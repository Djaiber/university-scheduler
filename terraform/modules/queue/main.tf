resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-optimization-jobs-dlq"
  message_retention_seconds = 1209600 # 14 días para diagnosticar
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${var.name}-optimization-jobs"
  visibility_timeout_seconds = var.solver_time_limit_seconds + 120
  message_retention_seconds  = 345600 # 4 días
  receive_wait_time_seconds  = 20     # long polling
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.jobs.arn]
  })
}
