# Salidas planas para scripts (terraform output -raw <nombre>)
output "web_url" {
  value = module.platform.web_url
}

output "api_url" {
  value = module.platform.api_url
}

output "ecr_api" {
  value = module.platform.ecr_repositories["api"]
}

output "ecr_worker" {
  value = module.platform.ecr_repositories["worker"]
}

output "cluster_name" {
  value = module.platform.cluster_name
}

output "api_task_definition" {
  value = module.platform.api_task_definition
}

output "api_security_group_id" {
  value = module.platform.api_security_group_id
}

output "private_subnet_ids_csv" {
  value = join(",", module.platform.private_subnet_ids)
}

output "site_bucket" {
  value = module.platform.site_bucket
}

output "cloudfront_distribution_id" {
  value = module.platform.cloudfront_distribution_id
}

output "cognito_domain" {
  value = module.platform.cognito.domain
}

output "cognito_web_client_id" {
  value = module.platform.cognito.web_client_id
}

output "cognito_user_pool_id" {
  value = module.platform.cognito.user_pool_id
}

output "db_endpoint" {
  value = module.platform.db_endpoint
}

output "queue_url" {
  value = module.platform.queue_url
}
