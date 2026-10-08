locals {
  name = "${var.project}-${var.environment}"
}

module "network" {
  source             = "../network"
  name               = local.name
  cidr_block         = var.vpc_cidr
  single_nat_gateway = var.single_nat_gateway
}

module "storage" {
  source        = "../storage"
  name          = local.name
  force_destroy = var.environment == "dev"
}

module "queue" {
  source                    = "../queue"
  name                      = local.name
  solver_time_limit_seconds = var.worker.solver_time_limit
}

module "registry" {
  source = "../registry"
  name   = local.name
}

module "database" {
  source                     = "../database"
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  allowed_security_group_ids = [module.compute.api_security_group_id, module.compute.worker_security_group_id]
  instance_class             = var.db.instance_class
  multi_az                   = var.db.multi_az
  deletion_protection        = var.db.deletion_protection
  backup_retention_days      = var.db.backup_days
}

module "auth" {
  source        = "../auth"
  name          = local.name
  callback_urls = concat(["${module.web.url}/auth/callback"], [for u in var.extra_callback_urls : "${u}/auth/callback"])
  logout_urls   = concat([module.web.url], var.extra_callback_urls)
}

module "compute" {
  source             = "../compute"
  name               = local.name
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  image_urls         = module.registry.repository_urls
  image_tag          = var.image_tag
  certificate_arn    = var.certificate_arn
  cognito_issuer_url = module.auth.issuer_url
  api                = var.api
  worker             = var.worker

  queue = {
    url  = module.queue.queue_url
    arn  = module.queue.queue_arn
    name = module.queue.queue_name
  }
  buckets = {
    imports     = module.storage.imports_bucket
    imports_arn = module.storage.imports_bucket_arn
    exports     = module.storage.exports_bucket
    exports_arn = module.storage.exports_bucket_arn
  }
  database = {
    host       = module.database.endpoint
    port       = module.database.port
    name       = module.database.db_name
    secret_arn = module.database.master_secret_arn
  }
}

module "web" {
  source            = "../web"
  name              = local.name
  api_origin_domain = module.compute.alb_dns_name
}

module "observability" {
  source                  = "../observability"
  name                    = local.name
  environment             = var.environment
  alert_emails            = var.alert_emails
  monthly_budget_usd      = var.monthly_budget_usd
  queue_name              = module.queue.queue_name
  dlq_name                = module.queue.dlq_name
  db_instance_id          = module.database.instance_id
  alb_arn_suffix          = module.compute.alb_arn_suffix
  target_group_arn_suffix = module.compute.target_group_arn_suffix
}
