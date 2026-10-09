terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.75"
    }
  }

  # Configuración parcial: bucket y tabla se pasan en init (ver backend.hcl.example)
  backend "s3" {
    key     = "university-scheduler/dev/terraform.tfstate"
    encrypt = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "university-scheduler"
      Environment = "dev"
      ManagedBy   = "terraform"
      Repository  = "Djaiber/university-scheduler"
    }
  }
}
