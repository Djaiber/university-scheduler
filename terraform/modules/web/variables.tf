variable "name" {
  type = string
}

variable "api_origin_domain" {
  description = "DNS del ALB de la API; CloudFront enruta /v1/* hacia él (mismo origen, sin CORS)"
  type        = string
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}
