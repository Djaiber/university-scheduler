resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  alarms = {
    dlq_messages = {
      description = "Hay trabajos en la DLQ: fallaron tras 3 intentos (revisar error estructurado)"
      namespace   = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", stat = "Maximum"
      dimensions  = { QueueName = var.dlq_name }, threshold = 0, operator = "GreaterThanThreshold"
    }
    queue_age = {
      description = "Un trabajo lleva demasiado tiempo esperando un worker"
      namespace   = "AWS/SQS", metric = "ApproximateAgeOfOldestMessage", stat = "Maximum"
      dimensions  = { QueueName = var.queue_name }, threshold = var.max_job_age_seconds, operator = "GreaterThanThreshold"
    }
    db_cpu = {
      description = "CPU de PostgreSQL sostenida por encima del 80 %"
      namespace   = "AWS/RDS", metric = "CPUUtilization", stat = "Average"
      dimensions  = { DBInstanceIdentifier = var.db_instance_id }, threshold = 80, operator = "GreaterThanThreshold"
    }
    db_storage = {
      description = "Menos de 2 GB libres en PostgreSQL"
      namespace   = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum"
      dimensions  = { DBInstanceIdentifier = var.db_instance_id }, threshold = 2147483648, operator = "LessThanThreshold"
    }
    api_5xx = {
      description = "La API devuelve errores 5xx"
      namespace   = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }, threshold = 5, operator = "GreaterThanThreshold"
    }
    api_unhealthy = {
      description = "No hay tareas sanas de la API detrás del ALB"
      namespace   = "AWS/ApplicationELB", metric = "HealthyHostCount", stat = "Minimum"
      dimensions  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.target_group_arn_suffix }
      threshold   = 1, operator = "LessThanThreshold"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dimensions
  period              = 300
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = each.value.operator
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Environment$%s", var.environment)]
  }

  dynamic "notification" {
    for_each = { 80 = "ACTUAL", 100 = "FORECASTED" }
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = tonumber(notification.key)
      threshold_type            = "PERCENTAGE"
      notification_type         = notification.value
      subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
    }
  }
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.name}-operacion"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title = "Cola de optimización", region = data.aws_region.current.name, stat = "Maximum", period = 60
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.queue_name],
            ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", var.queue_name],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.dlq_name],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title = "API", region = data.aws_region.current.name, stat = "Sum", period = 300
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix],
          ]
        }
      },
    ]
  })
}

data "aws_region" "current" {}
