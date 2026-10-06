variable "name" {
  type = string
}

variable "imports_retention_days" {
  description = "Retención de archivos importados originales (D16: 1 año)"
  type        = number
  default     = 365
}

variable "force_destroy" {
  description = "Permitir borrar buckets con objetos (solo entornos efímeros)"
  type        = bool
  default     = false
}
