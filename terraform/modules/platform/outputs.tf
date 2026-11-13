output "web_url" {
  description = "Panel administrativo (CloudFront)"
  value       = module.web.url
}

output "api_url" {
  description = "API a través de CloudFront (mismo origen que el panel)"
  value       = "${module.web.url}/v1"
}

output "ecr_repositories" {
  value = module.registry.repository_urls
}

output "cluster_name" {
  value = module.compute.cluster_name
}

output "queue_url" {
  value = module.queue.queue_url
}

output "db_endpoint" {
  value = module.database.endpoint
}

output "db_secret_arn" {
  value = module.database.master_secret_arn
}

output "cognito" {
  value = {
    user_pool_id  = module.auth.user_pool_id
    web_client_id = module.auth.web_client_id
    issuer_url    = module.auth.issuer_url
    domain        = module.auth.hosted_ui_domain
  }
}

output "site_bucket" {
  value = module.web.site_bucket
}

output "cloudfront_distribution_id" {
  value = module.web.distribution_id
}

output "alerts_topic_arn" {
  value = module.observability.alerts_topic_arn
}

# Para ejecutar migraciones como tarea única de ECS
output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "api_security_group_id" {
  value = module.compute.api_security_group_id
}

output "api_task_definition" {
  value = module.compute.api_task_definition
}
