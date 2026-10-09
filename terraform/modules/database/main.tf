resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "PostgreSQL: solo desde componentes autorizados"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-db" }
}

# count (y no for_each) porque los IDs de los grupos suelen ser desconocidos hasta el apply
resource "aws_vpc_security_group_ingress_rule" "from_apps" {
  count                        = length(var.allowed_security_group_ids)
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = var.allowed_security_group_ids[count.index]
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL desde componente autorizado ${count.index}"
}

# TLS obligatorio y registro de sentencias lentas / DDL
resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  parameter {
    name  = "log_statement"
    value = "ddl"
  }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-pg"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class
  db_name        = var.db_name
  username       = "scheduler_admin"

  # La contraseña maestra la genera y rota RDS en Secrets Manager (nunca pasa por el estado)
  manage_master_user_password = true

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period         = var.backup_retention_days
  backup_window                   = "07:00-08:00"         # 02:00-03:00 Bogotá
  maintenance_window              = "sun:08:00-sun:09:00" # domingo 03:00 Bogotá
  copy_tags_to_snapshot           = true
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = !var.deletion_protection
  final_snapshot_identifier       = var.deletion_protection ? "${var.name}-pg-final" : null
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
}
