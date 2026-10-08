variable "region" {
  type    = string
  default = "us-east-1"
}

variable "image_tag" {
  description = "SHA del commit cuyas imágenes se despliegan"
  type        = string
}

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "certificate_arn" {
  type    = string
  default = null
}
