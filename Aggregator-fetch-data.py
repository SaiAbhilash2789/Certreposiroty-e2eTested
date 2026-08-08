import json
import logging
import os
import time
import boto3
from decimal import Decimal

logger = logging.getLogger()
# Configurable via env var so verbosity can change without a redeploy -
# e.g. set LOG_LEVEL=DEBUG temporarily while investigating an issue.
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

TABLE_NAME = os.environ["TABLE_NAME"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

RESPONSE_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
}

PROJECTION_EXPRESSION = (
    "accountId, "
    "#dc, "
    "domainName, "
    "certProvider, "
    "expiryDate, "
    "renewalFrequency, "
    "teamOwner, "
    "manager, "
    "escalationMatrix, "
    "slackAlerting, "
    "slackChannelName, "
    "pagerDutyAlerting, "
    "app, "
    "ci, "
    "#type, "
    "#env"
)

EXPRESSION_ATTRIBUTE_NAMES = {
    "#dc": "Domain#cert",
    "#type": "type",
    "#env": "environment",
}


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


def slog(event, request_id=None, level="info", **kwargs):
    """
    Structured JSON logging helper. Every call is tagged with the Lambda
    request ID (when available) so a specific user-facing error can be
    correlated back to one exact invocation's full log trail in CloudWatch -
    without it, "FetchFailed" entries from concurrent invocations are
    indistinguishable from each other.
    """
    payload = {"event": event, **kwargs}
    if request_id:
        payload["requestId"] = request_id
    line = json.dumps(payload, default=str)
    getattr(logger, level, logger.info)(line)


def _safe_sort_key(row):
    # dict.get(key, default)'s default only applies when the key is
    # ABSENT - not when it's present with value None. DynamoDB happily
    # stores and returns an explicit null as Python None, so
    # row.get("expiryDate", "") previously returned None (not "") for any
    # record with a null expiryDate, and comparing None < str crashed the
    # sort for the ENTIRE batch - one bad record took down every user's
    # request, not just the one with missing data. `or ""` catches both
    # "key absent" and "key present but None"; .get()'s default only
    # catches the first.
    return (row.get("expiryDate") or "", row.get("domainName") or "")


def _build_cert_id(cert, request_id=None):
    """
    Builds a collision-resistant, stable identifier for one certificate
    record. Previously this joined accountId and Domain#cert with "_" and
    then replaced "#" with "_" too, which meant two DIFFERENT, legitimate
    records could produce the IDENTICAL id whenever either field's content
    made the join ambiguous (e.g. accountId="123", Domain#cert="abc#456"
    collided with accountId="123_abc", Domain#cert="456"). A null byte
    can't appear in either field's real-world content, so joining on it
    removes the ambiguity without needing a hash.
    """
    account_id = cert.get("accountId", "unknown")
    domain_cert = cert.get("Domain#cert", "unknown")
    return f"{account_id}\x00{domain_cert}".replace("\x00", "::")


def lambda_handler(event, context):
    start = time.time()
    request_id = getattr(context, "aws_request_id", None)

    try:
        items = []
        pages_scanned = 0

        scan_kwargs = {
            "ProjectionExpression": PROJECTION_EXPRESSION,
            "ExpressionAttributeNames": EXPRESSION_ATTRIBUTE_NAMES,
        }

        while True:
            response = table.scan(**scan_kwargs)
            pages_scanned += 1
            items.extend(response.get("Items", []))

            if "LastEvaluatedKey" not in response:
                break

            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

        # Proactive data-quality telemetry: surface records with a missing
        # or null expiryDate as a WARNING before they can cause a problem,
        # rather than only ever finding out via a crash or a silently wrong
        # sort position. This is cheap to compute alongside the sort itself.
        missing_expiry = [
            (row.get("accountId", "unknown"), row.get("domainName", "unknown"))
            for row in items
            if not row.get("expiryDate")
        ]
        if missing_expiry:
            slog(
                "RecordsMissingExpiryDate",
                request_id=request_id,
                level="warning",
                count=len(missing_expiry),
                sample=missing_expiry[:10],
            )

        items.sort(key=_safe_sort_key)

        seen_ids = {}
        duplicate_ids = []
        for cert in items:
            # accountId is serialized as a JSON number by default once it's
            # a DynamoDB Number - fine for typical 12-digit AWS account IDs,
            # but any value beyond Number.MAX_SAFE_INTEGER (2^53-1) is
            # silently corrupted the moment a JS client's JSON.parse touches
            # it (confirmed: input 9007199254741013 -> JS receives
            # 9007199254741012). Converting to a string here preserves full
            # precision across the wire regardless of magnitude.
            if "accountId" in cert:
                cert["accountId"] = str(cert["accountId"])

            cert["id"] = _build_cert_id(cert, request_id)
            if cert["id"] in seen_ids:
                duplicate_ids.append(cert["id"])
            seen_ids[cert["id"]] = True

        # Even with the improved separator, log if a collision somehow still
        # occurs (e.g. two records that are genuinely identical on both key
        # fields) - the frontend grid requires a unique id per row, and a
        # silent duplicate causes confusing, hard-to-trace UI bugs (wrong
        # row selected/highlighted) with no error anywhere to point at.
        if duplicate_ids:
            slog(
                "DuplicateCertIdsDetected",
                request_id=request_id,
                level="warning",
                count=len(duplicate_ids),
                sample=duplicate_ids[:10],
            )

        execution_time = round(time.time() - start, 2)

        if items:
            slog("FetchCompleted",
                 request_id=request_id,
                 recordsReturned=len(items),
                 pagesScanned=pages_scanned,
                 executionSeconds=execution_time)
        else:
            slog("NoCertificatesFound",
                 request_id=request_id,
                 pagesScanned=pages_scanned,
                 executionSeconds=execution_time)

        return {
            "statusCode": 200,
            "headers": RESPONSE_HEADERS,
            "body": json.dumps(items, cls=DecimalEncoder),
        }

    except Exception as e:
        execution_time = round(time.time() - start, 2)

        # logger.exception logs the full traceback (visible in CloudWatch)
        # - kept as-is since it's the most useful thing for actually
        # debugging what broke. The structured slog call alongside it adds
        # the request ID and exception TYPE (not just str(e), which for
        # something like a bare TypeError can be uninformative on its own)
        # so a CloudWatch Logs Insights query can filter/aggregate on
        # errorType without parsing free-text messages.
        logger.exception("Failed retrieving certificates")

        slog(
            "FetchFailed",
            request_id=request_id,
            level="error",
            executionSeconds=execution_time,
            errorType=type(e).__name__,
            error=str(e),
        )

        # Return a generic error message to the client.
        # Detailed exception information is available in CloudWatch logs,
        # correlated by requestId above.
        return {
            "statusCode": 500,
            "headers": RESPONSE_HEADERS,
            "body": json.dumps({
                "message": "Failed to retrieve certificates. Please try again later.",
                "requestId": request_id,
            }),
        }
