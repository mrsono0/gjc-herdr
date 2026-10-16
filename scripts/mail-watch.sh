#!/usr/bin/env bash
# gjc-herdr 팀장용 우편 감시 진입점(bash 3.2 + bun).
# 사용법: scripts/mail-watch.sh <받는이> [--timeout <초>]
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v bun >/dev/null 2>&1 || {
	echo 'bun이 필요합니다.' >&2
	exit 1
}

exec bun "$ROOT/scripts/mail-cli.ts" watch "$@"
