#!/usr/bin/env bash
# Open the Arcane invite, fill the display name and birthday, submit, and stop
# when a live hCaptcha is on screen. One captcha-solver probe is sent from the app.
# The window stays open. This script does not click the puzzle.
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT"

if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 || true
fi

export DISPLAY="${DISPLAY:-:0}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
[[ -d "$XDG_RUNTIME_DIR" ]] || export XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir

export AGENTDEEZ_SIGNUP_PLATFORM=discord
export AGENTDEEZ_FROM_SOURCE=1
export AGENTDEEZ_PROFILE_DIR="${AGENTDEEZ_PROFILE_DIR:-$HOME/.config/AgentDeez-signup}"
export AGENTDEEZ_TOKEN_FILES="${AGENTDEEZ_TOKEN_FILES:-0}"
export AGENTDEEZ_CDP_PORT="${AGENTDEEZ_CDP_PORT:-9222}"
# Leave the display name and birthday unset. The signup module picks a random
# alphanumeric display name and a date for an age from 18 through 50. Set AGENTDEEZ_DISPLAY_NAME,
# or all three of AGENTDEEZ_BIRTH_MONTH, AGENTDEEZ_BIRTH_DAY, and AGENTDEEZ_BIRTH_YEAR, to pin them.

LOG="${AGENTDEEZ_SIGNUP_LOG:-$HOME/.cache/agentdeez/signup-until-captcha.log}"
mkdir -p "$(dirname "$LOG")"

if ss -ltn | grep -q "127.0.0.1:${AGENTDEEZ_CDP_PORT} "; then
  echo "signup-until-captcha: port ${AGENTDEEZ_CDP_PORT} is already in use" >&2
  exit 1
fi

: > "$LOG"
setsid -f nohup ./run-agentdeez.sh > "$LOG" 2>&1 < /dev/null

deadline=$((SECONDS + ${AGENTDEEZ_SIGNUP_DEADLINE:-180}))
while (( SECONDS < deadline )); do
  if grep -q 'Captcha probe SENT' "$LOG"; then
    echo "signup-until-captcha: name and birthday submitted, live captcha, probe sent"
    grep -E 'Register identity|Register profile|Register next|Captcha frame live|Captcha probe SENT' "$LOG"
    exit 0
  fi
  if grep -q 'Captcha stayed dead' "$LOG"; then
    echo "signup-until-captcha: captcha stayed dead after refill" >&2
    grep -E 'Register profile|Register next|Captcha ' "$LOG" >&2 || true
    exit 2
  fi
  if grep -q 'Mail signup failed' "$LOG"; then
    echo "signup-until-captcha: mail signup failed" >&2
    exit 3
  fi
  sleep 2
done

echo "signup-until-captcha: timed out before a live captcha probe" >&2
grep -E 'Register |Captcha |Mail signup' "$LOG" >&2 || true
exit 4
