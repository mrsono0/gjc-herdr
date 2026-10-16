#!/usr/bin/env bash
# gjc-herdr 팀장용 우편 보내기(send) 진입점(bash 3.2 + bun).
# 사용법: scripts/mail-send.sh <받는이> --subject <제목> [--from <이름>] [--reply-to <ULID>] [--body-file <경로> | -]
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v bun >/dev/null 2>&1 || {
	echo 'bun이 필요합니다.' >&2
	exit 1
}

exec bun "$ROOT/scripts/mail-cli.ts" send "$@"
