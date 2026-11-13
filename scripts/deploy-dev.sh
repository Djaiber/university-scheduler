#!/usr/bin/env bash
# Despliegue completo del entorno dev en AWS (SCRUM-39).
#
#   AWS_PROFILE=Sebastian EXPECTED_ACCOUNT_SUFFIX=95 ./scripts/deploy-dev.sh
#
# Pasos (cada uno es idempotente; se puede relanzar si algo falla):
#   0. Prerrequisitos y verificación de la cuenta (debe terminar en EXPECTED_ACCOUNT_SUFFIX)
#   1. Bootstrap del estado remoto (S3 + DynamoDB)
#   2. Repositorios ECR (apply dirigido)
#   3. Imágenes ARM64 de API y worker → ECR (etiqueta = SHA del commit), construidas en AWS CodeBuild
#   4. terraform plan + confirmación + apply del entorno completo
#   5. Migraciones como tarea única de ECS
#   6. Panel web (npm local) → S3 + invalidación de CloudFront
#   7. Prueba de humo: GET /v1/health a través de CloudFront
#
# No requiere Docker local: las imágenes se construyen en un proyecto CodeBuild ARM temporal
# (rol IAM + bucket de fuentes efímeros que se eliminan al terminar el paso 3).
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
for bin in aws terraform git curl node npm; do command -v "$bin" >/dev/null || die "Falta '$bin' en el PATH"; done
[[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]] || die "Se necesita Node.js >= 20"
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
step "3/7 Imágenes ARM64 (AWS CodeBuild)"
image_exists() { aws ecr describe-images --repository-name "${1#*/}" --image-ids imageTag="$IMAGE_TAG" >/dev/null 2>&1; }
BUILD_TARGETS=""
image_exists "$ECR_API" && ok "api:$IMAGE_TAG ya existe en ECR" || BUILD_TARGETS+="api "
image_exists "$ECR_WORKER" && ok "worker:$IMAGE_TAG ya existe en ECR" || BUILD_TARGETS+="worker "

if [[ -n "$BUILD_TARGETS" ]]; then
  CB_NAME="university-scheduler-dev-image-build"
  CB_ROLE="$CB_NAME-role"
  CB_BUCKET="$CB_NAME-src-$ACCOUNT"
  CB_TMP="$(mktemp -d)"
  cleanup_codebuild() {
    set +e
    aws codebuild delete-project --name "$CB_NAME" >/dev/null 2>&1
    aws iam delete-role-policy --role-name "$CB_ROLE" --policy-name build >/dev/null 2>&1
    aws iam delete-role --role-name "$CB_ROLE" >/dev/null 2>&1
    aws s3 rb "s3://$CB_BUCKET" --force >/dev/null 2>&1
    rm -rf "$CB_TMP"
    set -e
  }
  trap cleanup_codebuild EXIT

  # Fuente: el commit exacto que da la etiqueta (igual que haría docker build sobre HEAD)
  aws s3api head-bucket --bucket "$CB_BUCKET" >/dev/null 2>&1 || {
    if [[ "$REGION" == "us-east-1" ]]; then aws s3api create-bucket --bucket "$CB_BUCKET" >/dev/null
    else aws s3api create-bucket --bucket "$CB_BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null; fi
    aws s3api put-public-access-block --bucket "$CB_BUCKET" --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  }
  git -C "$ROOT" archive --format=zip -o "$CB_TMP/src.zip" HEAD
  aws s3 cp "$CB_TMP/src.zip" "s3://$CB_BUCKET/src.zip" --only-show-errors

  # Rol con permisos mínimos: leer la fuente, escribir logs y publicar en los dos repositorios ECR
  aws iam get-role --role-name "$CB_ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$CB_ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  cat > "$CB_TMP/policy.json" <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":"arn:aws:logs:$REGION:$ACCOUNT:log-group:/aws/codebuild/$CB_NAME*"},
 {"Effect":"Allow","Action":["s3:GetObject","s3:GetObjectVersion"],"Resource":"arn:aws:s3:::$CB_BUCKET/*"},
 {"Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
 {"Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage"],
  "Resource":["arn:aws:ecr:$REGION:$ACCOUNT:repository/${ECR_API#*/}","arn:aws:ecr:$REGION:$ACCOUNT:repository/${ECR_WORKER#*/}"]}
]}
EOF
  aws iam put-role-policy --role-name "$CB_ROLE" --policy-name build --policy-document "file://$CB_TMP/policy.json"
  ROLE_ARN="$(aws iam get-role --role-name "$CB_ROLE" --query Role.Arn --output text)"

  # Compilación nativa en ARM64. Las imágenes base se toman del espejo público de ECR para evitar
  # el límite de descargas anónimas de Docker Hub desde las IP compartidas de CodeBuild.
  cat > "$CB_TMP/buildspec.yml" <<'EOF'
version: 0.2
env:
  variables:
    DOCKER_BUILDKIT: "1"
phases:
  pre_build:
    commands:
      - aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
      - sed -i -e '/^# syntax=/d' -e 's#^FROM node:#FROM public.ecr.aws/docker/library/node:#' -e 's#^FROM python:#FROM public.ecr.aws/docker/library/python:#' apps/api/Dockerfile services/worker/Dockerfile
  build:
    commands:
      - |
        for t in $BUILD_TARGETS; do
          case "$t" in
            api)    docker build -f apps/api/Dockerfile -t "$ECR_API:$IMAGE_TAG" . && docker push "$ECR_API:$IMAGE_TAG" ;;
            worker) docker build -f services/worker/Dockerfile -t "$ECR_WORKER:$IMAGE_TAG" . && docker push "$ECR_WORKER:$IMAGE_TAG" ;;
          esac || exit 1
        done
EOF
  node -e '
    const fs = require("fs"); const [bucket, role, spec, out] = process.argv.slice(1);
    fs.writeFileSync(out, JSON.stringify({
      source: { type: "S3", location: `${bucket}/src.zip`, buildspec: fs.readFileSync(spec, "utf8") },
      artifacts: { type: "NO_ARTIFACTS" },
      environment: { type: "ARM_CONTAINER", image: "aws/codebuild/amazonlinux-aarch64-standard:3.0",
                     computeType: "BUILD_GENERAL1_LARGE", privilegedMode: true },
      serviceRole: role, timeoutInMinutes: 60,
    }));' "$CB_BUCKET" "$ROLE_ARN" "$CB_TMP/buildspec.yml" "$CB_TMP/project.json"
  aws codebuild delete-project --name "$CB_NAME" >/dev/null 2>&1 || true
  # El rol recién creado tarda unos segundos en ser asumible por CodeBuild (consistencia eventual de IAM)
  for i in $(seq 1 12); do
    aws codebuild create-project --name "$CB_NAME" --cli-input-json "file://$CB_TMP/project.json" >/dev/null 2>&1 && break
    [[ "$i" == 12 ]] && aws codebuild create-project --name "$CB_NAME" --cli-input-json "file://$CB_TMP/project.json" >/dev/null
    sleep 10
  done

  BUILD_ID="$(aws codebuild start-build --project-name "$CB_NAME" --environment-variables-override \
    "name=REGISTRY,value=$REGISTRY" "name=ECR_API,value=$ECR_API" "name=ECR_WORKER,value=$ECR_WORKER" \
    "name=IMAGE_TAG,value=$IMAGE_TAG" "name=BUILD_TARGETS,value=$BUILD_TARGETS" \
    --query build.id --output text)"
  echo "Compilación $BUILD_ID ($BUILD_TARGETS)"
  while :; do
    STATUS="$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)"
    [[ "$STATUS" != "IN_PROGRESS" ]] && break
    PHASE="$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].currentPhase' --output text)"
    echo "  … $PHASE"; sleep 20
  done
  if [[ "$STATUS" != "SUCCEEDED" ]]; then
    aws logs tail "/aws/codebuild/$CB_NAME" --since 1h 2>/dev/null | tail -40 || true
    die "La compilación en CodeBuild terminó en $STATUS"
  fi
  cleanup_codebuild
  trap - EXIT
  ok "Imágenes $IMAGE_TAG publicadas en ECR (CodeBuild eliminado)"
fi

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
rm -rf "$ROOT/build/web" "$ROOT/apps/web/dist"
[[ -d "$ROOT/node_modules" ]] || npm --prefix "$ROOT" ci
( cd "$ROOT" && VITE_COGNITO_DOMAIN="$(tfo cognito_domain)" VITE_COGNITO_CLIENT_ID="$(tfo cognito_web_client_id)" \
    npm run build -w @us/web )
mkdir -p "$ROOT/build" && cp -R "$ROOT/apps/web/dist" "$ROOT/build/web"
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

Siguiente: crear el primer administrador (el resto de actores y su alcance se asignan en el panel → Usuarios).
Grupos: ADMINISTRADOR, COMITE_TACTICO, DIRECTOR, DOCENTE, ESTUDIANTE:
  aws cognito-idp admin-create-user --user-pool-id $(tfo cognito_user_pool_id) --username <correo> \\
    --user-attributes Name=email,Value=<correo> Name=email_verified,Value=true
  aws cognito-idp admin-add-user-to-group --user-pool-id $(tfo cognito_user_pool_id) --username <correo> --group-name ADMINISTRADOR
Para apagar dev y no pagar: terraform -chdir=terraform/environments/dev destroy -var image_tag=$IMAGE_TAG
────────────────────────────────────────────────────────────
EOF
