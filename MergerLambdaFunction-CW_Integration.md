# CloudWatch Integration Guide — MergerLambdaFunction

Two separate, complementary layers are involved:

1. **Built-in Lambda metrics** — AWS emits these automatically, zero code/config needed. Covers "did the function crash / run slow / get throttled."
2. **Custom metrics from your structured logs** — every `log_event(...)` call already writes a JSON line. CloudWatch Logs **Metric Filters** turn those into real CloudWatch metrics you can alarm on. Covers "did the function succeed but produce a result you care about" — which is exactly your `unmappedAccountsCount` case, since that returns a 200.

You need both. Layer 1 alone would never have caught your unmapped-account case, since the Lambda *did* succeed.

---

## Layer 1: Built-in Lambda metrics (do this first — 5 minutes, no code)

Every Lambda function automatically publishes these to CloudWatch under the `AWS/Lambda` namespace, dimensioned by `FunctionName`:

| Metric | What it tells you |
|---|---|
| `Errors` | Count of invocations that threw an unhandled exception. Since `lambda_handler` re-raises after logging `AggregationFailed`, this metric fires automatically — **no metric filter needed** for total-failure alerting. |
| `Duration` | How long each run takes. Useful for catching "creeping toward timeout" before `WriteTimeBudgetExceeded` starts firing. |
| `Throttles` | Lambda hit your account/function concurrency limit and rejected an invocation outright. |
| `ConcurrentExecutions` | How many overlapping invocations are running. |

**Set this up via CLI now** (replace `<your-function-name>` and `<your-topic-arn>` — topic creation is in Layer 2, Step 1 below, do that first if you don't have one):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "MergerLambda-Errors" \
  --namespace "AWS/Lambda" \
  --metric-name "Errors" \
  --dimensions Name=FunctionName,Value=<your-function-name> \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions <your-topic-arn>
```

This alone catches: missing/misconfigured env vars at cold start, IAM permission failures, and anything else that escapes the top-level `try/except` and re-raises.

---

## Layer 2: Custom metrics from your structured logs

### Step 1 — Create the SNS topic and confirm your email (one-time)

```bash
# Create the topic
aws sns create-topic --name merger-lambda-alerts
# → note the TopicArn in the output, you'll reuse it everywhere below

# Subscribe your email
aws sns subscribe \
  --topic-arn <topic-arn-from-above> \
  --protocol email \
  --notification-endpoint you@example.com
```

**Important:** AWS emails you a confirmation link. The subscription sits in `PendingConfirmation` and **no alarms will actually deliver email** until you click it. Check with:
```bash
aws sns list-subscriptions-by-topic --topic-arn <topic-arn>
```
Look for `"SubscriptionArn"` — if it literally says the string `PendingConfirmation` instead of a real ARN, you haven't confirmed yet.

### Step 2 — Find your log group

Lambda log groups follow the pattern `/aws/lambda/<function-name>`:
```bash
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/<your-function-name>"
```

### Step 3 — Create a metric filter

This is the core mechanic: a **filter pattern** matches JSON log lines, and a **metric transformation** tells CloudWatch what number to record each time it matches. Because every one of your logs is `{"event": "...", ...other fields}`, JSON-aware filter syntax (`$.fieldname`) works directly — no regex needed.

**General syntax:**
```bash
aws logs put-metric-filter \
  --log-group-name "/aws/lambda/<your-function-name>" \
  --filter-name "<descriptive-name>" \
  --filter-pattern '{ $.event = "<EventName>" }' \
  --metric-transformations \
      metricName=<CloudWatchMetricName>,metricNamespace=MergerLambda,metricValue=1,defaultValue=0
```

For metrics where you want the actual *count from the field* (not just "did it happen"), point `metricValue` at the field instead of a literal `1`:
```bash
metricValue='$.unmappedAccounts'
```

### Step 4 — Create an alarm on that metric

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "<descriptive-alarm-name>" \
  --namespace "MergerLambda" \
  --metric-name "<CloudWatchMetricName>" \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions <your-topic-arn>
```

`treat-missing-data notBreaching` matters here: this Lambda presumably doesn't run continuously, so "no data in this period" should *not* count as a breach — otherwise you'll get spurious alarms during idle periods.

---

## Which metrics are actually worth alerting on

Not every `log_event` call deserves an email — some are per-record and expected to fire occasionally as background noise; alarming on every single one would train you to ignore the alarms. Here's the full list, tiered by what I'd actually recommend, tying back to the severities from the earlier QA pass:

### Tier 1 — Alarm immediately (data loss or total failure; page-worthy)

| Event | Why it matters | Filter pattern | metricValue |
|---|---|---|---|
| `AggregationFailed` | Whole run threw and failed — already covered by the native `Errors` metric in Layer 1, but a custom filter also captures `errorType` if you want it broken out separately | `{ $.event = "AggregationFailed" }` | `1` |
| `WriteChunkFailedAfterRetries` | **Real data loss** — certs that should be in the Aggregate table aren't, after all retries exhausted. This is the closest thing to "silent corruption" in this codebase. | `{ $.event = "WriteChunkFailedAfterRetries" }` | `$.failedCount` |
| `WriteChunkNonRetryableError` | Almost certainly a config/IAM problem (validation or access-denied on the write path) — will keep failing every single run until someone fixes it, so it deserves immediate attention rather than getting lost in retry noise | `{ $.event = "WriteChunkNonRetryableError" }` | `1` |
| `PreferencesFetchNonRetryableError` | Same reasoning as above, but for the preferences table — a persistent config/IAM issue | `{ $.event = "PreferencesFetchNonRetryableError" }` | `1` |
| `WriteTimeBudgetExceeded` | The Lambda is running out of time mid-write and dropping records as a result — this is an early warning that your dataset has outgrown the current timeout/memory config | `{ $.event = "WriteTimeBudgetExceeded" }` | `$.unwrittenCount` |

**Suggested alarm threshold for all of these: `> 0` in a single 5-minute period.** Any occurrence is worth knowing about immediately.

### Tier 2 — Alarm on a threshold, not every occurrence (real but lower urgency)

| Event | Why threshold, not zero | Filter pattern | metricValue | Suggested threshold |
|---|---|---|---|---|
| `AggregationCompleted` with `unmappedAccounts > 0` | **Your original ask.** Not a failure — the run succeeded and returned 200 — but worth knowing an account has certs with no registered owner, since escalation may be misrouted for it | `{ $.event = "AggregationCompleted" && $.unmappedAccounts > 0 }` | `$.unmappedAccounts` | `> 0` (or higher if a small steady baseline is normal for you — see note below) |
| `DuplicateAggregateKeyDetected` | Signals a genuine data-quality problem upstream in ServiceRegistry (two rows for one account), but one stray duplicate isn't urgent — a *growing* count over time is what matters | `{ $.event = "DuplicateAggregateKeyDetected" }` | `1` | `>= 3` per period, or trend-watch via dashboard rather than alarm |
| `PreferencesFetchGaveUp` / `PreferencesFetchTimeBudgetExceeded` | Alert preferences didn't get fetched for some certs — those certs silently default to `slackAlerting: False`. Real, but less severe than losing the cert record entirely (Tier 1) | `{ $.event = "PreferencesFetchGaveUp" }` | `$.keysDropped` | `> 0` |

### Tier 3 — Dashboard only, not an email alarm (expected background noise)

| Event | Why not an alarm |
|---|---|
| `InvalidAccountId` (all 6 `reason` variants) | This fires **per malformed record**, every run, by design — it's the validation working correctly. A large dataset with a few bad rows will trip this constantly. Alarming on every occurrence would be pure noise. Instead, track it as a **CloudWatch Logs Insights** trend (query below) and only investigate if the volume spikes well above your normal baseline. |
| `ScanSegmentsClamped` / `InvalidScanSegmentsEnvVar` | Config-time issues — they fire once per cold start if `SCAN_SEGMENTS` is misconfigured, and stay constant until someone redeploys. Worth checking once after any deploy, not worth a recurring alarm. |
| `WriteChunkError` / `PreferencesFetchError` (the *retryable* variants) | These fire on transient throttling and usually **succeed on retry** — that's the whole point of the retry loop. Alarming here would fire on normal, self-healing throughput spikes. If you want visibility, dashboard it; only escalate if it's followed by the corresponding `...FailedAfterRetries` / `...GaveUp` event (Tier 1/2), which means the retries didn't actually save it. |

**A note on cost/noise for `InvalidAccountId`:** if your CertRegistry or ServiceRegistry tables are large, this event could fire thousands of times per run. Metric filters are charged per log event scanned (cheap, but not free) and, more importantly, a metric that spikes to "3,000" every run trains you to ignore it. I'd skip a per-occurrence metric filter for this one entirely and instead rely on the `skippedInvalidCerts` field already summarized once per run in `AggregationCompleted` — same information, 1/N the noise:

```bash
aws logs put-metric-filter \
  --log-group-name "/aws/lambda/<your-function-name>" \
  --filter-name "SkippedInvalidCertsPerRun" \
  --filter-pattern '{ $.event = "AggregationCompleted" }' \
  --metric-transformations \
      metricName=SkippedInvalidCertsPerRun,metricNamespace=MergerLambda,metricValue='$.skippedInvalidCerts',defaultValue=0
```
Then alarm on that metric if it exceeds whatever your normal baseline is (e.g. if you usually see 0-2 and suddenly see 50, that's a real upstream data-quality regression worth investigating).

---

## Answering your original question directly

For `unmappedAccountsCount`, here's the exact pair of commands:

```bash
aws logs put-metric-filter \
  --log-group-name "/aws/lambda/<your-function-name>" \
  --filter-name "UnmappedAccountsDetected" \
  --filter-pattern '{ $.event = "AggregationCompleted" && $.unmappedAccounts > 0 }' \
  --metric-transformations \
      metricName=UnmappedAccountsDetected,metricNamespace=MergerLambda,metricValue='$.unmappedAccounts',defaultValue=0

aws cloudwatch put-metric-alarm \
  --alarm-name "MergerLambda-UnmappedAccounts" \
  --namespace "MergerLambda" \
  --metric-name "UnmappedAccountsDetected" \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions <your-topic-arn>
```

That will email you exactly the scenario from your test run — `unmappedAccountsCount: 1` with `"509319545547"` — even though the Lambda itself returned 200, because it's watching the log field, not the HTTP-style status code.

---

## Bonus: ad-hoc trend queries (no alarm needed)

For the Tier 3 items, CloudWatch Logs Insights lets you eyeball trends without setting up a metric filter at all. Run these in the console (Logs → Logs Insights → pick your log group):

```
# How many InvalidAccountId rejections per run, broken down by reason
fields @timestamp, reason, rawValue
| filter event = "InvalidAccountId"
| stats count(*) by reason

# Trend of unmapped accounts over time
fields @timestamp, unmappedAccounts, duplicateKeysDetected, skippedInvalidCerts
| filter event = "AggregationCompleted"
| sort @timestamp desc
```

---

## Summary — what to actually set up, in order

1. **Now:** Layer 1 `Errors` alarm (5 min, catches total failures for free).
2. **Now:** SNS topic + confirmed email subscription.
3. **Now:** `UnmappedAccountsDetected` metric filter + alarm (answers your original question).
4. **This week:** The rest of Tier 1 (`WriteChunkFailedAfterRetries`, `WriteChunkNonRetryableError`, `PreferencesFetchNonRetryableError`, `WriteTimeBudgetExceeded`).
5. **When you have a sense of normal baseline volume:** Tier 2 threshold alarms.
6. **Optional, for visibility only:** a CloudWatch Dashboard pinning the Tier 3 Logs Insights queries above, so you can eyeball trends without email noise.
