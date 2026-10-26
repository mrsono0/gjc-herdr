#!/usr/bin/env bash
# 구현 팀원(agy) 배정 감시: 결과 파일의 완료 줄과 화면의 확인창을 읽기 전용으로 함께 본다.
# 끝나는 조건 넷: 결과 파일 완료 줄 확인(DONE, rc 0) / 확인창 감지(DIALOG, rc 10) / working 뒤 결과 없이 멈춤(NO_RESULT, rc 11) / 시간 초과(TIMEOUT, rc 1).
# 확인창으로 끝났으면 처리한 뒤 같은 명령으로 다시 건다.
set -u

usage() {
	printf '사용법: %s <결과 파일> <완료 줄> [시간 상한 초, 기본 2700]\n' "$0" >&2
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
	usage
	exit 2
fi

result_file="$1"
done_line="$2"
timeout_sec="${3:-2700}"

if [ -z "$result_file" ] || [ -z "$done_line" ]; then
	usage
	exit 2
fi

case "$timeout_sec" in
	''|*[!0-9]*)
		usage
		exit 2
		;;
esac
if [ "${#timeout_sec}" -gt 5 ]; then
	usage
	exit 2
fi
timeout_sec=$((10#$timeout_sec))
if [ "$timeout_sec" -lt 1 ] || [ "$timeout_sec" -gt 86400 ]; then
	usage
	exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
case "$result_file" in
	/*) ;;
	*) result_file="$ROOT/$result_file" ;;
esac

mate_name="${GJCH_MATE_NAME:-gjc-herdr-mate}"
[ -n "$mate_name" ] || mate_name="gjc-herdr-mate"

interval="${GJCH_MATE_WATCH_INTERVAL:-20}"
case "$interval" in
	''|*[!0-9]*) interval=20 ;;
	*)
		if [ "${#interval}" -gt 4 ]; then
			interval=20
		else
			interval=$((10#$interval))
			if [ "$interval" -lt 1 ] || [ "$interval" -gt 3600 ]; then
				interval=20
			fi
		fi
		;;
esac

stall_sec="${GJCH_MATE_WATCH_STALL:-60}"
case "$stall_sec" in
	''|*[!0-9]*) stall_sec=60 ;;
	*)
		if [ "${#stall_sec}" -gt 4 ]; then
			stall_sec=60
		else
			stall_sec=$((10#$stall_sec))
			if [ "$stall_sec" -lt 1 ] || [ "$stall_sec" -gt 3600 ]; then
				stall_sec=60
			fi
		fi
		;;
esac

check_done_line() {
	if [ -f "$result_file" ] && grep -Fq -- "$done_line" "$result_file" 2>/dev/null; then
		printf 'DONE %s\n' "$(date '+%H:%M:%S')"
		exit 0
	fi
}

saw_working=0
stall_since=""
SECONDS=0
while [ "$SECONDS" -lt "$timeout_sec" ]; do
	check_done_line

	agent_status=""
	if agent_json="$(herdr agent get "$mate_name" 2>/dev/null)"; then
		agent_status="$(printf '%s' "$agent_json" | PYTHONDONTWRITEBYTECODE=1 python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
if not isinstance(d,dict) or isinstance(d.get("error"),dict): sys.exit(0)
a=(d.get("result") or {}).get("agent")
s=a.get("agent_status") if isinstance(a,dict) else None
if isinstance(s,str) and s.strip(): print(s.strip())' 2>/dev/null)" || agent_status=""
	fi
	case "$agent_status" in
		working)
			saw_working=1
			stall_since=""
			;;
		idle|done)
			if [ "$saw_working" -eq 1 ]; then
				if [ -z "$stall_since" ]; then
					stall_since="$SECONDS"
				elif [ "$((SECONDS - stall_since))" -ge "$stall_sec" ]; then
					check_done_line
					printf 'NO_RESULT %s %s\n' "$agent_status" "$(date '+%H:%M:%S')"
					exit 11
				fi
			fi
			;;
		*)
			stall_since=""
			;;
	esac

	dw_rc=0
	dw_out="$(PYTHONDONTWRITEBYTECODE=1 python3 "$ROOT/scripts/dialog-watch.py" --names "$mate_name" --once)" || dw_rc=$?
	if [ "$dw_rc" -eq 10 ]; then
		printf '%s %s\n' "$dw_out" "$(date '+%H:%M:%S')"
		exit 10
	fi

	if [ "$SECONDS" -ge "$timeout_sec" ]; then
		break
	fi
	rem=$((timeout_sec - SECONDS))
	sleep_sec="$interval"
	if [ "$rem" -lt "$sleep_sec" ]; then
		sleep_sec="$rem"
	fi
	sleep "$sleep_sec"
done

printf 'TIMEOUT\n'
exit 1
