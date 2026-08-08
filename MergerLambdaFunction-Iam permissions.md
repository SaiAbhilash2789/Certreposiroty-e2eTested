# IAM Permissions Guide — MergerLambdaFunction

Two completely separate permission surfaces are involved. People often conflate them, but they're granted to different identities:

| | Who holds it | What it's for |
|---|---|---|
| **A. Lambda execution role** | The Lambda function itself (assumed automatically on every invocation) | Lets the *code* actually scan/read/write the four DynamoDB tables and write logs |
| **B. Deploy/operator permissions** | You, or whatever CI/CD role runs the CLI commands from the CloudWatch guide | Lets a *person* create metric filters, alarms, and the SNS topic — the Lambda itself never touches these APIs |

---

## A. Lambda Execution Role

### A1. Trust policy (who can assume this role)

This is separate from the *permissions* policy below — it says "Lambda is allowed to assume this role," not "what the role can do."

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### A2. Permissions policy — mapped 1:1 to actual code operations

I traced every DynamoDB call site in the delivered code (confirmed above) rather than guessing. This is scoped to exactly those actions, on exactly those four tables, nothing broader:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadCertRegistry",
      "Effect": "Allow",
      "Action": "dynamodb:Scan",
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/<CertRegistryTableName>"
    },
    {
      "Sid": "ReadServiceRegistry",
      "Effect": "Allow",
      "Action": "dynamodb:Scan",
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/<ServiceRegistryTableName>"
    },
    {
      "Sid": "ReadPreferences",
      "Effect": "Allow",
      "Action": "dynamodb:BatchGetItem",
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/<PreferencesTableName>"
    },
    {
      "Sid": "WriteAggregateTable",
      "Effect": "Allow",
      "Action": "dynamodb:BatchWriteItem",
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/<AggregateTableName>"
    },
    {
      "Sid": "WriteLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:<region>:<account-id>:log-group:/aws/lambda/<your-function-name>:*"
    }
  ]
}
```

Note what's **deliberately absent**: no `dynamodb:PutItem`, `GetItem`, `Query`, `UpdateItem`, `DeleteItem`, or `DescribeTable` — the code never calls them, so granting them would violate least privilege for no functional benefit. The `WriteLogs` block is the hand-written equivalent of AWS's managed `AWSLambdaBasicExecutionRole` policy, scoped down to just this function's log group instead of `*`.

If you'd rather use the AWS managed policy for the logging piece instead of hand-writing it (simpler to maintain, slightly broader — it covers `logs:*` log groups your account might create, not just this one):
```bash
aws iam attach-role-policy \
  --role-name <your-lambda-execution-role> \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```
Then only the four DynamoDB `Sid` blocks above need to be a separate inline/custom policy.

### A3. Conditional additions (only if they apply to your setup)

| Condition | Extra permission needed | Why |
|---|---|---|
| Lambda is configured to run inside a VPC | `ec2:CreateNetworkInterface`, `ec2:DescribeNetworkInterfaces`, `ec2:DeleteNetworkInterface` (or attach AWS managed `AWSLambdaVPCAccessExecutionRole`) | Lambda needs to create/manage ENIs to reach resources inside your VPC |
| Any of the 4 tables use a **customer-managed** KMS key for encryption at rest (not the default AWS-owned key) | `kms:Decrypt` (read tables) and `kms:GenerateDataKey` (write table) on that specific key ARN | DynamoDB encryption-at-rest with a customer CMK requires the caller to have KMS access, not just table access |
| The function is invoked by EventBridge (the code's comments reference this) | **Not an execution-role permission at all** — it's a resource-based policy *on the Lambda function itself*, allowing `events.amazonaws.com` to call `lambda:InvokeFunction`. Usually auto-added when you create the EventBridge rule via console/CLI target, but worth confirming: `aws lambda get-policy --function-name <your-function-name>` | Without this, EventBridge's attempt to invoke the function fails with an authorization error before your code ever runs |

### A4. Quick self-check

You can sanity-check the role's actual effective permissions without touching production data:
```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::<account-id>:role/<your-lambda-execution-role> \
  --action-names dynamodb:Scan dynamodb:PutItem dynamodb:BatchWriteItem \
  --resource-arns arn:aws:dynamodb:<region>:<account-id>:table/<AggregateTableName>
```
You'd want to see `Scan` and `BatchWriteItem` come back `allowed`, and — if you've scoped it correctly — `PutItem` come back `implicitDeny`, confirming the policy isn't broader than the code needs.

---

## B. Permissions for the CloudWatch/SNS setup (from the previous guide)

These belong to **whoever runs those CLI commands** — your own IAM user, or a CI/CD deploy role. The Lambda's execution role needs none of this; it never calls any of these APIs itself.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageMetricFilters",
      "Effect": "Allow",
      "Action": [
        "logs:PutMetricFilter",
        "logs:DeleteMetricFilter",
        "logs:DescribeMetricFilters",
        "logs:DescribeLogGroups"
      ],
      "Resource": "arn:aws:logs:<region>:<account-id>:log-group:/aws/lambda/<your-function-name>:*"
    },
    {
      "Sid": "ManageAlarms",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms"
      ],
      "Resource": "arn:aws:cloudwatch:<region>:<account-id>:alarm:MergerLambda-*"
    },
    {
      "Sid": "ManageSnsTopic",
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:ListSubscriptionsByTopic",
        "sns:GetTopicAttributes",
        "sns:SetTopicAttributes"
      ],
      "Resource": "arn:aws:sns:<region>:<account-id>:merger-lambda-alerts"
    }
  ]
}
```

### The part people usually miss: the SNS topic's own resource policy

This is different from everything above — it's not an IAM identity policy, it's a policy **attached to the SNS topic itself**, and it's what actually lets CloudWatch Alarms (as a service, not as "you") publish to it. If you created the topic via the AWS Console and picked it directly as an alarm action, AWS usually adds this automatically. If you're doing it purely via CLI (as in the previous guide), it's worth confirming explicitly — a `put-metric-alarm` call can succeed while the alarm silently fails to deliver, because the topic itself never granted CloudWatch permission to publish:

```bash
aws sns get-topic-attributes --topic-arn <your-topic-arn> --query 'Attributes.Policy'
```

If `cloudwatch.amazonaws.com` isn't listed as an allowed principal there, add it:
```json
{
  "Sid": "AllowCloudWatchAlarmsToPublish",
  "Effect": "Allow",
  "Principal": { "Service": "cloudwatch.amazonaws.com" },
  "Action": "sns:Publish",
  "Resource": "<your-topic-arn>",
  "Condition": {
    "ArnLike": { "aws:SourceArn": "arn:aws:cloudwatch:<region>:<account-id>:alarm:*" }
  }
}
```
Apply it with `aws sns set-topic-attributes --topic-arn <your-topic-arn> --attribute-name Policy --attribute-value '<the-full-policy-json>'` (merge it into any existing statements rather than overwriting the whole policy if one already exists).

---

## Summary table

| Identity | Needs | Does NOT need |
|---|---|---|
| Lambda execution role | `Scan` on Cert+Service tables, `BatchGetItem` on Preferences, `BatchWriteItem` on Aggregate, `logs:PutLogEvents` (+basic log group/stream creation) | Any single-item DynamoDB actions, SNS/CloudWatch alarm APIs, IAM itself |
| You / deploy role (one-time CloudWatch setup) | `logs:PutMetricFilter`, `cloudwatch:PutMetricAlarm`, `sns:CreateTopic`/`Subscribe` | Nothing on the DynamoDB tables at all |
| SNS topic resource policy | Must explicitly allow `cloudwatch.amazonaws.com` to `sns:Publish` | — |
