import os
import json
import time
import logging
import boto3
from concurrent.futures import ThreadPoolExecutor, as_completed
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def log_event(event_name, **fields):
    """
    Emit a single structured JSON log line so CloudWatch Logs Insights can
    query on `event` and any of the given fields directly, instead of
    regex-parsing free-text messages.
    """
    payload = {"event": event_name}
    payload.update(fields)
    logger.info(json.dumps(payload, default=str))


# --- Retry/backoff configuration -------------------------------------------------
# The SDK-level config below handles throttling and transient network/server errors
# (e.g. ProvisionedThroughputExceededException, 5xx) automatically before a call
# ever returns to our code. It does NOT retry UnprocessedItems/UnprocessedKeys
# returned inside a successful batch response -- those are valid, non-error
# responses and retrying them is the caller's responsibility. That's what the
# manual loops in batch_write_with_time_guard and get_preferences_map are for.
# Keeping SDK attempts modest avoids the two layers compounding into very long
# stalls on a genuinely failing chunk.
BOTO_CONFIG = Config(retries={'max_attempts': 4, 'mode': 'standard'})
dynamodb = boto3.resource('dynamodb', config=BOTO_CONFIG)

# --- BUG-04 FIX ---------------------------------------------------------------
# Some ClientErrors are not transient and will fail identically on every retry
# (e.g. a malformed request, or an IAM policy that doesn't grant the needed
# action). Retrying these wastes the retry budget AND the Lambda's remaining
# time-budget window, which can cause otherwise-healthy later chunks to get
# skipped by the time guard as collateral damage. Anything in this set is
# treated as an immediate, non-retryable failure for a given chunk instead of
# being pushed through the same exponential-backoff path as throttling.
NON_RETRYABLE_ERROR_CODES = {
    'ValidationException',
    'AccessDeniedException',
    'ResourceNotFoundException',
    'UnrecognizedClientException',
    'MissingAuthenticationTokenException',
}

# --- DynamoDB Table Names from Environment Variables ------------------------------
# All four table names are now required (no fallback): each is now explicitly
# configured in the Lambda's environment, so a missing/misconfigured value should
# fail loudly at cold start (KeyError) rather than silently falling back to a name
# that may not match the real deployed table -- the old SERVICE_REGISTRY_TABLE
# fallback in particular was a typo ("Sevice-registry-table") that never matched
# the actual table name.
CERT_TABLE_NAME = os.environ['CERT_REGISTRY_TABLE']
SERVICE_TABLE_NAME = os.environ['SERVICE_REGISTRY_TABLE']
AGGREGATE_TABLE_NAME = os.environ['AGGREGATE_TABLE']
# New: user-managed alert toggles now live in their own table, keyed the same
# way as AggregateTable-3 (accountId partition / Domain#cert sort). This lets us
# fetch only the handful of keys we're about to write instead of scanning the
# (much larger, ever-growing) aggregate table every run.
# Deliberately required (no default): this table gates whether Slack/PagerDuty
# actually fire. A missing/misconfigured value should fail loudly at cold start
# (KeyError) rather than silently pointing at a nonexistent/empty table, which
# would make every cert look like "nobody's configured alerts yet" with no error.
PREFERENCES_TABLE_NAME = os.environ['PREFERENCES_TABLE']

cert_table = dynamodb.Table(CERT_TABLE_NAME)
service_table = dynamodb.Table(SERVICE_TABLE_NAME)

# AggregateTable-3 key schema: partition key = 'accountId' (plain 12-digit AWS
# account ID), sort key = 'Domain#cert'. Together this allows any account to hold
# multiple certificates without collision -- each (accountId, Domain#cert) pair is
# unique. 'environment' and 'app' are plain, non-key columns: given the data model
# (one account -> one app -> one environment), they never need to double as a key
# element themselves.
UNKNOWN_ENVIRONMENT = 'N/A'  # default for the standalone 'environment' column when
                              # an account has no service registry entry

# --- BUG-05 FIX -----------------------------------------------------------------
# Upper bound on scan parallelism. Previously only a lower bound (>0) was
# enforced, so a misconfigured env var (e.g. SCAN_SEGMENTS=1000) would spin up
# that many ThreadPoolExecutor workers, risking resource exhaustion in the
# execution environment and an outsized RCU spike against the table. Values
# above this are clamped (with a logged warning) rather than rejected outright,
# since an overly-high value should degrade gracefully like the non-integer
# case below, not take the whole job down.
MAX_SCAN_SEGMENTS = 20

# Configurable scan parallelism -- was hardcoded to 4. Falls back to 4 on a
# missing or non-integer value rather than raising, since a bad env var should
# degrade gracefully, not take the whole aggregation job down.
try:
    SCAN_SEGMENTS = int(os.environ.get('SCAN_SEGMENTS', '4'))
    if SCAN_SEGMENTS <= 0:
        raise ValueError(f"SCAN_SEGMENTS must be positive, got {SCAN_SEGMENTS}")
    if SCAN_SEGMENTS > MAX_SCAN_SEGMENTS:
        log_event(
            "ScanSegmentsClamped",
            requestedValue=SCAN_SEGMENTS,
            clampedTo=MAX_SCAN_SEGMENTS
        )
        SCAN_SEGMENTS = MAX_SCAN_SEGMENTS
except (TypeError, ValueError) as e:
    log_event("InvalidScanSegmentsEnvVar", fallbackValue=4, error=str(e))
    SCAN_SEGMENTS = 4

# Only the attributes each downstream step actually needs. Reduces network
# transfer and Lambda memory footprint. NOTE: this does NOT reduce DynamoDB read
# capacity consumption on a Scan -- DynamoDB still reads full items off disk and
# filters after the fact, so RCU cost is unchanged. The benefit here is purely
# payload size / memory, not read cost.
CERT_TABLE_ATTRS = ['awsAccount', 'Domain#cert', 'domainName', 'certProvider', 'expiryDate']
SERVICE_TABLE_ATTRS = [
    'AWS Account', 'awsAccount', 'app', 'environment', 'ci', 'escalationMatrix',
    'manager', 'renewalFrequency', 'runbook', 'slackChannelName', 'teamOwner', 'type'
]
PREFERENCES_TABLE_ATTRS = ['accountId', 'Domain#cert', 'slackAlerting', 'pagerDutyAlerting']


def build_projection(attrs):
    """
    Builds a (ProjectionExpression, ExpressionAttributeNames) pair using
    placeholder names for every attribute. Placeholders are used unconditionally
    -- not just for known reserved words like 'type' -- because several of our
    real attribute names contain spaces (e.g. 'AWS Account') or '#' characters
    (e.g. 'Domain#cert'), which aren't valid unescaped in a ProjectionExpression
    and would otherwise silently collide with expression-attribute-name syntax.
    """
    names = {}
    parts = []
    for i, attr in enumerate(attrs):
        placeholder = f'#a{i}'
        names[placeholder] = attr
        parts.append(placeholder)
    return ', '.join(parts), names


def sanitize_account_id(raw_acc):
    """
    Validates raw account inputs and returns a 12-digit AWS account ID string,
    or None if raw_acc is missing or malformed.

    --- BUG-02 / BUG-03 / BUG-06 FIX -------------------------------------------
    Previously this function stripped any non-digit character out of the input
    (e.g. "-123456789012" -> "123456789012", silently turning a negative number
    into a "valid" account ID) and zero-padded anything from 9-12 digits up to
    a full 12 digits (e.g. "123456789" -> "000123456789"), which can fabricate
    a plausible-but-wrong account ID out of a truncated/corrupted input rather
    than rejecting it.

    Real AWS account IDs are always EXACTLY 12 digits with no other characters.
    This function now enforces that directly instead of "fixing" malformed
    input by editing it: anything that isn't already a clean 12-digit numeric
    string is rejected and logged, so bad upstream data surfaces as a visible
    "unmapped/skipped" record instead of a silently wrong mapping.
    """
    if raw_acc is None:
        # --- LOGGING FIX ---------------------------------------------------
        # Every other rejection branch in this function logs a reason; this
        # one silently returned None, making a missing account field
        # indistinguishable in the logs from a valid, successfully-processed
        # record. Logged for consistency and debuggability.
        log_event("InvalidAccountId", reason="missingValue", rawValue=raw_acc)
        return None

    acc_str = str(raw_acc).strip()
    if not acc_str:
        # --- LOGGING FIX ---------------------------------------------------
        # Same gap as above: an empty or whitespace-only value was silently
        # rejected with no log line.
        log_event("InvalidAccountId", reason="emptyOrWhitespaceOnly", rawValue=raw_acc)
        return None

    # Reject scientific-notation / float-looking values outright (e.g. a DynamoDB
    # Number stored as 1.002e+11). These would otherwise fail the exact-digits
    # check below anyway, but this gives a clearer log reason.
    lowered = acc_str.lower()
    if '.' in lowered or 'e' in lowered:
        log_event("InvalidAccountId", reason="scientificOrDecimalNotation", rawValue=raw_acc)
        return None

    # Must be purely digits -- no leading '-', no separators, no stray
    # characters. str.isdigit() correctly rejects a leading '-' (BUG-03),
    # unlike the old "keep only digit characters" filter.
    if not acc_str.isdigit():
        log_event("InvalidAccountId", reason="containsNonDigitCharacters", rawValue=raw_acc)
        return None

    # Must be exactly 12 digits -- no padding of short/truncated values
    # (BUG-02). A 9-11 digit value is more likely truncated/corrupted data
    # than a legitimate account ID, and padding it silently produces a
    # different, wrong-but-plausible-looking account ID.
    if len(acc_str) != 12:
        log_event("InvalidAccountId", reason="mustBeExactly12Digits", rawValue=raw_acc)
        return None

    # Reject the degenerate all-zeros case (BUG-06) -- never a real account ID.
    if acc_str == '0' * 12:
        log_event("InvalidAccountId", reason="allZeroAccountId", rawValue=raw_acc)
        return None

    return acc_str


def scan_table_parallel(table, total_segments=None, projection_expression=None, expression_attribute_names=None):
    """
    Full table scan using parallel segments for faster reads on large tables.
    Falls back gracefully to a single segment if total_segments <= 1.
    Accepts an optional ProjectionExpression to limit returned attributes.
    """
    if total_segments is None:
        total_segments = SCAN_SEGMENTS

    if total_segments <= 1:
        return scan_table(table, projection_expression, expression_attribute_names)

    items = []

    def scan_segment(segment):
        segment_items = []
        scan_kwargs = {'Segment': segment, 'TotalSegments': total_segments}
        if projection_expression:
            scan_kwargs['ProjectionExpression'] = projection_expression
            scan_kwargs['ExpressionAttributeNames'] = expression_attribute_names
        while True:
            response = table.scan(**scan_kwargs)
            segment_items.extend(response.get('Items', []))
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                break
            scan_kwargs['ExclusiveStartKey'] = last_key
        return segment_items

    with ThreadPoolExecutor(max_workers=total_segments) as executor:
        futures = [executor.submit(scan_segment, seg) for seg in range(total_segments)]
        for future in as_completed(futures):
            items.extend(future.result())

    return items


def scan_table(table, projection_expression=None, expression_attribute_names=None):
    """
    Helper to perform a full table scan using the high-level Resource API.
    Auto-deserializes DynamoDB types into native Python types and handles pagination.
    Accepts an optional ProjectionExpression to limit returned attributes.
    """
    items = []
    scan_kwargs = {}
    if projection_expression:
        scan_kwargs['ProjectionExpression'] = projection_expression
        scan_kwargs['ExpressionAttributeNames'] = expression_attribute_names

    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get('Items', []))

        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            break
        scan_kwargs['ExclusiveStartKey'] = last_key

    return items


def deterministic_order(items):
    """
    --- BUG-07 FIX (found via E2E execution, not static review) -----------------
    scan_table_parallel() farms segments out to a ThreadPoolExecutor and collects
    results via as_completed(), so the ORDER items come back in is whichever
    thread happens to finish first -- which varies run to run even for identical
    underlying data. Downstream, whenever two items collide on the same key (the
    ServiceRegistry duplicate-account case in _run_aggregation, and equally the
    CertRegistry case if two cert rows ever mapped to the same (accountId,
    Domain#cert)), the code keeps "the first one encountered." Fed a
    non-deterministically-ordered list, "first encountered" is itself
    non-deterministic -- confirmed empirically: the same seed data picked a
    different winner in 3 of 8 repeated runs during E2E testing.
    Sorting scan results into a stable, content-derived order before any
    duplicate-resolution logic runs makes "first occurrence wins" actually mean
    something reproducible: the same underlying data always produces the same
    winner, regardless of which scan segment/thread happened to finish first.
    This is an arbitrary tiebreak (the data model has no real "priority" field
    to break ties with) but a REPRODUCIBLE one, which is what matters for
    testability and for not silently flip-flopping between runs in production.
    """
    return sorted(items, key=lambda it: json.dumps(it, sort_keys=True, default=str))


def get_service_details_map():
    """
    Scans Service Registry and maps 12-digit Account IDs to lists of app metadata.
    """
    service_map = {}
    projection, names = build_projection(SERVICE_TABLE_ATTRS)
    raw_items = scan_table_parallel(service_table, projection_expression=projection, expression_attribute_names=names)
    raw_items = deterministic_order(raw_items)  # BUG-07 fix

    for item in raw_items:
        raw_acc = item.get('AWS Account') or item.get('awsAccount')
        acc_id = sanitize_account_id(raw_acc)

        if not acc_id:
            continue

        app_metadata = {
            'app': item.get('app', 'Unassigned'),
            'environment': item.get('environment', UNKNOWN_ENVIRONMENT),
            'ci': item.get('ci', 'N/A'),
            'escalationMatrix': item.get('escalationMatrix', 'N/A'),
            'manager': item.get('manager', 'N/A'),
            'renewalFrequency': item.get('renewalFrequency', 'N/A'),
            'runbook': item.get('runbook', 'N/A'),
            'slackChannelName': item.get('slackChannelName', 'N/A'),
            'teamOwner': item.get('teamOwner', 'N/A'),
            'type': item.get('type', 'N/A')
        }

        if acc_id not in service_map:
            service_map[acc_id] = []
        service_map[acc_id].append(app_metadata)

    return service_map


def get_preferences_map(keys, context, max_retries=5, min_remaining_ms=15000):
    """
    Fetches user-managed alert-toggle preferences for exactly the
    (accountId, Domain#cert) keys we're about to write -- via BatchGetItem --
    instead of scanning the whole PreferencesTable (or AggregateTable, as the
    old code did). This is the main scalability fix: cost now scales with the
    number of certs in *this* run, not with the total size of a growing table.

    `keys` should be a concrete list of (accountId, cert_name) tuples (not a
    generator) since it's only safe to consume once here today, but passing a
    list keeps that guarantee explicit rather than implicit.
    Returns a dict keyed by (accountId, cert_name) -> {'slackAlerting': bool,
    'pagerDutyAlerting': bool}. Missing keys (no preference record yet) are
    simply absent from the returned map; callers should default to False.
    """
    client = dynamodb.meta.client
    projection, names = build_projection(PREFERENCES_TABLE_ATTRS)
    prefs_map = {}

    key_list = [{'accountId': acc_id, 'Domain#cert': cert_name} for acc_id, cert_name in keys]

    # BatchGetItem allows a maximum of 100 keys per call, so we chunk.
    for i in range(0, len(key_list), 100):
        if context and hasattr(context, 'get_remaining_time_in_millis'):
            remaining_ms = context.get_remaining_time_in_millis()
            if remaining_ms < min_remaining_ms:
                unfetched = len(key_list) - i
                log_event(
                    "PreferencesFetchTimeBudgetExceeded",
                    remainingMs=remaining_ms,
                    unfetchedKeys=unfetched
                )
                break

        chunk = key_list[i:i + 100]
        request_items = {
            PREFERENCES_TABLE_NAME: {
                'Keys': chunk,
                'ProjectionExpression': projection,
                'ExpressionAttributeNames': names
            }
        }

        retries = 0
        while request_items and retries <= max_retries:
            try:
                response = client.batch_get_item(RequestItems=request_items)
                for item in response.get('Responses', {}).get(PREFERENCES_TABLE_NAME, []):
                    key = (item.get('accountId'), item.get('Domain#cert'))
                    prefs_map[key] = {
                        'slackAlerting': item.get('slackAlerting', False),
                        'pagerDutyAlerting': item.get('pagerDutyAlerting', False)
                    }

                unprocessed = response.get('UnprocessedKeys', {})
                if not unprocessed or not unprocessed.get(PREFERENCES_TABLE_NAME):
                    request_items = None
                    break
                request_items = unprocessed
                retries += 1
                time.sleep(2 ** retries * 0.1)
            except ClientError as e:
                # --- BUG-04 FIX -------------------------------------------------
                # Non-retryable errors (bad request shape, permissions, etc.) will
                # fail identically every time. Stop immediately instead of burning
                # the retry budget and time-budget window on guaranteed failures.
                error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                if error_code in NON_RETRYABLE_ERROR_CODES:
                    log_event(
                        "PreferencesFetchNonRetryableError",
                        chunkStartIndex=i,
                        errorCode=error_code,
                        error=str(e)
                    )
                    break
                log_event("PreferencesFetchError", chunkStartIndex=i, errorCode=error_code, error=str(e))
                retries += 1
                time.sleep(2 ** retries * 0.1)

        if request_items and PREFERENCES_TABLE_NAME in request_items:
            dropped = len(request_items[PREFERENCES_TABLE_NAME].get('Keys', []))
            log_event(
                "PreferencesFetchGaveUp",
                chunkStartIndex=i,
                keysDropped=dropped
            )

    return prefs_map


def batch_write_with_time_guard(table_name, items, context, max_retries=5, min_remaining_ms=15000):
    """
    Writes items in chunks of 25 with exponential backoff.
    Checks context.get_remaining_time_in_millis() to prevent Lambda hard timeouts.

    NOTE: callers must ensure `items` contains no duplicate primary keys
    (accountId, Domain#cert) -- see BUG-01 fix in _run_aggregation, where
    pending_records is deduplicated before this function is ever called.
    DynamoDB's BatchWriteItem raises a non-retryable ValidationException if a
    single request contains duplicate keys for the same table, which would
    otherwise fail the ENTIRE 25-item chunk -- including unrelated, valid
    items that happened to share a chunk with the duplicate -- not just
    "silently overwrite" as a naive reading of BatchWriteItem might suggest.
    """
    client = dynamodb.meta.client
    failed_count = 0
    written_count = 0
    dropped_keys = []

    for i in range(0, len(items), 25):
        if context and hasattr(context, 'get_remaining_time_in_millis'):
            remaining_ms = context.get_remaining_time_in_millis()
            if remaining_ms < min_remaining_ms:
                unprocessed_remaining = items[i:]
                log_event(
                    "WriteTimeBudgetExceeded",
                    remainingMs=remaining_ms,
                    unwrittenCount=len(unprocessed_remaining)
                )
                failed_count += len(unprocessed_remaining)
                dropped_keys.extend(
                    (it.get('accountId'), it.get('Domain#cert')) for it in unprocessed_remaining
                )
                break

        chunk = items[i:i + 25]
        request_items = {
            table_name: [{'PutRequest': {'Item': item}} for item in chunk]
        }

        retries = 0
        while request_items and retries <= max_retries:
            try:
                response = client.batch_write_item(RequestItems=request_items)
                unprocessed = response.get('UnprocessedItems', {})

                if not unprocessed or not unprocessed.get(table_name):
                    written_count += len(chunk)
                    request_items = None  # clear so the post-loop check below
                                           # doesn't re-read the stale original chunk
                                           # and misreport a successful write as failed
                    break
                request_items = unprocessed
                retries += 1
                time.sleep(2 ** retries * 0.1)
            except ClientError as e:
                # --- BUG-04 FIX -------------------------------------------------
                # Stop immediately on non-retryable errors instead of retrying a
                # guaranteed failure up to max_retries times.
                error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                if error_code in NON_RETRYABLE_ERROR_CODES:
                    log_event(
                        "WriteChunkNonRetryableError",
                        chunkStartIndex=i,
                        errorCode=error_code,
                        error=str(e)
                    )
                    break
                log_event("WriteChunkError", chunkStartIndex=i, errorCode=error_code, error=str(e))
                retries += 1
                time.sleep(2 ** retries * 0.1)

        if request_items and table_name in request_items:
            failed_chunk_items = [r['PutRequest']['Item'] for r in request_items[table_name]]
            failed_in_chunk = len(failed_chunk_items)
            failed_count += failed_in_chunk
            written_count += (len(chunk) - failed_in_chunk)
            dropped_keys.extend(
                (it.get('accountId'), it.get('Domain#cert')) for it in failed_chunk_items
            )
            log_event(
                "WriteChunkFailedAfterRetries",
                chunkStartIndex=i,
                failedCount=failed_in_chunk
            )

    if dropped_keys:
        # Logging the specific keys (not just a count) so a partial run can be
        # reconciled manually instead of leaving a silent gap in the aggregate
        # table with no way to tell what's missing.
        log_event("WriteDroppedKeys", keys=dropped_keys)

    return written_count, failed_count


def lambda_handler(event, context):
    try:
        return _run_aggregation(event, context)
    except Exception as e:
        # Catches anything unexpected -- IAM/permissions errors, malformed
        # DynamoDB responses, etc. -- that would otherwise kill the function
        # with a raw traceback and no structured `event` field to query on.
        # Re-raise (don't swallow) so Lambda's own failure/retry/alarm behavior
        # -- e.g. an EventBridge retry policy or a CloudWatch alarm on Errors --
        # still sees this invocation as failed.
        log_event("AggregationFailed", errorType=type(e).__name__, error=str(e))
        raise


def _run_aggregation(event, context):
    log_event("AggregationStarted", scanSegments=SCAN_SEGMENTS)

    # 1. Fetch Service Registry metadata (projected columns only)
    service_map = get_service_details_map()

    # 2. Fetch all Certificate records (projected columns only)
    cert_projection, cert_names = build_projection(CERT_TABLE_ATTRS)
    cert_items = scan_table_parallel(
        cert_table, projection_expression=cert_projection, expression_attribute_names=cert_names
    )
    cert_items = deterministic_order(cert_items)  # BUG-07 fix -- see deterministic_order() docstring

    unmapped_accounts = set()
    duplicate_key_count = 0
    skipped_invalid_certs = 0

    # 3. First pass: build records without alert-toggle flags yet, and collect
    #    the exact keys we'll need preferences for.
    #
    # --- BUG-01 FIX ---------------------------------------------------------
    # Previously this was a plain list, and a duplicate (accountId, Domain#cert)
    # key (e.g. from two ServiceRegistry rows for the same account) produced two
    # separate records with the identical primary key. Those get handed to
    # batch_write_item, which raises a non-retryable ValidationException if a
    # single request contains duplicate keys for the same table -- silently
    # failing the ENTIRE 25-item write chunk, including unrelated valid items
    # that happened to land in the same chunk (chunk membership is
    # non-deterministic here since scanning is parallelized). "Last write wins"
    # was never actually true for this failure mode.
    #
    # Deduplicating here, at the point where the collision is first knowable,
    # makes the outcome deterministic (first occurrence wins) and keeps the bad
    # data contained to a single flagged record instead of collateral-damaging
    # up to 24 unrelated certs.
    pending_records_map = {}

    for cert_item in cert_items:
        raw_acc = cert_item.get('awsAccount')
        # Both CertRegistryTable's cert-identifier attribute and the
        # aggregate/preferences tables' own sort key attribute are named
        # 'Domain#cert'.
        cert_name = cert_item.get('Domain#cert')

        acc_id = sanitize_account_id(raw_acc)
        if not cert_name or not acc_id:
            skipped_invalid_certs += 1
            continue

        if acc_id in service_map:
            apps_list = service_map[acc_id]
        else:
            unmapped_accounts.add(acc_id)
            apps_list = [{
                'app': 'Unassigned',
                'environment': UNKNOWN_ENVIRONMENT,
                'ci': 'N/A',
                'escalationMatrix': 'N/A',
                'manager': 'N/A',
                'renewalFrequency': 'N/A',
                'runbook': 'N/A',
                'slackChannelName': 'N/A',
                'teamOwner': 'N/A',
                'type': 'N/A'
            }]

        for service_info in apps_list:
            record_key = (acc_id, str(cert_name))  # matches table's actual key:
                                                     # partition=accountId, sort=Domain#cert

            candidate_record = {
                'accountId': acc_id,
                'Domain#cert': str(cert_name),
                'environment': service_info['environment'],
                'certProvider': cert_item.get('certProvider', 'Unknown'),
                'domainName': cert_item.get('domainName', cert_name),
                'expiryDate': cert_item.get('expiryDate', 'N/A'),
                'app': service_info['app'],
                'ci': service_info['ci'],
                'escalationMatrix': service_info['escalationMatrix'],
                'manager': service_info['manager'],
                'renewalFrequency': service_info['renewalFrequency'],
                'runbook': service_info['runbook'],
                'slackChannelName': service_info['slackChannelName'],
                'teamOwner': service_info['teamOwner'],
                'type': service_info['type'],
            }

            if record_key in pending_records_map:
                # A real collision: the service registry produced more than one
                # metadata entry for this account (our data model assumes
                # one account -> one app/environment). Log BOTH the kept and
                # the discarded metadata so bad upstream data is fully visible
                # and reconcilable, then keep the first occurrence
                # deterministically rather than letting write-chunk ordering
                # decide (or corrupting an unrelated chunk).
                duplicate_key_count += 1
                log_event(
                    "DuplicateAggregateKeyDetected",
                    accountId=acc_id,
                    certKey=str(cert_name),
                    keptRecord=pending_records_map[record_key],
                    discardedRecord=candidate_record
                )
                continue  # keep first occurrence; do not overwrite

            pending_records_map[record_key] = candidate_record

    pending_records = list(pending_records_map.values())

    # 4. Fetch alert-toggle preferences only for the keys we actually need,
    #    instead of scanning the whole (much larger) aggregate/preferences table.
    # Built as an explicit list (not a generator) so the interface stays safe
    # even if get_preferences_map is ever changed to iterate `keys` more than once.
    # (These keys are now guaranteed unique thanks to the BUG-01 fix above.)
    preference_keys = [(r['accountId'], r['Domain#cert']) for r in pending_records]
    prefs_map = get_preferences_map(preference_keys, context)

    # 5. Second pass: merge in preference flags (defaulting to False for certs
    #    with no preference record yet, e.g. brand new certs).
    aggregated_items = []
    for record in pending_records:
        prefs = prefs_map.get((record['accountId'], record['Domain#cert']), {})
        record['slackAlerting'] = prefs.get('slackAlerting', False)
        record['pagerDutyAlerting'] = prefs.get('pagerDutyAlerting', False)
        aggregated_items.append(record)

    # 6. Write current records to AggregateTable with time-budget protection
    written_count, failed_writes = 0, 0
    if aggregated_items:
        written_count, failed_writes = batch_write_with_time_guard(
            AGGREGATE_TABLE_NAME,
            aggregated_items,
            context
        )

    # NOTE: reconciliation (deleting aggregate records that no longer correspond to
    # any current cert/service pairing) is intentionally not implemented yet -- to
    # be added later. This means stale rows from removed certs/accounts will persist
    # in AggregateTable-3 until that's built.

    body = {
        'totalCertificatesProcessed': len(cert_items),
        'totalAggregatedRecords': len(aggregated_items),
        'recordsSuccessfullyWritten': written_count,
        'recordsFailedToWrite': failed_writes,
        'unmappedAccountsCount': len(unmapped_accounts),
        'unmappedAccountsList': list(unmapped_accounts),
        'duplicateKeysDetected': duplicate_key_count,
        'skippedInvalidCerts': skipped_invalid_certs
    }

    log_event(
        "AggregationCompleted",
        certificatesScanned=len(cert_items),
        serviceRecordsScanned=sum(len(v) for v in service_map.values()),
        aggregateRecordsWritten=written_count,
        aggregateRecordsFailed=failed_writes,
        unmappedAccounts=len(unmapped_accounts),
        duplicateKeysDetected=duplicate_key_count,
        skippedInvalidCerts=skipped_invalid_certs
    )

    return {
        'statusCode': 200 if failed_writes == 0 else 207,
        'body': body
    }
