#!/usr/bin/env bash
# Carga los CSV de data/University-Excels/import en un entorno a través de la API (auditado, validado).
#
#   TOKEN=<id token de Cognito de un ADMINISTRADOR> ./scripts/real-data/load.sh
#
# El token se copia en la consola del navegador con el panel abierto y la sesión iniciada:
#   JSON.parse(localStorage.getItem('scheduler.session')).token
# Variables opcionales: API_URL (por defecto el CloudFront de dev), PERIOD (2026-2), PERIOD_START, PERIOD_END.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/data/University-Excels/import"
: "${TOKEN:?Defina TOKEN con el id token de Cognito (ver cabecera del script)}"
API_URL="${API_URL:-$(terraform -chdir="$ROOT/terraform/environments/dev" output -raw web_url)}/v1"
PERIOD="${PERIOD:-2026-2}"
PERIOD_START="${PERIOD_START:-2026-07-27}"
PERIOD_END="${PERIOD_END:-2026-11-28}"
AUTH=(-H "authorization: Bearer $TOKEN")

api() { # método ruta [json]
  local out code data=()
  [[ -n "${3:-}" ]] && data=(--data "$3")
  out="$(curl -sS -w '\n%{http_code}' -X "$1" "${AUTH[@]}" -H 'content-type: application/json' \
    "${data[@]}" "$API_URL$2")"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  printf '%s\t%s\n' "$code" "$out"
}

ensure() { # descripción ruta-get filtro-jq ruta-post json
  if curl -sS "${AUTH[@]}" "$API_URL$2" | jq -e "$3" >/dev/null; then
    echo "✓ $1 ya existe"
  else
    IFS=$'\t' read -r code body < <(api POST "$4" "$5")
    [[ "$code" == 20* ]] || { echo "✗ $1: HTTP $code $body" >&2; exit 1; }
    echo "✓ $1 creado"
  fi
}

[[ -d "$DIR" ]] || { echo "Primero: python scripts/real-data/convert_sistemas.py" >&2; exit 1; }
code="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$API_URL/academic-periods")"
[[ "$code" == 200 ]] || { echo "✗ El token no es válido o expiró (HTTP $code). Copie uno nuevo." >&2; exit 1; }

ensure "Período $PERIOD" /academic-periods ".[] | select(.code == \"$PERIOD\")" /academic-periods \
  "{\"code\":\"$PERIOD\",\"starts_on\":\"$PERIOD_START\",\"ends_on\":\"$PERIOD_END\"}"
for plan in 886 516; do
  ensure "Programa IS-$plan" /programs ".[] | select(.code == \"IS-$plan\")" /programs \
    "{\"code\":\"IS-$plan\",\"name\":\"Ingeniería de Sistemas (plan $plan)\",\"faculty\":\"Ingeniería\"}"
done

# Orden de dependencias del diccionario de datos
for e in time_slots teachers classrooms courses groups teacher_availability classroom_availability; do
  resp="$(curl -sS "${AUTH[@]}" -F "file=@$DIR/$e.csv;type=text/csv" "$API_URL/imports/$e?period=$PERIOD")"
  status="$(jq -r '.status // .error // "?"' <<<"$resp")"
  if [[ "$status" == "REJECTED" || "$status" == "?" || "$(jq -r '.statusCode // empty' <<<"$resp")" =~ ^[45] ]]; then
    echo "✗ $e: $status"; jq -c '.errors[:10] // .' <<<"$resp" >&2; exit 1
  fi
  echo "✓ $e: $status ($(jq -r '.total_rows' <<<"$resp") filas)"
done
echo "Listo: datos de Ingeniería de Sistemas cargados en $PERIOD ($API_URL)"
