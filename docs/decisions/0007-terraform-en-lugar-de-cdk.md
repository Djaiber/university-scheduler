# ADR-0007: Terraform en `/terraform` en lugar de AWS CDK

- Estado: aceptado · Fecha: 2026-10-06 · Issue: SCRUM-26
- Reemplaza: la elección de AWS CDK del plan inicial (§3)

## Contexto
El equipo quiere controlar la infraestructura de forma explícita: ver el plan exacto antes de
aplicar, revisar los diffs de estado en los PR y reutilizar la experiencia existente en Terraform.
CDK genera CloudFormation de forma indirecta y acopla la infraestructura al toolchain de Node.

## Decisión
- Toda la infraestructura vive en `/terraform` (HCL, Terraform ≥ 1.6, compatible con OpenTofu).
- Estado remoto en S3 (versionado y cifrado) con bloqueo en DynamoDB, creado por `terraform/bootstrap`.
- Módulos pequeños y de una responsabilidad en `terraform/modules/*`, compuestos por
  `modules/platform` e instanciados por entorno en `terraform/environments/{dev,pilot}`.
- CI ejecuta `fmt -check`, `validate` y `tflint` en cada PR que toque `/terraform`; `plan` solo con
  credenciales OIDC configuradas; `apply` siempre manual y aprobado.
- Se elimina `infrastructure/aws-cdk` del monorepo.

## Consecuencias
+ Plan revisable y estado explícito; mismo lenguaje para todos los entornos.
− El estado es un activo crítico: acceso restringido, versionado y bloqueo obligatorios.
− Sin constructos de alto nivel de CDK: los módulos deben mantenerse (pinning de provider `~> 5.75`).
