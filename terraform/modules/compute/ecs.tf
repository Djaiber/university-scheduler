data "aws_region" "current" {}

resource "aws_ecs_cluster" "this" {
  name = "${var.name}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(["api", "worker"])
  name              = "/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

locals {
  db_env = [
    { name = "PGHOST", value = var.database.host },
    { name = "PGPORT", value = tostring(var.database.port) },
    { name = "PGDATABASE", value = var.database.name },
    { name = "PGSSLMODE", value = "require" },
  ]
  db_secrets = [
    { name = "PGUSER", valueFrom = "${var.database.secret_arn}:username::" },
    { name = "PGPASSWORD", valueFrom = "${var.database.secret_arn}:password::" },
  ]
  common_env = [
    { name = "AWS_REGION", value = data.aws_region.current.name },
    { name = "SQS_QUEUE_URL", value = var.queue.url },
    { name = "EXPORTS_BUCKET", value = var.buckets.exports },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api.cpu
  memory                   = var.api.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name         = "api"
    image        = "${var.image_urls["api"]}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = concat(local.db_env, local.common_env, [
      { name = "PORT", value = "3000" },
      { name = "IMPORTS_BUCKET", value = var.buckets.imports },
      { name = "COGNITO_ISSUER", value = var.cognito_issuer_url },
      { name = "COGNITO_USER_POOL_ID", value = var.cognito_user_pool.id },
    ])
    secrets = local.db_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this["api"].name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "api"
      }
    }
    readonlyRootFilesystem = true
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker.cpu
  memory                   = var.worker.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = "worker"
    image     = "${var.image_urls["worker"]}:${var.image_tag}"
    essential = true
    environment = concat(local.db_env, local.common_env, [
      { name = "SOLVER_WORKERS", value = tostring(floor(var.worker.cpu / 1024)) },
      { name = "SOLVER_MAX_TIME_LIMIT", value = tostring(var.worker.solver_time_limit) },
    ])
    secrets = local.db_secrets
    # SIGTERM → el worker deja de recibir y devuelve el mensaje a la cola (ADR-0003)
    stopTimeout = 120
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this["worker"].name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api.desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 30
  enable_execute_command            = false

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker.min_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count] # lo controla el autoescalado
  }
}
