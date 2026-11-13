variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "image_urls" {
  description = "URL de repositorio ECR por componente (api, worker)"
  type        = map(string)
}

variable "image_tag" {
  description = "Etiqueta inmutable a desplegar (SHA del commit)"
  type        = string
}

variable "queue" {
  type = object({ url = string, arn = string, name = string })
}

variable "buckets" {
  type = object({ imports = string, imports_arn = string, exports = string, exports_arn = string })
}

variable "database" {
  type = object({ host = string, port = number, name = string, secret_arn = string })
}

variable "cognito_issuer_url" {
  type = string
}

variable "api" {
  type = object({
    cpu           = number
    memory        = number
    desired_count = number
  })
  default = { cpu = 512, memory = 1024, desired_count = 1 }
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
  default = { cpu = 2048, memory = 4096, min_count = 0, max_count = 2, messages_per_task = 1, solver_time_limit = 300 }
}

variable "certificate_arn" {
  description = "Certificado ACM para HTTPS en el ALB (opcional en dev)"
  type        = string
  default     = null
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "cognito_user_pool" {
  description = "User pool donde la API crea las cuentas e invita por correo"
  type        = object({ id = string, arn = string })
}
