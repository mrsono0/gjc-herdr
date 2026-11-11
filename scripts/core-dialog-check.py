#!/usr/bin/env python3
"""Core(hc) 팀원 확인창·질문 감시 스크립트 (#86 2b).

목적:
  팀원(mate·critic) 터미널을 `hc ls --json --label …`과 `hc get --json`으로만 읽기 전용 감시해,
  `status.state == "blocked"`이면 `DIALOG <role> <kind> msglen=<n>`(종료 코드 10)으로 알린다.
  화면 읽기(hc read/attach)나 변경·응답 명령은 절대 실행하지 않는다.
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

sys.dont_write_bytecode = True

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DEFAULT_NAMES = "mate,critic"
DEFAULT_INTERVAL = 15.0
DEFAULT_STATE_PATH = os.path.join(ROOT, ".local", "team", "core-dialog-watch.state")

VALID_ROLES = {"mate", "critic", "lead"}
VALID_STATUS_STATES = {"idle", "working", "done", "blocked", "error"}
VALID_STATUS_KINDS = {"permission", "question", "auth"}
VALID_STATE_KINDS = {"permission", "question", "auth", "null", "other"}


def redact_line(raw: str) -> str:
    s = re.sub(r"[\r\n]+", " ", raw)
    for env_k in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET"):
        v = os.environ.get(env_k) or ""
        if len(v) >= 4:
            s = s.replace(v, "[REDACTED]")
    s = re.sub(r"sk-[A-Za-z0-9_-]{6,}", "sk-[REDACTED]", s)
    s = re.sub(r"ghp_[A-Za-z0-9]{6,}", "ghp_[REDACTED]", s)
    s = re.sub(r"AKIA[0-9A-Z]{8,}", "AKIA[REDACTED]", s)
    s = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1[REDACTED]", s)
    s = re.sub(
        r"(?i)\b(token|password|api_key|secret|session_id)=([^\s\"'&;,)}\]]+)",
        r"\1=[REDACTED]",
        s,
    )
    s = re.sub(
        r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
        "[REDACTED]",
        s,
    )
    s = re.sub(
        r"(?i)\b(?:[A-Za-z0-9_]+[_-])?(?:session[_-]?(?:id|uuid)|sid)[_-][A-Za-z0-9_-]{4,}\b",
        "[REDACTED]",
        s,
    )
    return s


def positive_finite_float(raw: str) -> float:
    try:
        val = float(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("invalid float value") from exc
    if not math.isfinite(val) or val <= 0:
        raise argparse.ArgumentTypeError("must be a finite positive number (> 0)")
    return val


def non_negative_finite_float(raw: str) -> float:
    try:
        val = float(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("invalid float value") from exc
    if not math.isfinite(val) or val < 0:
        raise argparse.ArgumentTypeError("must be a finite non-negative number (>= 0)")
    return val


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only Core(hc) watcher for GJCH member blocked status."
    )
    parser.add_argument(
        "--names",
        type=str,
        default=DEFAULT_NAMES,
        help="Comma-separated roles to watch (default: mate,critic).",
    )
    parser.add_argument(
        "--interval",
        type=positive_finite_float,
        default=DEFAULT_INTERVAL,
        help="Polling interval in seconds (default: 15).",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Judge once without writing state file (DIALOG rc 10, UNKNOWN rc 2, or none rc 0).",
    )
    parser.add_argument(
        "--state",
        type=str,
        default=DEFAULT_STATE_PATH,
        help="State file path storing only the last (role, kind, msglen).",
    )
    parser.add_argument(
        "--timeout",
        type=non_negative_finite_float,
        default=0.0,
        help="Overall watch timeout in seconds (default: 0 = infinite).",
    )
    return parser.parse_args(argv)


def normalize_role(token: str) -> str:
    t = token.strip()
    if t.endswith("-mate"):
        return "mate"
    if t.endswith("-critic"):
        return "critic"
    if t.endswith("-lead"):
        return "lead"
    return t


def run_hc_readonly(args: List[str], timeout: float = 10.0) -> Tuple[int, str, str]:
    hc_bin = os.environ.get("GJCH_HC_BIN") or "hc"
    try:
        res = subprocess.run(
            [hc_bin, *args],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return res.returncode, res.stdout or "", res.stderr or ""
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except Exception:
        return -1, "", "exec_failed"


def find_local_role_address(role: str, team: str, cmd_timeout: float) -> Tuple[str, str]:
    """`hc ls --json --label team=<team> --label role=<role>` 실행.

    반환: (tag, addr_or_reason)
      - ('ok', addr)
      - ('unknown', reason)
    """
    rc, out, _ = run_hc_readonly(
        ["ls", "--json", "--label", f"team={team}", "--label", f"role={role}"],
        timeout=cmd_timeout,
    )
    if rc != 0:
        return "unknown", "ls 조회 실패"
    try:
        doc = json.loads(out)
    except Exception:
        return "unknown", "ls 조회 실패"
    if not isinstance(doc, dict) or not isinstance(doc.get("terminals"), list):
        return "unknown", "ls 조회 실패"

    addrs: List[str] = []
    for t in doc["terminals"]:
        if not isinstance(t, dict):
            return "unknown", "ls 조회 실패"
        addr = t.get("address")
        if not isinstance(addr, str) or not addr:
            return "unknown", "ls 조회 실패"
        if "/" in addr:
            continue
        labels = t.get("labels")
        if labels is not None:
            if not isinstance(labels, dict):
                return "unknown", "ls 조회 실패"
            if labels.get("team") != team or labels.get("role") != role:
                continue
        addrs.append(addr)

    if len(addrs) == 0:
        return "unknown", "없음"
    if len(addrs) > 1:
        return "unknown", "라벨 중복(2개 이상)"
    return "ok", addrs[0]


def inspect_role_terminal(
    role: str, team: str, cmd_timeout: float
) -> Tuple[str, str, int]:
    """역할 하나를 조회해 판정한다.

    반환: (result_tag, kind_or_reason, msglen)
      - ('ok', status_state, 0)
      - ('blocked', kind_word, msglen)
      - ('unknown', reason, 0)
    """
    f_tag, addr_or_reason = find_local_role_address(role, team, cmd_timeout)
    if f_tag != "ok":
        return "unknown", addr_or_reason, 0

    rc, out, _ = run_hc_readonly(["get", "--json", addr_or_reason], timeout=cmd_timeout)
    if rc != 0:
        return "unknown", "get 조회 실패", 0
    try:
        d = json.loads(out)
    except Exception:
        return "unknown", "get 조회 실패", 0
    if not isinstance(d, dict):
        return "unknown", "get 조회 실패", 0

    raw_state = d.get("state")
    if raw_state == "finished":
        return "unknown", "state=finished", 0
    if raw_state != "live":
        return "unknown", "state=other", 0

    raw_reported = d.get("reported")
    if raw_reported is False:
        return "unknown", "미보고(reported=false)", 0
    if raw_reported is not True:
        return "unknown", "미보고(reported=unknown)", 0

    st = d.get("status")
    if not isinstance(st, dict):
        return "unknown", "상태 없음", 0

    raw_st_state = st.get("state")
    if not isinstance(raw_st_state, str) or raw_st_state not in VALID_STATUS_STATES:
        return "unknown", "상태 불명(status=other)", 0

    raw_kind = st.get("kind")
    if raw_kind is None:
        kind_word = "null"
    elif isinstance(raw_kind, str) and raw_kind in VALID_STATUS_KINDS:
        kind_word = raw_kind
    else:
        kind_word = "other"

    msg = st.get("msg")
    msglen = len(msg) if isinstance(msg, str) else 0

    if raw_st_state == "blocked":
        return "blocked", kind_word, msglen

    return "ok", raw_st_state, msglen


def read_state_file(state_path: str) -> Optional[Dict[str, Any]]:
    try:
        if not os.path.exists(state_path):
            return None
        with open(state_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_state_file(state_path: str, role: str, kind: str, msglen: int) -> None:
    if (
        role not in VALID_ROLES
        or kind not in VALID_STATE_KINDS
        or not isinstance(msglen, int)
        or isinstance(msglen, bool)
        or msglen < 0
    ):
        sys.stderr.write("core-dialog-check: invalid state record\n")
        sys.stderr.flush()
        return
    tmp_path: Optional[str] = None
    record = {
        "role": role,
        "kind": kind,
        "msglen": msglen,
    }
    try:
        abs_path = os.path.abspath(state_path)
        parent = os.path.dirname(abs_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp_path = f"{abs_path}.tmp.{os.getpid()}"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(record, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp_path, abs_path)
    except Exception:
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception:
            pass
        sys.stderr.write("core-dialog-check: failed to write state file\n")
        sys.stderr.flush()


def is_same_dialog(
    prev_state: Optional[Dict[str, Any]],
    role: str,
    kind: str,
    msglen: int,
) -> bool:
    if not isinstance(prev_state, dict):
        return False
    return (
        prev_state.get("role") == role
        and prev_state.get("kind") == kind
        and prev_state.get("msglen") == msglen
    )


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    if os.environ.get("GJCH_CORE") != "1":
        sys.stderr.write("core 스크립트는 GJCH_CORE=1에서만 실행합니다.\n")
        return 2

    if os.environ.get("GJCH_TEAM_ROLE"):
        return 0

    if os.environ.get("GJCH_EXTERNAL_LEAD") != "1":
        if args.once:
            sys.stderr.write(
                "Core 외부 팀장(GJCH_CORE=1, GJCH_EXTERNAL_LEAD=1)에서 실행하세요.\n"
            )
            return 2
        return 0

    raw_cwd = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    try:
        if not os.path.isdir(raw_cwd):
            raise OSError("not a directory")
        real_here = os.path.realpath(raw_cwd)
    except Exception:
        sys.stderr.write("작업 경로 확인 실패\n")
        return 2 if args.once else 0
    if real_here != ROOT and not real_here.startswith(ROOT + os.sep):
        sys.stderr.write("현재 경로가 저장소 밖\n")
        return 2 if args.once else 0

    try:
        wt_res = subprocess.run(
            [
                "/bin/bash",
                "-c",
                '. "$1/scripts/worktree-guard.sh"; gjch_worktree_reason "$1"',
                "_",
                ROOT,
            ],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=5.0,
        )
        if wt_res.returncode == 0:
            sys.stderr.write("연결 worktree에서 실행 중\n")
            return 0
    except Exception:
        pass

    roles = [normalize_role(n) for n in args.names.split(",") if n.strip()]
    if not roles:
        sys.stderr.write("core-dialog-check: --names must include at least one role\n")
        return 2
    if any(r not in VALID_ROLES for r in roles):
        sys.stderr.write(
            "core-dialog-check: 허용되지 않는 역할입니다(mate, critic, lead만 가능).\n"
        )
        return 2

    team = os.environ.get("GJCH_CORE_TEAM") or "gjch"
    started_at = time.monotonic()
    deadline: Optional[float] = (
        started_at + args.timeout if args.timeout and args.timeout > 0 else None
    )

    while True:
        if deadline is not None and time.monotonic() >= deadline:
            print("DIALOG-WATCH timeout", flush=True)
            return 0

        had_unknown = False

        for role in roles:
            if deadline is not None and time.monotonic() >= deadline:
                print("DIALOG-WATCH timeout", flush=True)
                return 0

            cmd_timeout = 10.0
            if deadline is not None:
                rem = deadline - time.monotonic()
                if rem <= 0:
                    print("DIALOG-WATCH timeout", flush=True)
                    return 0
                cmd_timeout = min(10.0, rem)

            tag, detail, msglen = inspect_role_terminal(role, team, cmd_timeout)
            if tag == "unknown":
                had_unknown = True
                print(redact_line(f"UNKNOWN {role} {detail}"), flush=True)
                continue

            if tag == "blocked":
                if not args.once:
                    prev_state = read_state_file(args.state)
                    if is_same_dialog(prev_state, role, detail, msglen):
                        continue
                    write_state_file(args.state, role, detail, msglen)
                print(redact_line(f"DIALOG {role} {detail} msglen={msglen}"), flush=True)
                return 10

        if args.once:
            if had_unknown:
                return 2
            print("none", flush=True)
            return 0

        if deadline is not None:
            rem = deadline - time.monotonic()
            if rem <= 0:
                print("DIALOG-WATCH timeout", flush=True)
                return 0
            sleep_sec = min(args.interval, rem)
        else:
            sleep_sec = args.interval

        time.sleep(sleep_sec)


if __name__ == "__main__":
    sys.exit(main())
