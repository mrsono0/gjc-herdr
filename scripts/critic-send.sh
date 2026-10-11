#!/usr/bin/env bash
# Codex 검토 전송: 새 대화 준비를 관측하고, 작업 전후 저장소 상태를 비교한다.
# timeout·전송 불확실 뒤에는 재전송하지 않는다. 스냅숏은 /tmp에 남긴다.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CRITIC_NAME="${GJCH_CRITIC_NAME:-gjc-herdr-critic}"
WORKDIR="${GJCH_CODEX_WORKDIR:-$(dirname "$ROOT")/$(basename "$ROOT")-codex-work}"
timeout=1800000 # 기본 30분, 준비 확인은 최대 30초
no_wait=0
compare=""
brief=""
argument_count="$#"

usage() {
	printf '사용법: %s [--timeout <ms>] [--no-wait] <지시서 파일>\n       %s --compare <스냅숏 파일>\n' "$0" "$0"
}
fail() { echo "$*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
	case "$1" in
		--timeout) [ "$#" -ge 2 ] || fail '--timeout 값이 필요합니다.'; timeout="$2"; shift 2 ;;
		--no-wait) no_wait=1; shift ;;
		--compare) [ "$#" -ge 2 ] || fail '--compare 파일이 필요합니다.'; compare="$2"; shift 2 ;;
		-h|--help) [ "$argument_count" -eq 1 ] || fail '도움말은 단독으로 사용합니다.'; usage; exit 0 ;;
		--) shift; [ "$#" -eq 1 ] || fail '지시서 파일 하나가 필요합니다.'; brief="$1"; shift ;;
		-*) usage >&2; exit 1 ;;
		*) [ -z "$brief" ] || fail '지시서 파일은 하나만 지정합니다.'; brief="$1"; shift ;;
	esac
done
command -v python3 >/dev/null || fail 'python3가 필요합니다.'
command -v git >/dev/null || fail 'git이 필요합니다.'

# status 문자열만으로는 이미 수정된 파일의 추가 수정을 볼 수 없으므로 내용·index도 비교한다.
# gitignore된 untracked 경로는 제외한다. 파일 내용 자체는 저장하지 않는다.
git_state() {
	python3 - "$ROOT" "$1" "$2" <<'PY'
import difflib, hashlib, json, os, stat, subprocess, sys
root, mode, path = sys.argv[1:]
def git(*args):
    return subprocess.check_output(["git", "-C", root, *args])
try:
    files = {}
    for raw in sorted(set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0")) - {b""}):
        name = os.fsdecode(raw)
        full = os.path.join(root, name)
        try:
            info = os.lstat(full)
        except FileNotFoundError:
            files[name] = {"missing": True}
            continue
        item = {"mode": stat.S_IMODE(info.st_mode)}
        if stat.S_ISLNK(info.st_mode):
            item["link"] = os.readlink(full)
        elif stat.S_ISREG(info.st_mode):
            digest = hashlib.sha256()
            with open(full, "rb") as source:
                for chunk in iter(lambda: source.read(65536), b""):
                    digest.update(chunk)
            item["sha256"] = digest.hexdigest()
        else:
            item["type"] = stat.S_IFMT(info.st_mode)
        files[name] = item
    head_ref = subprocess.run(["git", "-C", root, "symbolic-ref", "-q", "HEAD"], stdout=subprocess.PIPE)
    if head_ref.returncode not in (0, 1):
        head_ref.check_returncode()
    state = {
        "root": root,
        "HEAD": git("rev-parse", "HEAD").decode().strip(),
        "HEAD_symbolic": head_ref.stdout.decode().strip() if head_ref.returncode == 0 else "",
        "refs": git("for-each-ref").decode(),
        "stash": git("stash", "list").decode(),
        "status": os.fsdecode(git("status", "--porcelain=v1", "--untracked-files=all", "-z")),
        "index": os.fsdecode(git("ls-files", "--stage", "-z")),
        "files": files,
    }
    if mode == "save":
        with open(path, "w", encoding="utf-8") as target:
            json.dump(state, target, ensure_ascii=False, indent=2, sort_keys=True)
            target.write("\n")
    else:
        with open(path, encoding="utf-8") as source:
            before = json.load(source)
        if before.get("root") != root:
            raise ValueError("스냅숏의 저장소 루트가 다릅니다.")
        if before != state:
            print("Codex 작업 중 저장소 상태가 바뀜, 확인 필요 (변경 주체는 판정하지 않음).")
            lines = lambda obj: json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True).splitlines(True)
            sys.stdout.writelines(difflib.unified_diff(lines(before), lines(state), fromfile="작업 전", tofile="현재"))
            print()
            sys.exit(3)
        print("저장소 상태 변화 없음 (gitignore된 untracked 경로는 비교하지 않음).")
except (OSError, ValueError, subprocess.CalledProcessError) as error:
    print(f"저장소 상태 확인 실패: {error}", file=sys.stderr)
    sys.exit(1)
PY
}
if [ -n "$compare" ]; then
	[ "$argument_count" -eq 2 ] || fail '--compare는 다른 옵션 없이 단독으로 사용합니다.'
	git_state compare "$compare"
	exit 0
fi
[ -n "$brief" ] && [ -r "$brief" ] && [ -f "$brief" ] || fail '읽을 수 있는 지시서 파일이 필요합니다.'
case "$timeout" in ''|*[!0-9]*) fail '--timeout은 양의 정수(ms)여야 합니다.' ;; esac
[ "$timeout" -gt 0 ] || fail '--timeout은 양의 정수(ms)여야 합니다.'
[ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_WORKSPACE_ID:-}" ] && [ -n "${HERDR_PANE_ID:-}" ] || fail 'Herdr workspace 안에서 실행합니다.'
command -v herdr >/dev/null || fail 'herdr가 필요합니다.'
WORKDIR="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$WORKDIR")"

jget() {
	python3 -c 'import json,sys
try: value=json.load(sys.stdin)
except ValueError: sys.exit(1)
for key in sys.argv[1].split("."):
    value=value.get(key) if isinstance(value,dict) else None
print("" if value is None else value)' "$1"
}
now_ms() { python3 -c 'import time; print(time.monotonic_ns() // 1000000)'; }

# 마지막 입력란이 빈 placeholder인 경우만 허용한다(이전 대화의 echo와 구별).
screen_matches() { # 화면, empty|fresh
	printf '%s' "$1" | python3 -c 'import re,sys
s=sys.stdin.read()
prompts=re.findall(r"(?m)^\s*› ([^\n]*)$",s)
empty=bool(prompts) and prompts[-1].strip()=="Ask Codex to do anything"
fresh=empty and "OpenAI Codex" in s and "Context 100% left" in s and "0 in · 0 out" in s
sys.exit(0 if (empty if sys.argv[1]=="empty" else fresh) else 1)' "$2"
}

# 전송 시도 뒤 어느 실패 경로로 중단해도 같은 복구 안내를 남긴다.
delivery_followup() {
	# rc 3은 완료 뒤 비교 결과이므로 안내하지 않는다.
	if [ "$1" -ne 0 ] && [ "$1" -ne 3 ] && [ -n "$delivery_kind" ]; then
		echo "$delivery_kind 전송을 이미 시도했습니다(전송됨/결과 불확실). 자동 재전송·/new 재입력 금지. 원격 작업은 계속될 수 있습니다." >&2
		printf '공개 상태·완료 확인 뒤 비교: %q --compare %q\n' "$0" "$snapshot" >&2
	fi
}

# 이름·workspace·Codex 종류·작업 폴더·terminal identity가 같은 소유 pane만 사용한다.
validate_agent() { # JSON, 입력 예정 여부, 이름 유지 필요 여부
	printf '%s' "$1" | python3 -c 'import json,os,sys
ws,caller,workdir,expected_pane,terminal,name,send,require_name=sys.argv[1:]
a=json.load(sys.stdin).get("result",{}).get("agent",{})
valid=(a.get("workspace_id")==ws and a.get("pane_id")!=caller and a.get("agent")=="codex"
       and os.path.realpath(a.get("foreground_cwd") or a.get("cwd") or "")==workdir
       and (not expected_pane or a.get("pane_id")==expected_pane)
       and (not terminal or a.get("terminal_id")==terminal)
       and a.get("name") in (None,"",name))
if require_name=="1": valid=valid and a.get("name")==name
if send=="1": valid=valid and a.get("focused") is False and a.get("agent_status") in ("idle","done") and a.get("interactive_ready") is True
if not valid:
    print("대상 거부: 소유 Codex·workspace·이름·입력 준비·비포커스 조건을 확인하세요. 상태="+str(a.get("agent_status"))+", focused="+str(a.get("focused")),file=sys.stderr)
    sys.exit(1)' "${HERDR_WORKSPACE_ID:-}" "${HERDR_PANE_ID:-}" "$WORKDIR" "${pane:-}" "${terminal:-}" "$CRITIC_NAME" "$2" "$3"
}
agent="$(herdr agent get "$CRITIC_NAME")" || fail '검토 agent 이름을 확인하지 못했습니다.'
validate_agent "$agent" 1 1 || exit 1
pane="$(printf '%s' "$agent" | jget result.agent.pane_id)"
terminal="$(printf '%s' "$agent" | jget result.agent.terminal_id)"
[ -n "$pane" ] && [ -n "$terminal" ] || fail 'pane·terminal identity가 없습니다.'
prompt="$(python3 -c 'import sys; text=open(sys.argv[1],encoding="utf-8").read(); assert text.strip(), "빈 지시서"; print(text,end="")' "$brief")" || fail 'UTF-8 지시서 내용을 읽지 못했습니다.'

snapshot="$(mktemp /tmp/gjch-critic-state.XXXXXX)"
git_state save "$snapshot"
printf '저장소 스냅숏: %s\n나중 비교: %q --compare %q\n' "$snapshot" "$0" "$snapshot"
deadline=$(( $(now_ms) + timeout ))
ready_deadline=$(( $(now_ms) + 30000 ))
[ "$ready_deadline" -le "$deadline" ] || ready_deadline="$deadline"
# 입력 직전에 다시 확인한다. 이후의 focus/occupant 변경과 입력은 원자적이지 않다.
agent="$(herdr agent get "$CRITIC_NAME")" || fail '새 대화 전 대상 확인 실패.'
validate_agent "$agent" 1 1 || exit 1
screen="$(herdr pane read "$pane" --source visible)" || fail '전송 전 입력란 확인 실패.'
screen_matches "$screen" empty || fail '입력란에 draft가 있거나 화면 형식이 불확실합니다. 아무 입력도 보내지 않았습니다.'
delivery_kind=""
trap 'delivery_followup "$?"' EXIT
if screen_matches "$screen" fresh; then
	echo '이미 빈 새 대화입니다. /new 전송 생략.'
else
	revision="$(printf '%s' "$agent" | jget result.agent.revision)"
	sequence="$(printf '%s' "$agent" | jget result.agent.state_change_seq)"
	[ -n "$revision" ] && [ -n "$sequence" ] || fail '새 대화 준비 관측용 revision·상태 seq가 없습니다.'
	delivery_kind='/new'
	herdr pane send-text "$pane" '/new' || { echo '/new 입력 결과가 불확실합니다.' >&2; exit 2; }
	herdr pane send-keys "$pane" enter || { echo '/new 제출 결과가 불확실합니다.' >&2; exit 2; }
	echo '/new 제출 완료. 새 입력란 준비를 확인합니다.'

# 기존 대화에서만 /new를 보낸다. 이전 화면과 다른 새 빈 화면과 상태를 함께 확인한다.
while :; do
	[ "$(now_ms)" -lt "$ready_deadline" ] || fail '새 입력란 준비 확인 timeout. 지시서는 보내지 않았습니다.'
	agent="$(herdr agent get "$pane")" || fail '새 입력란 상태 확인 실패. 지시서는 보내지 않았습니다.'
	validate_agent "$agent" 0 1 || exit 1
	focused="$(printf '%s' "$agent" | jget result.agent.focused)"
	[ "$focused" = False ] || fail 'pane에 focus가 생겨 지시서를 보내지 않았습니다.'
	status="$(printf '%s' "$agent" | jget result.agent.agent_status)"
	case "$status" in blocked|unknown) fail "새 입력란 상태=$status. 지시서를 보내지 않았습니다." ;; esac
	screen="$(herdr pane read "$pane" --source visible)" || fail '새 대화 화면 확인 실패.'
	if printf '%s' "$agent" | python3 -c 'import json,sys
a=json.load(sys.stdin)["result"]["agent"]
changed=str(a.get("revision"))!=sys.argv[1] or str(a.get("state_change_seq"))!=sys.argv[2]
sys.exit(0 if changed and a.get("agent_status") in ("idle","done") and a.get("interactive_ready") is True else 1)' "$revision" "$sequence" \
		&& screen_matches "$screen" fresh; then
		break
	fi
	sleep 1
done
fi
agent="$(herdr agent get "$CRITIC_NAME")" || fail '전송 직전 이름 확인 실패.'
validate_agent "$agent" 1 1 || exit 1
screen="$(herdr pane read "$pane" --source visible)" || fail '전송 직전 입력란 확인 실패.'
screen_matches "$screen" fresh || fail '전송 직전 새 입력란이 더 이상 비어 있지 않거나 준비되지 않았습니다. 지시서는 보내지 않았습니다.'
remaining=$(( deadline - $(now_ms) ))
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
[ "$no_wait" -eq 0 ] || { echo '완료 대기 생략. 완료·idle/done 확인 뒤 위 --compare 명령으로 비교하세요.'; exit 0; }
while :; do
	agent="$(herdr agent get "$pane")" || fail '완료 상태 확인 실패. 공개 상태와 스냅숏을 확인하세요.'
	validate_agent "$agent" 0 0 || exit 1
	status="$(printf '%s' "$agent" | jget result.agent.agent_status)"
	case "$status" in
		idle|done) break ;;
		blocked|unknown) fail "완료 대기 중 상태=$status. 대화상자에 응답하지 않습니다." ;;
	esac
	[ "$(now_ms)" -lt "$deadline" ] || { echo '완료 대기 timeout. 원격 작업은 중단하지 않았습니다. 완료 확인 뒤 --compare를 사용하세요.' >&2; exit 2; }
	sleep 1
done
git_state compare "$snapshot"
