variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Subredes privadas (mínimo 2 AZ)"
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Grupos de seguridad autorizados a conectarse en 5432 (API, worker, migraciones)"
  type        = list(string)
  default     = []
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "max_allocated_storage_gb" {
  description = "Autoescalado de almacenamiento"
  type        = number
  default     = 100
}

variable "engine_version" {
  type    = string
  default = "16" # versión mayor: RDS elige la menor vigente y aplica parches automáticamente
}

variable "db_name" {
  type    = string
  default = "scheduler"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}
