#!/usr/bin/env bash
# gjc-herdr Core(hc) 팀 구성·점검·정리 스크립트(GJCH_CORE=1 전용).
# 화면 읽기(hc read/attach)나 확인창 응답(hc keys/--force)은 수행하지 않는다.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=scripts/core-lib.sh
. "$ROOT/scripts/core-lib.sh"

mode="${1:-}"

print_expected_units() { # agy|codex
	case "${1:-}" in
		agy) format_expected_units "${MATE_START_ARGS[@]}" ;;
		codex) format_expected_units "${CRITIC_START_ARGS[@]}" ;;
		*) return 1 ;;
	esac
}

if [ "$mode" = "--print-expected-units" ]; then
	if [ "${GJCH_CORE:-}" != 1 ]; then
		printf 'core 스크립트는 GJCH_CORE=1에서만 실행합니다.\n' >&2
		exit 2
	fi
	print_expected_units "${2:-}"
	exit $?
fi

if [ "$mode" = "--layout" ] || [ "$mode" = "--report-resume" ]; then
	if [ "${GJCH_CORE:-}" != 1 ]; then
		printf 'core 스크립트는 GJCH_CORE=1에서만 실행합니다.\n' >&2
		exit 2
	fi
	printf 'Core 미지원: %s\n' "$mode" >&2
	exit 2
fi

if [ "$mode" = "--lock" ]; then
	if [ "${GJCH_CORE:-}" != 1 ]; then
		printf 'core 스크립트는 GJCH_CORE=1에서만 실행합니다.\n' >&2
		exit 2
	fi
	shift
	for lock_arg in "$@"; do
		if [ "$lock_arg" = "--force" ]; then
			printf '강제 해제는 지원하지 않습니다: scripts/team-lead.sh release --force(사용자 승인)\n' >&2
			exit 2
		fi
	done
	if [ "$#" -ne 1 ]; then
		printf '사용법: %s --lock <status|claim|release>\n' "$0" >&2
		exit 2
	fi
	case "$1" in
		status)
			core_lock_class
			exit $?
			;;
		claim)
			/bin/bash "$ROOT/scripts/team-lead.sh" claim >/dev/null 2>&1
			lock_rc=$?
			case "$lock_rc" in
				0)
					printf 'mine\n'
					exit 0
					;;
				3)
					printf 'other-live\n' >&2
					exit 3
					;;
				4)
					printf 'unknown\n' >&2
					exit 4
					;;
				*)
					printf 'unknown\n' >&2
					exit 1
					;;
			esac
			;;
		release)
			/bin/bash "$ROOT/scripts/team-lead.sh" release >/dev/null 2>&1
			lock_rc=$?
			case "$lock_rc" in
				0)
					printf 'none\n'
					exit 0
					;;
				3)
					printf 'other-live\n' >&2
					exit 3
					;;
				*)
					printf 'unknown\n' >&2
					exit 1
					;;
			esac
			;;
		*)
			printf '사용법: %s --lock <status|claim|release>\n' "$0" >&2
			exit 2
			;;
	esac
fi

codex_enabled() { [ "${GJCH_TEAM_CODEX:-1}" != 0 ] && command -v codex >/dev/null 2>&1; }

print_core_role_line() {
	local rc="$1"
	case "$rc" in
		0)
			core_redact "GJCH: 이 세션이 Core 외부 팀장입니다(herdr-core, 팀장 잠금 보유, team=$CORE_TEAM)."
			;;
		3)
			core_redact "GJCH: 팀장 잠금이 다른 세션(other-live)에 있어 이 세션은 부팀장($DEPUTY_NAME)입니다. 팀원에게 배정·입력하지 말고 팀장을 지원만 합니다."
			;;
		4)
			core_redact "GJCH: 세션 정체(CLAUDE_CODE_SESSION_ID·소켓)를 알 수 없어 이 세션은 Core 외부 팀장이 아닙니다."
			;;
	esac
}

# 역할 하나를 점검해 "<state>\t<check_line>\t<status_line>\t<unknown_reason>"을 출력한다.
inspect_role() { # role kind [optional_only_if_present]
	local role="$1" kind="$2" optional="${3:-0}" tname="${CORE_TEAM}-${1}" addr find_rc=0 info get_rc=0 expected_raw="" safe_addr=""
	addr="$(core_find "$role")" || find_rc=$?
	if [ "$find_rc" -eq 1 ]; then
		if [ "$optional" = 1 ]; then
			printf 'absent\t\t\t\n'
			return 0
		fi
		printf 'mismatch\t%s - mismatch 실제=없음 기대=실행 중\t- 팀원: %s - %s 옵션 일치 ×(실제=없음) resume 해당 없음 확인창 없음 상태 없음\t\n' \
			"$tname" "$tname" "$kind"
		return 0
	fi
	if [ "$find_rc" -eq 2 ]; then
		printf 'unknown\t%s - unknown 라벨 중복(2개 이상)\t- 팀원: %s - %s 옵션 일치 ?(라벨 중복) resume 해당 없음 확인창 모름 상태 없음\t%s 라벨 중복\n' \
			"$tname" "$tname" "$kind" "$tname"
		return 0
	fi
	if [ "$find_rc" -ne 0 ] || [ -z "$addr" ]; then
		printf 'unknown\t%s - unknown ls 조회 실패\t- 팀원: %s - %s 옵션 일치 ?(ls 조회 실패) resume 해당 없음 확인창 모름 상태 없음\t%s ls 조회 실패\n' \
			"$tname" "$tname" "$kind" "$tname"
		return 0
	fi
	safe_addr="${addr//$'\r'/ }"
	safe_addr="${safe_addr//$'\n'/ }"
	safe_addr="${safe_addr//$'\t'/ }"
	info="$(core_get "$addr")" || get_rc=$?
	if [ "$get_rc" -ne 0 ] || [ -z "$info" ]; then
		printf 'unknown\t%s %s unknown get 조회 실패\t- 팀원: %s %s %s 옵션 일치 ?(get 조회 실패) resume 해당 없음 확인창 모름 상태 없음\t%s get 조회 실패\n' \
			"$tname" "$safe_addr" "$tname" "$safe_addr" "$kind" "$tname"
		return 0
	fi
	if [ "$kind" = "agy" ] || [ "$kind" = "codex" ]; then
		expected_raw="$(print_expected_units "$kind")"
	fi
	python3 -B -c 'import importlib.util,json,os,re,sys
root, tname, addr, kind, info_raw, exp_raw = sys.argv[1:7]
tname = re.sub(r"[\r\n\t]+", " ", tname)
addr = re.sub(r"[\r\n\t]+", " ", addr)
real_root = os.path.realpath(root)
checker_path = os.environ.get("GJCH_ARGV_CHECKER") or os.path.join(root, "scripts", "agent-argv-check.py")
spec = importlib.util.spec_from_file_location("agent_argv_check", checker_path)
if spec is None or spec.loader is None:
    sys.exit(1)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

try:
    d = json.loads(info_raw)
except Exception:
    print(f"unknown\t{tname} {addr} unknown JSON 오류\t- 팀원: {tname} {addr} {kind} 옵션 일치 ?(JSON 오류) resume 해당 없음 확인창 모름 상태 없음\t{tname} JSON 오류")
    sys.exit(0)

state = d.get("state")
st = d.get("status") if isinstance(d.get("status"), dict) else {}
st_state = st.get("state") if isinstance(st.get("state"), str) else ""
st_kind = st.get("kind") if isinstance(st.get("kind"), str) else ""
msglen = d.get("msglen") if isinstance(d.get("msglen"), int) and not isinstance(d.get("msglen"), bool) else 0
reported = d.get("reported")
raw_argv = d.get("argv")
fg = d.get("foreground") if isinstance(d.get("foreground"), dict) else {}
fg_name = fg.get("name") if isinstance(fg.get("name"), str) else ""
cwd = d.get("cwd") if isinstance(d.get("cwd"), str) else ""

status_for_report = st_state if st_state else "없음"
if st_state == "blocked":
    dialog_str = f"{st_kind or '\''blocked'\''}(msglen={msglen})"
elif reported is True and st_state in ("idle", "working", "done", "error"):
    dialog_str = "없음"
else:
    dialog_str = "모름"

if state != "live":
    c_line = f"{tname} {addr} mismatch state={state or '\''none'\''} 기대=live"
    s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ×(state={state or '\''none'\''}) resume 해당 없음 확인창 {dialog_str} 상태 {status_for_report}"
    print(f"mismatch\t{c_line}\t{s_line}\t")
    sys.exit(0)

cwd_ok = None
if cwd and cwd.startswith("/"):
    try:
        real_cwd = os.path.realpath(cwd)
        cwd_ok = (real_cwd == real_root)
    except Exception:
        cwd_ok = None

if cwd_ok is False:
    c_line = f"{tname} {addr} mismatch 실제=cwd:다름 기대=cwd:{real_root}"
    s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ×(실제=cwd:다름) resume 해당 없음 확인창 {dialog_str} 상태 {status_for_report}"
    print(f"mismatch\t{c_line}\t{s_line}\t")
    sys.exit(0)

actual_parts = []
expected_parts = []
argv_unknown_reason = ""

if kind in ("agy", "codex"):
    if not isinstance(raw_argv, list) or len(raw_argv) == 0 or any(not isinstance(x, str) for x in raw_argv):
        argv_unknown_reason = "argv 없음"
    else:
        exe_idx = 0
        if checker.basename_of(raw_argv[0]) == "env":
            exe_idx = 1
            while exe_idx < len(raw_argv) and "=" in raw_argv[exe_idx] and not raw_argv[exe_idx].startswith("-"):
                exe_idx += 1
        if exe_idx >= len(raw_argv):
            argv_unknown_reason = "argv 없음"
        else:
            exe_base = checker.basename_of(raw_argv[exe_idx])
            if exe_base != kind:
                actual_parts.append("agent:다름")
                expected_parts.append(f"agent:{kind}")
            exp_lines = [ln for ln in exp_raw.splitlines() if ln.strip()]
            expected_units = checker.parse_expected_units(exp_lines)
            actual_units = checker.group_argv_units(raw_argv[exe_idx + 1:])
            for exp_flag, exp_val in expected_units:
                exp_unit_str = exp_flag if exp_val is None else f"{exp_flag} {exp_val}"
                same_flag_vals = [val for (flag, val) in actual_units if flag == exp_flag]
                if not same_flag_vals:
                    actual_parts.append(f"없음:{exp_flag}")
                    expected_parts.append(exp_unit_str)
                elif exp_val is not None and exp_val not in same_flag_vals:
                    actual_parts.append(f"다름:{exp_flag}")
                    expected_parts.append(exp_unit_str)

if not fg_name or checker.basename_of(fg_name) != kind:
    has_argv_diff = bool(actual_parts or argv_unknown_reason)
    diff_note = "기동 옵션 차이 있음" if has_argv_diff else "기동 옵션 차이 없음"
    c_line = f"{tname} {addr} unknown foreground 판정 불가(래퍼 또는 미관측, {diff_note})"
    s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ?(foreground 판정 불가, {diff_note}) resume 해당 없음 확인창 {dialog_str} 상태 {status_for_report}"
    print(f"unknown\t{c_line}\t{s_line}\t{tname} foreground 판정 불가({diff_note})")
    sys.exit(0)

if argv_unknown_reason:
    c_line = f"{tname} {addr} unknown {argv_unknown_reason}"
    s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ?({argv_unknown_reason}) resume 해당 없음 확인창 {dialog_str} 상태 {status_for_report}"
    print(f"unknown\t{c_line}\t{s_line}\t{tname} {argv_unknown_reason}")
    sys.exit(0)

if actual_parts:
    act_str = ",".join(actual_parts)
    exp_str = ",".join(expected_parts)
    c_line = f"{tname} {addr} mismatch 실제={act_str} 기대={exp_str}"
    s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ×(실제={act_str}) resume 해당 없음 확인창 {dialog_str} 상태 {status_for_report}"
    print(f"mismatch\t{c_line}\t{s_line}\t")
    sys.exit(0)

if cwd_ok is None:
    c_line = f"{tname} {addr} unknown cwd 미확인"
    s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ?(cwd 미확인) resume 해당 없음 확인창 {dialog_str} 상태 {status_for_report}"
    print(f"unknown\t{c_line}\t{s_line}\t{tname} cwd 미확인")
    sys.exit(0)

if reported is not True:
    if reported is False:
        c_line = f"{tname} {addr} unknown 미보고(reported=false)"
        s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ?(미보고) resume 해당 없음 확인창 모름 상태 {status_for_report}"
        print(f"unknown\t{c_line}\t{s_line}\t{tname} 미보고")
    else:
        c_line = f"{tname} {addr} unknown 미보고(reported=unknown)"
        s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ?(reported=unknown) resume 해당 없음 확인창 모름 상태 {status_for_report}"
        print(f"unknown\t{c_line}\t{s_line}\t{tname} reported=unknown")
    sys.exit(0)

if st_state not in ("idle", "working", "done", "blocked", "error"):
    c_line = f"{tname} {addr} unknown status 판정 불가"
    s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ?(status 판정 불가) resume 해당 없음 확인창 모름 상태 {status_for_report}"
    print(f"unknown\t{c_line}\t{s_line}\t{tname} status 판정 불가")
    sys.exit(0)

if st_state == "blocked":
    c_line = f"{tname} {addr} ok status=blocked kind={st_kind or '\''unknown'\''} msglen={msglen}"
else:
    c_line = f"{tname} {addr} ok status={st_state}"
s_line = f"- 팀원: {tname} {addr} {kind} 옵션 일치 ○ resume 해당 없음 확인창 {dialog_str} 상태 {status_for_report}"
print(f"ok\t{c_line}\t{s_line}\t")
' "$ROOT" "$tname" "$safe_addr" "$kind" "$info" "$expected_raw"
}

run_core_check() {
	local has_mismatch=0 has_unknown=0 lock_cls line state c_line rest insp_rc
	local -a roles=("mate:agy:0")
	if codex_enabled; then
		roles+=("critic:codex:0")
	fi
	roles+=("lead:claude:1")
	for entry in "${roles[@]}"; do
		local r="${entry%%:*}"
		local rem="${entry#*:}"
		local k="${rem%%:*}"
		local opt="${rem#*:}"
		insp_rc=0
		line="$(inspect_role "$r" "$k" "$opt" 2>/dev/null)" || insp_rc=$?
		if [ "$insp_rc" -ne 0 ] || [ -z "$line" ]; then
			has_unknown=1
			core_redact "${CORE_TEAM}-${r} - unknown 역할 점검 실패"
			continue
		fi
		state="${line%%$'\t'*}"
		if [ "$opt" = 1 ] && [ "$state" = "absent" ]; then
			continue
		fi
		rest="${line#*$'\t'}"
		c_line="${rest%%$'\t'*}"
		case "$state" in
			ok)
				core_redact "$c_line"
				;;
			mismatch)
				has_mismatch=1
				core_redact "$c_line"
				;;
			unknown)
				has_unknown=1
				core_redact "$c_line"
				;;
			*)
				has_unknown=1
				core_redact "${CORE_TEAM}-${r} - unknown 알 수 없는 판정 태그"
				;;
		esac
	done
	lock_cls="$(core_lock_class)" || lock_cls="unknown"
	core_redact "lock $lock_cls"
	if [ "$has_unknown" -eq 1 ] || [ "$lock_cls" = "unknown" ]; then
		return 2
	fi
	if [ "$has_mismatch" -eq 1 ]; then
		return 1
	fi
	return 0
}

run_core_status() {
	local has_mismatch=0 has_unknown=0 lock_cls line state rest s_line u_reason branch="" short_sha="" porcel="" dirty_cnt=0 git_line="- 저장소: 모름" git_ok=0 insp_rc
	local -a member_lines=()
	local -a unknown_reasons=()
	local -a roles=("mate:agy:0")
	if codex_enabled; then
		roles+=("critic:codex:0")
	fi
	for entry in "${roles[@]}"; do
		local r="${entry%%:*}"
		local rem="${entry#*:}"
		local k="${rem%%:*}"
		local opt="${rem#*:}"
		insp_rc=0
		line="$(inspect_role "$r" "$k" "$opt" 2>/dev/null)" || insp_rc=$?
		if [ "$insp_rc" -ne 0 ] || [ -z "$line" ]; then
			has_unknown=1
			member_lines+=("- 팀원: ${CORE_TEAM}-${r} - ${k} 옵션 일치 ?(역할 점검 실패) resume 해당 없음 확인창 모름 상태 없음")
			unknown_reasons+=("${CORE_TEAM}-${r} 역할 점검 실패")
			continue
		fi
		state="${line%%$'\t'*}"
		if [ "$opt" = 1 ] && [ "$state" = "absent" ]; then
			continue
		fi
		rest="${line#*$'\t'}"
		rest="${rest#*$'\t'}"
		s_line="${rest%%$'\t'*}"
		u_reason="${rest#*$'\t'}"
		case "$state" in
			ok)
				member_lines+=("$s_line")
				;;
			mismatch)
				has_mismatch=1
				member_lines+=("$s_line")
				;;
			unknown)
				has_unknown=1
				member_lines+=("$s_line")
				[ -n "$u_reason" ] && unknown_reasons+=("$u_reason")
				;;
			*)
				has_unknown=1
				member_lines+=("- 팀원: ${CORE_TEAM}-${r} - ${k} 옵션 일치 ?(알 수 없는 판정 태그) resume 해당 없음 확인창 모름 상태 없음")
				unknown_reasons+=("${CORE_TEAM}-${r} 알 수 없는 판정 태그")
				;;
		esac
	done
	lock_cls="$(core_lock_class)" || lock_cls="unknown"
	if [ "$lock_cls" = "unknown" ]; then
		unknown_reasons+=("잠금 unknown")
	fi
	if command -v git >/dev/null 2>&1; then
		branch="$(git --no-optional-locks -c core.fsmonitor=false -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
		short_sha="$(git --no-optional-locks -c core.fsmonitor=false -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
		if [ -n "$branch" ] && [ -n "$short_sha" ] && porcel="$(git --no-optional-locks -c core.fsmonitor=false -C "$ROOT" status --porcelain 2>/dev/null)"; then
			git_ok=1
			if [ -z "$porcel" ]; then
				git_line="- 저장소: ${branch} @${short_sha}, 작업 트리 깨끗"
			else
				dirty_cnt="$(printf '%s\n' "$porcel" | grep -c '[^[:space:]]' || true)"
				git_line="- 저장소: ${branch} @${short_sha}, 작업 트리 미커밋 ${dirty_cnt}"
			fi
		fi
	fi
	if [ "$git_ok" -eq 0 ]; then
		unknown_reasons+=("저장소 모름")
	fi
	local unconfirmed="없음"
	if [ "${#unknown_reasons[@]}" -gt 0 ]; then
		local IFS=", "
		unconfirmed="${unknown_reasons[*]}"
	fi
	core_redact "- 팀장 세션: Core 외부 팀장(GJCH_CORE=1, team=$CORE_TEAM), 잠금 $lock_cls"
	for s_line in "${member_lines[@]}"; do
		core_redact "$s_line"
	done
	core_redact "$git_line"
	printf -- '- 팀장 감시: 모름(팀장이 채움)\n'
	printf -- '- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)\n'
	printf -- '- 진행 중이던 일·잃은 것: 모름(팀장이 채움)\n'
	core_redact "- 미확인: $unconfirmed"
	if [ "$has_unknown" -eq 1 ] || [ "$lock_cls" = "unknown" ]; then
		return 2
	fi
	if [ "$has_mismatch" -eq 1 ]; then
		return 1
	fi
	return 0
}

if [ "$mode" = "--hook" ]; then
	hook_source=""
	if [ ! -t 0 ]; then
		hook_source="$(python3 -B -c 'import json,os,select,sys,time
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
	core_guard "--hook" || exit $?
	[ "$CORE_GUARD_PASSED" = 1 ] || exit 0
	/bin/bash "$ROOT/scripts/team-lead.sh" claim >/dev/null 2>&1
	lead_rc=$?
	case "$lead_rc" in
		0|3|4) ;;
		*)
			printf 'GJCH: 팀장 잠금 확인에 실패했습니다.\n' >&2
			exit 1
			;;
	esac
	print_core_role_line "$lead_rc"
	if [ "$lead_rc" -eq 0 ] && [ "$hook_source" != "clear" ]; then
		if [ -x "$0" ]; then
			GJCH_FROM_HOOK=1 nohup "$0" --up </dev/null >/dev/null 2>&1 &
		else
			GJCH_FROM_HOOK=1 nohup /bin/bash "$0" --up </dev/null >/dev/null 2>&1 &
		fi
	fi
	exit 0
fi

core_guard "$mode" || exit $?
[ "$CORE_GUARD_PASSED" = 1 ] || exit 0

if [ "$mode" = "--check" ]; then
	run_core_check
	exit $?
fi

if [ "$mode" = "--status" ]; then
	run_core_status
	exit $?
fi

if [ -z "$mode" ]; then
	/bin/bash "$ROOT/scripts/team-lead.sh" claim >/dev/null 2>&1
	lead_rc=$?
	case "$lead_rc" in
		0|3|4)
			print_core_role_line "$lead_rc"
			exit 0
			;;
		*)
			printf 'GJCH: 팀장 잠금 확인에 실패했습니다.\n' >&2
			exit 1
			;;
	esac
fi

extract_error_kind() {
	local raw="$1" k=""
	k="$(core_json "$raw" "error.kind" || core_json "$raw" "error.data.kind" || true)"
	case "$k" in
		invalid_params|name_taken|spawn_failed|unavailable|invalid_template|not_found|machine_unknown|config)
			printf '%s\n' "$k"
			;;
		*)
			printf 'other\n'
			;;
	esac
}

spawn_core_role() { # role bin start_args...
	local role="$1" bin="$2" tname="${CORE_TEAM}-${1}" addr="" find_rc=0 run_out="" run_rc=0 err_kind="" ret_addr="" ret_name=""
	shift 2
	addr="$(core_find "$role")" || find_rc=$?
	if [ "$find_rc" -eq 0 ]; then
		core_redact "$tname ($addr): 이미 있음"
		return 0
	fi
	if [ "$find_rc" -eq 2 ]; then
		core_redact "$tname: 오류 duplicate_label (2개 이상, 기동 안 함)" >&2
		return 1
	fi
	if [ "$find_rc" -ne 1 ]; then
		core_redact "$tname: 오류 ls_failed (조회 실패, 기동 안 함)" >&2
		return 1
	fi
	if [ "$role" = "mate" ]; then
		case "$MATE_MODEL" in
			""|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-]*)
				printf 'GJCH_MATE_MODEL은 영문자·숫자·점·밑줄·하이픈만 사용할 수 있습니다.\n' >&2
				return 1
				;;
		esac
	fi
	if ! command -v "$bin" >/dev/null 2>&1; then
		core_redact "$bin not found; $tname not spawned" >&2
		return 1
	fi
	run_out="$(core_hc run --bg --json --no-notify --no-parent --name "$tname" --cwd "$ROOT" --label "team=$CORE_TEAM" --label "role=$role" -- "$bin" "$@" 2>&1)" || run_rc=$?
	if [ "$run_rc" -ne 0 ]; then
		err_kind="$(extract_error_kind "$run_out")"
		core_redact "$tname 기동 실패: $err_kind" >&2
		return 1
	fi
	ret_addr="$(core_json "$run_out" "address" || true)"
	ret_name="$(core_json "$run_out" "name" || true)"
	if [ -z "$ret_addr" ] || [ "$ret_name" != "$tname" ]; then
		core_redact "$tname 기동 실패: invalid_run_response" >&2
		return 1
	fi
	core_redact "spawned $tname at $ret_addr (cwd $ROOT)"
	return 0
}

if [ "$mode" = "--up" ] || [ "$mode" = "--spawn" ]; then
	mate_rc=0
	spawn_core_role mate agy "${MATE_START_ARGS[@]}" || mate_rc=$?
	critic_rc=0
	if [ "${GJCH_TEAM_CODEX:-1}" = 0 ]; then
		printf 'Codex reviewer disabled (GJCH_TEAM_CODEX=0)\n'
	elif ! command -v codex >/dev/null 2>&1; then
		printf 'codex not found; optional reviewer skipped (GJCH_TEAM_CODEX=0 disables it)\n' >&2
	else
		spawn_core_role critic codex "${CRITIC_START_ARGS[@]}" || critic_rc=$?
	fi
	check_rc=0
	run_core_check || check_rc=$?
	if [ "$mate_rc" -ne 0 ] || [ "$critic_rc" -ne 0 ]; then
		exit 1
	fi
	exit "$check_rc"
fi

if [ "$mode" = "--down" ]; then
	down_rc=0
	down_interval="${GJCH_CORE_DOWN_INTERVAL:-3}"
	case "$down_interval" in
		''|0*|*[!0-9]*) down_interval=3 ;;
		*)
			if [ "$down_interval" -lt 1 ] || [ "$down_interval" -gt 3600 ]; then
				down_interval=3
			fi
			;;
	esac
	down_retries="${GJCH_CORE_DOWN_RETRIES:-10}"
	case "$down_retries" in
		''|0*|*[!0-9]*) down_retries=10 ;;
		*)
			if [ "$down_retries" -lt 1 ] || [ "$down_retries" -gt 100 ]; then
				down_retries=10
			fi
			;;
	esac
	for role in mate critic; do
		tname="${CORE_TEAM}-${role}"
		addr=""
		find_rc=0
		addr="$(core_find "$role" --all)" || find_rc=$?
		if [ "$find_rc" -eq 1 ]; then
			core_redact "$tname: 없음"
			continue
		fi
		if [ "$find_rc" -eq 2 ]; then
			core_redact "$tname: 라벨 중복(2개 이상), 중지 안 함" >&2
			down_rc=1
			continue
		fi
		if [ "$find_rc" -ne 0 ] || [ -z "$addr" ]; then
			core_redact "$tname: 조회 실패, 중지 안 함" >&2
			down_rc=1
			continue
		fi
		info=""
		if ! info="$(core_get "$addr")" || [ -z "$info" ]; then
			core_redact "$tname ($addr): get 조회 실패, 중지 안 함" >&2
			down_rc=1
			continue
		fi
		t_state="$(core_json "$info" "state" || true)"
		st_state="$(core_json "$info" "status.state" || true)"
		if [ "$t_state" = "finished" ]; then
			if core_hc rm --json "$addr" >/dev/null 2>&1; then
				core_redact "$tname ($addr): 정리 완료"
			else
				core_redact "$tname ($addr): rm 실패, 잔류" >&2
				down_rc=1
			fi
			continue
		fi
		if [ "$t_state" != "live" ]; then
			core_redact "$tname ($addr): 알 수 없는 상태, 중지 안 함" >&2
			down_rc=1
			continue
		fi
		if [ "$st_state" = "working" ]; then
			core_redact "$tname ($addr): 작업 중, 중지 안 함" >&2
			down_rc=1
			continue
		fi
		if ! core_hc kill --json "$addr" >/dev/null 2>&1; then
			core_redact "$tname ($addr): kill 실패, 잔류" >&2
			down_rc=1
			continue
		fi
		confirmed_finished=0
		i=0
		while [ "$i" -lt "$down_retries" ]; do
			if poll_info="$(core_get "$addr")" && [ -n "$poll_info" ]; then
				poll_state="$(core_json "$poll_info" "state" || true)"
				if [ "$poll_state" = "finished" ]; then
					confirmed_finished=1
					break
				fi
			fi
			i=$((i + 1))
			if [ "$i" -lt "$down_retries" ]; then
				sleep "$down_interval"
			fi
		done
		if [ "$confirmed_finished" -eq 1 ]; then
			if core_hc rm --json "$addr" >/dev/null 2>&1; then
				core_redact "$tname ($addr): 정리 완료"
			else
				core_redact "$tname ($addr): rm 실패, 잔류" >&2
				down_rc=1
			fi
		else
			core_redact "$tname ($addr): finished 미확인, 잔류(rm 생략)" >&2
			down_rc=1
		fi
	done
	exit "$down_rc"
fi

printf '사용법: %s [--hook|--up|--spawn|--check|--status|--lock <status|claim|release>|--down|--print-expected-units <agy|codex>]\n' "$0" >&2
exit 2
