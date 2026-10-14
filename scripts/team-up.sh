#!/usr/bin/env bash
# gjc-herdr 팀 구성 보조. 기본: 이 pane의 이름·label만 맞춘다(pane 생성 없음).
#   scripts/team-up.sh --hook    SessionStart hook용. 백그라운드에서 clear는 기본 동작, 그 외는 --spawn 수행
#   scripts/team-up.sh           기본 동작을 지금 수행
#   scripts/team-up.sh --spawn   기본 동작 + 없는 GJC 팀원·선택 Codex 검토 구성(남은 빈 셸 pane 재사용)
#   scripts/team-up.sh --layout  기본 동작 + 기존 팀장·팀원·검토 pane을 목표 배치로 재배치(수동 전용, hook에서는 실행하지 않음)
#   목표 배치: 팀장 위(높이 60%), 그 아래 왼쪽 팀원 GJC | 오른쪽 검토 Codex(반반). Sidebar 등 다른 pane은 건드리지 않는다.
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

# --- 배치 보조 ---
# 같은 탭 안 pane move는 same_tab으로 무시되므로 임시 탭을 거친다. pane swap은 source pane에 focus를 주고
# 그 탭을 활성화하므로 쓰지 않고, 모든 move는 --no-focus로 사용자 focus를 유지한다.

# 스크립트가 만든 임시 탭은 남은 pane이 모두 agent 없는 pane(사용자 설정이 자동으로 만든 Sidebar 등)일 때만 닫는다.
close_temp_tab() { # tab
	local left
	left="$(herdr pane list 2>/dev/null | python3 -c 'import sys,json
try: panes=json.load(sys.stdin)["result"]["panes"]
except Exception: print("unknown"); sys.exit(0)
ps=[p for p in panes if p.get("tab_id")==sys.argv[1]]
print("agent" if any(p.get("agent") for p in ps) else "ok" if ps else "gone")' "$1")"
	case "$left" in
		ok) herdr tab close "$1" >/dev/null 2>&1 || echo "could not close temporary tab $1" >&2 ;;
		gone) ;;
		*) echo "temporary tab $1 left open (it has an agent pane or could not be listed)" >&2 ;;
	esac
}

# pane을 임시 탭으로 뺐다가 tab의 target 옆(split 방향, target 몫 ratio)에 되돌린다.
move_via_temp_tab() { # pane tab target split ratio
	local tmp
	tmp="$(herdr pane move "$1" --new-tab --no-focus 2>/dev/null | jget result.move_result.created_tab.tab_id)"
	[ -n "$tmp" ] || { echo "could not confirm moving $1 to a temporary tab; check herdr tab list" >&2; return 1; }
	if [ "$(herdr pane move "$1" --tab "$2" --target-pane "$3" --split "$4" --ratio "$5" --no-focus 2>/dev/null | jget result.move_result.changed)" != True ]; then
		echo "could not move $1 back from temporary tab $tmp; move it manually" >&2
		return 1
	fi
	close_temp_tab "$tmp"
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

# --- 재배치(--layout): 기존 팀장·팀원·검토 pane을 목표 배치로 ---
# 출력: "ok <팀장/아래 비율> [<팀원/검토 비율>]"(목표 모양) | "move"(아님) | 빈 값(layout 읽기 실패)
layout_state() { # mate [critic]
	herdr pane layout --pane "$HERDR_PANE_ID" 2>/dev/null | python3 -c 'import sys,json
lead,mate,critic=sys.argv[1:4]
try: l=json.load(sys.stdin)["result"]["layout"]
except Exception: sys.exit(0)
r={p["pane_id"]:p["rect"] for p in l["panes"]}
def rect(p):
    q=r.get(p)
    return q and (q["x"],q["y"],q["width"],q["height"])
def ratio(d,box):
    for s in l["splits"]:
        q=s["rect"]
        if s["direction"]==d and (q["x"],q["y"],q["width"],q["height"])==box: return s["ratio"]
L,M,C=rect(lead),rect(mate),rect(critic) if critic else None
ok=bool(L and M and (C or not critic)) and M[0]==L[0] and M[1]==L[1]+L[3]
if ok and C: ok=C[0]==M[0]+M[2] and C[1]==M[1] and C[3]==M[3] and M[2]+C[2]==L[2]
elif ok: ok=M[2]==L[2]
down=ok and ratio("down",(L[0],L[1],L[2],L[3]+M[3]))
right=ok and C and ratio("right",(M[0],M[1],M[2]+C[2],M[3]))
print("move" if down is None or not ok or (C and right is None) else "ok %s %s" % (down, right if C else ""))' "$HERDR_PANE_ID" "$1" "${2:-}"
}

# split 비율을 target으로 맞춘다. 늘릴 때는 첫 pane을 경계 쪽으로, 줄일 때는 둘째 pane을 경계 쪽으로 resize한다(amount = 비율 차).
set_ratio() { # current target first_pane grow_dir second_pane shrink_dir
	local d
	d="$(python3 -c 'import sys; d=float(sys.argv[2])-float(sys.argv[1]); print("" if abs(d)<0.005 else "%+.4f" % d)' "$1" "$2")" || return 1
	case "$d" in
		"") return 0 ;;
		+*) herdr pane resize --pane "$3" --direction "$4" --amount "${d#+}" >/dev/null 2>&1 ;;
		*) herdr pane resize --pane "$5" --direction "$6" --amount "${d#-}" >/dev/null 2>&1 ;;
	esac
}

# 목표 모양이면 팀장/아래 0.6, 팀원/검토 0.5로 맞추고 다시 읽어 확인한다.
# 반환: 0 맞춘 비율 확인, 1 resize 실패 또는 미도달(stderr에 읽은 비율), 2 목표 모양이 아님(layout 읽기 실패 포함)
# 비교는 rect가 아니라 split ratio 값이라 행·열 반올림의 영향을 받지 않으므로 허용 오차는 0.01이다.
fit_ratios() { # mate [critic]
	local mate="$1" critic="${2:-}" fail=0
	# shellcheck disable=SC2046
	set -- $(layout_state "$mate" "$critic")
	[ "${1:-}" = ok ] || return 2
	set_ratio "$2" 0.6 "$HERDR_PANE_ID" down "$mate" up || fail=1
	if [ -n "$critic" ]; then
		set_ratio "$3" 0.5 "$mate" right "$critic" left || fail=1
	fi
	# shellcheck disable=SC2046
	set -- $(layout_state "$mate" "$critic")
	[ "${1:-}" = ok ] || { echo "layout changed while resizing; not in the target layout" >&2; return 1; }
	python3 -c 'import sys
r=sys.argv[1:]
sys.exit(0 if abs(float(r[0])-0.6)<=0.01 and (len(r)<2 or abs(float(r[1])-0.5)<=0.01) else 1)' "$2" ${3:+"$3"} || fail=1
	[ "$fail" = 0 ] || echo "resize failed or not reached: lead/below $2${3:+, mate/critic $3} (target 0.6${critic:+/0.5})" >&2
	return "$fail"
}

apply_layout() {
	local lead="$HERDR_PANE_ID" lead_tab mate critic p why state
	if [ "$(herdr agent get "$LEAD_NAME" 2>/dev/null | jget result.agent.pane_id)" != "$lead" ]; then
		echo "--layout: agent '$LEAD_NAME' is not this pane ($lead); nothing moved" >&2; return 1
	fi
	mate="$(herdr agent get "$MATE_NAME" 2>/dev/null | jget result.agent.pane_id)"
	[ -n "$mate" ] || { echo "--layout: agent '$MATE_NAME' not found; nothing moved" >&2; return 1; }
	# 검토는 있으면 함께 배치하고, 없으면 팀장 60% / 팀원 아래만 맞춘다.
	critic="$(herdr agent get "$CRITIC_NAME" 2>/dev/null | jget result.agent.pane_id)"
	lead_tab="$(herdr pane get "$lead" 2>/dev/null | jget result.pane.tab_id)"
	[ -n "$lead_tab" ] || { echo "--layout: could not read the tab of $lead; nothing moved" >&2; return 1; }
	for p in "$mate" ${critic:+"$critic"}; do
		why="$(herdr pane get "$p" 2>/dev/null | python3 -c 'import sys,json,os
root,tab=sys.argv[1:3]
try: p=json.load(sys.stdin)["result"]["pane"]
except Exception: print("could not be read"); sys.exit(0)
cwd=p.get("foreground_cwd") or p.get("cwd")
if p.get("tab_id")!=tab: print("is not in the lead tab "+tab)
elif not cwd or not (os.path.realpath(cwd).rstrip("/")+"/").startswith(root.rstrip("/")+"/"): print("cwd is outside "+root)' "$ROOT" "$lead_tab")"
		[ -z "$why" ] || { echo "--layout: pane $p $why; nothing moved" >&2; return 1; }
	done
	state="$(layout_state "$mate" "$critic")"
	[ -n "$state" ] || { echo "--layout: could not read the layout of $lead_tab; nothing moved" >&2; return 1; }
	if [ "$state" = move ]; then
		move_via_temp_tab "$mate" "$lead_tab" "$lead" down 0.6 || return 1
		if [ -n "$critic" ]; then
			move_via_temp_tab "$critic" "$lead_tab" "$mate" right 0.5 || return 1
		fi
	fi
	fit_ratios "$mate" "$critic"
	case $? in
		0) echo "layout: lead $lead on top (60%), mate $mate${critic:+ | critic $critic} below" ;;
		2) echo "--layout: $lead_tab is not in the target layout; check herdr pane layout" >&2; return 1 ;;
		*) echo "--layout: panes are in place but the split ratios are not 60%/50%; check herdr pane layout" >&2; return 1 ;;
	esac
}

if [ "$mode" = "--layout" ]; then
	apply_layout
	exit $?
fi
[ "$mode" = "--spawn" ] || exit 0

# --- 팀원 GJC pane (이미 있으면 생성하지 않음) ---
mate_pane=""
spawn_mate() {
local existing pane mate_command lead_tab critic critic_tab layout_status=0
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
# 새로 만들 때만 위치를 정한다(재사용하는 pane은 옮기지 않음). 포커스가 아니라 팀장 pane(HERDR_PANE_ID) 기준이다.
if [ -z "$pane" ]; then
	lead_tab="$(herdr pane get "$HERDR_PANE_ID" 2>/dev/null | jget result.pane.tab_id)"
	critic="$(herdr agent get "$CRITIC_NAME" 2>/dev/null | jget result.agent.pane_id)"
	if [ -n "$critic" ] && [ -n "$lead_tab" ] && [ "$(herdr pane get "$critic" 2>/dev/null | jget result.pane.tab_id)" = "$lead_tab" ]; then
		# 검토가 같은 탭에 있으면 검토를 반으로 나눠 만들고, 검토를 새 pane 오른쪽으로 옮긴다(팀원 왼쪽).
		pane="$(herdr pane split --pane "$critic" --direction right --ratio 0.5 --cwd "$ROOT" --no-focus 2>/dev/null | jget result.pane.pane_id)"
		[ -n "$pane" ] || { echo "pane split failed" >&2; return 1; }
		# 배치 실패는 팀원 시작을 막지 않지만 최종 상태는 실패(비0)로 남긴다. hook에서 전체 재배치는 하지 않는다.
		if move_via_temp_tab "$critic" "$lead_tab" "$pane" right 0.5; then
			fit_ratios "$pane" "$critic"
			case $? in
				0) ;;
				2) layout_status=1; echo "mate pane $pane was created but $lead_tab is not in the target layout; run scripts/team-up.sh --layout" >&2 ;;
				*) layout_status=1; echo "mate pane $pane was created but the split ratios are not 60%/50%; run scripts/team-up.sh --layout" >&2 ;;
			esac
		else
			layout_status=1
			critic_tab="$(herdr pane get "$critic" 2>/dev/null | jget result.pane.tab_id)"
			if [ "$critic_tab" = "$lead_tab" ]; then
				echo "mate pane $pane is right of $CRITIC_NAME ($critic); run scripts/team-up.sh --layout to fix it" >&2
			else
				echo "$CRITIC_NAME ($critic) is not back in $lead_tab (now in ${critic_tab:-an unknown tab}); move it back manually first, --layout refuses panes outside the lead tab" >&2
			fi
		fi
	else
		pane="$(herdr pane split --pane "$HERDR_PANE_ID" --direction down --ratio 0.6 --cwd "$ROOT" --no-focus 2>/dev/null | jget result.pane.pane_id)"
		[ -n "$pane" ] || { echo "pane split failed" >&2; return 1; }
	fi
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
return "$layout_status"
}

# --- 독립 검토 Codex (GJC 단계 성공 여부와 무관하게 수행) ---
spawn_critic() {
	local existing workdir pane anchor direction ratio lead_tab layout_status=0
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
		# 팀원이 팀장과 같은 탭이면 팀원 오른쪽(반반), 아니면 팀장 아래(팀장 60%, 나중에 만드는 팀원이 검토 왼쪽에 들어감)
		anchor="$HERDR_PANE_ID"
		direction=down
		ratio=0.6
		if [ -n "$mate_pane" ]; then
			lead_tab="$(herdr pane get "$HERDR_PANE_ID" | jget result.pane.tab_id)"
			if [ -n "$lead_tab" ] && [ "$(herdr pane get "$mate_pane" | jget result.pane.tab_id)" = "$lead_tab" ]; then
				anchor="$mate_pane"
				direction=right
				ratio=0.5
			fi
		fi
		pane="$(herdr pane split --pane "$anchor" --direction "$direction" --ratio "$ratio" --cwd "$workdir" --no-focus | jget result.pane.pane_id)"
		[ -n "$pane" ] || { echo "Codex pane split failed" >&2; return 1; }
		# 팀원 옆에 만들었으면 Codex 시작 전에 팀장 60%·반반을 맞춘다(실패해도 시작은 계속하고 최종 비0).
		if [ "$direction" = right ]; then
			fit_ratios "$mate_pane" "$pane"
			case $? in
				0) ;;
				2) layout_status=1; echo "critic pane $pane was created but $lead_tab is not in the target layout; run scripts/team-up.sh --layout" >&2 ;;
				*) layout_status=1; echo "critic pane $pane was created but the split ratios are not 60%/50%; run scripts/team-up.sh --layout" >&2 ;;
			esac
		fi
	fi
	herdr pane rename "$pane" "$CRITIC_LABEL" >/dev/null || return 1
	if ! herdr agent start "$CRITIC_NAME" --kind codex --pane "$pane" --timeout 60000 -- --no-daemon --yolo -m "$CODEX_MODEL" -C "$workdir"; then
		echo "Codex start failed for $pane" >&2
		return 1
	fi
	echo "spawned $CRITIC_NAME at $pane (cwd $ROOT)"
	return "$layout_status"
}

mate_status=0
spawn_mate || mate_status=$?
spawn_critic || exit $?
exit "$mate_status"
