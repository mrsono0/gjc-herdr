# gjc-herdr Core(hc) 공통 보조 함수 모음(source 전용, bash 3.2 + python3).
# 함수는 core_hc, core_json, core_find, core_get, core_guard, core_lock_class, core_redact 7개만 둔다.
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
# shellcheck source=scripts/worktree-guard.sh
. "$ROOT/scripts/worktree-guard.sh"
# shellcheck source=scripts/team-args.sh
. "$ROOT/scripts/team-args.sh"

CORE_TEAM="${GJCH_CORE_TEAM:-gjch}"
CORE_GUARD_PASSED=0

core_hc() {
	local bin="${GJCH_HC_BIN:-hc}"
	"$bin" "$@"
}

core_redact() {
	if [ $# -gt 0 ]; then
		local _in="$*"
		case "$_in" in
			*$'\r'*|*$'\n'*|*sk-*|*ghp_*|*AKIA*|*[Bb][Ee][Aa][Rr][Ee][Rr]*|*[Tt][Oo][Kk][Ee][Nn]=*|*[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]=*|*[Aa][Pp][Ii]_[Kk][Ee][Yy]=*|*[Ss][Ee][Cc][Rr][Ee][Tt]=*|*????????-????-????-????-????????????*|*[Ss][Ee][Ss][Ss][Ii][Oo][Nn]*|*[Ss][Ii][Dd][_-]*)
				;;
			*)
				if [ -z "${CLAUDE_CODE_SESSION_ID:-}" ] || [ "${_in#*"$CLAUDE_CODE_SESSION_ID"}" = "$_in" ]; then
					if [ -z "${CLAUDE_CODE_MESSAGING_SOCKET:-}" ] || [ "${_in#*"$CLAUDE_CODE_MESSAGING_SOCKET"}" = "$_in" ]; then
						printf '%s\n' "$_in"
						return 0
					fi
				fi
				;;
		esac
		python3 -B -c 'import os,re,sys
s = sys.argv[1]
s = re.sub(r"[\r\n]+", " ", s)
for env_k in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET"):
    v = os.environ.get(env_k) or ""
    if len(v) >= 4:
        s = s.replace(v, "[REDACTED]")
s = re.sub(r"sk-[A-Za-z0-9_-]{6,}", "sk-[REDACTED]", s)
s = re.sub(r"ghp_[A-Za-z0-9]{6,}", "ghp_[REDACTED]", s)
s = re.sub(r"AKIA[0-9A-Z]{8,}", "AKIA[REDACTED]", s)
s = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1[REDACTED]", s)
s = re.sub(r"(?i)\b(token|password|api_key|secret|session_id)=([^\s\"'\''&;,)}\]]+)", r"\1=[REDACTED]", s)
s = re.sub(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", "[REDACTED]", s)
s = re.sub(r"(?i)\b(?:[A-Za-z0-9_]+[_-])?(?:session[_-]?(?:id|uuid)|sid)[_-][A-Za-z0-9_-]{4,}\b", "[REDACTED]", s)
print(s)' "$*"
	else
		python3 -B -c 'import os,re,sys
s = sys.stdin.read()
for env_k in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET"):
    v = os.environ.get(env_k) or ""
    if len(v) >= 4:
        s = s.replace(v, "[REDACTED]")
s = re.sub(r"sk-[A-Za-z0-9_-]{6,}", "sk-[REDACTED]", s)
s = re.sub(r"ghp_[A-Za-z0-9]{6,}", "ghp_[REDACTED]", s)
s = re.sub(r"AKIA[0-9A-Z]{8,}", "AKIA[REDACTED]", s)
s = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1[REDACTED]", s)
s = re.sub(r"(?i)\b(token|password|api_key|secret|session_id)=([^\s\"'\''&;,)}\]]+)", r"\1=[REDACTED]", s)
s = re.sub(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", "[REDACTED]", s)
s = re.sub(r"(?i)\b(?:[A-Za-z0-9_]+[_-])?(?:session[_-]?(?:id|uuid)|sid)[_-][A-Za-z0-9_-]{4,}\b", "[REDACTED]", s)
sys.stdout.write(s)'
	fi
}

core_json() {
	python3 -B -c 'import json,sys
if len(sys.argv) < 3:
    sys.exit(1)
raw, path = sys.argv[1], sys.argv[2]
if not path:
    sys.exit(1)
try:
    cur = json.loads(raw)
except Exception:
    sys.exit(1)
for k in path.split("."):
    if isinstance(cur, dict) and k in cur:
        cur = cur[k]
    else:
        sys.exit(1)
if cur is None:
    sys.exit(1)
if isinstance(cur, bool):
    print("true" if cur else "false")
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur, ensure_ascii=False, separators=(",", ":")))
else:
    print(str(cur))' "${1:-}" "${2:-}" 2>/dev/null
}

core_find() {
	local role="${1:-}" all_flag="${2:-}" team="${GJCH_CORE_TEAM:-gjch}" out rc=0
	[ -n "$role" ] || return 3
	if [ "$all_flag" = "--all" ]; then
		out="$(core_hc ls --all --json --label "team=$team" --label "role=$role" 2>/dev/null)" || rc=$?
	elif [ -z "$all_flag" ]; then
		out="$(core_hc ls --json --label "team=$team" --label "role=$role" 2>/dev/null)" || rc=$?
	else
		return 3
	fi
	[ "$rc" -eq 0 ] || return 3
	python3 -B -c 'import json,sys
raw, team, role = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    doc = json.loads(raw)
except Exception:
    sys.exit(3)
if not isinstance(doc, dict) or "terminals" not in doc:
    sys.exit(3)
terms = doc.get("terminals")
if not isinstance(terms, list):
    sys.exit(3)
addrs = []
for t in terms:
    if not isinstance(t, dict):
        sys.exit(3)
    addr = t.get("address")
    if not isinstance(addr, str) or not addr:
        sys.exit(3)
    if "/" in addr:
        continue
    labels = t.get("labels")
    if labels is not None:
        if not isinstance(labels, dict):
            sys.exit(3)
        if labels.get("team") != team or labels.get("role") != role:
            continue
    addrs.append(addr)
if len(addrs) == 0:
    sys.exit(1)
if len(addrs) == 1:
    print(addrs[0])
    sys.exit(0)
sys.exit(2)' "$out" "$team" "$role" 2>/dev/null
}

core_get() {
	local addr="${1:-}" out rc=0 json_line=""
	[ -n "$addr" ] || return 1
	out="$(core_hc get --json "$addr" 2>/dev/null)" || rc=$?
	[ "$rc" -eq 0 ] || return 1
	json_line="$(python3 -B -c 'import json,sys
raw = sys.argv[1]
try:
    d = json.loads(raw)
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    sys.exit(1)
raw_state = d.get("state")
if not isinstance(raw_state, str) or not raw_state:
    sys.exit(1)
state = raw_state if raw_state in ("live", "finished") else "other"
st = d.get("status")
st_state = None
st_kind = None
msglen = 0
if st is None:
    pass
elif isinstance(st, dict):
    raw_st_state = st.get("state")
    if isinstance(raw_st_state, str) and raw_st_state in ("idle", "working", "done", "blocked", "error"):
        st_state = raw_st_state
    else:
        st_state = "other"
    raw_st_kind = st.get("kind")
    if raw_st_kind is None:
        st_kind = None
    elif isinstance(raw_st_kind, str) and raw_st_kind in ("permission", "question", "auth"):
        st_kind = raw_st_kind
    else:
        st_kind = "other"
    msg = st.get("msg")
    if isinstance(msg, str):
        msglen = len(msg)
else:
    st_state = "other"
    st_kind = "other"
fg = d.get("foreground")
fg_name = None
if isinstance(fg, dict) and isinstance(fg.get("name"), str) and fg.get("name"):
    fg_name = fg.get("name")
raw_argv = d.get("argv")
if isinstance(raw_argv, list) and len(raw_argv) > 0 and all(isinstance(x, str) for x in raw_argv):
    argv_out = list(raw_argv)
else:
    argv_out = None
raw_labels = d.get("labels")
labels_out = {}
if isinstance(raw_labels, dict):
    for k, v in raw_labels.items():
        if isinstance(k, str) and isinstance(v, str):
            labels_out[k] = v
cwd_val = d.get("cwd") if isinstance(d.get("cwd"), str) and d.get("cwd") else None
raw_reported = d.get("reported")
if isinstance(raw_reported, bool):
    reported_val = raw_reported
else:
    reported_val = "unknown"
raw_turn = d.get("turn")
turn_val = raw_turn if isinstance(raw_turn, int) and not isinstance(raw_turn, bool) and raw_turn >= 0 else None
res = {
    "state": state,
    "status": {
        "state": st_state,
        "kind": st_kind,
    },
    "msglen": msglen,
    "reported": reported_val,
    "turn": turn_val,
    "argv": argv_out,
    "foreground": {
        "name": fg_name,
    },
    "cwd": cwd_val,
    "labels": labels_out,
}
print(json.dumps(res, ensure_ascii=False, separators=(",", ":")))' "$out" 2>/dev/null)" || return 1
	core_redact "$json_line"
}

core_lock_class() {
	local raw rc=0 first
	raw="$(/bin/bash "$ROOT/scripts/team-lead.sh" status 2>/dev/null)" || rc=$?
	if [ "$rc" -ne 0 ]; then
		printf 'unknown\n'
		return 1
	fi
	first="${raw%% *}"
	case "$first" in
		mine)
			printf 'mine\n'
			return 0
			;;
		other)
			printf 'other-live\n'
			return 0
			;;
		stale)
			printf 'stale\n'
			return 0
			;;
		none)
			printf 'none\n'
			return 0
			;;
		*)
			printf 'unknown\n'
			return 1
			;;
	esac
}

core_guard() {
	local gmode="${1:-}" here wt_reason lock_cls
	CORE_GUARD_PASSED=0
	if [ "${GJCH_CORE:-}" != 1 ]; then
		printf 'core 스크립트는 GJCH_CORE=1에서만 실행합니다.\n' >&2
		return 2
	fi
	if [ -n "${GJCH_TEAM_ROLE:-}" ]; then
		if [ "$gmode" = "--check" ] || [ "$gmode" = "--status" ]; then
			printf '팀원 역할에서는 %s를 실행할 수 없습니다.\n' "$gmode" >&2
			return 2
		fi
		return 0
	fi
	if [ "${GJCH_EXTERNAL_LEAD:-}" != 1 ]; then
		if [ "$gmode" = "--check" ] || [ "$gmode" = "--status" ]; then
			printf 'Core 외부 팀장(GJCH_CORE=1, GJCH_EXTERNAL_LEAD=1)에서 실행하세요.\n' >&2
			return 2
		fi
		return 0
	fi
	if ! here="$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null && pwd -P)"; then
		if [ "$gmode" = "--check" ] || [ "$gmode" = "--status" ]; then
			printf '작업 경로 확인 실패\n' >&2
			return 2
		fi
		case "$gmode" in
			--up|--spawn|--down|send|critic-send)
				printf '작업 경로 확인 실패\n' >&2
				return 1
				;;
		esac
		return 0
	fi
	case "$here/" in
		"$ROOT"/*) ;;
		*)
			if [ "$gmode" = "--check" ] || [ "$gmode" = "--status" ]; then
				printf '현재 경로가 저장소 밖\n' >&2
				return 2
			fi
			case "$gmode" in
				--up|--spawn|--down|send|critic-send)
					printf '현재 경로가 저장소 밖\n' >&2
					return 1
					;;
			esac
			return 0
			;;
	esac
	if wt_reason="$(gjch_worktree_reason "$ROOT")"; then
		if [ "$gmode" = "--hook" ]; then
			printf 'GJCH: 이 세션은 연결 worktree에서 실행 중이라 팀장으로 동작하지 않습니다. 데스크톱 세션의 worktree 옵션을 끄고 저장소 폴더에서 새 세션을 엽니다.\n'
			return 0
		fi
		printf '연결 worktree에서 실행 중\n' >&2
		if [ "$gmode" = "--check" ] || [ "$gmode" = "--status" ]; then
			return 2
		fi
		return 1
	fi
	case "$gmode" in
		--up|--spawn|--down|send|critic-send)
			lock_cls="$(core_lock_class)" || lock_cls="unknown"
			if [ "$lock_cls" != "mine" ]; then
				printf '팀장 잠금이 mine이 아닙니다(lock=%s). 변경 작업을 수행하지 않습니다.\n' "$lock_cls" >&2
				return 1
			fi
			;;
	esac
	CORE_GUARD_PASSED=1
	return 0
}
