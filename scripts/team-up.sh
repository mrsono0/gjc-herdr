#!/usr/bin/env bash
# gjc-herdr 팀 구성 보조. 기본: 이 pane의 이름·label만 맞춘다(pane 생성 없음).
#   scripts/team-up.sh --hook    SessionStart hook용. 잠금 확인 후 역할을 한 줄로 출력하고 백그라운드에서 기본/--spawn 수행
#   scripts/team-up.sh           기본 동작을 지금 수행(외부 팀장은 역할 한 줄만 출력)
#   scripts/team-up.sh --spawn   기본 동작 + 없는 agy 팀원·선택 Codex 검토 구성(남은 빈 셸 pane 재사용) + 마지막에 목표 배치 보정
#                                (팀원이 팀장 탭에 없는 등 조건이 안 맞으면 옮기지 않고 건너뜀, 조회 실패는 비0,
#                                 검토는 선택 Codex가 켜져 있고 같은 탭일 때만 포함)
#   scripts/team-up.sh --layout  기본 동작 + 기존 팀장·팀원·검토 pane을 목표 배치로 재배치(조건이 안 맞으면 오류)
#   목표 배치(공식 기준): Herdr 안은 팀장 위(높이 60%), 그 아래 왼쪽 팀원 agy | 오른쪽 검토 Codex(반반). 검토가 없으면 팀장 60% / 팀원 아래.
#                         외부 팀장(GJCH_EXTERNAL_LEAD=1, Herdr 밖)은 팀 작업공간 한 탭 안에서 팀원 agy | 검토 Codex(반반).
#   팀장 잠금(scripts/team-lead.sh, GJCH_LEAD_LOCK): 잠금이 다른 세션에 있으면 Herdr 안 Claude는 부팀장(GJCH_DEPUTY_NAME, 기본 gjc-herdr-deputy)이 되고,
#   외부 세션은 팀원이 있는 작업공간(GJCH_WS_LABEL)을 건드리지 않는다.
#   Sidebar 등 다른 pane은 건드리지 않는다(임시 탭에 자동 생성된 agent 없는 Sidebar만 탭 닫기로 함께 정리).
#   GJCH_MATE_MODEL은 팀원 agy 모델(기본 gemini-4-argon-high)이며, 영문자·숫자·점·밑줄·하이픈만 허용한다.
#   GJCH_TEAM_CODEX=0은 Codex 생성을 끈다. Codex는 사용자 지시로 --yolo(샌드박스 없음)를 사용한다.
#   --no-daemon은 공유 daemon 환경의 훅이 세션 ID를 다른 pane으로 보고하는 것을 막는다.
#   -c 'tui.status_line=[...]'은 56칸 검토 pane에서 상태 줄이 잘리지 않게 사용자 설정을 바꾸지 않고 이 프로세스만 덮어쓴다.
#   -c project_doc_max_bytes=65536(GJCH_CODEX_DOC_MAX_BYTES, 양의 정수가 아니면 65536)은 AGENTS.md를 끝까지 읽게 하며 사용자 설정은 바꾸지 않는다.
#   Codex는 저장소 루트에서 실행하며, 파일 수정은 먼저 팀장 허락을 받는다는 규칙(AGENTS.md·지시서)으로 지킨다.
# 아무것도 덮어쓰지 않는다: 이미 다른 pane이 쓰는 이름은 건드리지 않고, 작업공간 label은 비었거나 폴더명(Herdr 기본값)일 때만 설정한다.
set -u

LEAD_NAME="${GJCH_LEAD_NAME:-gjc-herdr-lead}"
DEPUTY_NAME="${GJCH_DEPUTY_NAME:-gjc-herdr-deputy}"
MATE_NAME="${GJCH_MATE_NAME:-gjc-herdr-mate}"
CRITIC_NAME="${GJCH_CRITIC_NAME:-gjc-herdr-critic}"
LEAD_LABEL="GJCH 팀장"
DEPUTY_LABEL="GJCH 부팀장 · Claude"
MATE_LABEL="GJCH 팀원 · agy"
CRITIC_LABEL="GJCH 검토·조사 · Codex"
CODEX_MODEL="${GJCH_CODEX_MODEL:-gpt-6.1-sol}"
CODEX_DOC_MAX_BYTES="${GJCH_CODEX_DOC_MAX_BYTES:-65536}"
case "$CODEX_DOC_MAX_BYTES" in
	""|0*|*[!0-9]*) CODEX_DOC_MAX_BYTES=65536 ;;
esac
MATE_MODEL="${GJCH_MATE_MODEL:-gemini-4-argon-high}"
WS_LABEL="${GJCH_WS_LABEL:-GJCH · gjc-herdr}"
RETRIES="${GJCH_RETRIES:-30}"   # 2초 간격 → 최대 약 60초

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=scripts/worktree-guard.sh
. "$ROOT/scripts/worktree-guard.sh"
mode="${1:-}"

CODEX_STATUS_LINE='tui.status_line=["context-remaining","total-input-tokens","total-output-tokens"]'
MATE_START_ARGS=(--model "$MATE_MODEL" --mode accept-edits --sandbox)
CRITIC_START_ARGS=(--no-daemon --yolo -m "$CODEX_MODEL" -C "$ROOT" --disable worktrees -c "$CODEX_STATUS_LINE" -c "project_doc_max_bytes=$CODEX_DOC_MAX_BYTES")

# 시작 인자 배열(argv 조각)을 기대 단위("<깃발> <값>" 또는 "<깃발>") 줄 목록으로 바꾼다(#42).
# 전제: 기대 옵션에는 위치 인자가 없고 옵션 값은 '-'로 시작하지 않는다.
format_expected_units() {
	while [ $# -gt 0 ]; do
		if [ $# -ge 2 ] && case "$2" in -*) false ;; *) true ;; esac; then
			printf '%s %s\n' "$1" "$2"
			shift 2
		else
			printf '%s\n' "$1"
			shift
		fi
	done
}

print_expected_units() { # agy|codex
	case "${1:-}" in
		agy) format_expected_units "${MATE_START_ARGS[@]}" ;;
		codex) format_expected_units "${CRITIC_START_ARGS[@]}" ;;
		*) return 1 ;;
	esac
}

if [ "$mode" = "--print-expected-units" ]; then
	print_expected_units "${2:-}"
	exit $?
fi

# --- 가드: Herdr 안 또는 외부 팀장(GJCH_EXTERNAL_LEAD=1), 이 프로젝트 안, 팀원 역할이 아닐 때만 ---
if [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ]; then
	lead_mode=inside
elif [ "${GJCH_EXTERNAL_LEAD:-}" = 1 ]; then
	lead_mode=external
else
	exit 0
fi
[ -z "${GJCH_TEAM_ROLE:-}" ] || exit 0
here="$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null && pwd -P)" || exit 0
case "$here/" in "$ROOT"/*) ;; *) exit 0 ;; esac
if wt_reason="$(gjch_worktree_reason "$ROOT")"; then
	if [ "$mode" = "--hook" ]; then
		printf 'GJCH: 이 세션은 연결 worktree(%s)에서 실행 중이라 팀장으로 동작하지 않습니다. 데스크톱 세션의 worktree 옵션을 끄고 저장소 폴더에서 새 세션을 엽니다.\n' "$ROOT"
		exit 0
	fi
	printf '%s\n' "$wt_reason" >&2
	exit 1
fi
command -v herdr >/dev/null || exit 0
command -v python3 >/dev/null || exit 0

lead_out="$(/bin/bash "$ROOT/scripts/team-lead.sh" claim 2>&1)"
lead_rc=$?
case "$lead_rc" in
	0|3|4) ;;
	*)
		echo "${lead_out:-팀장 잠금 확인에 실패했습니다.}" >&2
		exit 1 ;;
esac
held_info="${lead_out#held }"
held_info="${held_info%…}"

print_role_line() {
	if [ "$lead_mode" = inside ]; then
		case "$lead_rc" in
			0) echo "GJCH: 이 세션이 팀장입니다(herdr pane $HERDR_PANE_ID, 팀장 잠금 보유)." ;;
			3) echo "GJCH: 팀장 잠금이 다른 세션($held_info)에 있어 이 세션은 부팀장($DEPUTY_NAME)입니다. 팀원에게 배정·입력하지 말고 팀장을 지원만 합니다." ;;
			4) echo "GJCH: 정체를 알 수 없으나 이 세션이 팀장입니다(herdr pane $HERDR_PANE_ID, 다른 살아 있는 팀장 잠금 없음)." ;;
		esac
	else
		case "$lead_rc" in
			0) echo "GJCH: 이 세션이 외부 팀장입니다(herdr 밖, 팀장 잠금 보유). 팀원 작업공간 '$WS_LABEL'을 확인·구성합니다." ;;
			3) echo "GJCH: 팀장 잠금이 다른 세션($held_info)에 있어 이 세션은 팀장이 아닙니다. 팀원에게 배정·입력하지 마세요." ;;
			4) echo "GJCH: 세션 정체(CLAUDE_CODE_SESSION_ID·소켓)를 알 수 없어 이 세션은 외부 팀장이 아닙니다." ;;
		esac
	fi
}

jget() { python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
for k in sys.argv[1].split("."): d=d.get(k) if isinstance(d,dict) else None
print("" if d is None else d)' "$1"; }

realpath() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }

codex_enabled() { [ "${GJCH_TEAM_CODEX:-1}" != 0 ] && command -v codex >/dev/null; }

# 시험용: GJCH_HOOK_ARGV_TIMEOUT(hook-argv-check.py에서 양의 유한 숫자·상한 30초 검증, 아니면 기본 3초)
HOOK_ARGV_TIMEOUT="${GJCH_HOOK_ARGV_TIMEOUT:-3}"

# 기존 팀원·검토 pane의 foreground argv를 기대 시작 옵션과 비교한다(#42).
# 일치하면 무출력·rc 0, 불일치·판정 불가는 한 줄 출력 후 rc 1(GJCH_FROM_HOOK=1 문맥은 stdout에 GJCH: 접두사를 쓰고 rc 0).
check_member_argv() { # name pane kind [status]
	local name="$1" pane="$2" kind="$3" status="${4:-idle}" recovery info_out info_rc=0 msg
	[ -n "$status" ] || status=idle
	if [ "$lead_mode" = external ]; then
		recovery="idle·빈 입력란 확인 → /quit → GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --spawn"
	else
		recovery="idle·빈 입력란 확인 → /quit → scripts/team-up.sh --spawn"
	fi
	local -a expected=()
	case "$kind" in
		agy) expected=("${MATE_START_ARGS[@]}") ;;
		codex) expected=("${CRITIC_START_ARGS[@]}") ;;
		*) return 1 ;;
	esac
	info_out="$(herdr pane process-info --pane "$pane" 2>/dev/null)" || info_rc=$?
	if [ "$info_rc" = 0 ]; then
		msg="$(printf '%s' "$info_out" | python3 "$ROOT/scripts/agent-argv-check.py" --status "$status" "$kind" "$name" "$recovery" -- "${expected[@]}")" && return 0
	else
		msg="$(python3 "$ROOT/scripts/agent-argv-check.py" --process-info-failed --status "$status" "$kind" "$name" "$recovery" -- "${expected[@]}")"
	fi
	if [ "$mode" = "--hook" ] || [ "${GJCH_FROM_HOOK:-}" = 1 ]; then
		[ -n "$msg" ] && printf 'GJCH: %s\n' "$msg"
		return 0
	fi
	[ -n "$msg" ] && printf '%s\n' "$msg" >&2
	return 1
}

# agent 이름 → pane ID. agent_not_found로 확인되면 빈 값(rc 0), 조회·파싱 실패면 rc 1.
# herdr는 오류 JSON을 stderr로 내므로 함께 읽는다.
# herdr 자체의 rc도 본다: rc 0이면 pane_id가 있어야 하고, 비0이면 agent_not_found일 때만 부재다.
agent_pane() { # name
	local out rc
	out="$(herdr agent get "$1" 2>&1)"; rc=$?
	printf '%s' "$out" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
p=((d.get("result") or {}).get("agent") or {}).get("pane_id")
if sys.argv[1]=="0":
    if not p: sys.exit(1)
    print(p)
elif ((d.get("error") or {}).get("code"))!="agent_not_found": sys.exit(1)' "$rc"
}

# agent 이름 → "<pane_id>|<agent_status>". agent_not_found면 빈 값(rc 0), 조회·파싱 실패면 rc 1.
agent_pane_status() { # name
	local out rc=0
	out="$(herdr agent get "$1" 2>&1)" || rc=$?
	printf '%s' "$out" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
a=((d.get("result") or {}).get("agent") or {})
p=a.get("pane_id")
s=a.get("agent_status") or "idle"
if sys.argv[1]=="0":
    if not p: sys.exit(1)
    print("%s|%s" % (p, s))
elif ((d.get("error") or {}).get("code"))!="agent_not_found": sys.exit(1)' "$rc"
}

# 이름이 비었거나 이 pane 소유일 때만 rename (이미 다른 pane이 쓰면 건드리지 않음, 조회 실패면 rc 1)
claim_name() { # pane name
	local owner
	owner="$(agent_pane "$2")" || return 1
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
	local out left=unknown
	out="$(herdr pane list 2>/dev/null)" && left="$(printf '%s' "$out" | python3 -c 'import sys,json
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

# tab의 pane ID 목록(공백 구분). before를 주면 그때 없던 agent 없는 pane만. 목록 조회(herdr rc 포함)·파싱 실패면 rc 1.
tab_panes() { # tab [before]
	local out
	out="$(herdr pane list 2>/dev/null)" || return 1
	printf '%s' "$out" | python3 -c 'import sys,json
try: panes=json.load(sys.stdin)["result"]["panes"]
except Exception: sys.exit(1)
tab=sys.argv[1]; ps=[p for p in panes if p.get("tab_id")==tab]
if len(sys.argv)>2:
    before=set(sys.argv[2].split()); ps=[p for p in ps if p["pane_id"] not in before and not p.get("agent")]
print(" ".join(p["pane_id"] for p in ps))' "$@"
}

# 새 탭에는 사용자 설정이 agent 없는 Sidebar pane을 비동기로 만든다(실측 0.63–1.01초, CPU 부하 포함).
# 즉시 되돌리면 원래 탭에 agent 없는 pane이 하나 더 생기는 경쟁이 관측됐고, 그 원인을 Sidebar 플러그인으로 추정한다.
# 그래서 임시 탭의 pane 수가 늘어 0.3초 동안 변하지 않을 때까지 기다린다. 상한(최댓값의 약 2배)은 목록 조회를
# 포함한 대기 시간의 상한이다(Python 시작 등 프로세스 비용은 제외). 상한 안에 늘지 않으면(Sidebar 없음) 그대로 진행한다.
# 반환: 0 안정됨 또는 정상 목록으로 상한 만료, 1 목록 조회 실패(herdr rc·JSON) 또는 상한 안에 정상 목록을 한 번도 못 받음
TEMP_TAB_WAIT=2.5
wait_temp_tab() { # tab
	python3 -c 'import json,subprocess,sys,time
tab,cap=sys.argv[1],float(sys.argv[2])
end=time.monotonic()+cap; last=None; changed=0.0
while True:
    left=end-time.monotonic()
    if left<=0: break
    try: r=subprocess.run(["herdr","pane","list"],capture_output=True,text=True,timeout=left)
    except subprocess.TimeoutExpired: break
    except Exception: sys.exit(1)
    if r.returncode!=0: sys.exit(1)
    try: panes=json.loads(r.stdout)["result"]["panes"]; n=sum(1 for p in panes if p.get("tab_id")==tab)
    except Exception: sys.exit(1)
    now=time.monotonic()
    if n!=last: last,changed=n,now
    if n>=2 and now-changed>=0.3: sys.exit(0)
    left=end-now
    if left<=0: break
    time.sleep(min(0.1,left))
sys.exit(0 if last is not None else 1)' "$1" "$TEMP_TAB_WAIT"
}

# pane을 임시 탭으로 뼈다가 tab의 target 옆(split 방향, target 몫 ratio)에 되돌린다.
# 반환: 0 성공, 1 이동 실패, 2 되돌린 뒤 tab에 새로 관측된 agent 없는 pane이 있음(출처 미확인, 닫지 않음),
#       3 되돌렸지만 임시 탭 대기나 되돌린 뒤 목록 조회가 실패해 새 pane 검사를 믿을 수 없음.
# 호출부(spawn_mate·apply_layout)는 0이 아니면 모두 배치 실패로 다루며, 1/2/3 구분은 stderr 안내에만 쓴다.
move_via_temp_tab() { # pane tab target split ratio
	local tmp before left waited=0
	before="$(tab_panes "$2")" || { echo "could not list the panes of $2; $1 not moved" >&2; return 1; }
	tmp="$(herdr pane move "$1" --new-tab --no-focus 2>/dev/null | jget result.move_result.created_tab.tab_id)"
	[ -n "$tmp" ] || { echo "could not confirm moving $1 to a temporary tab; check herdr tab list" >&2; return 1; }
	# 대기 조회가 실패해도 pane은 되돌리되, 그 실패는 끝까지 보존한다.
	wait_temp_tab "$tmp" || { waited=1; echo "could not watch temporary tab $tmp while waiting; moving $1 back anyway" >&2; }
	if [ "$(herdr pane move "$1" --tab "$2" --target-pane "$3" --split "$4" --ratio "$5" --no-focus 2>/dev/null | jget result.move_result.changed)" != True ]; then
		echo "could not move $1 back from temporary tab $tmp; move it manually" >&2
		return 1
	fi
	close_temp_tab "$tmp"
	left="$(tab_panes "$2" "$before")" || { echo "could not list the panes of $2 after moving $1; new panes were not checked" >&2; return 3; }
	if [ -n "$left" ]; then
		echo "pane(s) $left newly observed in $2 during the move via a temporary tab (no agent, origin unknown); not closed" >&2
		return 2
	fi
	if [ "$waited" = 1 ]; then
		echo "$2 shows no new pane now, but one may still appear because the wait was not completed" >&2
		return 3
	fi
}

# 외부 팀장용 기존 agent 검증(이름 → "<workspace_id>|<pane_id>|<state>").
# agent_not_found로 확인되면 빈 값(rc 0), 조회·파싱 실패나 agent 종류·cwd 불일치면 stderr에 이유를 쓰고 rc 1.
ext_agent_info() { # name expected_kind cwd_mode(inside|exact)
	local name="$1" expected_kind="$2" cwd_mode="$3" out rc=0
	out="$(herdr agent get "$name" 2>&1)" || rc=$?
	printf '%s' "$out" | python3 -c 'import json,os,subprocess,sys
rc,name,expected_kind,cwd_mode,root=sys.argv[1:6]
def fail_lookup():
    print("could not look up agent '\''%s'\''" % name, file=sys.stderr)
    sys.exit(1)
try: d=json.load(sys.stdin)
except Exception: fail_lookup()
if not isinstance(d,dict): fail_lookup()
if rc!="0":
    err=d.get("error")
    if isinstance(err,dict) and err.get("code")=="agent_not_found":
        sys.exit(0)
    fail_lookup()
res=d.get("result")
a=(res.get("agent") if isinstance(res,dict) else None) or {}
if not isinstance(a,dict) or not a.get("pane_id"):
    fail_lookup()
p=a.get("pane_id")
w=a.get("workspace_id") or ""
k=a.get("agent") or ""
c=a.get("foreground_cwd") or a.get("cwd") or ""
s=a.get("agent_status") or ""
r=a.get("interactive_ready")
if s=="blocked": st="blocked|"+p+"|blocked"
elif s=="working" or (s in ("idle","done") and r is True): st="ready|"+p+"|"+s
elif s: st="not_ready|"+p+"|"+s
else: st="not_ready|"+p+"|idle"
if not w or not k or not c:
    try:
        pr=subprocess.run(["herdr","pane","get",p],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
        pane_raw=pr.stdout if pr.returncode==0 else ""
    except Exception:
        pane_raw=""
    if pane_raw:
        try:
            pdoc=json.loads(pane_raw)
            pres=pdoc.get("result") if isinstance(pdoc,dict) else None
            pd=(pres.get("pane") if isinstance(pres,dict) else None) or {}
        except Exception: pd={}
        if isinstance(pd,dict):
            if not w: w=pd.get("workspace_id") or ""
            if not k: k=pd.get("agent") or ""
            if not c: c=pd.get("foreground_cwd") or pd.get("cwd") or ""
if not w:
    print("could not determine workspace of agent '\''%s'\'' (%s)" % (name, p), file=sys.stderr)
    sys.exit(1)
if k != expected_kind:
    print("agent '\''%s'\'' (%s) is '\''%s'\'', expected '\''%s'\''" % (name, p, k or "unknown", expected_kind), file=sys.stderr)
    sys.exit(1)
if not c:
    print("could not determine cwd of agent '\''%s'\'' (%s)" % (name, p), file=sys.stderr)
    sys.exit(1)
real_c=os.path.realpath(c)
real_root=os.path.realpath(root)
if cwd_mode=="exact":
    if real_c != real_root:
        print("agent '\''%s'\'' (%s) cwd (%s) is not %s" % (name, p, real_c, real_root), file=sys.stderr)
        sys.exit(1)
else:
    if not (real_c.rstrip("/")+"/").startswith(real_root.rstrip("/")+"/"):
        print("agent '\''%s'\'' (%s) cwd (%s) is outside %s" % (name, p, real_c, real_root), file=sys.stderr)
        sys.exit(1)
print("%s|%s|%s" % (w, p, st))' "$rc" "$name" "$expected_kind" "$cwd_mode" "$ROOT"
}

# SessionStart(startup) hook에서 기존 팀원·검토가 이미 떠 있으면 상태와 상관없이 argv를 동기로 점검해 stdout(GJCH: 접두사)에 알린다(#42, #58).
hook_check_existing_argv() {
	local codex_on=0
	codex_enabled && codex_on=1
	python3 "$ROOT/scripts/hook-argv-check.py" \
		"$HOOK_ARGV_TIMEOUT" \
		"$lead_mode" \
		"$ROOT" \
		"${HERDR_PANE_ID:-}" \
		"$MATE_NAME" \
		"$CRITIC_NAME" \
		"$codex_on" \
		"${#MATE_START_ARGS[@]}" \
		"${MATE_START_ARGS[@]}" \
		"${#CRITIC_START_ARGS[@]}" \
		"${CRITIC_START_ARGS[@]}" || true
}

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
	print_role_line
	if [ "$lead_mode" = inside ]; then
		if [ "$hook_source" = clear ]; then
			GJCH_FROM_HOOK=1 nohup "$0" >/dev/null 2>&1 &
		else
			if [ "$lead_rc" != 3 ]; then
				hook_check_existing_argv
			fi
			GJCH_FROM_HOOK=1 nohup "$0" --spawn >/dev/null 2>&1 &
		fi
	elif [ "$lead_rc" = 0 ] && [ "$hook_source" != clear ]; then
		hook_check_existing_argv
		GJCH_FROM_HOOK=1 nohup "$0" --spawn >/dev/null 2>&1 &
	fi
	exit 0
fi

TEAM_WS=""
NEW_WS_ROOT_PANE=""
EXT_MATE_PANE=""
EXT_MATE_STATE=""
EXT_CRITIC_PANE=""
EXT_CRITIC_STATE=""
argv_status=0

if [ "$lead_mode" = inside ]; then
	# --- 팀장/부팀장(이 pane) ---
	# 이 pane의 실제 cwd가 프로젝트 안일 때, 그리고 이름을 이 pane이 확보했을 때만 label을 바꾼다.
	# (다른 프로젝트 pane에서 실행되거나 이름이 다른 pane 소유면 이름·pane label·작업공간 label 모두 건드리지 않는다)
	pane_cwd="$(herdr pane get "$HERDR_PANE_ID" 2>/dev/null | jget result.pane.cwd)"
	if [ -n "$pane_cwd" ]; then
		pane_cwd="$(realpath "$pane_cwd")" || exit 0
	fi
	case "$pane_cwd/" in "$ROOT"/*) ;; *) echo "pane $HERDR_PANE_ID is not in $ROOT; nothing changed" >&2; exit 0 ;; esac

	if [ "$lead_rc" = 3 ]; then
		if retry claim_name "$HERDR_PANE_ID" "$DEPUTY_NAME"; then
			herdr pane rename "$HERDR_PANE_ID" "$DEPUTY_LABEL" >/dev/null 2>&1
		else
			echo "agent name '$DEPUTY_NAME' not claimed by $HERDR_PANE_ID; labels left unchanged" >&2
		fi
		if [ -n "$mode" ] && [ "${GJCH_FROM_HOOK:-}" != 1 ]; then
			echo "팀장 잠금이 다른 세션에 있어 팀원 구성·배치를 하지 않습니다" >&2
			exit 3
		fi
		exit 0
	fi

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
	TEAM_WS="${HERDR_WORKSPACE_ID:-}"
else
	# --- 외부 팀장(Herdr 밖) ---
	if [ "$lead_rc" != 0 ]; then
		if [ -z "$mode" ]; then
			print_role_line
			exit 0
		fi
		print_role_line >&2
		exit "$lead_rc"
	fi
	if [ -z "$mode" ]; then
		print_role_line
		exit 0
	fi
	if [ "$mode" = "--spawn" ] || [ "$mode" = "--layout" ]; then
		mate_info="$(ext_agent_info "$MATE_NAME" agy inside)" || exit 1
		critic_info="$(ext_agent_info "$CRITIC_NAME" codex exact)" || exit 1
		mate_ws=""
		if [ -n "$mate_info" ]; then
			mate_ws="${mate_info%%|*}"
			ext_rest="${mate_info#*|}"
			EXT_MATE_PANE="${ext_rest%%|*}"
			EXT_MATE_STATE="${ext_rest#*|}"
		fi
		critic_ws=""
		if [ -n "$critic_info" ]; then
			critic_ws="${critic_info%%|*}"
			ext_rest="${critic_info#*|}"
			EXT_CRITIC_PANE="${ext_rest%%|*}"
			EXT_CRITIC_STATE="${ext_rest#*|}"
		fi
		if [ -n "$mate_ws" ] && [ -n "$critic_ws" ] && [ "$mate_ws" != "$critic_ws" ]; then
			echo "agents '$MATE_NAME' ($mate_ws) and '$CRITIC_NAME' ($critic_ws) are in different workspaces" >&2
			exit 1
		fi
		TEAM_WS="${mate_ws:-$critic_ws}"
		if [ -z "$TEAM_WS" ]; then
			ws_out="$(herdr workspace list 2>/dev/null)" || { echo "could not list workspaces" >&2; exit 1; }
			ws_match="$(printf '%s' "$ws_out" | python3 -c 'import json,sys
label=sys.argv[1]
try: ws=json.load(sys.stdin)["result"]["workspaces"]
except Exception: sys.exit(2)
hits=[w.get("workspace_id") for w in ws if isinstance(w,dict) and w.get("label")==label and w.get("workspace_id")]
if len(hits)>1: sys.exit(3)
print(hits[0] if hits else "")' "$WS_LABEL")"
			ws_rc=$?
			if [ "$ws_rc" = 3 ]; then
				echo "multiple workspaces found with label '$WS_LABEL'" >&2
				exit 1
			elif [ "$ws_rc" != 0 ]; then
				echo "could not list workspaces" >&2
				exit 1
			fi
			TEAM_WS="$ws_match"
		fi
		if [ -z "$TEAM_WS" ]; then
			if [ "$mode" = "--spawn" ]; then
				ws_create="$(herdr workspace create --cwd "$ROOT" --label "$WS_LABEL" --no-focus 2>/dev/null)" || {
					echo "workspace create failed" >&2
					exit 1
				}
				TEAM_WS="$(printf '%s' "$ws_create" | jget result.workspace.workspace_id)"
				NEW_WS_ROOT_PANE="$(printf '%s' "$ws_create" | jget result.root_pane.pane_id)"
				[ -n "$TEAM_WS" ] || { echo "workspace create did not return workspace_id" >&2; exit 1; }
			else
				echo "--layout: workspace '$WS_LABEL' not found; nothing moved" >&2
				exit 1
			fi
		fi
	fi
fi

# --- 재배치(--layout): 기존 팀장·팀원·검토 pane을 목표 배치로 ---
# 출력: "ok <팀장/아래 비율> <0.01안:1|0> <팀장/아래 delta> [<팀원/검토 비율> <팀원/검토 delta>]"(목표 모양)
#       | "move"(아님, 옮겨도 됨)
#       | "blocked <이유>"(아님, 팀 pane이 한 분할 영역을 빈틈없이 채우지 않아 옮기면 다른 pane이 커지거나 밀림) | 빈 값(layout 읽기 실패)
# 빈틈없는 영역: 팀 pane rect의 경계 상자가 splits 중 하나의 rect와 같고, 그 상자와 겹치는 다른 pane이 없으며,
# 팀 pane 면적 합이 상자 면적과 같다(한 split 노드가 팀 pane만으로 채워짐).
layout_state() { # mate [critic]
	local out
	out="$(herdr pane layout --pane "$HERDR_PANE_ID" 2>/dev/null)" || return 0
	printf '%s' "$out" | python3 -c 'import sys,json
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
if not (down is None or not ok or (C and right is None)):
    def parse_r(v,target):
        s=str(v).strip()
        tok=s.split()[0] if s else "?"
        try:
            f=float(s)
            if f!=f or f in (float("inf"),float("-inf")): raise ValueError
        except Exception:
            return tok,False,"x"
        d=target-f
        return tok,abs(f-target)<=0.01,("0" if abs(d)<0.005 else "%+.4f" % d)
    d_tok,d_ok,d_delta=parse_r(down,0.6)
    if C:
        r_tok,r_ok,r_delta=parse_r(right,0.5)
        in_tol="1" if (d_ok and r_ok) else "0"
        print("ok %s %s %s %s %s" % (d_tok, in_tol, d_delta, r_tok, r_delta))
    else:
        in_tol="1" if d_ok else "0"
        print("ok %s %s %s" % (d_tok, in_tol, d_delta))
    sys.exit(0)
ps=[q for q in (L,M,C) if q]
if len(ps)<(3 if critic else 2): print("blocked the team panes are not all in the layout"); sys.exit(0)
x0=min(q[0] for q in ps); y0=min(q[1] for q in ps); x1=max(q[0]+q[2] for q in ps); y1=max(q[1]+q[3] for q in ps)
box=(x0,y0,x1-x0,y1-y0)
mine={lead,mate,critic}
other=sorted(p for p,q in r.items() if p not in mine and q["x"]<x1 and q["x"]+q["width"]>x0 and q["y"]<y1 and q["y"]+q["height"]>y0)
split=any((s["rect"]["x"],s["rect"]["y"],s["rect"]["width"],s["rect"]["height"])==box for s in l["splits"])
if other: print("blocked pane(s) %s are inside the team area" % " ".join(other))
elif not split or sum(q[2]*q[3] for q in ps)!=box[2]*box[3]: print("blocked the team panes do not fill one split area")
else: print("move")' "$HERDR_PANE_ID" "$1" "${2:-}"
}

# 외부 팀장 배치 판정: 한 탭 안에서 팀원 왼쪽 | 검토 바로 오른쪽(같은 y·높이)이면 "ok <비율> <0.01안:1|0> <delta>", 아니면 "mismatch", 조회 실패면 빈 값.
layout_state_external() { # mate critic
	local out
	out="$(herdr pane layout --pane "$1" 2>/dev/null)" || return 0
	printf '%s' "$out" | python3 -c 'import sys,json
mate,critic=sys.argv[1:3]
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
M,C=rect(mate),rect(critic)
ok=bool(M and C) and C[0]==M[0]+M[2] and C[1]==M[1] and C[3]==M[3]
right=ok and ratio("right",(M[0],M[1],M[2]+C[2],M[3]))
if ok and right is not None:
    s=str(right).strip()
    r_tok=s.split()[0] if s else "?"
    try:
        rf=float(s)
        if rf!=rf or rf in (float("inf"),float("-inf")): raise ValueError
        rd=0.5-rf
        in_tol="1" if abs(rf-0.5)<=0.01 else "0"
        r_delta="0" if abs(rd)<0.005 else "%+.4f" % rd
    except Exception:
        in_tol,r_delta="0","x"
    print("ok %s %s %s" % (r_tok, in_tol, r_delta))
else:
    print("mismatch")' "$1" "$2"
}

# split 비율을 target으로 맞춘다. 늘릴 때는 첫 pane을 경계 쪽으로, 줄일 때는 둘째 pane을 경계 쪽으로 resize한다(amount = 비율 차).
set_ratio() { # delta first_pane grow_dir second_pane shrink_dir
	case "$1" in
		""|0) return 0 ;;
		+*) herdr pane resize --pane "$2" --direction "$3" --amount "${1#+}" >/dev/null 2>&1 ;;
		-*) herdr pane resize --pane "$4" --direction "$5" --amount "${1#-}" >/dev/null 2>&1 ;;
		*) return 1 ;;
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
	set_ratio "${4:-}" "$HERDR_PANE_ID" down "$mate" up || fail=1
	if [ -n "$critic" ]; then
		set_ratio "${6:-}" "$mate" right "$critic" left || fail=1
	fi
	# shellcheck disable=SC2046
	set -- $(layout_state "$mate" "$critic")
	[ "${1:-}" = ok ] || { echo "layout changed while resizing; not in the target layout" >&2; return 1; }
	[ "${3:-}" = 1 ] || fail=1
	[ "$fail" = 0 ] || echo "resize failed or not reached: lead/below $2${5:+, mate/critic $5} (target 0.6${critic:+/0.5})" >&2
	return "$fail"
}

# 외부 팀장 비율 조정: 팀원 | 검토 split 비율을 0.5로 맞추고 0.01 안인지 확인한다.
fit_ratios_external() { # mate critic
	local mate="$1" critic="$2" fail=0
	# shellcheck disable=SC2046
	set -- $(layout_state_external "$mate" "$critic")
	[ "${1:-}" = ok ] || return 2
	set_ratio "${4:-}" "$mate" right "$critic" left || fail=1
	# shellcheck disable=SC2046
	set -- $(layout_state_external "$mate" "$critic")
	[ "${1:-}" = ok ] || { echo "layout changed while resizing; not in the target layout" >&2; return 1; }
	[ "${3:-}" = 1 ] || fail=1
	[ "$fail" = 0 ] || echo "resize failed or not reached: mate/critic $2 (target 0.5)" >&2
	return "$fail"
}

# pane의 "<tab_id> in|out"(cwd가 저장소 안/밖). 조회·파싱 실패나 tab·cwd 없음이면 rc 1.
pane_place() { # pane
	local out
	out="$(herdr pane get "$1" 2>/dev/null)" || return 1
	printf '%s' "$out" | python3 -c 'import sys,json,os
root=sys.argv[1]
try: p=json.load(sys.stdin)["result"]["pane"]
except Exception: sys.exit(1)
cwd=p.get("foreground_cwd") or p.get("cwd")
if not p.get("tab_id") or not cwd: sys.exit(1)
print(p["tab_id"], "in" if (os.path.realpath(cwd).rstrip("/")+"/").startswith(root.rstrip("/")+"/") else "out")' "$ROOT"
}

# 확인된 조건 불일치: 수동 --layout은 오류(1), 팀 구성(team)은 건너뜀(0). 어느 쪽이든 아무것도 옮기지 않는다.
layout_refuse() { # how reason
	if [ "$1" = team ]; then
		echo "team layout skipped: $2; nothing moved" >&2
		return 0
	fi
	echo "--layout: $2; nothing moved" >&2
	return 1
}

# 조회·파싱 실패: 두 모드 모두 옮기기 전에 실패(1). 사용자 의도(다른 탭 등)로 추정하지 않는다.
layout_error() { # how reason
	if [ "$1" = team ]; then
		echo "team layout failed: $2; nothing moved" >&2
	else
		echo "--layout: $2; nothing moved" >&2
	fi
	return 1
}

# 외부 팀장 배치 보정: 한 탭 안에서 팀원 | 검토(반반). 조건이 안 맞으면 옮기지 않는다.
apply_layout_external() { # manual|team
	local how="$1" mate="$EXT_MATE_PANE" critic="$EXT_CRITIC_PANE" mate_place mate_tab critic_place state
	[ -n "$mate" ] || { layout_refuse "$how" "agent '$MATE_NAME' not found"; return; }
	if [ "$how" = manual ]; then
		check_member_argv "$MATE_NAME" "$mate" agy "${EXT_MATE_STATE##*|}" || argv_status=1
		if [ -n "$critic" ] && codex_enabled; then
			check_member_argv "$CRITIC_NAME" "$critic" codex "${EXT_CRITIC_STATE##*|}" || argv_status=1
		fi
	fi
	mate_place="$(pane_place "$mate")" || { layout_error "$how" "could not read pane $mate"; return; }
	mate_tab="${mate_place% *}"
	[ "${mate_place#* }" = in ] || { layout_refuse "$how" "pane $mate cwd is outside $ROOT"; return; }
	if [ -z "$critic" ] || ! codex_enabled; then
		echo "layout: mate $mate only"
		return 0
	fi
	critic_place="$(pane_place "$critic")" || { layout_error "$how" "could not read pane $critic"; return; }
	[ "${critic_place% *}" = "$mate_tab" ] || { layout_refuse "$how" "pane $critic is not in the mate tab $mate_tab"; return; }
	[ "${critic_place#* }" = in ] || { layout_refuse "$how" "pane $critic cwd is outside $ROOT"; return; }
	state="$(layout_state_external "$mate" "$critic")"
	[ -n "$state" ] || { layout_error "$how" "could not read the layout of $mate_tab"; return; }
	case "$state" in
		ok*) ;;
		*) layout_refuse "$how" "mate $mate and critic $critic are not side by side (mate | critic) in $mate_tab"; return ;;
	esac
	fit_ratios_external "$mate" "$critic"
	case $? in
		0) echo "layout: mate $mate | critic $critic (50%) in $mate_tab" ;;
		2) echo "layout: $mate_tab is not in the target layout; check herdr pane layout" >&2; return 1 ;;
		*) echo "layout: panes are in place but the split ratio is not 50%; check herdr pane layout" >&2; return 1 ;;
	esac
}

# 목표 배치를 보장한다. 모양이 맞으면 비율만, 다르면 임시 탭 경유로 옮긴다. 이미 목표면 아무것도 바꾸지 않는다.
# how=manual(--layout): 존재하는 검토는 포함하고, 다른 탭이면 오류.
# how=team(--spawn 마지막): 다른 탭의 검토는 사용자가 뺀 것으로 보고 제외한다. 선택 Codex가 꺼져 있으면(GJCH_TEAM_CODEX=0, codex 없음)
#   검토를 제외하되, 그 검토가 같은 탭에 남아 있으면 2-pane 판정이 팀원을 흔들 수 있어 건너뛴다.
# 반환: 0 목표 배치 확인 또는 team 건너뜀, 1 조회 실패·조건 불일치(manual)·이동·resize 실패
apply_layout() { # manual|team
	if [ "$lead_mode" = external ]; then
		apply_layout_external "$1"
		return $?
	fi
	local how="$1" lead="$HERDR_PANE_ID" owner lead_tab mate_ps mate mate_st critic_ps critic critic_st critic_place="" place p state
	owner="$(agent_pane "$LEAD_NAME")" || { layout_error "$how" "could not look up agent '$LEAD_NAME'"; return; }
	[ "$owner" = "$lead" ] || { layout_refuse "$how" "agent '$LEAD_NAME' is not this pane ($lead)"; return; }
	mate_ps="$(agent_pane_status "$MATE_NAME")" || { layout_error "$how" "could not look up agent '$MATE_NAME'"; return; }
	mate="${mate_ps%%|*}"
	mate_st="${mate_ps#*|}"
	[ -n "$mate" ] || { layout_refuse "$how" "agent '$MATE_NAME' not found"; return; }
	# 검토는 있으면 함께 배치하고, 없으면 팀장 60% / 팀원 아래만 맞춘다.
	critic_ps="$(agent_pane_status "$CRITIC_NAME")" || { layout_error "$how" "could not look up agent '$CRITIC_NAME'"; return; }
	critic="${critic_ps%%|*}"
	critic_st="${critic_ps#*|}"
	if [ "$how" = manual ]; then
		check_member_argv "$MATE_NAME" "$mate" agy "$mate_st" || argv_status=1
		if [ -n "$critic" ] && codex_enabled; then
			check_member_argv "$CRITIC_NAME" "$critic" codex "$critic_st" || argv_status=1
		fi
	fi
	lead_tab="$(pane_place "$lead")" || { layout_error "$how" "could not read pane $lead"; return; }
	lead_tab="${lead_tab% *}"
	if [ "$how" = team ] && [ -n "$critic" ]; then
		critic_place="$(pane_place "$critic")" || { layout_error "$how" "could not read pane $critic"; return; }
		if ! codex_enabled; then
			if [ "${critic_place% *}" = "$lead_tab" ]; then
				layout_refuse "$how" "the Codex reviewer is off but $CRITIC_NAME ($critic) is still in $lead_tab"; return
			fi
			echo "team layout: the Codex reviewer is off; laying out the lead and mate only" >&2
			critic=""
		elif [ "${critic_place% *}" != "$lead_tab" ]; then
			echo "team layout: $CRITIC_NAME ($critic) is not in $lead_tab; laying out the lead and mate only" >&2
			critic=""
		fi
	fi
	for p in "$mate" ${critic:+"$critic"}; do
		if [ "$p" = "$critic" ] && [ -n "$critic_place" ]; then
			place="$critic_place"
		else
			place="$(pane_place "$p")" || { layout_error "$how" "could not read pane $p"; return; }
		fi
		[ "${place% *}" = "$lead_tab" ] || { layout_refuse "$how" "pane $p is not in the lead tab $lead_tab"; return; }
		[ "${place#* }" = in ] || { layout_refuse "$how" "pane $p cwd is outside $ROOT"; return; }
	done
	state="$(layout_state "$mate" "$critic")"
	[ -n "$state" ] || { layout_error "$how" "could not read the layout of $lead_tab"; return; }
	# 사이에 끼어든 pane이 있으면 옮기지 않는다(옮기면 그 pane이 커지거나 밀림). 같은 탭 안의 끼어듦은 team에서도 실패다.
	case "$state" in blocked*) layout_error "$how" "${state#blocked }"; return ;; esac
	if [ "$state" = move ]; then
		move_via_temp_tab "$mate" "$lead_tab" "$lead" down 0.6 || return 1
		if [ -n "$critic" ]; then
			move_via_temp_tab "$critic" "$lead_tab" "$mate" right 0.5 || return 1
		fi
	fi
	fit_ratios "$mate" "$critic"
	case $? in
		0) echo "layout: lead $lead on top (60%), mate $mate${critic:+ | critic $critic} below" ;;
		2) echo "layout: $lead_tab is not in the target layout; check herdr pane layout" >&2; return 1 ;;
		*) echo "layout: panes are in place but the split ratios are not 60%/50%; check herdr pane layout" >&2; return 1 ;;
	esac
}

if [ "$mode" = "--layout" ]; then
	layout_rc=0
	apply_layout manual || layout_rc=$?
	[ "$layout_rc" = 0 ] || exit "$layout_rc"
	exit "$argv_status"
fi
[ "$mode" = "--spawn" ] || exit 0

# --- 팀원 agy pane (이미 있으면 생성하지 않음) ---
mate_pane=""
layout_status=0   # 배치 실패(기동 실패와 별도). 이동 단계의 비0은 마지막 배치 보정이 성공해도 그대로 둔다.
spawn_mate() {
local existing mate_out mate_rc mate_state pane lead_tab critic critic_tab now_critic_tab start_out start_info err_code err_detail pane_out pane_status
if [ "$lead_mode" = external ]; then
	if [ -n "$EXT_MATE_PANE" ] && [ -z "$EXT_MATE_STATE" ]; then
		echo "could not look up agent '$MATE_NAME'; mate not spawned" >&2
		return 1
	fi
	mate_state="$EXT_MATE_STATE"
else
	mate_out="$(herdr agent get "$MATE_NAME" 2>&1)"; mate_rc=$?
	mate_state="$(printf '%s' "$mate_out" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
a=(d.get("result") or {}).get("agent") or {}
p=a.get("pane_id") if isinstance(a,dict) else None
if sys.argv[1]=="0":
    if not p: sys.exit(1)
    s=a.get("agent_status") or ""
    r=a.get("interactive_ready")
    if s=="blocked": print("blocked|"+p+"|blocked")
    elif s=="working" or (s in ("idle","done") and r is True): print("ready|"+p+"|"+s)
    elif s: print("not_ready|"+p+"|"+s)
    else: sys.exit(1)
elif ((d.get("error") or {}).get("code"))!="agent_not_found":
    sys.exit(1)' "$mate_rc")" || {
		echo "could not look up agent '$MATE_NAME'; mate not spawned" >&2
		return 1
	}
fi
if [ -n "$mate_state" ]; then
	existing="${mate_state#*|}"
	existing="${existing%%|*}"
	mate_pane="$existing"
	case "${mate_state%%|*}" in
		ready)
			echo "mate already exists at $existing; nothing spawned"
			check_member_argv "$MATE_NAME" "$existing" agy "${mate_state##*|}" || argv_status=1
			return 0 ;;
		blocked)
			echo "agy가 시작 중 멈췄습니다($existing, status=blocked). 폴더 신뢰 창이나 다른 질문일 수 있으니 그 pane에서 사용자가 확인한 뒤 scripts/team-up.sh --spawn을 다시 실행하세요." >&2
			check_member_argv "$MATE_NAME" "$existing" agy "${mate_state##*|}" || argv_status=1
			return 1 ;;
		*)
			echo "existing mate '$MATE_NAME' at $existing is not ready (status=${mate_state##*|}); check the pane and re-run scripts/team-up.sh --spawn" >&2
			check_member_argv "$MATE_NAME" "$existing" agy "${mate_state##*|}" || argv_status=1
			return 1 ;;
	esac
fi
# 새로 실행할 때만 모델 값을 검사한다(영문자·숫자·점·밑줄·하이픈만 허용).
case "$MATE_MODEL" in
	""|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-]*)
		echo 'GJCH_MATE_MODEL은 영문자·숫자·점·밑줄·하이픈만 사용할 수 있습니다.' >&2
		return 1 ;;
esac
if ! command -v agy >/dev/null; then
	echo "agy not found; mate not spawned" >&2
	return 1
fi
# 재시작 후 남은 팀원 pane(label 일치·이 프로젝트 cwd·agent 없음 = 빈 셸)이 있으면 재사용한다.
pane="$(herdr pane list 2>/dev/null | python3 -c 'import sys,json,os
root,ws,label=sys.argv[1:4]
try: panes=json.load(sys.stdin)["result"]["panes"]
except Exception: sys.exit(0)
for p in panes:
    cwd=p.get("foreground_cwd") or p.get("cwd")
    if p.get("workspace_id")==ws and p.get("label")==label and not p.get("agent") and cwd and (os.path.realpath(cwd).rstrip("/")+"/").startswith(root.rstrip("/")+"/"):
        print(p["pane_id"]); break' "$ROOT" "$TEAM_WS" "$MATE_LABEL")"
# 새로 만들 때만 위치를 정한다.
if [ -z "$pane" ]; then
	if [ "$lead_mode" = external ]; then
		if [ -n "$NEW_WS_ROOT_PANE" ]; then
			pane="$NEW_WS_ROOT_PANE"
			NEW_WS_ROOT_PANE=""
		else
			critic="$EXT_CRITIC_PANE"
			critic_tab=""
			if [ -n "$critic" ]; then
				critic_tab="$(herdr pane get "$critic" 2>/dev/null | jget result.pane.tab_id)"
			fi
			if [ -n "$critic" ] && [ -n "$critic_tab" ]; then
				pane="$(herdr pane split --pane "$critic" --direction right --ratio 0.5 --cwd "$ROOT" --no-focus 2>/dev/null | jget result.pane.pane_id)"
				[ -n "$pane" ] || { echo "pane split failed" >&2; return 1; }
				if move_via_temp_tab "$critic" "$critic_tab" "$pane" right 0.5; then
					fit_ratios_external "$pane" "$critic" || :
				else
					layout_status=1
					now_critic_tab="$(pane_place "$critic")" || now_critic_tab=""
					now_critic_tab="${now_critic_tab% *}"
					if [ "$now_critic_tab" != "$critic_tab" ]; then
						echo "$CRITIC_NAME ($critic) is not back in $critic_tab (now in ${now_critic_tab:-an unknown tab}); move it back manually, then run scripts/team-up.sh --layout" >&2
					fi
				fi
			else
				pane="$(herdr tab create --workspace "$TEAM_WS" --cwd "$ROOT" --no-focus 2>/dev/null | jget result.root_pane.pane_id)"
				[ -n "$pane" ] || { echo "tab create failed" >&2; return 1; }
			fi
		fi
	else
		lead_tab="$(herdr pane get "$HERDR_PANE_ID" 2>/dev/null | jget result.pane.tab_id)"
		critic="$(herdr agent get "$CRITIC_NAME" 2>/dev/null | jget result.agent.pane_id)"
		if [ -n "$critic" ] && [ -n "$lead_tab" ] && [ "$(herdr pane get "$critic" 2>/dev/null | jget result.pane.tab_id)" = "$lead_tab" ]; then
			# 검토가 같은 탭에 있으면 검토를 반으로 나눠 만들고, 검토를 새 pane 오른쪽으로 옮긴다(팀원 왼쪽).
			pane="$(herdr pane split --pane "$critic" --direction right --ratio 0.5 --cwd "$ROOT" --no-focus 2>/dev/null | jget result.pane.pane_id)"
			[ -n "$pane" ] || { echo "pane split failed" >&2; return 1; }
			# 배치 실패는 팀원 시작을 막지 않는다. 모양·비율은 시작 전에 맞춰 두고, 결과는 마지막 배치 보정이 다시 확인한다.
			# 이동이 0이 아니면 사유와 상관없이 배치 실패로 남긴다(마지막 보정이 모양을 고쳐도 최종 비0).
			if move_via_temp_tab "$critic" "$lead_tab" "$pane" right 0.5; then
				fit_ratios "$pane" "$critic" || :
			else
				layout_status=1
				critic_tab="$(pane_place "$critic")" || critic_tab=""
				critic_tab="${critic_tab% *}"
				if [ "$critic_tab" != "$lead_tab" ]; then
					# 마지막 배치 보정은 다른 탭의 검토를 옮기지 않는다.
					echo "$CRITIC_NAME ($critic) is not back in $lead_tab (now in ${critic_tab:-an unknown tab}); move it back manually, then run scripts/team-up.sh --layout" >&2
				fi
			fi
		else
			pane="$(herdr pane split --pane "$HERDR_PANE_ID" --direction down --ratio 0.6 --cwd "$ROOT" --no-focus 2>/dev/null | jget result.pane.pane_id)"
			[ -n "$pane" ] || { echo "pane split failed" >&2; return 1; }
		fi
	fi
fi
mate_pane="$pane"
herdr pane rename "$pane" "$MATE_LABEL" >/dev/null 2>&1
if ! start_out="$(herdr agent start "$MATE_NAME" --kind agy --pane "$pane" --timeout 60000 -- "${MATE_START_ARGS[@]}" 2>&1)"; then
	start_info="$(printf '%s' "$start_out" | python3 -c 'import sys,json
raw=sys.stdin.read().strip()
try: d=json.loads(raw)
except Exception:
    print("-|"+raw.replace("\n"," "))
    sys.exit(0)
err=(d.get("error") if isinstance(d,dict) else None) or {}
if not isinstance(err,dict): err={}
code=err.get("code") if isinstance(err.get("code"),str) else ""
msg=err.get("message") if isinstance(err.get("message"),str) else ""
detail=code+": "+msg if code and msg else code or msg or raw
print((code or "-")+"|"+detail.replace("\n"," "))')"
	err_code="${start_info%%|*}"
	err_detail="${start_info#*|}"
	pane_status=""
	if [ "$err_code" = agent_not_ready ]; then
		if pane_out="$(herdr pane get "$pane" 2>/dev/null)"; then
			pane_status="$(printf '%s' "$pane_out" | jget result.pane.agent_status)" || pane_status=""
		fi
		if [ "$pane_status" = blocked ]; then
			echo "agy가 시작 중 멈췄습니다($pane, status=blocked${err_detail:+, $err_detail}). 폴더 신뢰 창이나 다른 질문일 수 있으니 그 pane에서 사용자가 확인한 뒤 scripts/team-up.sh --spawn을 다시 실행하세요." >&2
			return 1
		fi
	fi
	echo "agy start failed for $pane${pane_status:+ (status=$pane_status)}${err_detail:+: $err_detail}" >&2
	return 1
fi
EXT_MATE_PANE="$pane"
echo "spawned $MATE_NAME at $pane (cwd $ROOT)"
return 0
}

# --- 독립 검토 Codex (팀원 단계 성공 여부와 무관하게 수행) ---
spawn_critic() {
	local existing critic_ps critic_st workdir pane anchor direction ratio lead_tab
	if [ "${GJCH_TEAM_CODEX:-1}" = 0 ]; then
		echo "Codex reviewer disabled (GJCH_TEAM_CODEX=0)"
		return 0
	fi
	if ! command -v codex >/dev/null; then
		echo "codex not found; optional reviewer skipped (GJCH_TEAM_CODEX=0 disables it)" >&2
		return 0
	fi
	if [ "$lead_mode" = external ]; then
		existing="$EXT_CRITIC_PANE"
		critic_st="${EXT_CRITIC_STATE##*|}"
	else
		critic_ps="$(agent_pane_status "$CRITIC_NAME")" || {
			echo "could not look up agent '$CRITIC_NAME'; critic not spawned" >&2
			return 1
		}
		existing="${critic_ps%%|*}"
		critic_st="${critic_ps#*|}"
	fi
	if [ -n "$existing" ]; then
		echo "critic already exists at $existing; nothing spawned"
		check_member_argv "$CRITIC_NAME" "$existing" codex "$critic_st" || argv_status=1
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
        print(p["pane_id"]); break' "$workdir" "$TEAM_WS" "$CRITIC_LABEL")"
	if [ -z "$pane" ]; then
		if [ "$lead_mode" = external ]; then
			if [ -n "$mate_pane" ]; then
				pane="$(herdr pane split --pane "$mate_pane" --direction right --ratio 0.5 --cwd "$workdir" --no-focus | jget result.pane.pane_id)"
				[ -n "$pane" ] || { echo "Codex pane split failed" >&2; return 1; }
				fit_ratios_external "$mate_pane" "$pane" || :
			else
				pane="$(herdr tab create --workspace "$TEAM_WS" --cwd "$workdir" --no-focus 2>/dev/null | jget result.root_pane.pane_id)"
				[ -n "$pane" ] || { echo "Codex tab create failed" >&2; return 1; }
			fi
		else
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
			# 팀원 옆에 만들었으면 Codex 시작 전에 팀장 60%·반반을 맞춘다(결과는 마지막 배치 보정이 다시 확인한다).
			if [ "$direction" = right ]; then
				fit_ratios "$mate_pane" "$pane" || :
			fi
		fi
	fi
	herdr pane rename "$pane" "$CRITIC_LABEL" >/dev/null || return 1
	if ! herdr agent start "$CRITIC_NAME" --kind codex --pane "$pane" --timeout 60000 -- "${CRITIC_START_ARGS[@]}"; then
		echo "Codex start failed for $pane" >&2
		return 1
	fi
	EXT_CRITIC_PANE="$pane"
	echo "spawned $CRITIC_NAME at $pane (cwd $ROOT)"
}

mate_status=0
spawn_mate || mate_status=$?
critic_status=0
spawn_critic || critic_status=$?
# --- 마지막 배치 보정: 기존·재사용 pane까지 목표 배치로(조건이 안 맞으면 건너뜀) ---
# Codex 단계가 실패하면 agent 없는 검토 pane이 남을 수 있어 그 pane을 밀어내지 않도록 보정하지 않는다.
if [ "$critic_status" = 0 ]; then
	apply_layout team || layout_status=1
else
	echo "team layout skipped: the Codex step failed; nothing moved" >&2
	layout_status=1
fi
if [ "$layout_status" != 0 ]; then
	if [ "$lead_mode" = external ]; then
		echo "team layout is not in place; run GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --layout" >&2
	else
		echo "team layout is not in place; run scripts/team-up.sh --layout from the lead pane" >&2
	fi
fi
# 기동 실패 rc를 배치·옵션 점검 rc보다 우선한다.
[ "$critic_status" = 0 ] || exit "$critic_status"
[ "$mate_status" = 0 ] || exit "$mate_status"
[ "$layout_status" = 0 ] || exit "$layout_status"
exit "$argv_status"
