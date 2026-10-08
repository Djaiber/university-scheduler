# dev: costes mínimos, recursos destruibles, sin multi-AZ
module "platform" {
  source             = "../../modules/platform"
  environment        = "dev"
  vpc_cidr           = "10.40.0.0/16"
  single_nat_gateway = true
  image_tag          = var.image_tag
  certificate_arn    = var.certificate_arn
  alert_emails       = var.alert_emails
  monthly_budget_usd = 50

  extra_callback_urls = ["http://localhost:5173"]

  db = {
    instance_class      = "db.t4g.micro"
    multi_az            = false
    deletion_protection = false
    backup_days         = 3
  }
  api    = { cpu = 256, memory = 512, desired_count = 1 }
  worker = { cpu = 2048, memory = 4096, min_count = 0, max_count = 1, messages_per_task = 1, solver_time_limit = 300 }
}
