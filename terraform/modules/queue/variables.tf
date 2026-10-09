variable "name" {
  type = string
}

variable "solver_time_limit_seconds" {
  description = "Límite máximo del solver; la visibilidad del mensaje debe superarlo (ADR-0003)"
  type        = number
  default     = 600
}

variable "max_receive_count" {
  description = "Intentos antes de enviar el mensaje a la DLQ"
  type        = number
  default     = 3
}
