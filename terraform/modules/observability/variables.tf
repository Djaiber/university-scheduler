variable "name" {
  type = string
}

variable "environment" {
  description = "Valor de la etiqueta Environment usada para filtrar costes"
  type        = string
}

variable "alert_emails" {
  description = "Destinatarios de alarmas (confirman la suscripción por correo)"
  type        = list(string)
  default     = []
}

variable "monthly_budget_usd" {
  description = "Presupuesto mensual del entorno (D15)"
  type        = number
  default     = 50
}

variable "queue_name" {
  type = string
}

variable "dlq_name" {
  type = string
}

variable "max_job_age_seconds" {
  description = "Edad máxima aceptable del trabajo más antiguo en cola"
  type        = number
  default     = 900
}

variable "db_instance_id" {
  type = string
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffix" {
  type = string
}
