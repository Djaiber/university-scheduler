variable "project" {
  type    = string
  default = "university-scheduler"
}

variable "environment" {
  description = "dev | pilot"
  type        = string
  validation {
    condition     = contains(["dev", "pilot"], var.environment)
    error_message = "environment debe ser dev o pilot."
  }
}

variable "vpc_cidr" {
  type = string
}

variable "single_nat_gateway" {
  type    = bool
  default = true
}

variable "image_tag" {
  type = string
}

variable "db" {
  type = object({
    instance_class      = string
    multi_az            = bool
    deletion_protection = bool
    backup_days         = number
  })
}

variable "api" {
  type = object({ cpu = number, memory = number, desired_count = number })
}

variable "worker" {
  type = object({
    cpu               = number
    memory            = number
    min_count         = number
    max_count         = number
    messages_per_task = number
    solver_time_limit = number
  })
}

variable "certificate_arn" {
  type    = string
  default = null
}

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "monthly_budget_usd" {
  type = number
}

variable "extra_callback_urls" {
  description = "URLs adicionales de inicio de sesión (p. ej. http://localhost:5173 en dev)"
  type        = list(string)
  default     = []
}
