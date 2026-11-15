#!/usr/bin/env bash
# Launch AgentDeez with Discord creds/token pulled from the local self-hosted Infisical.
# Identity file (chmod 600): ~/.config/agentdeez/infisical-identity.env, override with AGENTDEEZ_IDENTITY_FILE.
# Uses the AppImage in dist/ if present (or AGENTDEEZ_APPIMAGE); AGENTDEEZ_FROM_SOURCE=1 forces `npx electron .`.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ID_FILE="${AGENTDEEZ_IDENTITY_FILE:-$HOME/.config/agentdeez/infisical-identity.env}"

die() { echo "run-agentdeez: $*" >&2; exit 1; }
[[ -f "$ID_FILE" ]] || die "missing $ID_FILE"
[[ "$(stat -c %a "$ID_FILE")" == 600 ]] || die "$ID_FILE must be chmod 600"
command -v infisical >/dev/null || die "infisical CLI not installed"

set -a; . "$ID_FILE"; set +a
: "${INFISICAL_API_URL:=http://localhost:8080}"
: "${INFISICAL_ENV:=dev}"
: "${INFISICAL_SECRET_PATH:=/}"
for v in INFISICAL_PROJECT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET; do
  val="${!v:-}"
  [[ -n "$val" && "$val" != REPLACE_ME* ]] || die "$v not set in $ID_FILE"
done
export INFISICAL_API_URL INFISICAL_ENV INFISICAL_SECRET_PATH
CLI_DOMAIN="${INFISICAL_API_URL%/}"; CLI_DOMAIN="${CLI_DOMAIN%/api}/api"

# Client id/secret and the access token travel only in env (the CLI reads INFISICAL_UNIVERSAL_AUTH_CLIENT_ID/_SECRET
# and INFISICAL_TOKEN), never in argv, so they don't show up in ps or /proc/*/cmdline.
INFISICAL_TOKEN="$(infisical login --method=universal-auth --domain="$CLI_DOMAIN" --silent --plain)" || die "Universal Auth login failed"
export INFISICAL_TOKEN

APPIMAGE="${AGENTDEEZ_APPIMAGE:-$(ls -1t "$HERE"/dist/AgentDeez-*.AppImage 2>/dev/null | head -1 || true)}"
if [[ "${AGENTDEEZ_FROM_SOURCE:-0}" != 1 && -n "$APPIMAGE" && -x "$APPIMAGE" ]]; then
  cmd=("$APPIMAGE")
else
  cd "$HERE"; cmd=(npx --no-install electron .)
fi

exec infisical run --domain="$CLI_DOMAIN" \
  --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENV" --path="$INFISICAL_SECRET_PATH" \
  -- "${cmd[@]}" "$@"
