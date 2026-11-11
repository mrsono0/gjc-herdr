#!/usr/bin/env bash
# Core(hc) 구현 팀원(agy) 배정 감시: 결과 파일의 완료 줄과 hc get --json 상태를 읽기 전용으로 감시한다.
# 화면 읽기(hc read/attach)나 변경 명령은 절대 실행하지 않는다.
# 종료 코드: DONE(0) / TIMEOUT(1) / 인자·가드 오류(2) / DIALOG(10) / NO_RESULT(11) / UNKNOWN(12).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=scripts/core-lib.sh
. "$ROOT/scripts/core-lib.sh"

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

core_guard "mate-watch" || exit $?
if [ "$CORE_GUARD_PASSED" != 1 ]; then
	printf 'Core 외부 팀장(GJCH_CORE=1, GJCH_EXTERNAL_LEAD=1, 저장소 안, 팀원 역할 아님)에서 실행하세요.\n' >&2
	exit 2
fi

case "$result_file" in
	/*) ;;
	*) result_file="$ROOT/$result_file" ;;
esac

interval="${GJCH_MATE_WATCH_INTERVAL:-3}"
case "$interval" in
	''|*[!0-9]*) interval=3 ;;
	*)
		if [ "${#interval}" -gt 4 ]; then
			interval=3
		else
			interval=$((10#$interval))
			if [ "$interval" -lt 1 ] || [ "$interval" -gt 3600 ]; then
				interval=3
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

check_done_line

addr=""
find_rc=0
addr="$(core_find mate)" || find_rc=$?
if [ "$find_rc" -eq 1 ]; then
	core_redact "UNKNOWN mate 없음"
	exit 12
fi
if [ "$find_rc" -eq 2 ]; then
	core_redact "UNKNOWN mate 라벨 중복(2개 이상)"
	exit 12
fi
if [ "$find_rc" -ne 0 ] || [ -z "$addr" ]; then
	core_redact "UNKNOWN mate ls 조회 실패"
	exit 12
fi

saw_working=0
stall_since=""
fail_count=0
SECONDS=0

while [ "$SECONDS" -lt "$timeout_sec" ]; do
	check_done_line

	info=""
	get_rc=0
	info="$(core_get "$addr")" || get_rc=$?
	if [ "$get_rc" -ne 0 ] || [ -z "$info" ]; then
		fail_count=$((fail_count + 1))
		stall_since=""
		if [ "$fail_count" -ge 5 ]; then
			core_redact "UNKNOWN mate get 조회 연속 실패(${fail_count}회)"
			exit 12
		fi
	else
		fail_count=0
		t_state="$(core_json "$info" "state" || true)"
		reported="$(core_json "$info" "reported" || true)"
		st_state="$(core_json "$info" "status.state" || true)"
		st_kind="$(core_json "$info" "status.kind" || true)"
		msglen="$(core_json "$info" "msglen" || true)"
		[ -n "$st_kind" ] || st_kind="null"
		[ -n "$msglen" ] || msglen="0"

		if [ "$t_state" = "finished" ]; then
			core_redact "UNKNOWN mate state=finished"
			exit 12
		fi
		if [ "$t_state" != "live" ]; then
			core_redact "UNKNOWN mate state=other"
			exit 12
		fi
		if [ "$reported" = "false" ]; then
			core_redact "UNKNOWN mate 미보고(reported=false)"
			exit 12
		fi
		if [ "$reported" != "true" ]; then
			core_redact "UNKNOWN mate 미보고(reported=unknown)"
			exit 12
		fi

		case "$st_state" in
			blocked)
				core_redact "DIALOG mate ${st_kind} msglen=${msglen}"
				exit 10
				;;
			working)
				saw_working=1
				stall_since=""
				;;
			idle|done)
				check_done_line
				if [ "$saw_working" -eq 1 ]; then
					if [ -z "$stall_since" ]; then
						stall_since="$SECONDS"
					elif [ "$((SECONDS - stall_since))" -ge "$stall_sec" ]; then
						check_done_line
						core_redact "NO_RESULT ${st_state} $(date '+%H:%M:%S')"
						exit 11
					fi
				fi
				;;
			*)
				stall_since=""
				;;
		esac
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
