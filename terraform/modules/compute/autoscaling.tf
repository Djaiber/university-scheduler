# El worker escala según el trabajo pendiente: 0 tareas sin cola, hasta max_count con backlog (ADR-0005)
resource "aws_appautoscaling_target" "worker" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.worker.min_count
  max_capacity       = var.worker.max_count
}

resource "aws_appautoscaling_policy" "worker_backlog" {
  name               = "${var.name}-worker-backlog"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.worker.service_namespace
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ExactCapacity"
    cooldown                = 60
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_upper_bound = 1
      scaling_adjustment          = var.worker.min_count
    }
    step_adjustment {
      metric_interval_lower_bound = 1
      metric_interval_upper_bound = 1 + var.worker.messages_per_task
      scaling_adjustment          = min(1, var.worker.max_count)
    }
    step_adjustment {
      metric_interval_lower_bound = 1 + var.worker.messages_per_task
      scaling_adjustment          = var.worker.max_count
    }
  }
}

# Trabajos visibles + en curso: no se reduce a 0 mientras haya un solver ejecutándose
resource "aws_cloudwatch_metric_alarm" "worker_backlog" {
  alarm_name          = "${var.name}-worker-backlog"
  alarm_description   = "Controla la capacidad del worker según la cola"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.worker_backlog.arn]

  metric_query {
    id          = "backlog"
    expression  = "visible + inflight"
    label       = "Trabajos pendientes"
    return_data = true
  }
  metric_query {
    id = "visible"
    metric {
      namespace   = "AWS/SQS"
      metric_name = "ApproximateNumberOfMessagesVisible"
      period      = 60
      stat        = "Maximum"
      dimensions  = { QueueName = var.queue.name }
    }
  }
  metric_query {
    id = "inflight"
    metric {
      namespace   = "AWS/SQS"
      metric_name = "ApproximateNumberOfMessagesNotVisible"
      period      = 60
      stat        = "Maximum"
      dimensions  = { QueueName = var.queue.name }
    }
  }
}
