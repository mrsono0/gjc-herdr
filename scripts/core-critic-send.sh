#!/usr/bin/env bash
# Core(hc) Codex 검토 전송: 소유 critic 터미널을 교체 기동(kill -> finished -> rm -> run)한 뒤
# reported=true·idle 준비를 확인하고 지시서를 1회 전송한다.
# 화면 읽기(hc read/attach)·/new·--force·keys·자동 재전송은 절대 수행하지 않는다.
# 종료 코드: 완료(0) / 전제·교체·전송 실패(1) / 대기 timeout(2) / 결과 파일 미작성(4) / 확인창 blocked 감지(5) / 저장소 상태 변경·대조 불가(6).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=scripts/core-lib.sh
. "$ROOT/scripts/core-lib.sh"

timeout=1800000
no_wait=0
result_file=""
brief=""
argument_count="$#"

usage() {
	printf '사용법: %s [--timeout <ms>] [--no-wait | --result <결과 파일>] <지시서 파일>\n' "$0"
}

fail() {
	core_redact "$*" >&2
	exit 1
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--timeout)
			[ "$#" -ge 2 ] || fail '--timeout 값이 필요합니다.'
			timeout="$2"
			shift 2
			;;
		--no-wait)
			no_wait=1
			shift
			;;
		--result)
			[ "$#" -ge 2 ] && [ -n "$2" ] || fail '--result 값이 필요합니다.'
			result_file="$2"
			shift 2
			;;
		-h|--help)
			[ "$argument_count" -eq 1 ] || fail '도움말은 단독으로 사용합니다.'
			usage
			exit 0
			;;
		--)
			shift
			[ "$#" -eq 1 ] || fail '지시서 파일 하나가 필요합니다.'
			brief="$1"
			shift
			;;
		-*)
			usage >&2
			exit 1
			;;
		*)
			[ -z "$brief" ] || fail '지시서 파일은 하나만 지정합니다.'
			brief="$1"
			shift
			;;
	esac
done

command -v python3 >/dev/null 2>&1 || fail 'python3가 필요합니다.'
[ -n "$brief" ] && [ -r "$brief" ] && [ -f "$brief" ] || fail '읽을 수 있는 지시서 파일이 필요합니다.'
if [ -n "$result_file" ]; then
	[ "$no_wait" -eq 0 ] || fail '--result와 --no-wait는 함께 쓸 수 없음.'
	case "$result_file" in
		/*) ;;
		*) result_file="$ROOT/$result_file" ;;
	esac
	[ ! -d "$result_file" ] || fail '--result 경로가 디렉터리입니다.'
fi

case "$timeout" in
	''|*[!0-9]*) fail '--timeout은 양의 정수(ms)여야 합니다.' ;;
esac
[ "${#timeout}" -le 9 ] || fail '--timeout은 1–86400000ms(24시간) 범위여야 합니다(최대 9자리).'
[ "$timeout" -gt 0 ] && [ "$timeout" -le 86400000 ] || fail '--timeout은 1–86400000ms(24시간) 범위여야 합니다.'

core_now_ms() {
	python3 -B -c 'import time; print(int(time.monotonic() * 1000))'
}

SECONDS=0
start_ms="$(core_now_ms)"
deadline_ms=$((start_ms + 10#$timeout))
ready_deadline_ms=0

prompt="$(python3 -B -c 'import sys
text = open(sys.argv[1], encoding="utf-8").read()
if not text.strip():
    sys.exit(1)
sys.stdout.write(text)' "$brief" 2>/dev/null)" || fail 'UTF-8 지시서 내용을 읽지 못했습니다.'

core_guard "critic-send" || exit $?
if [ "$CORE_GUARD_PASSED" != 1 ]; then
	fail 'Core 외부 팀장(GJCH_CORE=1, GJCH_EXTERNAL_LEAD=1, 저장소 안, 팀원 역할 아님)에서 실행하세요.'
fi

# 동기 hc 호출(ls/get/kill/rm/run)을 남은 시간 예산(ms) 안으로 제한하고 초과 시 프로세스 그룹 전체를 정리한 뒤 124를 반환한다.
core_hc() {
	local bin="${GJCH_HC_BIN:-hc}"
	python3 -B -c 'import os,signal,subprocess,sys,time
deadline_ms = int(sys.argv[1])
ready_cap_ms = int(sys.argv[2])
cmd = sys.argv[3:]
now_ms = int(time.monotonic() * 1000)
if deadline_ms - now_ms <= 0:
    sys.exit(124)
eff_ms = deadline_ms
if ready_cap_ms > 0 and ready_cap_ms < eff_ms:
    eff_ms = ready_cap_ms
rem_ms = eff_ms - now_ms
if rem_ms <= 0:
    sys.exit(125)
try:
    proc = subprocess.Popen(cmd, start_new_session=True)
except Exception:
    sys.exit(127)
try:
    rc = proc.wait(timeout=rem_ms / 1000.0)
except subprocess.TimeoutExpired:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except Exception:
            pass
        try:
            os.kill(proc.pid, sig)
        except Exception:
            pass
        if sig == signal.SIGTERM:
            time.sleep(0.05)
    try:
        proc.wait(timeout=0.2)
    except Exception:
        pass
    if deadline_ms - int(time.monotonic() * 1000) <= 0:
        sys.exit(124)
    sys.exit(125)
now_after = int(time.monotonic() * 1000)
if deadline_ms - now_after <= 0:
    sys.exit(124)
if ready_cap_ms > 0 and ready_cap_ms - now_after <= 0:
    sys.exit(125)
sys.exit(rc)
' "$deadline_ms" "${ready_deadline_ms:-0}" "$bin" "$@"
}

# core_find도 단일 python3 호출에서 남은 예산 제한과 JSON 검증을 함께 수행한다.
core_find() {
	local role="${1:-}" all_flag="${2:-}" team="${GJCH_CORE_TEAM:-gjch}" bin="${GJCH_HC_BIN:-hc}"
	[ -n "$role" ] || return 3
	python3 -B -c 'import json,os,signal,subprocess,sys,time
deadline_ms = int(sys.argv[1])
team = sys.argv[2]
role = sys.argv[3]
cmd = sys.argv[4:]
rem_ms = deadline_ms - int(time.monotonic() * 1000)
if rem_ms <= 0:
    sys.exit(124)
try:
    proc = subprocess.Popen(cmd, start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
except Exception:
    sys.exit(3)
try:
    out, _ = proc.communicate(timeout=rem_ms / 1000.0)
except subprocess.TimeoutExpired:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except Exception:
            pass
        try:
            os.kill(proc.pid, sig)
        except Exception:
            pass
        if sig == signal.SIGTERM:
            time.sleep(0.05)
    try:
        proc.wait(timeout=0.2)
    except Exception:
        pass
    sys.exit(124)
if deadline_ms - int(time.monotonic() * 1000) <= 0:
    sys.exit(124)
if proc.returncode != 0:
    sys.exit(3)
try:
    doc = json.loads(out)
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
sys.exit(2)
' "$deadline_ms" "$team" "$role" "$bin" ls ${all_flag:+"$all_flag"} --json --label "team=$team" --label "role=$role" 2>/dev/null
}

# core_get도 단일 python3 호출에서 남은 예산 제한(Popen + killpg)과 JSON 정규화를 함께 수행해 프로세스 기동 오버헤드를 줄인다.
core_get() {
	local addr="${1:-}" bin="${GJCH_HC_BIN:-hc}" json_line=""
	[ -n "$addr" ] || return 1
	json_line="$(python3 -B -c 'import json,os,signal,subprocess,sys,time
deadline_ms = int(sys.argv[1])
ready_cap_ms = int(sys.argv[2])
cmd = sys.argv[3:]
now_ms = int(time.monotonic() * 1000)
if deadline_ms - now_ms <= 0:
    sys.exit(124)
eff_ms = deadline_ms
if ready_cap_ms > 0 and ready_cap_ms < eff_ms:
    eff_ms = ready_cap_ms
rem_ms = eff_ms - now_ms
if rem_ms <= 0:
    sys.exit(125)
try:
    proc = subprocess.Popen(cmd, start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
except Exception:
    sys.exit(1)
try:
    out, _ = proc.communicate(timeout=rem_ms / 1000.0)
except subprocess.TimeoutExpired:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except Exception:
            pass
        try:
            os.kill(proc.pid, sig)
        except Exception:
            pass
        if sig == signal.SIGTERM:
            time.sleep(0.05)
    try:
        proc.wait(timeout=0.2)
    except Exception:
        pass
    if deadline_ms - int(time.monotonic() * 1000) <= 0:
        sys.exit(124)
    sys.exit(125)
now_after = int(time.monotonic() * 1000)
if deadline_ms - now_after <= 0:
    sys.exit(124)
if ready_cap_ms > 0 and ready_cap_ms - now_after <= 0:
    sys.exit(125)
if proc.returncode != 0:
    sys.exit(1)
try:
    d = json.loads(out)
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
    st_state = raw_st_state if isinstance(raw_st_state, str) and raw_st_state in ("idle", "working", "done", "blocked", "error") else "other"
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
raw_reported = d.get("reported")
reported_val = raw_reported if isinstance(raw_reported, bool) else "unknown"
res = {
    "state": state,
    "status": {"state": st_state, "kind": st_kind},
    "msglen": msglen,
    "reported": reported_val,
}
print(json.dumps(res, ensure_ascii=False, separators=(",", ":")))
' "$deadline_ms" "${ready_deadline_ms:-0}" "$bin" get --json "$addr" 2>/dev/null)" || return $?
	printf '%s\n' "$json_line"
}

# core_get 정규화 JSON 한 줄에서 state, reported, status.state, status.kind, msglen을 추출한다.
parse_get_info() {
	local raw="$1"
	G_STATE=""
	G_REPORTED=""
	G_ST_STATE=""
	G_ST_KIND=""
	G_MSGLEN=""
	local r_state='"state":"([^"]*)"'
	local r_st_state='"status":."state":"([^"]*)"'
	local r_st_kind='"kind":"([^"]*)"'
	local r_msglen='"msglen":([0-9]+)'
	local r_rep='"reported":(true|false|"unknown")'
	if [[ "$raw" =~ $r_state ]]; then
		G_STATE="${BASH_REMATCH[1]}"
	fi
	if [[ "$raw" =~ $r_st_state ]]; then
		G_ST_STATE="${BASH_REMATCH[1]}"
	fi
	if [[ "$raw" =~ $r_st_kind ]]; then
		G_ST_KIND="${BASH_REMATCH[1]}"
	fi
	if [[ "$raw" =~ $r_msglen ]]; then
		G_MSGLEN="${BASH_REMATCH[1]}"
	fi
	if [[ "$raw" =~ $r_rep ]]; then
		G_REPORTED="${BASH_REMATCH[1]//\"/}"
	fi
}

# 결과 파일 상태: 없으면 "없음", 있으면 "<st_mtime_ns> <st_size>". 링크는 따라가지 않는다(lstat).
result_state() {
	python3 -B -c 'import os,sys
try: st=os.lstat(sys.argv[1])
except FileNotFoundError: print("없음"); sys.exit(0)
print(st.st_mtime_ns,st.st_size)' "$1"
}

# 경로 자체가 비어 있지 않은 일반 파일(심볼릭 링크 제외)이며 전송 전 상태(result_state 출력)와 달라야 통과한다.
result_written() {
	python3 -B -c 'import os,stat,sys
path,before=sys.argv[1:]
try: st=os.lstat(path)
except OSError: sys.exit(1)
if not stat.S_ISREG(st.st_mode) or st.st_size==0: sys.exit(1)
sys.exit(0 if before=="없음" or before!=str(st.st_mtime_ns)+" "+str(st.st_size) else 1)' "$1" "$2"
}

# 검토 전후 저장소 상태(HEAD·refs·stash·status)를 이름표와 함께 한 덩어리로 기록한다.
capture_repo_state() {
	local head_out="" refs_out="" stash_out="" status_out=""
	head_out="$(GIT_OPTIONAL_LOCKS=0 git -C "$ROOT" rev-parse HEAD 2>/dev/null)" || return 1
	refs_out="$(GIT_OPTIONAL_LOCKS=0 git -C "$ROOT" for-each-ref --format='%(refname) %(objectname)' 2>/dev/null)" || return 1
	stash_out="$(GIT_OPTIONAL_LOCKS=0 git -C "$ROOT" stash list 2>/dev/null)" || return 1
	status_out="$(GIT_OPTIONAL_LOCKS=0 git -C "$ROOT" status --porcelain=v1 --untracked-files=all 2>/dev/null)" || return 1
	printf 'HEAD\n%s\n\036refs\n%s\n\036stash\n%s\n\036status\n%s\n' \
		"$head_out" "$refs_out" "$stash_out" "$status_out"
}

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

ready_interval="${GJCH_CRITIC_READY_INTERVAL:-3}"
case "$ready_interval" in
	''|0*|*[!0-9]*) ready_interval=3 ;;
	*)
		if [ "$ready_interval" -lt 1 ] || [ "$ready_interval" -gt 60 ]; then
			ready_interval=3
		fi
		;;
esac

ready_retries="${GJCH_CRITIC_READY_RETRIES:-20}"
case "$ready_retries" in
	''|0*|*[!0-9]*) ready_retries=20 ;;
	*)
		if [ "$ready_retries" -lt 1 ] || [ "$ready_retries" -gt 100 ]; then
			ready_retries=20
		fi
		;;
esac

watch_interval="${GJCH_CRITIC_WATCH_INTERVAL:-3}"
case "$watch_interval" in
	''|0*|*[!0-9]*) watch_interval=3 ;;
	*)
		if [ "$watch_interval" -lt 1 ] || [ "$watch_interval" -gt 3600 ]; then
			watch_interval=3
		fi
		;;
esac

tname="${CORE_TEAM}-critic"

# --- 1. 교체 기동(설계 §4): 기존 critic 확인 및 정리 ---
existing_addr=""
find_rc=0
existing_addr="$(core_find critic)" || find_rc=$?
if [ "$find_rc" -eq 124 ]; then
	core_redact "hc 응답 대기 만료(시간 예산 소진): ${tname}. 지시서는 보내지 않았습니다." >&2
	exit 2
fi
if [ "$find_rc" -eq 2 ]; then
	fail "${tname}: 라벨 중복(2개 이상), 교체 안 함. 지시서는 보내지 않았습니다."
fi
if [ "$find_rc" -ne 0 ] && [ "$find_rc" -ne 1 ]; then
	fail "${tname}: ls 조회 실패, 교체 안 함. 지시서는 보내지 않았습니다."
fi

if [ "$find_rc" -eq 0 ]; then
	[ -n "$existing_addr" ] || fail "${tname}: 기존 주소가 비어 있습니다. 지시서는 보내지 않았습니다."
	info=""
	get_rc=0
	info="$(core_get "$existing_addr")" || get_rc=$?
	if [ "$get_rc" -eq 124 ]; then
		core_redact "hc 응답 대기 만료(시간 예산 소진): ${tname} (${existing_addr}). 지시서는 보내지 않았습니다." >&2
		exit 2
	fi
	if [ "$get_rc" -ne 0 ] || [ -z "$info" ]; then
		fail "${tname} (${existing_addr}): get 조회 실패, 교체 안 함. 지시서는 보내지 않았습니다."
	fi
	parse_get_info "$info"
	t_state="$G_STATE"
	reported="$G_REPORTED"
	st_state="$G_ST_STATE"
	if [ "$t_state" = "finished" ]; then
		rm_rc=0
		core_hc rm --json "$existing_addr" >/dev/null 2>&1 || rm_rc=$?
		if [ "$rm_rc" -eq 124 ]; then
			core_redact "hc 응답 대기 만료(시간 예산 소진): ${tname} (${existing_addr}). 지시서는 보내지 않았습니다." >&2
			exit 2
		fi
		if [ "$rm_rc" -ne 0 ]; then
			fail "${tname} (${existing_addr}): finished 터미널 rm 실패. 지시서는 보내지 않았습니다."
		fi
	elif [ "$t_state" != "live" ]; then
		fail "${tname} (${existing_addr}): 알 수 없는 상태(state=${t_state:-other}), 교체 안 함. 지시서는 보내지 않았습니다."
	else
		if [ "$reported" = "false" ]; then
			fail "${tname} (${existing_addr}): 미보고(reported=false), 교체 안 함. 지시서는 보내지 않았습니다."
		fi
		if [ "$reported" != "true" ]; then
			fail "${tname} (${existing_addr}): 미보고(reported=unknown), 교체 안 함. 지시서는 보내지 않았습니다."
		fi
		case "$st_state" in
			idle|done)
				;;
			working|blocked)
				fail "${tname} (${existing_addr}): 검토 중(${st_state}), 교체 안 함. 지시서는 보내지 않았습니다."
				;;
			"")
				fail "${tname} (${existing_addr}): 상태 없음(status=null), 교체 안 함. 지시서는 보내지 않았습니다."
				;;
			error)
				fail "${tname} (${existing_addr}): 오류 상태(status=error), 교체 안 함. 지시서는 보내지 않았습니다."
				;;
			*)
				fail "${tname} (${existing_addr}): 상태 불명(status=other), 교체 안 함. 지시서는 보내지 않았습니다."
				;;
		esac
		kill_rc=0
		core_hc kill --json "$existing_addr" >/dev/null 2>&1 || kill_rc=$?
		if [ "$kill_rc" -eq 124 ]; then
			core_redact "hc 응답 대기 만료(시간 예산 소진): ${tname} (${existing_addr}). 지시서는 보내지 않았습니다." >&2
			exit 2
		fi
		if [ "$kill_rc" -ne 0 ]; then
			fail "${tname} (${existing_addr}): kill 실패, 교체 안 함. 지시서는 보내지 않았습니다."
		fi
		confirmed_finished=0
		i=0
		while [ "$i" -lt "$down_retries" ]; do
			poll_info=""
			poll_rc=0
			poll_info="$(core_get "$existing_addr")" || poll_rc=$?
			if [ "$poll_rc" -eq 124 ]; then
				core_redact "hc 응답 대기 만료(시간 예산 소진): ${tname} (${existing_addr}). 지시서는 보내지 않았습니다." >&2
				exit 2
			fi
			if [ "$poll_rc" -eq 0 ] && [ -n "$poll_info" ]; then
				parse_get_info "$poll_info"
				poll_state="$G_STATE"
				if [ "$poll_state" = "finished" ]; then
					confirmed_finished=1
					break
				fi
			fi
			i=$((i + 1))
			if [ "$i" -lt "$down_retries" ]; then
				now_ms="$(core_now_ms)"
				rem_ms=$((deadline_ms - now_ms))
				if [ "$rem_ms" -le 0 ]; then
					core_redact "교체 대기 timeout(시간 예산 소진): ${tname} (${existing_addr}). 지시서는 보내지 않았습니다." >&2
					exit 2
				fi
				down_iv_ms=$((down_interval * 1000))
				if [ "$rem_ms" -lt "$down_iv_ms" ]; then
					python3 -B -c 'import sys,time; time.sleep(max(0, int(sys.argv[1])) / 1000.0)' "$rem_ms"
				else
					sleep "$down_interval"
				fi
				now_ms="$(core_now_ms)"
				if [ "$((deadline_ms - now_ms))" -le 0 ]; then
					core_redact "교체 대기 timeout(시간 예산 소진): ${tname} (${existing_addr}). 지시서는 보내지 않았습니다." >&2
					exit 2
				fi
			fi
		done
		if [ "$confirmed_finished" -ne 1 ]; then
			fail "${tname} (${existing_addr}): finished 미확인, 교체 중단(rm 생략). 지시서는 보내지 않았습니다."
		fi
		rm_rc=0
		core_hc rm --json "$existing_addr" >/dev/null 2>&1 || rm_rc=$?
		if [ "$rm_rc" -eq 124 ]; then
			core_redact "hc 응답 대기 만료(시간 예산 소진): ${tname} (${existing_addr}). 지시서는 보내지 않았습니다." >&2
			exit 2
		fi
		if [ "$rm_rc" -ne 0 ]; then
			fail "${tname} (${existing_addr}): rm 실패, 교체 중단. 지시서는 보내지 않았습니다."
		fi
	fi
fi

# --- 2. 새 critic 기동 및 응답 address 고정 ---
if ! command -v codex >/dev/null 2>&1; then
	fail "codex를 찾을 수 없습니다. ${tname} 기동 안 함. 지시서는 보내지 않았습니다."
fi

run_out=""
run_rc=0
run_out="$(core_hc run --bg --json --no-notify --no-parent --name "$tname" --cwd "$ROOT" --label "team=$CORE_TEAM" --label "role=critic" -- codex "${CRITIC_START_ARGS[@]}" 2>&1)" || run_rc=$?
if [ "$run_rc" -eq 124 ]; then
	core_redact "hc 응답 대기 만료(시간 예산 소진): ${tname}. 지시서는 보내지 않았습니다." >&2
	exit 2
fi
if [ "$run_rc" -ne 0 ]; then
	err_kind="$(extract_error_kind "$run_out")"
	fail "${tname} 교체 기동 실패: ${err_kind}. 지시서는 보내지 않았습니다."
fi

target_addr="$(python3 -B -c 'import json,sys
raw, exp_name = sys.argv[1], sys.argv[2]
try:
    d = json.loads(raw)
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    sys.exit(1)
addr = d.get("address")
name = d.get("name")
if not isinstance(addr, str) or not addr or "/" in addr:
    sys.exit(1)
if not isinstance(name, str) or name != exp_name:
    sys.exit(1)
print(addr)' "$run_out" "$tname" 2>/dev/null)" || fail "${tname} 교체 기동 실패: invalid_run_response. 지시서는 보내지 않았습니다."
[ -n "$target_addr" ] || fail "${tname} 교체 기동 실패: invalid_run_response. 지시서는 보내지 않았습니다."

# --- 3. 준비 대기(state=live, reported=true, status.state=idle, min(start_ready_ms + 60000, deadline_ms)) ---
ready_ok=0
last_ready_reason="조회 전"
start_ready_ms="$(core_now_ms)"
if [ "$((deadline_ms - start_ready_ms))" -le 0 ]; then
	core_redact "준비 대기 timeout(시간 예산 소진): ${tname} (${target_addr}). 지시서는 보내지 않았습니다." >&2
	exit 2
fi
ready_deadline_ms=$((start_ready_ms + 60000))
if [ "$deadline_ms" -lt "$ready_deadline_ms" ]; then
	ready_deadline_ms="$deadline_ms"
fi
r_idx=0
while [ "$r_idx" -lt "$ready_retries" ]; do
	r_info=""
	r_get_rc=0
	r_info="$(core_get "$target_addr")" || r_get_rc=$?
	if [ "$r_get_rc" -eq 124 ]; then
		ready_deadline_ms=0
		core_redact "준비 대기 timeout(시간 예산 소진): ${tname} (${target_addr}). 지시서는 보내지 않았습니다." >&2
		exit 2
	fi
	if [ "$r_get_rc" -eq 125 ]; then
		last_ready_reason="준비 상한(60초) 초과"
		break
	fi
	if [ "$r_get_rc" -eq 0 ] && [ -n "$r_info" ]; then
		parse_get_info "$r_info"
		r_state="$G_STATE"
		r_rep="$G_REPORTED"
		r_st="$G_ST_STATE"
		if [ "$r_state" = "finished" ]; then
			ready_deadline_ms=0
			fail "준비 미확인(state=finished). 지시서는 보내지 않았습니다."
		elif [ "$r_state" != "live" ]; then
			last_ready_reason="state=other"
		elif [ "$r_rep" = "false" ]; then
			last_ready_reason="미보고(reported=false)"
		elif [ "$r_rep" != "true" ]; then
			last_ready_reason="미보고(reported=unknown)"
		elif [ "$r_st" = "blocked" ]; then
			ready_deadline_ms=0
			fail "준비 미확인(blocked). 지시서는 보내지 않았습니다."
		elif [ "$r_st" = "error" ]; then
			ready_deadline_ms=0
			fail "준비 미확인(error). 지시서는 보내지 않았습니다."
		elif [ "$r_st" = "done" ]; then
			last_ready_reason="idle 아님(done)"
		elif [ "$r_st" = "idle" ]; then
			ready_ok=1
			break
		else
			last_ready_reason="status=${r_st:-없음}"
		fi
	else
		last_ready_reason="get 조회 실패"
	fi
	r_idx=$((r_idx + 1))
	if [ "$r_idx" -lt "$ready_retries" ]; then
		now_ms="$(core_now_ms)"
		if [ "$((deadline_ms - now_ms))" -le 0 ]; then
			ready_deadline_ms=0
			core_redact "준비 대기 timeout(시간 예산 소진): ${tname} (${target_addr}). 지시서는 보내지 않았습니다." >&2
			exit 2
		fi
		rem_ready_ms=$((ready_deadline_ms - now_ms))
		if [ "$rem_ready_ms" -le 0 ]; then
			last_ready_reason="준비 상한(60초) 초과"
			break
		fi
		ready_iv_ms=$((ready_interval * 1000))
		if [ "$rem_ready_ms" -lt "$ready_iv_ms" ]; then
			python3 -B -c 'import sys,time; time.sleep(max(0, int(sys.argv[1])) / 1000.0)' "$rem_ready_ms"
		else
			sleep "$ready_interval"
		fi
		now_ms="$(core_now_ms)"
		if [ "$((deadline_ms - now_ms))" -le 0 ]; then
			ready_deadline_ms=0
			core_redact "준비 대기 timeout(시간 예산 소진): ${tname} (${target_addr}). 지시서는 보내지 않았습니다." >&2
			exit 2
		fi
		if [ "$((ready_deadline_ms - now_ms))" -le 0 ]; then
			last_ready_reason="준비 상한(60초) 초과"
			break
		fi
	fi
done
ready_deadline_ms=0

if [ "$ready_ok" -ne 1 ]; then
	fail "준비 미확인(${last_ready_reason}). 지시서는 보내지 않았습니다."
fi

# --- 4. 전송 전 결과 파일 lstat 상태 및 저장소 상태 기록 ---
result_before=""
if [ -n "$result_file" ]; then
	result_before="$(result_state "$result_file")" || fail '결과 파일 전송 전 상태 기록 실패. 지시서는 보내지 않았습니다.'
fi
repo_before=""
repo_before_ok=0
if [ "$no_wait" -eq 0 ]; then
	if repo_before="$(capture_repo_state)"; then
		repo_before_ok=1
	fi
fi

report_blocked_and_exit() {
	local b_kind="${1:-}" b_len="${2:-}" b_info=""
	if [ -z "$b_kind" ] || [ "$b_kind" = "null" ]; then
		if b_info="$(core_get "$target_addr" 2>/dev/null)" && [ -n "$b_info" ]; then
			b_kind="$(core_json "$b_info" "status.kind" || true)"
			b_len="$(core_json "$b_info" "msglen" || true)"
		fi
	fi
	[ -n "$b_kind" ] || b_kind="null"
	[ -n "$b_len" ] || b_len="0"
	core_redact "DIALOG critic ${b_kind} msglen=${b_len}" >&2
	printf '확인창 감지. 대화상자에 응답하지 않습니다.\n' >&2
	exit 5
}

validate_send_result() {
	local s_rc="$1" s_raw="$2" nw="$3" exp_addr="$4"
	python3 -B -c 'import json,sys
rc_str, raw, nw, exp_addr = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
if rc_str != "0":
    print("err\tsend_rc_nonzero")
    sys.exit(0)
try:
    d = json.loads(raw)
except Exception:
    print("err\tinvalid_json")
    sys.exit(0)
if not isinstance(d, dict):
    print("err\tinvalid_json")
    sys.exit(0)
turn = d.get("turn")
if not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
    print("err\tmissing_turn")
    sys.exit(0)
started = d.get("started")
if started is not True:
    print("err\tstarted_not_true")
    sys.exit(0)
if nw == "1":
    print("started_ok\tok")
    sys.exit(0)
w = d.get("wait")
if not isinstance(w, dict):
    print("err\tmissing_wait")
    sys.exit(0)
w_term = w.get("terminal")
w_turn = w.get("turn")
w_children = w.get("children")
ended = w.get("ended")
reason = w.get("reason")
w_status = w.get("status")
if (
    not isinstance(w_term, str)
    or w_term != exp_addr
    or not isinstance(w_turn, int)
    or isinstance(w_turn, bool)
    or w_turn < 0
    or not isinstance(w_children, list)
    or not isinstance(ended, bool)
    or not isinstance(reason, str)
    or not reason
):
    print("err\tinvalid_wait")
    sys.exit(0)
if reason == "not_started":
    print("err\tnot_started")
    sys.exit(0)
if reason == "exit":
    print("err\texit")
    sys.exit(0)
if reason == "status":
    if w_status == "blocked":
        print("blocked\tnull")
        sys.exit(0)
    if w_status == "error":
        print("err\twait_status_error")
        sys.exit(0)
    if w_status in ("idle", "done") and ended is True:
        print("done\t" + w_status)
        sys.exit(0)
    if w_status == "working" and ended is False:
        print("continue\tworking")
        sys.exit(0)
    print("err\twait_status_unexpected")
    sys.exit(0)
if reason == "timeout":
    if w_status == "blocked":
        print("blocked\tnull")
        sys.exit(0)
    if w_status == "error":
        print("err\twait_status_error")
        sys.exit(0)
    if ended is False:
        print("continue\ttimeout")
        sys.exit(0)
    print("err\ttimeout_ended_true")
    sys.exit(0)
if reason in ("message", "children"):
    if w_status == "blocked":
        print("blocked\tnull")
        sys.exit(0)
    if w_status == "error":
        print("err\twait_status_error")
        sys.exit(0)
    print("continue\t" + reason)
    sys.exit(0)
print("err\tunknown_wait_reason")' "$s_rc" "$s_raw" "$nw" "$exp_addr"
}

# --- 5. 지시서 1회 전송(--no-wait·--wait 모두 백그라운드 + 3초 blocked·예산 감시) ---
now_ms="$(core_now_ms)"
rem_ms=$((deadline_ms - now_ms))
if [ "$rem_ms" -le 0 ]; then
	core_redact "전송 전 timeout(미전송 만료, 시간 예산 소진): ${tname} (${target_addr}). 지시서는 보내지 않았습니다." >&2
	exit 2
fi
send_timeout_sec=$(( (rem_ms + 999) / 1000 ))
[ "$send_timeout_sec" -ge 1 ] || send_timeout_sec=1

send_pid=""
cleanup_send_bg() {
	if [ -n "${send_pid:-}" ]; then
		python3 -B -c 'import os,signal,sys,time
root_pid = int(sys.argv[1])
for sig in (signal.SIGTERM, signal.SIGKILL):
    try:
        os.killpg(root_pid, sig)
    except Exception:
        pass
    try:
        os.kill(root_pid, sig)
    except Exception:
        pass
    if sig == signal.SIGTERM:
        time.sleep(0.05)
' "$send_pid" 2>/dev/null || true
		wait "$send_pid" 2>/dev/null || true
		send_pid=""
	fi
	exec 3<&- || true
}
trap 'cleanup_send_bg' EXIT

send_raw=""
collect_send_slice() {
	local max_wait_ms="$1" chunk="" rc=0
	chunk="$(python3 -B -c 'import os,select,sys,time
deadline_ms = int(sys.argv[1])
max_wait_ms = int(sys.argv[2])
now_ms = int(time.monotonic() * 1000)
rem_ms = deadline_ms - now_ms
slice_end_ms = now_ms + (min(max_wait_ms, rem_ms) if rem_ms > 0 else 0)
os.set_blocking(3, False)
buf = bytearray()
eof = False
slice_expired = False
first_read = True
while True:
    while True:
        if not first_read:
            cur_ms = int(time.monotonic() * 1000)
            if cur_ms >= slice_end_ms or cur_ms >= deadline_ms:
                slice_expired = True
                break
        first_read = False
        try:
            c = os.read(3, 65536)
            if not c:
                eof = True
                break
            buf.extend(c)
        except BlockingIOError:
            break
        except Exception:
            eof = True
            break
        cur_ms = int(time.monotonic() * 1000)
        if cur_ms >= slice_end_ms or cur_ms >= deadline_ms:
            slice_expired = True
            break
    if eof or slice_expired:
        break
    cur_ms = int(time.monotonic() * 1000)
    if cur_ms >= deadline_ms:
        if not buf:
            r0, _, _ = select.select([3], [], [], 0.08)
            if r0:
                try:
                    c = os.read(3, 65536)
                    if not c:
                        eof = True
                    else:
                        buf.extend(c)
                except Exception:
                    pass
        break
    rem_slice_ms = min(slice_end_ms, deadline_ms) - cur_ms
    if rem_slice_ms <= 0:
        break
    r, _, _ = select.select([3], [], [], rem_slice_ms / 1000.0)
    if not r:
        break
if buf:
    sys.stdout.buffer.write(bytes(buf))
sys.stdout.buffer.write(b".")
sys.stdout.buffer.flush()
sys.exit(0 if eof else 1)
' "$deadline_ms" "$max_wait_ms" 2>/dev/null)" || rc=$?
	chunk="${chunk%.}"
	send_raw+="$chunk"
	return "$rc"
}

check_pre_expired() {
	if [[ "$send_raw" == *"__SEND_PRE_EXPIRED__"* ]]; then
		cleanup_send_bg
		core_redact "전송 전 timeout(미전송 만료, 시간 예산 소진): ${tname} (${target_addr}). 지시서는 보내지 않았습니다." >&2
		exit 2
	fi
}

hc_bin="${GJCH_HC_BIN:-hc}"
if [ "$no_wait" -eq 1 ]; then
	exec 3< <(exec python3 -B -c 'import os,subprocess,sys,time
try:
    os.setsid()
except Exception:
    pass
deadline_ms = int(sys.argv[1])
if deadline_ms - int(time.monotonic() * 1000) <= 0:
    sys.stdout.write("\n__SEND_PRE_EXPIRED__\n")
    sys.stdout.flush()
    sys.exit(0)
rc = subprocess.call(sys.argv[2:])
sys.stdout.write("\n__SEND_RC__:" + str(rc) + "\n")
sys.stdout.flush()
' "$deadline_ms" "$hc_bin" send --json --if idle "$target_addr" "$prompt" </dev/null 2>/dev/null)
else
	exec 3< <(exec python3 -B -c 'import os,subprocess,sys,time
try:
    os.setsid()
except Exception:
    pass
deadline_ms = int(sys.argv[1])
rem_ms = deadline_ms - int(time.monotonic() * 1000)
if rem_ms <= 0:
    sys.stdout.write("\n__SEND_PRE_EXPIRED__\n")
    sys.stdout.flush()
    sys.exit(0)
t_sec = str(max(1, (rem_ms + 999) // 1000))
cmd = [sys.argv[2], "send", "--json", "--if", "idle", "--wait", "--timeout", t_sec, sys.argv[3], sys.argv[4]]
rc = subprocess.call(cmd)
sys.stdout.write("\n__SEND_RC__:" + str(rc) + "\n")
sys.stdout.flush()
' "$deadline_ms" "$hc_bin" "$target_addr" "$prompt" </dev/null 2>/dev/null)
fi
send_pid=$!

# 짧은 초기 대기(최대 150ms, 잔여 예산 내) 동안 fd 3 EOF 및 로컬 send 종료까지 완료되지 않으면 watch_interval 주기로 core_get을 폴링해 blocked와 남은 예산을 감시하며 비차단 수집을 이어간다.
if ! collect_send_slice 150; then
	check_pre_expired
	while :; do
		now_ms="$(core_now_ms)"
		if [ "$((deadline_ms - now_ms))" -le 0 ]; then
			collect_send_slice 0 || true
			check_pre_expired
			cleanup_send_bg
			core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
			exit 2
		fi
		bg_info=""
		bg_rc=0
		bg_info="$(core_get "$target_addr" 2>/dev/null)" || bg_rc=$?
		if [ "$bg_rc" -eq 0 ] && [ -n "$bg_info" ]; then
			parse_get_info "$bg_info"
			bg_st="$G_ST_STATE"
			if [ "$bg_st" = "blocked" ]; then
				bg_kind="$G_ST_KIND"
				bg_len="$G_MSGLEN"
				cleanup_send_bg
				report_blocked_and_exit "${bg_kind:-null}" "${bg_len:-0}"
			fi
		fi
		now_ms="$(core_now_ms)"
		rem_ms=$((deadline_ms - now_ms))
		if [ "$rem_ms" -le 0 ]; then
			collect_send_slice 0 || true
			check_pre_expired
			cleanup_send_bg
			core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
			exit 2
		fi
		watch_iv_ms=$((watch_interval * 1000))
		if collect_send_slice "$watch_iv_ms"; then
			break
		fi
		check_pre_expired
		now_ms="$(core_now_ms)"
		if [ "$((deadline_ms - now_ms))" -le 0 ]; then
			collect_send_slice 0 || true
			check_pre_expired
			cleanup_send_bg
			core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
			exit 2
		fi
	done
fi

check_pre_expired
now_ms="$(core_now_ms)"
if [ "$((deadline_ms - now_ms))" -le 0 ]; then
	cleanup_send_bg
	core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
	exit 2
fi
cleanup_send_bg

send_rc=1
send_out=""
if [[ "$send_raw" == *$'\n__SEND_RC__:'* ]]; then
	send_rc="${send_raw##*$'\n__SEND_RC__:'}"
	send_rc="${send_rc%%$'\n'*}"
	send_out="${send_raw%$'\n__SEND_RC__:'*}"
elif [[ "$send_raw" == __SEND_RC__:* ]]; then
	send_rc="${send_raw#__SEND_RC__:}"
	send_rc="${send_rc%%$'\n'*}"
	send_out=""
fi

verdict="$(validate_send_result "$send_rc" "$send_out" "$no_wait" "$target_addr")"
v_tag="${verdict%%$'\t'*}"
v_detail="${verdict#*$'\t'}"

if [ "$no_wait" -eq 1 ]; then
	if [ "$v_tag" != "started_ok" ]; then
		fail "전송 시작 미확인(${v_detail}). 자동 재전송 없음."
	fi
	if post_nw_info="$(core_get "$target_addr" 2>/dev/null)" && [ -n "$post_nw_info" ]; then
		post_nw_st="$(core_json "$post_nw_info" "status.state" || true)"
		if [ "$post_nw_st" = "blocked" ]; then
			post_nw_kind="$(core_json "$post_nw_info" "status.kind" || true)"
			post_nw_len="$(core_json "$post_nw_info" "msglen" || true)"
			report_blocked_and_exit "${post_nw_kind:-null}" "${post_nw_len:-0}"
		fi
	fi
	now_ms="$(core_now_ms)"
	if [ "$((deadline_ms - now_ms))" -le 0 ]; then
		core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
		exit 2
	fi
	core_redact "전송 수락(started) 확인: ${tname} (${target_addr})"
	exit 0
fi

case "$v_tag" in
	err)
		fail "전송 또는 대기 미확인(${v_detail}). 자동 재전송 없음."
		;;
	blocked)
		report_blocked_and_exit "null" "0"
		;;
	done)
		# send --wait가 status=idle|done으로 끝났더라도 현재 상태가 blocked가 아닌지 한 번 더 확인한다.
		if post_info="$(core_get "$target_addr" 2>/dev/null)" && [ -n "$post_info" ]; then
			post_st="$(core_json "$post_info" "status.state" || true)"
			if [ "$post_st" = "blocked" ]; then
				post_kind="$(core_json "$post_info" "status.kind" || true)"
				post_len="$(core_json "$post_info" "msglen" || true)"
				report_blocked_and_exit "${post_kind:-null}" "${post_len:-0}"
			fi
		fi
		now_ms="$(core_now_ms)"
		if [ "$((deadline_ms - now_ms))" -le 0 ]; then
			core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
			exit 2
		fi
		;;
	continue)
		# 체크인(timeout·ended=false, message, children) 뒤에는 재전송 없이 deadline까지 완료를 기다린다.
		while :; do
			now_ms="$(core_now_ms)"
			if [ "$((deadline_ms - now_ms))" -le 0 ]; then
				core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
				exit 2
			fi
			c_info=""
			c_get_rc=0
			c_info="$(core_get "$target_addr")" || c_get_rc=$?
			now_ms="$(core_now_ms)"
			if [ "$((deadline_ms - now_ms))" -le 0 ]; then
				core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
				exit 2
			fi
			if [ "$c_get_rc" -ne 0 ] || [ -z "$c_info" ]; then
				fail '완료 대기 중 상태 확인 실패. 자동 재전송 없음.'
			fi
			parse_get_info "$c_info"
			c_state="$G_STATE"
			c_rep="$G_REPORTED"
			c_st="$G_ST_STATE"
			if [ "$c_state" != "live" ] || [ "$c_rep" != "true" ]; then
				fail "완료 대기 중 터미널 비정상(state=${c_state}, reported=${c_rep}). 자동 재전송 없음."
			fi
			case "$c_st" in
				idle|done)
					break
					;;
				blocked)
					c_kind="$G_ST_KIND"
					c_len="$G_MSGLEN"
					report_blocked_and_exit "${c_kind:-null}" "${c_len:-0}"
					;;
				error)
					fail '완료 대기 중 오류 상태(status=error). 자동 재전송 없음.'
					;;
				working)
					now_ms="$(core_now_ms)"
					rem_ms=$((deadline_ms - now_ms))
					if [ "$rem_ms" -le 0 ]; then
						core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
						exit 2
					fi
					watch_iv_ms=$((watch_interval * 1000))
					if [ "$rem_ms" -lt "$watch_iv_ms" ]; then
						python3 -B -c 'import sys,time; time.sleep(max(0, int(sys.argv[1])) / 1000.0)' "$rem_ms"
					else
						sleep "$watch_interval"
					fi
					;;
				*)
					fail "완료 대기 중 알 수 없는 상태(status=${c_st:-없음}). 자동 재전송 없음."
					;;
			esac
		done
		;;
	*)
		fail '전송 판정 실패. 자동 재전송 없음.'
		;;
esac

# --- 6. 완료 및 결과 파일 검증(--result) 및 저장소 상태 대조 ---
now_ms="$(core_now_ms)"
if [ "$((deadline_ms - now_ms))" -le 0 ]; then
	core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
	exit 2
fi
res_ok=1
if [ -n "$result_file" ]; then
	res_ok=0
	if result_written "$result_file" "$result_before"; then
		res_ok=1
	fi
fi
now_ms="$(core_now_ms)"
if [ "$((deadline_ms - now_ms))" -le 0 ]; then
	core_redact "timeout·완료 미확인: ${tname} (${target_addr}). 원격 작업은 중단하지 않았습니다." >&2
	exit 2
fi
core_redact "완료(idle/done) 확인: ${tname} (${target_addr})"
if [ -n "$result_file" ] && [ "$res_ok" -eq 1 ]; then
	core_redact "완료·결과 파일 확인: ${result_file}"
fi

repo_rc=0
repo_after=""
if [ "$repo_before_ok" -ne 1 ] || ! repo_after="$(capture_repo_state)"; then
	core_redact "저장소 상태 대조 불가 — 팀장이 확인" >&2
	repo_rc=6
elif [ "$repo_before" != "$repo_after" ]; then
	b_rest="$repo_before"
	a_rest="$repo_after"
	changed_labels=""
	for label in HEAD refs stash status; do
		b_part="${b_rest%%$'\036'*}"
		b_rest="${b_rest#*$'\036'}"
		a_part="${a_rest%%$'\036'*}"
		a_rest="${a_rest#*$'\036'}"
		if [ "$b_part" != "$a_part" ]; then
			changed_labels="${changed_labels:+$changed_labels }${label}"
		fi
	done
	[ -n "$changed_labels" ] || changed_labels="status"
	core_redact "저장소 상태 변경 감지: ${changed_labels} — 검토 중 팀장·다른 작업의 변경일 수 있음, 팀장이 확인" >&2
	repo_rc=6
fi

if [ -n "$result_file" ] && [ "$res_ok" -ne 1 ]; then
	core_redact "Codex가 idle로 돌아왔지만 결과 파일이 새로 쓰이지 않았습니다." >&2
	exit 4
fi
exit "$repo_rc"
