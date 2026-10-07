variable "name" {
  type = string
}

variable "callback_urls" {
  description = "URLs de retorno del panel web tras iniciar sesión"
  type        = list(string)
}

variable "logout_urls" {
  type = list(string)
}

variable "allowed_email_domain" {
  description = "Dominio institucional (informativo; la creación de usuarios es solo por administradores)"
  type        = string
  default     = "unbosque.edu.co"
}
