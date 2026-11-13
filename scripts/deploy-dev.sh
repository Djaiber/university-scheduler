#!/usr/bin/env bash
# Despliegue completo del entorno dev en AWS (SCRUM-39).
#
#   AWS_PROFILE=Sebastian EXPECTED_ACCOUNT_SUFFIX=95 ./scripts/deploy-dev.sh
#
# Pasos (cada uno es idempotente; se puede relanzar si algo falla):
#   0. Prerrequisitos y verificación de la cuenta (debe terminar en EXPECTED_ACCOUNT_SUFFIX)
#   1. Bootstrap del estado remoto (S3 + DynamoDB)
#   2. Repositorios ECR (apply dirigido)
#   3. Imágenes ARM64 de API y worker → ECR (etiqueta = SHA del commit)
#   4. terraform plan + confirmación + apply del entorno completo
#   5. Migraciones como tarea única de ECS
#   6. Panel web → S3 + invalidación de CloudFront
#   7. Prueba de humo: GET /v1/health a través de CloudFront
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_ROOT="$ROOT/terraform"
ENV_DIR="$TF_ROOT/environments/dev"
: "${AWS_PROFILE:?Defina AWS_PROFILE (p. ej. AWS_PROFILE=Sebastian)}"
EXPECTED_ACCOUNT_SUFFIX="${EXPECTED_ACCOUNT_SUFFIX:-}"
REGION="${AWS_REGION:-$(aws configure get region --profile "$AWS_PROFILE" 2>/dev/null || true)}"
REGION="${REGION:-us-east-1}"
export AWS_PROFILE AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
AUTO_APPROVE="${AUTO_APPROVE:-false}"

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
tfo() { terraform -chdir="$ENV_DIR" output -raw "$1"; }

# ---------------------------------------------------------------- 0
step "0/7 Prerrequisitos y cuenta"
for bin in aws terraform docker git curl; do command -v "$bin" >/dev/null || die "Falta '$bin' en el PATH"; done
docker info >/dev/null 2>&1 || die "Docker no está corriendo (abra Docker Desktop)"
docker buildx version >/dev/null 2>&1 || die "Se necesita docker buildx"
terraform version | head -1

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)" || die "No hay sesión válida para el perfil $AWS_PROFILE (¿aws sso login --profile $AWS_PROFILE?)"
CALLER="$(aws sts get-caller-identity --query Arn --output text)"
echo "Cuenta: $ACCOUNT · Identidad: $CALLER · Región: $REGION"
if [[ -n "$EXPECTED_ACCOUNT_SUFFIX" && "$ACCOUNT" != *"$EXPECTED_ACCOUNT_SUFFIX" ]]; then
  die "La cuenta $ACCOUNT no termina en $EXPECTED_ACCOUNT_SUFFIX: se aborta para no desplegar en la cuenta equivocada"
fi
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || echo "⚠ Hay cambios sin commit; la imagen se etiqueta con el último commit"
IMAGE_TAG="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
ok "Cuenta verificada; etiqueta de imágenes $IMAGE_TAG"

# ---------------------------------------------------------------- 1
step "1/7 Estado remoto (bootstrap)"
terraform -chdir="$TF_ROOT/bootstrap" init -input=false -upgrade >/dev/null
terraform -chdir="$TF_ROOT/bootstrap" apply -input=false -auto-approve -var "region=$REGION"
STATE_BUCKET="$(terraform -chdir="$TF_ROOT/bootstrap" output -raw state_bucket)"
LOCK_TABLE="$(terraform -chdir="$TF_ROOT/bootstrap" output -raw lock_table)"
cat > "$ENV_DIR/backend.hcl" <<EOF
bucket         = "$STATE_BUCKET"
dynamodb_table = "$LOCK_TABLE"
region         = "$REGION"
EOF
terraform -chdir="$ENV_DIR" init -input=false -reconfigure -backend-config=backend.hcl >/dev/null
ok "Estado en s3://$STATE_BUCKET (bloqueo $LOCK_TABLE)"

TF_VARS=(-var "region=$REGION" -var "image_tag=$IMAGE_TAG")
[[ -n "${ALERT_EMAIL:-}" ]] && TF_VARS+=(-var "alert_emails=[\"$ALERT_EMAIL\"]")

# ---------------------------------------------------------------- 2
step "2/7 Repositorios ECR"
terraform -chdir="$ENV_DIR" apply -input=false -auto-approve "${TF_VARS[@]}" -target=module.platform.module.registry
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
ECR_API="$(terraform -chdir="$ENV_DIR" state show -no-color 'module.platform.module.registry.aws_ecr_repository.this["api"]' | awk -F'"' '/repository_url/ {print $2}')"
ECR_WORKER="$(terraform -chdir="$ENV_DIR" state show -no-color 'module.platform.module.registry.aws_ecr_repository.this["worker"]' | awk -F'"' '/repository_url/ {print $2}')"
ok "API → $ECR_API · worker → $ECR_WORKER"

# ---------------------------------------------------------------- 3
step "3/7 Imágenes ARM64"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
push_if_missing() { # repo dockerfile
  local repo="$1" dockerfile="$2" name="${1##*/}"
  if aws ecr describe-images --repository-name "${repo#*/}" --image-ids imageTag="$IMAGE_TAG" >/dev/null 2>&1; then
    ok "$name:$IMAGE_TAG ya existe en ECR"
  else
    docker buildx build --platform linux/arm64 -f "$ROOT/$dockerfile" -t "$repo:$IMAGE_TAG" --push "$ROOT"
    ok "$name:$IMAGE_TAG publicada"
  fi
}
push_if_missing "$ECR_API" apps/api/Dockerfile
push_if_missing "$ECR_WORKER" services/worker/Dockerfile

# ---------------------------------------------------------------- 4
step "4/7 Plan del entorno dev"
terraform -chdir="$ENV_DIR" plan -input=false "${TF_VARS[@]}" -out=tfplan
if [[ "$AUTO_APPROVE" != "true" ]]; then
  echo
  echo "Coste estimado de dev: ~USD 70–80/mes (NAT ~33, ALB ~17, RDS ~15, Fargate API ~7, resto <5)."
  read -r -p "¿Aplicar este plan en la cuenta $ACCOUNT? Escriba 'si' para continuar: " answer
  [[ "$answer" == "si" ]] || die "Cancelado por el usuario (no se aplicó nada del paso 4)"
fi
terraform -chdir="$ENV_DIR" apply -input=false tfplan
rm -f "$ENV_DIR/tfplan"
ok "Infraestructura aplicada"

# ---------------------------------------------------------------- 5
step "5/7 Migraciones (tarea única de ECS)"
CLUSTER="$(tfo cluster_name)"
TASK_ARN="$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$(tfo api_task_definition)" \
  --network-configuration "awsvpcConfiguration={subnets=[$(tfo private_subnet_ids_csv)],securityGroups=[$(tfo api_security_group_id)],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["bash","db/migrate.sh"],"environment":[{"name":"DATABASE_URL","value":"postgresql://"}]}]}' \
  --query 'tasks[0].taskArn' --output text)"
echo "Tarea $TASK_ARN"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)"
[[ "$EXIT_CODE" == "0" ]] || die "Las migraciones fallaron (exit $EXIT_CODE). Logs: aws logs tail /university-scheduler-dev/api --since 15m"
ok "Migraciones aplicadas"

# ---------------------------------------------------------------- 6
step "6/7 Panel web"
rm -rf "$ROOT/build/web"
docker buildx build -f "$ROOT/apps/web/Dockerfile" \
  --build-arg "VITE_COGNITO_DOMAIN=$(tfo cognito_domain)" \
  --build-arg "VITE_COGNITO_CLIENT_ID=$(tfo cognito_web_client_id)" \
  --output "type=local,dest=$ROOT/build/web" "$ROOT"
BUCKET="$(tfo site_bucket)"
aws s3 sync "$ROOT/build/web" "s3://$BUCKET" --delete --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp "$ROOT/build/web/index.html" "s3://$BUCKET/index.html" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$(tfo cloudfront_distribution_id)" --paths "/index.html" >/dev/null
ok "Panel publicado en s3://$BUCKET"

# ---------------------------------------------------------------- 7
step "7/7 Prueba de humo"
WEB_URL="$(tfo web_url)"
for i in $(seq 1 40); do
  code="$(curl -s -o /tmp/health.json -w '%{http_code}' "$WEB_URL/v1/health" || true)"
  if [[ "$code" == "200" ]]; then ok "API sana: $(cat /tmp/health.json)"; break; fi
  echo "  intento $i/40: HTTP $code (CloudFront/ECS aún arrancando)…"; sleep 15
done
[[ "$code" == "200" ]] || die "La API no respondió 200. Revise: aws ecs describe-services --cluster $CLUSTER --services api"

cat <<EOF

────────────────────────────────────────────────────────────
Entorno dev desplegado en la cuenta $ACCOUNT ($REGION)
  Panel:      $WEB_URL
  API:        $(tfo api_url)
  Cognito:    pool $(tfo cognito_user_pool_id) · dominio $(tfo cognito_domain)
  Imágenes:   $IMAGE_TAG

Siguiente: crear usuarios y asignarlos a grupos (COORDINATOR, REVIEWER, APPROVER…):
  aws cognito-idp admin-create-user --user-pool-id $(tfo cognito_user_pool_id) --username <correo> \\
    --user-attributes Name=email,Value=<correo> Name=email_verified,Value=true
  aws cognito-idp admin-add-user-to-group --user-pool-id $(tfo cognito_user_pool_id) --username <correo> --group-name COORDINATOR
Para apagar dev y no pagar: terraform -chdir=terraform/environments/dev destroy -var image_tag=$IMAGE_TAG
────────────────────────────────────────────────────────────
EOF
