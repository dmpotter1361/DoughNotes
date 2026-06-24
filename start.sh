#!/usr/bin/env bash
#
# DoughNotes launcher — builds, starts, and health-checks the stack.
#
# Usage:
#   ./start.sh [options]
#
# Options:
#   --http        Plain HTTP on :3500 (no Caddy)            (default if no DOMAIN in .env)
#   --https       HTTPS via Caddy on 80/443                 (default if DOMAIN is set)
#   --ai          Enable local AI extraction (Ollama)       (default if OLLAMA_URL is set)
#   --no-ai       Disable AI extraction
#   --no-build    Skip the image rebuild (faster restart)
#   --pull        Force re-pull of the Ollama model
#   -y, --yes     Non-interactive; use flags/.env defaults, no prompts
#   -h, --help    Show this help
#
# With no flags it reads .env and (if interactive) confirms the choices.

set -euo pipefail
cd "$(dirname "$0")"

# ---- pretty output -----------------------------------------------------------
if [ -t 1 ]; then
  B="\033[1m"; G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; N="\033[0m"
else
  B=""; G=""; Y=""; R=""; C=""; N=""
fi
info()  { printf "${C}•${N} %s\n" "$1"; }
ok()    { printf "${G}✓${N} %s\n" "$1"; }
warn()  { printf "${Y}!${N} %s\n" "$1"; }
die()   { printf "${R}✗ %s${N}\n" "$1" >&2; exit 1; }
step()  { printf "\n${B}%s${N}\n" "$1"; }

# ---- parse flags -------------------------------------------------------------
MODE=""; AI=""; BUILD=1; FORCE_PULL=0; ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --http)     MODE="http" ;;
    --https)    MODE="https" ;;
    --ai)       AI="yes" ;;
    --no-ai)    AI="no" ;;
    --no-build) BUILD=0 ;;
    --pull)     FORCE_PULL=1 ;;
    -y|--yes)   ASSUME_YES=1 ;;
    -h|--help)  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ---- docker / compose detection ---------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker is not installed."
SUDO=""
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then SUDO="sudo"; else die "Cannot talk to the Docker daemon (is it running?)."; fi
fi
DC="$SUDO docker compose"
$DC version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose ...)."

# ---- .env handling -----------------------------------------------------------
step "Checking configuration"
if [ ! -f .env ]; then
  cp .env.example .env
  warn "No .env found — created one from .env.example."
fi

# read a KEY=value from .env (value only, no surrounding quotes)
getenv() { sed -n "s/^$1=//p" .env | tail -n1 | sed 's/^"\(.*\)"$/\1/'; }
# set or replace KEY=value in .env
setenv() {
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf "%s=%s\n" "$1" "$2" >> .env
  fi
}

# JWT secret must be real
JWT="$(getenv JWT_SECRET)"
if [ -z "$JWT" ] || printf "%s" "$JWT" | grep -qi "change-me"; then
  if command -v openssl >/dev/null 2>&1; then
    setenv JWT_SECRET "$(openssl rand -hex 32)"
    ok "Generated a random JWT_SECRET."
  else
    die "JWT_SECRET is not set in .env and openssl isn't available to generate one."
  fi
else
  ok "JWT_SECRET is set."
fi

DOMAIN="$(getenv DOMAIN)"
OLLAMA_URL="$(getenv OLLAMA_URL)"
OLLAMA_MODEL="$(getenv OLLAMA_MODEL)"; [ -n "$OLLAMA_MODEL" ] || OLLAMA_MODEL="llama3.2:3b"

# ---- decide mode + AI (flags > .env > prompt) --------------------------------
[ -n "$MODE" ] || { [ -n "$DOMAIN" ] && MODE="https" || MODE="http"; }
[ -n "$AI" ]   || { [ -n "$OLLAMA_URL" ] && AI="yes" || AI="no"; }

if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
  read -r -p "$(printf "${B}Mode${N} [http/https] (%s): " "$MODE")" a; [ -n "$a" ] && MODE="$a"
  read -r -p "$(printf "${B}AI extraction (Ollama)?${N} [y/N] (%s): " "$AI")" a
  case "$a" in y|Y|yes) AI="yes" ;; n|N|no) AI="no" ;; esac
fi
[ "$MODE" = "http" ] || [ "$MODE" = "https" ] || die "Mode must be http or https."

# ---- consistency checks / nudges --------------------------------------------
PROFILES=""
if [ "$MODE" = "https" ]; then
  [ -n "$DOMAIN" ] || die "HTTPS mode needs DOMAIN=<your domain> in .env."
  PROFILES="$PROFILES --profile https"
  [ "$(getenv COOKIE_SECURE)" = "true" ] || warn "COOKIE_SECURE is not 'true' — logins may fail over HTTPS. Consider setting it."
  case "$(getenv APP_BASE_URL)" in https://*) ;; *) warn "APP_BASE_URL is not https:// — Google Drive sign-in needs the HTTPS URL." ;; esac
  ok "HTTPS via Caddy for ${DOMAIN} (needs ports 80 + 443 forwarded)."
else
  ok "Plain HTTP on :3500."
  [ "$(getenv COOKIE_SECURE)" = "true" ] && warn "COOKIE_SECURE=true but you're on plain HTTP — logins will fail. Set it to false."
fi

if [ "$AI" = "yes" ]; then
  PROFILES="$PROFILES --profile llm"
  if [ -z "$OLLAMA_URL" ]; then
    setenv OLLAMA_URL "http://ollama:11434"
    ok "Set OLLAMA_URL=http://ollama:11434 in .env."
    OLLAMA_URL="http://ollama:11434"
  fi
  ok "AI extraction on (model: ${OLLAMA_MODEL})."
else
  info "AI extraction off — imports use the built-in heuristic parser."
fi

# ---- start -------------------------------------------------------------------
step "Starting containers"
BUILD_FLAG=""; [ "$BUILD" -eq 1 ] && BUILD_FLAG="--build"
info "$DC$PROFILES up -d $BUILD_FLAG"
# shellcheck disable=SC2086
$DC $PROFILES up -d $BUILD_FLAG
ok "Containers up."
# shellcheck disable=SC2086
$DC $PROFILES ps

# ---- wait for the app health ------------------------------------------------
step "Waiting for the app to be healthy"
healthy=0
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3500/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" -eq 1 ]; then ok "App is responding on :3500."; else
  warn "App didn't answer /api/health in ~60s. Check: $DC logs app --tail 50"
fi

# ---- AI model: ensure it's present ------------------------------------------
if [ "$AI" = "yes" ]; then
  step "Checking the AI model"
  info "Waiting for the Ollama service…"
  oll=0
  for i in $(seq 1 30); do
    # shellcheck disable=SC2086
    if $DC $PROFILES exec -T ollama ollama list >/dev/null 2>&1; then oll=1; break; fi
    sleep 2
  done
  [ "$oll" -eq 1 ] || warn "Ollama service not ready yet — you may need to pull the model manually."
  if [ "$oll" -eq 1 ]; then
    # shellcheck disable=SC2086
    if [ "$FORCE_PULL" -eq 1 ] || ! $DC $PROFILES exec -T ollama ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL%%:*}"; then
      info "Pulling model ${OLLAMA_MODEL} (one-time, can take a few minutes)…"
      # shellcheck disable=SC2086
      $DC $PROFILES exec -T ollama ollama pull "$OLLAMA_MODEL" && ok "Model ready." || warn "Model pull failed — imports will fall back to the heuristic until it's pulled."
    else
      ok "Model ${OLLAMA_MODEL} already present."
    fi
  fi
fi

# ---- summary -----------------------------------------------------------------
step "Done 🥐"
if [ "$MODE" = "https" ]; then
  printf "  Open: ${B}https://%s${N}\n" "$DOMAIN"
  info "First HTTPS hit may take a moment while Caddy gets its certificate — see: $DC logs caddy --tail 30"
else
  printf "  Open: ${B}http://localhost:3500${N}  (or http://<server-ip>:3500)\n"
fi
[ "$AI" = "yes" ] && info "AI import is on. First import after start is slower while the model loads."
info "Logs:  $DC $PROFILES logs -f app"
info "Stop:  $DC $PROFILES down"
