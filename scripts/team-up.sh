#!/usr/bin/env bash
# gjc-herdr 팀 구성 보조. 기본: 이 pane의 이름·label만 맞춘다(pane 생성 없음).
#   scripts/team-up.sh --hook    SessionStart hook용. 백그라운드에서 clear는 기본 동작, 그 외는 --spawn 수행
#   scripts/team-up.sh           기본 동작을 지금 수행
#   scripts/team-up.sh --spawn   기본 동작 + 없는 GJC 팀원·선택 Codex 검토 구성(남은 빈 셸 pane 재사용)
#   GJCH_MATE_PRESET은 팀원 프리셋(기본 opus5-codex56-pro)이며, 빈 값이면 프리셋 없이 실행한다.
#   GJCH_TEAM_CODEX=0은 Codex 생성을 끈다. Codex는 사용자 지시로 --yolo(샌드박스 없음)를 사용한다.
#   --no-daemon은 공유 daemon 환경의 훅이 세션 ID를 다른 pane으로 보고하는 것을 막는다.
#   Codex는 저장소 루트에서 실행하며, 파일 수정은 먼저 팀장 허락을 받는다는 규칙(AGENTS.md·지시서)으로 지킨다.
# 아무것도 덮어쓰지 않는다: 이미 다른 pane이 쓰는 이름은 건드리지 않고, 작업공간 label은 비었거나 폴더명(Herdr 기본값)일 때만 설정한다.
set -u

LEAD_NAME="${GJCH_LEAD_NAME:-gjc-herdr-lead}"
MATE_NAME="${GJCH_MATE_NAME:-gjc-herdr-mate}"
CRITIC_NAME="${GJCH_CRITIC_NAME:-gjc-herdr-critic}"
LEAD_LABEL="GJCH 팀장 · Claude"
MATE_LABEL="GJCH 팀원 · GJC"
CRITIC_LABEL="GJCH 검토·조사 · Codex"
CODEX_MODEL="${GJCH_CODEX_MODEL:-gpt-6.1-sol}"
MATE_PRESET="${GJCH_MATE_PRESET-opus5-codex56-pro}"
WS_LABEL="GJCH · gjc-herdr"
RETRIES="${GJCH_RETRIES:-30}"   # 2초 간격 → 최대 약 60초

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
mode="${1:-}"

# --- 가드: Herdr 안, 이 프로젝트 안, 팀원 역할이 아닐 때만 ---
[ "${HERDR_ENV:-}" = 1 ] || exit 0
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
[ -z "${GJCH_TEAM_ROLE:-}" ] || exit 0
here="$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null && pwd -P)" || exit 0
case "$here/" in "$ROOT"/*) ;; *) exit 0 ;; esac
command -v herdr >/dev/null || exit 0
command -v python3 >/dev/null || exit 0

if [ "$mode" = "--hook" ]; then
	hook_source=""
	if [ ! -t 0 ]; then
		hook_source="$(python3 -c 'import json,os,select,sys,time
deadline=time.monotonic()+2
raw=bytearray()
try:
    while True:
        remaining=deadline-time.monotonic()
        if remaining<=0 or not select.select([sys.stdin],[],[],remaining)[0]: sys.exit(0)
        chunk=os.read(sys.stdin.fileno(),65536)
        if not chunk: break
        raw.extend(chunk)
    value=json.loads(raw)
    if isinstance(value,dict) and value.get("source")=="clear": print("clear")
except (OSError, ValueError): pass')"
	fi
	if [ "$hook_source" = clear ]; then
		nohup "$0" >/dev/null 2>&1 &
	else
		nohup "$0" --spawn >/dev/null 2>&1 &
	fi
	exit 0
fi

jget() { python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
for k in sys.argv[1].split("."): d=d.get(k) if isinstance(d,dict) else None
print("" if d is None else d)' "$1"; }

realpath() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }

# 이름이 비었거나 이 pane 소유일 때만 rename (이미 다른 pane이 쓰면 건드리지 않음)
claim_name() { # pane name
	local owner
	owner="$(herdr agent get "$2" 2>/dev/null | jget result.agent.pane_id)"
	if [ -z "$owner" ] || [ "$owner" = "$1" ]; then
		herdr agent rename "$1" "$2" >/dev/null 2>&1
	else
		return 2
	fi
}

retry() { # 감지·보고 지연을 기다리며 명령을 반복
	local i=0
	until "$@"; do
		i=$((i + 1)); [ "$i" -ge "$RETRIES" ] && return 1
		sleep 2
	done
}

# --- 팀장(이 pane) ---
# 이 pane의 실제 cwd가 프로젝트 안일 때, 그리고 이름을 이 pane이 확보했을 때만 label을 바꾼다.
# (다른 프로젝트 pane에서 실행되거나 이름이 다른 pane 소유면 이름·pane label·작업공간 label 모두 건드리지 않는다)
pane_cwd="$(herdr pane get "$HERDR_PANE_ID" 2>/dev/null | jget result.pane.cwd)"
if [ -n "$pane_cwd" ]; then
	pane_cwd="$(realpath "$pane_cwd")" || exit 0
fi
case "$pane_cwd/" in "$ROOT"/*) ;; *) echo "pane $HERDR_PANE_ID is not in $ROOT; nothing changed" >&2; exit 0 ;; esac

if retry claim_name "$HERDR_PANE_ID" "$LEAD_NAME"; then
	herdr pane rename "$HERDR_PANE_ID" "$LEAD_LABEL" >/dev/null 2>&1
	if [ -n "${HERDR_WORKSPACE_ID:-}" ]; then
		cur="$(herdr workspace get "$HERDR_WORKSPACE_ID" 2>/dev/null | jget result.workspace.label)"
		# 비었거나 Herdr가 폴더명으로 자동 부여한 기본값일 때만 바꾼다(사용자가 정한 이름은 유지)
		if [ -z "$cur" ] || [ "$cur" = "$(basename "$ROOT")" ]; then
			herdr workspace rename "$HERDR_WORKSPACE_ID" "$WS_LABEL" >/dev/null 2>&1
		fi
	fi
else
	echo "agent name '$LEAD_NAME' not claimed by $HERDR_PANE_ID; labels left unchanged" >&2
fi

[ "$mode" = "--spawn" ] || exit 0

# --- 팀원 GJC pane (이미 있으면 생성하지 않음) ---
mate_pane=""
spawn_mate() {
local existing pane mate_command
existing="$(herdr agent get "$MATE_NAME" 2>/dev/null | jget result.agent.pane_id)"
if [ -n "$existing" ]; then
	mate_pane="$existing"
	echo "mate already exists at $existing; nothing spawned"
	return 0
fi
# 새로 실행할 때만 프리셋을 검사한다(셸에 문자열로 입력되므로 허용 문자만).
case "$MATE_PRESET" in
	*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-]*)
		echo 'GJCH_MATE_PRESET은 비워 두거나 영문자·숫자·점·밑줄·하이픈만 사용할 수 있습니다.' >&2
		return 1 ;;
esac
mate_command="gjc"
[ -z "$MATE_PRESET" ] || mate_command="gjc --mpreset $MATE_PRESET"
# 재시작 후 남은 팀원 pane(label 일치·이 프로젝트 cwd·agent 없음 = 빈 셸)이 있으면 재사용한다.
pane="$(herdr pane list 2>/dev/null | python3 -c 'import sys,json,os
root,ws,label=sys.argv[1:4]
try: panes=json.load(sys.stdin)["result"]["panes"]
except Exception: sys.exit(0)
for p in panes:
    cwd=p.get("foreground_cwd") or p.get("cwd")
    if p.get("workspace_id")==ws and p.get("label")==label and not p.get("agent") and cwd and (os.path.realpath(cwd).rstrip("/")+"/").startswith(root.rstrip("/")+"/"):
        print(p["pane_id"]); break' "$ROOT" "${HERDR_WORKSPACE_ID:-}" "$MATE_LABEL")"
if [ -z "$pane" ]; then
	pane="$(herdr pane split --current --direction down --cwd "$ROOT" --no-focus 2>/dev/null | jget result.pane.pane_id)"
	[ -n "$pane" ] || { echo "pane split failed" >&2; return 1; }
fi
mate_pane="$pane"
herdr pane rename "$pane" "$MATE_LABEL" >/dev/null 2>&1
herdr pane run "$pane" "$mate_command" >/dev/null 2>&1 || { echo "pane run failed for $pane" >&2; return 1; }
if ! retry claim_name "$pane" "$MATE_NAME"; then
	echo "spawned pane $pane but agent name was not claimed within the retry window" >&2
	return 1
fi
echo "spawned $MATE_NAME at $pane"

# 사이드바는 pane label이 아니라 GJC 세션 이름을 보인다. GJC가 idle이고 플러그인 session_id token이
# 발행된 뒤(= 세션이 시작되어 입력을 받을 수 있음)에만 /rename을 입력하고, 아니면 수동 안내만 남긴다.
mate_ready() {
	herdr pane get "$pane" 2>/dev/null | python3 -c 'import sys,json
p=json.load(sys.stdin)["result"]["pane"]
sys.exit(0 if p.get("agent_status")=="idle" and p.get("tokens",{}).get("gjc_herdr_session_id") else 1)' 2>/dev/null
}
mate_renamed() {
	[ "$(herdr pane get "$pane" 2>/dev/null | jget result.pane.tokens.gjc_herdr_session)" = "$MATE_LABEL" ]
}
if retry mate_ready; then
	herdr pane send-text "$pane" "/rename $MATE_LABEL" >/dev/null 2>&1
	herdr pane send-keys "$pane" enter >/dev/null 2>&1
	if retry mate_renamed; then
		echo "session renamed to '$MATE_LABEL'"
	else
		echo "typed /rename but the session name token did not update; check the GJC input box" >&2
	fi
else
	echo "GJC not ready for input; run /rename '$MATE_LABEL' in the GJC input box manually" >&2
fi
return 0
}

# --- 독립 검토 Codex (GJC 단계 성공 여부와 무관하게 수행) ---
spawn_critic() {
	local existing workdir pane anchor direction mate_workspace
	if [ "${GJCH_TEAM_CODEX:-1}" = 0 ]; then
		echo "Codex reviewer disabled (GJCH_TEAM_CODEX=0)"
		return 0
	fi
	if ! command -v codex >/dev/null; then
		echo "codex not found; optional reviewer skipped (GJCH_TEAM_CODEX=0 disables it)" >&2
		return 0
	fi
	existing="$(herdr agent get "$CRITIC_NAME" 2>/dev/null | jget result.agent.pane_id)"
	if [ -n "$existing" ]; then
		echo "critic already exists at $existing; nothing spawned"
		return 0
	fi
	workdir="$ROOT"
	pane="$(herdr pane list | python3 -c 'import sys,json,os
workdir,ws,label=sys.argv[1:4]
try: panes=json.load(sys.stdin)["result"]["panes"]
except Exception: sys.exit(0)
for p in panes:
    cwd=p.get("foreground_cwd") or p.get("cwd")
    if p.get("workspace_id")==ws and p.get("label")==label and not p.get("agent") and cwd and os.path.realpath(cwd)==workdir:
        print(p["pane_id"]); break' "$workdir" "${HERDR_WORKSPACE_ID:-}" "$CRITIC_LABEL")"
	if [ -z "$pane" ]; then
		anchor="$HERDR_PANE_ID"
		direction=down
		if [ -n "$mate_pane" ] && [ -n "${HERDR_WORKSPACE_ID:-}" ]; then
			mate_workspace="$(herdr pane get "$mate_pane" | jget result.pane.workspace_id)"
			if [ "$mate_workspace" = "$HERDR_WORKSPACE_ID" ]; then
				anchor="$mate_pane"
				direction=right
			fi
		fi
		pane="$(herdr pane split --pane "$anchor" --direction "$direction" --cwd "$workdir" --no-focus | jget result.pane.pane_id)"
		[ -n "$pane" ] || { echo "Codex pane split failed" >&2; return 1; }
	fi
	herdr pane rename "$pane" "$CRITIC_LABEL" >/dev/null || return 1
	if ! herdr agent start "$CRITIC_NAME" --kind codex --pane "$pane" --timeout 60000 -- --no-daemon --yolo -m "$CODEX_MODEL" -C "$workdir"; then
		echo "Codex start failed for $pane" >&2
		return 1
	fi
	echo "spawned $CRITIC_NAME at $pane (cwd $ROOT)"
}

mate_status=0
spawn_mate || mate_status=$?
spawn_critic || exit $?
exit "$mate_status"
