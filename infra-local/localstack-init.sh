#!/bin/bash
# Crea en LocalStack los mismos recursos que terraform/modules/{queue,storage}
set -euo pipefail
awslocal sqs create-queue --queue-name optimization-jobs-dlq
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url http://localhost:4566/000000000000/optimization-jobs-dlq \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
awslocal sqs create-queue --queue-name optimization-jobs --attributes "{
  \"VisibilityTimeout\": \"420\",
  \"ReceiveMessageWaitTimeSeconds\": \"20\",
  \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
}"
awslocal s3 mb s3://scheduler-imports
awslocal s3 mb s3://scheduler-exports
echo "LocalStack listo: optimization-jobs (+DLQ), scheduler-imports, scheduler-exports"
