variable "name" {
  description = "Prefijo de nombres (proyecto-entorno)"
  type        = string
}

variable "cidr_block" {
  description = "CIDR de la VPC"
  type        = string
  default     = "10.40.0.0/16"
}

variable "az_count" {
  description = "Zonas de disponibilidad (RDS exige al menos 2 subredes en AZ distintas)"
  type        = number
  default     = 2
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count debe estar entre 2 y 3."
  }
}

variable "single_nat_gateway" {
  description = "Un solo NAT Gateway (más barato, menos disponible). false = uno por AZ"
  type        = bool
  default     = true
}
