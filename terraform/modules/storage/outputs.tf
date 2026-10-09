output "imports_bucket" {
  value = aws_s3_bucket.this["imports"].bucket
}

output "imports_bucket_arn" {
  value = aws_s3_bucket.this["imports"].arn
}

output "exports_bucket" {
  value = aws_s3_bucket.this["exports"].bucket
}

output "exports_bucket_arn" {
  value = aws_s3_bucket.this["exports"].arn
}
