output "state_bucket" {
  description = "Bucket para backend \"s3\" de los entornos"
  value       = aws_s3_bucket.state.bucket
}

output "lock_table" {
  description = "Tabla DynamoDB de bloqueo del estado"
  value       = aws_dynamodb_table.lock.name
}
