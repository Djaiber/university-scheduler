variable "project" {
  description = "Prefijo de nombres de recursos"
  type        = string
  default     = "university-scheduler"
}

variable "region" {
  description = "Región AWS del estado remoto"
  type        = string
  default     = "us-east-1"
}
