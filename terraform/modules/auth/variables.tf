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
