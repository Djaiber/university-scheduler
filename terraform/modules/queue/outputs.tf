output "queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "queue_arn" {
  value = aws_sqs_queue.jobs.arn
}

output "queue_name" {
  value = aws_sqs_queue.jobs.name
}

output "dlq_arn" {
  value = aws_sqs_queue.dlq.arn
}

output "dlq_name" {
  value = aws_sqs_queue.dlq.name
}

output "visibility_timeout_seconds" {
  value = aws_sqs_queue.jobs.visibility_timeout_seconds
}
