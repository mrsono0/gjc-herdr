#!/usr/bin/env bash
# Codex 검토 전송: 저장소 루트의 검토 pane에서 새 대화 준비·전송 수락·완료를 관측한다.
# timeout·전송 불확실 뒤에는 재전송하지 않는다. 저장소 전후 비교·스냅숏은 만들지 않는다.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CRITIC_NAME="${GJCH_CRITIC_NAME:-gjc-herdr-critic}"
timeout=1800000 # 기본 30분, 준비 확인은 최대 30초
no_wait=0
brief=""
argument_count="$#"

usage() {
	printf '사용법: %s [--timeout <ms>] [--no-wait] <지시서 파일>\n' "$0"
}
fail() { echo "$*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
	case "$1" in
		--timeout) [ "$#" -ge 2 ] || fail '--timeout 값이 필요합니다.'; timeout="$2"; shift 2 ;;
		--no-wait) no_wait=1; shift ;;
		-h|--help) [ "$argument_count" -eq 1 ] || fail '도움말은 단독으로 사용합니다.'; usage; exit 0 ;;
		--) shift; [ "$#" -eq 1 ] || fail '지시서 파일 하나가 필요합니다.'; brief="$1"; shift ;;
		-*) usage >&2; exit 1 ;;
		*) [ -z "$brief" ] || fail '지시서 파일은 하나만 지정합니다.'; brief="$1"; shift ;;
	esac
done
command -v python3 >/dev/null || fail 'python3가 필요합니다.'
[ -n "$brief" ] && [ -r "$brief" ] && [ -f "$brief" ] || fail '읽을 수 있는 지시서 파일이 필요합니다.'
case "$timeout" in ''|*[!0-9]*) fail '--timeout은 양의 정수(ms)여야 합니다.' ;; esac
[ "${#timeout}" -le 9 ] || fail '--timeout은 1–86400000ms(24시간) 범위여야 합니다(최대 9자리).'
[ "$timeout" -gt 0 ] && [ "$timeout" -le 86400000 ] || fail '--timeout은 1–86400000ms(24시간) 범위여야 합니다.'
# bash 3.2의 SECONDS 해상도에 맞춰 ms 인자를 초 단위로 올림한다.
timeout=$(( (10#$timeout + 999) / 1000 * 1000 ))
[ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_WORKSPACE_ID:-}" ] && [ -n "${HERDR_PANE_ID:-}" ] || fail 'Herdr workspace 안에서 실행합니다.'
command -v herdr >/dev/null || fail 'herdr가 필요합니다.'

jget() {
	python3 -c 'import json,sys
try: value=json.load(sys.stdin)
except ValueError: sys.exit(1)
for key in sys.argv[1].split("."):
    value=value.get(key) if isinstance(value,dict) else None
print("" if value is None else value)' "$1"
}
# command substitution도 같은 bash 시작 시각을 상속한다(별도 Python clock을 쓰지 않음).
now_ms() { printf '%s\n' "$((SECONDS * 1000))"; }

# 마지막 입력란이 빈 placeholder인 경우만 허용한다(이전 대화의 echo와 구별).
screen_matches() { # 화면, empty|readable|fresh|typing|new|worktree_menu|worktree
	printf '%s' "$1" | python3 -c 'import re,sys
raw=sys.stdin.read()
# src/input.ts와 같은 SGR 0·2·22 및 색상 인자 처리. 글자별 dim 상태를 보존한다.
parts=[]
dim_chars=[]
dim=False
end=0
for match in re.finditer(r"\x1b\[([0-9;:]*)m",raw):
    text=raw[end:match.start()]
    parts.append(text)
    dim_chars.extend([dim]*len(text))
    end=match.end()
    params=match.group(1).split(";")
    i=0
    while i<len(params):
        param=params[i]
        code=int(param.split(":",1)[0] or "0")
        if code in (38,48):
            if ":" in param:
                color=param.split(":")
                if not ((len(color)==3 and color[1]=="5") or (len(color) in (5,6) and color[1]=="2")):
                    sys.exit(1)
                values=color[-1:] if color[1]=="5" else color[-3:]
            else:
                mode=params[i+1] if i+1<len(params) else ""
                count=2 if mode=="5" else 4 if mode=="2" else 0
                if not count or i+count>=len(params): sys.exit(1)
                values=params[i+2:i+count+1]
                i+=count
            if not all(value.isdecimal() and 0<=int(value)<=255 for value in values): sys.exit(1)
        elif code==0: dim=False
        elif code==2: dim=True
        elif code==22: dim=False
        i+=1
text=raw[end:]
parts.append(text)
dim_chars.extend([dim]*len(text))
s="".join(parts)
# 잘린 SGR이나 다른 escape는 흐림 상태를 해석할 수 없으므로 거부한다.
if "\x1b" in s: sys.exit(1)
# 들여쓴 ›는 이어지는 draft 내용일 수 있으므로 0번째 칸만 후보로 본다.
prompts=list(re.finditer(r"(?m)^›([^\n]*)$",s))
last=prompts[-1].group(1).strip() if prompts else None
start=prompts[-1].start(1)+len(prompts[-1].group(1))-len(prompts[-1].group(1).lstrip()) if prompts else 0
empty=last=="Ask Codex to do anything" and all(dim_chars[start:start+len(last)])
footer=[line.strip() for line in s[prompts[-1].end():].splitlines() if line.strip()] if prompts else []
hints=("← for agents · ? for shortcuts","? for shortcuts")
hint_line=footer[1] if len(footer)==2 else ""
warning=re.search(r"(?:^|[ \t]+)(⚠.*)$",hint_line)
warning_ok=False
if warning:
    badge=warning.group(1)
    badge=badge[:-1].rstrip() if badge.endswith("…") else badge
    count=re.match(r"⚠ ([0-9]+)",badge)
    warning_ok=badge=="⚠" or (bool(count) and any(
        ("⚠ "+count.group(1)+" "+word+" · f2 to view").startswith(badge) for word in ("warning","warnings")))
    hint_line=hint_line[:warning.start()].rstrip()
hint_prefix=hint_line[:-1].rstrip() if hint_line.endswith("…") else hint_line
guide_ok=bool(hint_prefix) and any(hint.startswith(hint_prefix) for hint in hints)
hint_ok=len(footer)==1 or (len(footer)==2 and (guide_ok or (bool(warning) and not hint_prefix)) and (not warning or warning_ok))
status=re.fullmatch(r".* · Context (\d+)% left · (\d+(?:\.\d+)?[KM]?) in( ·.*| …|…)?",footer[0]) if footer else None
tail=(status.group(3) or "") if status else ""
output=re.fullmatch(r" · (\d+(?:\.\d+)?[KM]?) out",tail)
clipped=re.fullmatch(r"(?: ·(?: ?…| \d+(?:\.\d*)?[KM]?(?: (?:o|ou|out)?)?…)| …|…)",tail)
readable=bool(last) and hint_ok and bool(status) and (not tail or bool(clipped) or bool(output))
# 누적 입력 0으로 이전 대화와 구별한다. 헤더·잘린 출력 카운터에 의존하지 않는다.
fresh=empty and readable and status.group(1)=="100" and status.group(2)=="0" and (not output or output.group(1)=="0")
typing=last is not None and last!="" and not empty
new=last=="/new"
# 화면 최하단 블록만 메뉴로 본다: 마지막 비지 않은 줄이 안내 줄이고, 그 위 가장 가까운 질문 줄과
# 안내 줄 사이에 0번째 칸 › 선택 줄이 정확히 하나 있어야 한다(옛 화면·draft와 구별).
rows=[line.rstrip(" \t\r") for line in s.split("\n")]
filled=[i for i,line in enumerate(rows) if line.strip()]
hint_at=filled[-1] if filled and rows[filled[-1]].strip()=="enter select · esc back" else None
ask_at=next((i for i in range(hint_at-1,-1,-1) if rows[i].strip()=="Where should the new conversation run?"),None) if hint_at is not None else None
picks=[rows[i] for i in range(ask_at+1,hint_at) if rows[i].startswith("›")] if ask_at is not None else []
worktree_menu=ask_at is not None and len(picks)==1
worktree=worktree_menu and bool(re.match(r"› 1\. Use current Git worktree(?:[ \t]|$)",picks[0]))
sys.exit(0 if {"empty":empty,"readable":readable,"fresh":fresh,"typing":typing,"new":new,"worktree_menu":worktree_menu,"worktree":worktree}[sys.argv[1]] else 1)' "$2"
}

screen_size_failure() {
	local details dimensions
	[ -z "${1:-}" ] || printf '%s\n' "$1" >&2
	details="$(herdr pane layout --pane "$pane" | python3 -c 'import json,sys
p=next(p for p in json.load(sys.stdin)["result"]["layout"]["panes"] if p["pane_id"]==sys.argv[1])
w,h=p["rect"]["width"],p["rect"]["height"]
print(str(w)+"×"+str(h)+(" small" if w<56 or h<10 else " format"))' "$pane")" || details='확인 불가 format'
	dimensions="${details% *}"
	if [ "${details##* }" = small ]; then
		fail "pane이 작습니다(현재 $dimensions). 이 환경에서 확인한 56×10 이상으로 키우세요(모델 이름에 따라 폭 추가 필요). draft는 자동 삭제하지 않습니다. 지시서는 보내지 않았습니다."
	fi
	printf '상태 줄·안내 줄 형식을 판정할 수 없습니다(pane %s). 마지막 화면 6줄:\n' "$dimensions" >&2
	printf '%s' "${screen:-}" | python3 -c 'import sys; print("\n".join(sys.stdin.read().splitlines()[-6:]))' >&2
	fail '빈 placeholder와 현재 상태 줄·알려진 안내 줄 형식을 확인하세요. draft는 자동 삭제하지 않습니다. 지시서는 보내지 않았습니다.'
}

# 전송 시도 뒤 어느 실패 경로로 중단해도 같은 복구 안내를 남긴다.
delivery_followup() {
	if [ "$1" -ne 0 ] && [ -n "$delivery_kind" ]; then
		echo "$delivery_kind 전송을 이미 시도했습니다(전송됨/결과 불확실). 자동 재전송·/new 재입력 금지. 원격 작업은 계속될 수 있습니다." >&2
	fi
}

# 이름·workspace·Codex 종류·저장소 루트·terminal identity가 같은 소유 pane만 사용한다.
validate_agent() { # JSON, 입력 예정 여부, 이름 유지 필요 여부
	printf '%s' "$1" | python3 -c 'import json,os,sys
ws,caller,root,expected_pane,terminal,name,send,require_name=sys.argv[1:]
a=json.load(sys.stdin).get("result",{}).get("agent",{})
valid=(a.get("workspace_id")==ws and a.get("pane_id")!=caller and a.get("agent")=="codex"
       and os.path.realpath(a.get("foreground_cwd") or a.get("cwd") or "")==root
       and (not expected_pane or a.get("pane_id")==expected_pane)
       and (not terminal or a.get("terminal_id")==terminal)
       and a.get("name") in (None,"",name))
if require_name=="1": valid=valid and a.get("name")==name
if send=="1": valid=valid and a.get("focused") is False and a.get("agent_status") in ("idle","done") and a.get("interactive_ready") is True
if not valid:
    print("대상 거부: 소유 Codex·workspace·이름·입력 준비·비포커스 조건을 확인하세요. 상태="+str(a.get("agent_status"))+", focused="+str(a.get("focused")),file=sys.stderr)
    sys.exit(1)' "${HERDR_WORKSPACE_ID:-}" "${HERDR_PANE_ID:-}" "$ROOT" "${pane:-}" "${terminal:-}" "$CRITIC_NAME" "$2" "$3"
}
agent="$(herdr agent get "$CRITIC_NAME")" || fail '검토 agent 이름을 확인하지 못했습니다.'
validate_agent "$agent" 1 1 || exit 1
pane="$(printf '%s' "$agent" | jget result.agent.pane_id)"
terminal="$(printf '%s' "$agent" | jget result.agent.terminal_id)"
[ -n "$pane" ] && [ -n "$terminal" ] || fail 'pane·terminal identity가 없습니다.'
prompt="$(python3 -c 'import sys; text=open(sys.argv[1],encoding="utf-8").read(); assert text.strip(), "빈 지시서"; print(text,end="")' "$brief")" || fail 'UTF-8 지시서 내용을 읽지 못했습니다.'

deadline=$(( $(now_ms) + timeout ))
ready_deadline=$(( $(now_ms) + 30000 ))
[ "$ready_deadline" -le "$deadline" ] || ready_deadline="$deadline"
# 입력 직전에 다시 확인한다. 이후의 focus/occupant 변경과 입력은 원자적이지 않다.
agent="$(herdr agent get "$CRITIC_NAME")" || fail '새 대화 전 대상 확인 실패.'
validate_agent "$agent" 1 1 || exit 1
screen="$(herdr pane read "$pane" --source visible --format ansi)" || fail '전송 전 입력란 확인 실패.'
screen_matches "$screen" empty || screen_size_failure '입력란에 draft가 있거나 흐린 placeholder를 확인할 수 없습니다.'
screen_matches "$screen" readable || screen_size_failure
delivery_kind=""
trap 'delivery_followup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if screen_matches "$screen" fresh; then
	echo '이미 빈 새 대화입니다. /new 전송 생략.'
else
	revision="$(printf '%s' "$agent" | jget result.agent.revision)"
	sequence="$(printf '%s' "$agent" | jget result.agent.state_change_seq)"
	[ -n "$revision" ] && [ -n "$sequence" ] || fail '새 대화 준비 관측용 revision·상태 seq가 없습니다.'
	delivery_kind='/new'
	herdr pane send-text "$pane" '/new' || { echo '/new 입력 결과가 불확실합니다.' >&2; exit 2; }
	# 입력 반영을 관측한 뒤 Enter 한 번만 보낸다. 전체 준비/대기 한도도 넘기지 않는다.
	new_text_deadline=$(( $(now_ms) + 5000 ))
	[ "$new_text_deadline" -le "$ready_deadline" ] || new_text_deadline="$ready_deadline"
	while :; do
		[ "$(now_ms)" -lt "$new_text_deadline" ] || { echo '/new 입력 반영 확인 timeout. Enter와 지시서는 보내지 않았습니다.' >&2; exit 2; }
		agent="$(herdr agent get "$pane")" || fail 'Enter 전 대상 확인 실패.'
		validate_agent "$agent" 1 1 || exit 1
		screen="$(herdr pane read "$pane" --source visible --format ansi)" || fail 'Enter 전 /new 입력란 확인 실패.'
		if screen_matches "$screen" new; then break; fi
		if screen_matches "$screen" typing; then
			echo 'Enter 전 입력란에 /new와 다른 글이 있습니다. Enter와 지시서는 보내지 않았습니다.' >&2
			exit 2
		fi
		sleep 1
	done
	[ "$(now_ms)" -lt "$new_text_deadline" ] || { echo '/new 입력 반영 확인 timeout. Enter와 지시서는 보내지 않았습니다.' >&2; exit 2; }
	herdr pane send-keys "$pane" enter || { echo '/new 제출 결과가 불확실합니다.' >&2; exit 2; }
	echo '/new·Enter 전송 요청 완료. 새 입력란 준비를 확인합니다.'

# 기존 대화에서만 /new를 보낸다. 이전 화면과 다른 새 빈 화면과 상태를 함께 확인한다.
draft_reads=0
worktree_enter_sent=0
while :; do
	if [ "$(now_ms)" -ge "$ready_deadline" ]; then
		screen_matches "$screen" readable || screen_size_failure
		fail '새 입력란 준비 확인 timeout. 지시서는 보내지 않았습니다.'
	fi
	agent="$(herdr agent get "$pane")" || fail '새 입력란 상태 확인 실패. 지시서는 보내지 않았습니다.'
	validate_agent "$agent" 0 1 || exit 1
	focused="$(printf '%s' "$agent" | jget result.agent.focused)"
	[ "$focused" = False ] || fail 'pane에 focus가 생겨 지시서를 보내지 않았습니다.'
	status="$(printf '%s' "$agent" | jget result.agent.agent_status)"
	case "$status" in blocked|unknown) fail "새 입력란 상태=$status. 지시서를 보내지 않았습니다." ;; esac
	screen="$(herdr pane read "$pane" --source visible --format ansi)" || fail '새 대화 화면 확인 실패.'
	# Git worktree 메뉴는 현재 폴더 선택에만 Enter를 한 번 허용한다.
	if screen_matches "$screen" worktree_menu; then
		# Enter 직후의 과도 화면을 감안해 1초 간격 세 관측 동안 메뉴가 남을 때만 중단한다.
		if [ "$worktree_enter_sent" -ne 0 ]; then
			worktree_enter_sent=$((worktree_enter_sent + 1))
			[ "$worktree_enter_sent" -le 3 ] || { echo '/new 뒤 worktree 메뉴가 계속 남았습니다. 지시서는 보내지 않았습니다. 자동 Esc·Enter 재전송 없음.' >&2; exit 2; }
			sleep 1
			continue
		fi
		screen_matches "$screen" worktree || { echo '/new 뒤 worktree 메뉴의 선택이 1번(현재 worktree)이 아닙니다. 지시서는 보내지 않았습니다. 자동 Esc·Enter 없음.' >&2; exit 2; }
		agent="$(herdr agent get "$pane")" || fail 'worktree 선택 전 대상 확인 실패. 지시서는 보내지 않았습니다.'
		validate_agent "$agent" 1 1 || exit 1
		[ "$(now_ms)" -lt "$ready_deadline" ] || fail '새 입력란 준비 확인 timeout. 지시서는 보내지 않았습니다.'
		worktree_enter_sent=1
		herdr pane send-keys "$pane" enter || { echo 'worktree 선택 Enter 결과가 불확실합니다. 지시서는 보내지 않았습니다.' >&2; exit 2; }
		draft_reads=0
		sleep 1
		continue
	fi
	# 한 번의 과도 화면만으로 단정하지 않고 1초 간격 두 관측에서 글이 남으면 중단한다.
	if screen_matches "$screen" typing; then
		draft_reads=$((draft_reads + 1))
		[ "$draft_reads" -lt 2 ] || { echo '/new 뒤 입력란에 미제출 글이 남았습니다. 지시서는 보내지 않았습니다. 자동 Enter 재전송·삭제 없음.' >&2; exit 2; }
	else
		draft_reads=0
	fi
	if printf '%s' "$agent" | python3 -c 'import json,sys
a=json.load(sys.stdin)["result"]["agent"]
changed=str(a.get("revision"))!=sys.argv[1] or str(a.get("state_change_seq"))!=sys.argv[2]
sys.exit(0 if changed and a.get("agent_status") in ("idle","done") and a.get("interactive_ready") is True else 1)' "$revision" "$sequence" \
		&& screen_matches "$screen" fresh; then
		observed_ms="$(now_ms)"
		[ "$observed_ms" -lt "$ready_deadline" ] && [ "$observed_ms" -lt "$deadline" ] || fail '새 입력란 준비 확인 timeout. 지시서는 보내지 않았습니다.'
		break
	fi
	sleep 1
done
fi
agent="$(herdr agent get "$CRITIC_NAME")" || fail '전송 직전 이름 확인 실패.'
validate_agent "$agent" 1 1 || exit 1
screen="$(herdr pane read "$pane" --source visible --format ansi)" || fail '전송 직전 입력란 확인 실패.'
screen_matches "$screen" readable || screen_size_failure
screen_matches "$screen" fresh || fail '전송 직전 새 입력란이 더 이상 비어 있지 않거나 준비되지 않았습니다. 지시서는 보내지 않았습니다.'
# 최종 관측이 늦게 반환된 경우도 준비 한도를 다시 확인한다.
observed_ms="$(now_ms)"
[ "$observed_ms" -lt "$ready_deadline" ] || fail '새 입력란 준비 확인 timeout. 지시서는 보내지 않았습니다.'
remaining=$(( deadline - observed_ms ))
[ "$remaining" -gt 0 ] || fail '전송 전 timeout. 지시서는 보내지 않았습니다.'
accept_timeout=10000
[ "$accept_timeout" -le "$remaining" ] || accept_timeout="$remaining"
# --until working으로 수락을 관측한다. timeout/stalled는 미전달 증거가 아니다.
delivery_kind='지시서'
if ! herdr agent prompt "$pane" "$prompt" --wait --until working --timeout "$accept_timeout"; then
	echo '전송 결과가 불확실하거나 거부됐습니다. 자동 재전송·/new 재입력 없음. 공개 상태와 결과 파일부터 확인하세요.' >&2
	herdr agent get "$pane" || true
	exit 2
fi

# 첫 전송 후 이름이 풀릴 수 있다. 다른 pane의 이름은 빼앗지 않는다.
agent="$(herdr agent get "$pane")" || fail '전송 뒤 pane 확인 실패.'
validate_agent "$agent" 0 0 || exit 1
if named="$(herdr agent get "$CRITIC_NAME")"; then
	[ "$(printf '%s' "$named" | jget result.agent.pane_id)" = "$pane" ] || fail '전송 뒤 이름이 다른 pane을 가리킵니다. 이름을 변경하지 않습니다.'
else
	herdr agent rename "$pane" "$CRITIC_NAME" || fail '전송 뒤 이름 재등록 실패.'
fi
named="$(herdr agent get "$CRITIC_NAME")" || fail '전송 뒤 이름 확인 실패.'
validate_agent "$named" 0 0 || exit 1
echo "전송 수락(working) 확인: $CRITIC_NAME ($pane)"
[ "$no_wait" -eq 0 ] || { echo '완료 대기 생략. 공개 상태와 결과 파일에서 완료 여부를 확인하세요.'; exit 0; }
while :; do
	agent="$(herdr agent get "$pane")" || fail '완료 상태 확인 실패. 공개 상태와 결과 파일을 확인하세요.'
	validate_agent "$agent" 0 0 || exit 1
	status="$(printf '%s' "$agent" | jget result.agent.agent_status)"
	# 완료를 관측하면 늦게 반환됐어도 인정한다. 아직 미완료일 때만 아래 한도를 적용한다.
	case "$status" in
		idle|done) break ;;
		blocked|unknown) fail "완료 대기 중 상태=$status. 대화상자에 응답하지 않습니다." ;;
	esac
	[ "$(now_ms)" -lt "$deadline" ] || { echo '완료 대기 timeout. 원격 작업은 중단하지 않았습니다. 공개 상태와 결과 파일을 확인하세요.' >&2; exit 2; }
	sleep 1
done
echo "완료(idle/done) 확인: $CRITIC_NAME ($pane)"
exit 0
