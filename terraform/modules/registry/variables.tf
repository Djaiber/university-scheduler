variable "name" {
  type = string
}

variable "repositories" {
  description = "Imágenes de contenedor del proyecto"
  type        = list(string)
  default     = ["api", "worker"]
}

variable "keep_images" {
  type    = number
  default = 20
}
