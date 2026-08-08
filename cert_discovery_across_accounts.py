import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from threading import Lock

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

BOTO_CONFIG = Config(retries={"max_attempts": 6, "mode": "standard"})

# BUG-18 fix: writes now go through individual put_item() calls (see
# save_to_dynamodb below) instead of the low-level batch_write_item API
# from the previous BUG-14 fix. MAX_DDB_WRITE_WORKERS bounds how many of
# those run concurrently.
MAX_DDB_WRITE_WORKERS = int(os.environ.get("MAX_DDB_WRITE_WORKERS", "10"))

dynamodb = boto3.resource("dynamodb", config=BOTO_CONFIG)
sts_client = boto3.client("sts", config=BOTO_CONFIG)
ssm_client = boto3.client("ssm", config=BOTO_CONFIG)

TABLE_NAME = os.environ["TABLE_NAME"]
ROLE_NAME = os.environ["CROSS_ACCOUNT_ROLE_NAME"]
AWS_REGIONS = [r.strip() for r in os.environ["AWS_REGIONS"].split(",") if r.strip()]

# BUG-08 fix: fail fast and loudly at cold start if no regions are
# configured, instead of silently completing every invocation with
# statusCode 200 / certificatesFound: 0 -- which was indistinguishable
# from "scanned everything, genuinely found nothing." A bad/empty
# AWS_REGIONS env var now crashes Lambda initialization outright (a
# clearly visible Init error in CloudWatch), rather than looking like a
# healthy, uneventful run.
if not AWS_REGIONS:
    raise ValueError(
        "AWS_REGIONS must contain at least one region (comma-separated, "
        "e.g. 'us-east-1,us-west-2'). Got an empty/unset value -- refusing "
        "to start, since running with zero regions would otherwise "
        "silently report success with zero certificates found."
    )

TARGET_ACCOUNTS_SSM_PARAMETER = os.environ["TARGET_ACCOUNTS_SSM_PARAMETER"].strip()
TARGET_ACCOUNTS_ENV = [
    a.strip() for a in os.environ.get("TARGET_ACCOUNTS", "").split(",") if a.strip()
]
EXTERNAL_ID = os.environ.get("CROSS_ACCOUNT_EXTERNAL_ID", "").strip() or None
ASSUME_ROLE_DURATION_SECONDS = int(
    os.environ.get("ASSUME_ROLE_DURATION_SECONDS", "900")
)

# BUG-06 fix: region-level fan-out is now capped, not 1:1 with region
# count. With 2 configured regions (us-east-1, us-west-2) this still
# processes both fully in parallel (min(2, 8) == 2); the cap only kicks
# in if the region list ever grows.
MAX_REGION_WORKERS = int(os.environ.get("MAX_REGION_WORKERS", "8"))

# BUG-07 fix: describe_certificate calls within a region are now
# parallelized too, bounded by this cap.
MAX_DESCRIBE_WORKERS = int(os.environ.get("MAX_DESCRIBE_WORKERS", "10"))


class DiscoveryFailedError(Exception):
    """
    Raised (rather than returned as a 200/207/500 dict) so that a
    directly-invoked Lambda's CloudWatch "Errors" metric, any configured
    EventBridge retry policy, DLQ redrive, or Lambda Destinations
    on-failure routing actually see this invocation as a failure.
    Previously the function always returned a plain dict regardless of
    outcome, which none of those mechanisms observe.
    """

    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or {}


def slog(event, **kwargs):
    logger.info(json.dumps({"event": event, **kwargs}))


def get_target_accounts():
    if TARGET_ACCOUNTS_SSM_PARAMETER:
        try:
            value = ssm_client.get_parameter(
                Name=TARGET_ACCOUNTS_SSM_PARAMETER
            )["Parameter"]["Value"]
            accounts = [a.strip() for a in value.split(",") if a.strip()]
            if accounts:
                return accounts
            logger.warning("SSM parameter was empty, falling back to TARGET_ACCOUNTS.")
        except ClientError as e:
            logger.error(f"Failed reading SSM parameter: {e}. Falling back to TARGET_ACCOUNTS.")
    return TARGET_ACCOUNTS_ENV


def assume_role(account_id):
    params = {
        "RoleArn": f"arn:aws:iam::{account_id}:role/{ROLE_NAME}",
        "RoleSessionName": "CertRegistryDiscoverySession",
        "DurationSeconds": ASSUME_ROLE_DURATION_SECONDS,
    }
    if EXTERNAL_ID:
        params["ExternalId"] = EXTERNAL_ID
    return sts_client.assume_role(**params)["Credentials"]


def fetch_region(credentials, account_id, region, metrics, lock):
    acm = boto3.client(
        "acm",
        region_name=region,
        aws_access_key_id=credentials["AccessKeyId"],
        aws_secret_access_key=credentials["SecretAccessKey"],
        aws_session_token=credentials["SessionToken"],
        config=BOTO_CONFIG,
    )

    now = datetime.now(timezone.utc).isoformat()
    results = []
    describe_failures = []

    # BUG-15 fix: no more no-op `except ClientError: raise` here. If
    # list_certificates fails, the exception propagates naturally;
    # process_account() already catches and logs it per-region.
    cert_summaries = []
    paginator = acm.get_paginator("list_certificates")
    for page in paginator.paginate():
        cert_summaries.extend(page.get("CertificateSummaryList", []))

    def describe_one(cert):
        arn = cert["CertificateArn"]
        try:
            detail = acm.describe_certificate(CertificateArn=arn)["Certificate"]
            return {
                "item": {
                    "awsAccount": account_id,
                    "Domain#cert": f'{cert["DomainName"]}#{arn.split("/")[-1]}',
                    "domainName": cert["DomainName"],
                    "certProvider": detail.get("Issuer", "Unknown"),
                    "expiryDate": detail["NotAfter"].isoformat() if detail.get("NotAfter") else "N/A",
                    "region": region,
                    "updatedAt": now,
                },
                "failure": None,
            }
        except ClientError as e:
            # BUG-05 fix: capture the actual error, not just the ARN.
            return {"item": None, "failure": {"arn": arn, "error": str(e)}}

    # BUG-07 fix: describe_certificate calls for this region's certs now
    # run concurrently instead of one at a time in a for-loop.
    if cert_summaries:
        with ThreadPoolExecutor(
            max_workers=min(MAX_DESCRIBE_WORKERS, len(cert_summaries))
        ) as describe_pool:
            futures = [describe_pool.submit(describe_one, cert) for cert in cert_summaries]
            for future in as_completed(futures):
                outcome = future.result()
                if outcome["item"] is not None:
                    results.append(outcome["item"])
                else:
                    describe_failures.append(outcome["failure"])

    with lock:
        metrics["regionsProcessed"] += 1
        metrics["certificatesFound"] += len(results)
        metrics["describeFailures"] += len(describe_failures)

    if describe_failures:
        slog(
            "DescribeFailures",
            account=account_id,
            region=region,
            failedCount=len(describe_failures),
            sampleFailures=describe_failures[:10],
        )

    return results


def process_account(account_id, metrics, lock):
    credentials = assume_role(account_id)
    results = []
    failed_regions = []

    with ThreadPoolExecutor(
        max_workers=min(MAX_REGION_WORKERS, max(1, len(AWS_REGIONS)))
    ) as executor:
        futures = {
            executor.submit(fetch_region, credentials, account_id, region, metrics, lock): region
            for region in AWS_REGIONS
        }

        for future in as_completed(futures):
            region = futures[future]
            try:
                results.extend(future.result())
            except Exception as e:
                failed_regions.append(region)
                slog("RegionFailed", account=account_id, region=region, error=str(e))

    with lock:
        metrics["accountsProcessed"] += 1

    slog("AccountCompleted", account=account_id,
         certificates=len(results), failedRegions=failed_regions)
    return results, failed_regions


def _dedupe_items_by_key(items):
    """
    Cheap safety net: collapses any items sharing the same primary key
    (awsAccount + Domain#cert) before writing, keeping the LAST
    occurrence. Can genuinely happen if ACM's list_certificates
    pagination overlaps with certificates being created/rotated
    concurrently during a scan. With individual put_item() calls (see
    below) a duplicate is no longer harmful -- it would just mean two
    redundant, overwriting writes for the same key -- but skipping the
    redundant call is still worth doing.
    """
    deduped = {}
    for item in items:
        key = (item.get("awsAccount"), item.get("Domain#cert"))
        deduped[key] = item
    if len(deduped) != len(items):
        slog(
            "DuplicateItemsDroppedBeforeWrite",
            totalItems=len(items),
            uniqueItems=len(deduped),
            duplicatesDropped=len(items) - len(deduped),
        )
    return list(deduped.values())


def save_to_dynamodb(items, metrics):
    """
    BUG-18 fix. Writes each certificate individually via the high-level
    Table.put_item(), which handles Python -> DynamoDB type conversion
    automatically -- the same serialization path the original code used
    and that was proven correct in production.

    This replaces the previous BUG-14 fix, which used the low-level
    batch_write_item API. That approach had a fundamental flaw:
    BatchWriteItem's UnprocessedItems mechanism only reports back items
    that failed due to throttling/capacity limits. For a STRUCTURAL
    failure (e.g. a validation error), the entire call raises with NO
    per-item breakdown at all -- every item in that call gets blamed
    collectively, regardless of which one (or what combination) actually
    caused it. That's precisely what was observed in production: 6
    distinct, well-formed certificates, one opaque whole-batch
    rejection, impossible to attribute to a specific cause.

    Individual put_item() calls don't have this problem by construction:
    each call's success or failure is attributable to exactly one item.
    Calls are parallelized (bounded by MAX_DDB_WRITE_WORKERS) for
    throughput. Automatic retry for genuinely transient errors
    (throttling, etc.) is handled by botocore's own built-in retry
    configuration (see BOTO_CONFIG) -- no custom retry loop needed, and
    botocore's "standard" retry mode already does not retry permanent
    errors like ValidationException, so BUG-16's fail-fast concern is
    naturally satisfied without bespoke logic to get wrong.
    """
    table = dynamodb.Table(TABLE_NAME)
    items = _dedupe_items_by_key(items)
    failed_keys = []
    write_lock = Lock()

    def _put_one(item):
        try:
            table.put_item(Item=item)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            slog(
                "PutItemFailed",
                key=item.get("Domain#cert"),
                account=item.get("awsAccount"),
                errorCode=error_code,
                error=str(e),
            )
            with write_lock:
                failed_keys.append(item.get("Domain#cert"))

    if items:
        with ThreadPoolExecutor(max_workers=min(MAX_DDB_WRITE_WORKERS, len(items))) as pool:
            list(pool.map(_put_one, items))

    if failed_keys:
        slog("BatchWriteFailed", failedCount=len(failed_keys), failedKeys=failed_keys)

    # Accumulate, since save_to_dynamodb is called once per account
    # (see BUG-01 fix), not once globally.
    metrics["writeFailures"] += len(failed_keys)
    return len(failed_keys)


def _summarize_failure(summary, max_listed=5):
    """
    Builds a short, human-readable summary for DiscoveryFailedError's
    message itself -- so the failure reason is visible directly in the
    Lambda console/CLI/EventBridge error output (errorMessage), without
    requiring a trip into CloudWatch Logs just to learn WHAT failed.
    The full detail always remains available via slog("DiscoveryFailed",
    ...) and the exception's .details attribute.
    """
    parts = []

    accounts_failed = summary["accountsFailed"]
    if accounts_failed:
        shown = ", ".join(accounts_failed[:max_listed])
        more = f" (+{len(accounts_failed) - max_listed} more)" if len(accounts_failed) > max_listed else ""
        parts.append(f"{len(accounts_failed)} account(s) failed: {shown}{more}")

    failed_regions = summary["failedRegions"]
    if failed_regions:
        entries = list(failed_regions.items())
        shown = ", ".join(f"{acct}:{','.join(regions)}" for acct, regions in entries[:max_listed])
        more = f" (+{len(entries) - max_listed} more)" if len(entries) > max_listed else ""
        parts.append(f"{len(entries)} account(s) had region failures: {shown}{more}")

    write_failures = summary["certificatesFailedToWrite"]
    if write_failures:
        parts.append(f"{write_failures} certificate(s) failed to write to DynamoDB")

    return "; ".join(parts) if parts else "unknown failure"


def _raise_discovery_failed(summary):
    reason = _summarize_failure(summary)
    slog("DiscoveryFailed", summary=summary)
    raise DiscoveryFailedError(
        f"Certificate discovery completed with failures: {reason}. "
        f"See the DiscoveryFailed / AccountFailed / RegionFailed / "
        f"BatchWriteFailed log entries for full detail.",
        details=summary,
    )


def lambda_handler(event, context):
    start = time.time()

    metrics = {
        "accountsProcessed": 0,
        "accountsFailed": 0,
        "regionsProcessed": 0,
        "certificatesFound": 0,
        "describeFailures": 0,
        "writeFailures": 0,
    }

    lock = Lock()
    accounts = get_target_accounts()

    if not accounts:
        slog("NoTargetAccountsConfigured")
        # Bug 1 fix: raise instead of returning a 500 dict, so this
        # invocation is actually visible to CloudWatch/EventBridge/DLQ.
        raise DiscoveryFailedError("No target accounts configured.")

    failed_accounts = []
    failed_regions = {}

    with ThreadPoolExecutor(max_workers=min(10, len(accounts))) as executor:
        futures = {
            executor.submit(process_account, account, metrics, lock): account
            for account in accounts
        }

        for future in as_completed(futures):
            account = futures[future]
            try:
                items, regions = future.result()
            except Exception as e:
                failed_accounts.append(account)
                metrics["accountsFailed"] += 1
                slog("AccountFailed", account=account, error=str(e))
                continue

            if regions:
                failed_regions[account] = regions

            if items:
                # BUG-01 fix: write each account's results to DynamoDB
                # as soon as they're ready, instead of accumulating
                # every account's data in memory and writing once at
                # the very end. Bounds data loss, on interruption, to
                # whichever account(s) were still in flight -- not the
                # entire run.
                save_to_dynamodb(items, metrics)

    elapsed = round(time.time() - start, 2)

    summary = {
        "accountsProcessed": metrics["accountsProcessed"],
        "accountsFailed": failed_accounts,
        # BUG-09 fix: the previously-dead metrics["accountsFailed"]
        # counter is now actually surfaced in the response/logs.
        "accountsFailedCount": metrics["accountsFailed"],
        "failedRegions": failed_regions,
        "certificatesFound": metrics["certificatesFound"],
        "certificatesFailedToWrite": metrics["writeFailures"],
        "executionSeconds": elapsed,
    }

    slog(
        "DiscoveryCompleted",
        executionSeconds=elapsed,
        metrics=metrics,
        failedAccounts=failed_accounts,
        failedRegions=failed_regions,
    )

    # BUG-12 + Bug-1 fix: failure now factors in ALL THREE failure
    # tiers -- account, region, and write -- and raises rather than
    # silently returning a 207. A fully clean run is unaffected: it
    # still returns a normal 200 body, exactly as before.
    if failed_accounts or failed_regions or metrics["writeFailures"]:
        _raise_discovery_failed(summary)

    return {
        "statusCode": 200,
        "body": json.dumps(summary),
    }
