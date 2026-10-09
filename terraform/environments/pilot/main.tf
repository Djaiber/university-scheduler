# pilot: piloto con Administración; datos reales, protección de borrado y respaldo extendido
module "platform" {
  source             = "../../modules/platform"
  environment        = "pilot"
  vpc_cidr           = "10.41.0.0/16"
  single_nat_gateway = true
  image_tag          = var.image_tag
  certificate_arn    = var.certificate_arn
  alert_emails       = var.alert_emails
  monthly_budget_usd = 120

  db = {
    instance_class      = "db.t4g.small"
    multi_az            = false
    deletion_protection = true
    backup_days         = 14
  }
  api    = { cpu = 512, memory = 1024, desired_count = 2 }
  worker = { cpu = 4096, memory = 8192, min_count = 0, max_count = 2, messages_per_task = 1, solver_time_limit = 600 }
}
