#!/usr/bin/env bash
# gjc-herdr 팀장 잠금 관리(bash 3.2 + python3, herdr 미호출).
# 잠금 파일: ${GJCH_LEAD_LOCK:-$ROOT/.local/team/lead.json} (동시 실행은 <잠금 파일>.mutex의 fcntl.flock으로 직렬화).
# 명령과 종료 코드(rc):
#   scripts/team-lead.sh status          none | mine <kind> <session_id> | other <kind> <session_id> live | stale <kind> <session_id> (rc 0, 읽기 오류 rc 1)
#   scripts/team-lead.sh claim           잠금 확보·갱신 시 claimed <kind> <session_id> (rc 0), 다른 살아 있는 잠금 보유 시 stderr에 held <kind> <sid8>… (rc 3),
#                                        내 정체 미확인(환경변수 누락·소켓 stat 실패)이고 살아 있는 다른 잠금 없음 (rc 4), 오류 (rc 1)
#   scripts/team-lead.sh release         내 잠금·만료 잠금·잠금 없음이면 해제 후 rc 0, 다른 세션의 살아 있는 잠금이면 rc 3, 오류 rc 1
#   scripts/team-lead.sh release --force 무엇이든 잠금 파일을 삭제하고 rc 0 (사용자 승인으로만 사용)
# 소켓 판정: connect를 쓰지 않고(macOS는 backlog가 차면 connect가 거부됨), 소켓 부재(FileNotFoundError/NotADirectoryError)·비소켓·ino/ctime 불일치·lsof -t가 rc 1이고 stdout/stderr가 모두 빈 경우만 만료(stale)로 확정하며, stat의 그 밖의 OSError(권한 등)·rc 0+PID 출력·lsof stderr 출력·lsof 부재·timeout·그 밖의 rc는 살아 있는 것(live)으로 본다.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=scripts/worktree-guard.sh
. "$ROOT/scripts/worktree-guard.sh"
LOCK_FILE="${GJCH_LEAD_LOCK:-$ROOT/.local/team/lead.json}"
cmd="${1:-}"
arg="${2:-}"

usage() {
	printf '사용법: %s <status|claim|release [--force]>\n' "$0" >&2
	exit 1
}

case "$cmd" in
	status|claim) [ "$#" -eq 1 ] || usage ;;
	release) [ "$#" -eq 1 ] || { [ "$#" -eq 2 ] && [ "$arg" = "--force" ]; } || usage ;;
	*) usage ;;
esac

if wt_reason="$(gjch_worktree_reason "$ROOT")"; then
	printf '%s\n' "$wt_reason" >&2
	exit 1
fi

command -v python3 >/dev/null || { echo 'python3가 필요합니다.' >&2; exit 1; }

python3 - "$cmd" "$arg" "$LOCK_FILE" <<'PY'
from datetime import datetime, timezone
import fcntl
import json
import os
import stat
import subprocess
import sys

cmd, arg, lock_path = sys.argv[1], sys.argv[2], sys.argv[3]
lock_dir = os.path.dirname(lock_path) or "."
mutex_path = lock_path + ".mutex"

my_sid = os.environ.get("CLAUDE_CODE_SESSION_ID") or ""
my_sock = os.environ.get("CLAUDE_CODE_MESSAGING_SOCKET") or ""
my_kind = "herdr" if (os.environ.get("HERDR_ENV") == "1" and os.environ.get("HERDR_PANE_ID")) else "external"
my_pane = os.environ.get("HERDR_PANE_ID") or ""


def stat_socket(path):
    if not path:
        return None
    try:
        st = os.stat(path)
    except OSError:
        return None
    if not stat.S_ISSOCK(st.st_mode):
        return None
    return st


def read_lock():
    try:
        with open(lock_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return None
    except Exception as exc:
        print(f"잠금 파일 읽기 실패: {exc}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(data, dict):
        print("잠금 파일 형식 오류: JSON 객체가 아닙니다.", file=sys.stderr)
        sys.exit(1)
    sid = data.get("session_id")
    sock = data.get("socket")
    ino = data.get("socket_ino")
    ctime_ns = data.get("socket_ctime_ns")
    kind = data.get("kind")
    if (
        not isinstance(sid, str)
        or not sid
        or not isinstance(sock, str)
        or not sock
        or not isinstance(ino, int)
        or isinstance(ino, bool)
        or not isinstance(ctime_ns, int)
        or isinstance(ctime_ns, bool)
        or kind not in ("herdr", "external")
    ):
        print("잠금 파일 필수 필드 오류.", file=sys.stderr)
        sys.exit(1)
    return data


def is_live(data):
    path = data["socket"]
    if not path:
        return False
    try:
        st = os.stat(path)
    except (FileNotFoundError, NotADirectoryError):
        return False
    except OSError:
        return True
    if not stat.S_ISSOCK(st.st_mode):
        return False
    if st.st_ino != data["socket_ino"] or st.st_ctime_ns != data["socket_ctime_ns"]:
        return False
    try:
        res = subprocess.run(
            ["lsof", "-t", path],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return True
    out = res.stdout.strip()
    err = res.stderr.strip()
    if res.returncode == 0 and any(line.strip().isdigit() for line in out.splitlines()):
        return True
    if res.returncode == 1 and not out and not err:
        return False
    return True


def is_mine(data):
    if my_sid and my_sid == data["session_id"]:
        return True
    if my_sock and my_sock == data["socket"]:
        st = stat_socket(my_sock)
        if st is not None and st.st_ino == data["socket_ino"] and st.st_ctime_ns == data["socket_ctime_ns"]:
            return True
    return False


if cmd == "status":
    data = read_lock()
    if data is None:
        print("none")
        sys.exit(0)
    live = is_live(data)
    mine = is_mine(data)
    kind = data["kind"]
    sid = data["session_id"]
    if live and mine:
        print(f"mine {kind} {sid}")
    elif live:
        print(f"other {kind} {sid} live")
    else:
        print(f"stale {kind} {sid}")
    sys.exit(0)

if cmd == "release" and not os.path.exists(lock_path):
    sys.exit(0)

if cmd == "claim" and (not my_sid or stat_socket(my_sock) is None) and not os.path.exists(lock_path):
    sys.exit(4)

try:
    os.makedirs(lock_dir, exist_ok=True)
    mutex_fd = os.open(mutex_path, os.O_CREAT | os.O_RDWR, 0o600)
    fcntl.flock(mutex_fd, fcntl.LOCK_EX)
except OSError as exc:
    print(f"잠금 파일 준비 실패: {exc}", file=sys.stderr)
    sys.exit(1)

if cmd == "release":
    if arg == "--force":
        try:
            os.unlink(lock_path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            print(f"잠금 해제 실패: {exc}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    data = read_lock()
    if data is None:
        sys.exit(0)
    mine = is_mine(data)
    live = is_live(data)
    if not mine and live:
        print(f"held {data['kind']} {data['session_id'][:8]}…", file=sys.stderr)
        sys.exit(3)
    try:
        os.unlink(lock_path)
    except FileNotFoundError:
        pass
    except OSError as exc:
        print(f"잠금 해제 실패: {exc}", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)

# cmd == "claim"
data = read_lock()
if data is not None:
    mine = is_mine(data)
    live = is_live(data)
    if not mine and live:
        print(f"held {data['kind']} {data['session_id'][:8]}…", file=sys.stderr)
        sys.exit(3)

my_st = stat_socket(my_sock)
if not my_sid or my_st is None:
    sys.exit(4)

record = {
    "session_id": my_sid,
    "socket": my_sock,
    "socket_ino": my_st.st_ino,
    "socket_ctime_ns": my_st.st_ctime_ns,
    "kind": my_kind,
    "claimed_at": datetime.now(timezone.utc).isoformat(),
}
if my_kind == "herdr":
    record["pane_id"] = my_pane

tmp_path = f"{lock_path}.tmp.{os.getpid()}"
try:
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp_path, lock_path)
except OSError as exc:
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    print(f"잠금 기록 실패: {exc}", file=sys.stderr)
    sys.exit(1)

print(f"claimed {my_kind} {my_sid}")
sys.exit(0)
PY
