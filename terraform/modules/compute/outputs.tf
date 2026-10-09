output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "alb_arn_suffix" {
  value = aws_lb.api.arn_suffix
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}

output "worker_security_group_id" {
  value = aws_security_group.worker.id
}

output "api_task_definition" {
  description = "Para ejecutar migraciones como tarea única: aws ecs run-task --overrides command=[\"npm\",\"run\",\"migrate\"]"
  value       = aws_ecs_task_definition.api.family
}

output "service_names" {
  value = { api = aws_ecs_service.api.name, worker = aws_ecs_service.worker.name }
}
