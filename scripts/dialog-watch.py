#!/usr/bin/env python3
"""Herdr 팀원 확인창·질문 감시 스크립트 (#60).

목적:
  팀원(agy·Codex) 화면을 읽기 전용으로 감시해 확인창·질문·인증 오류의 종류를 가리고,
  화면 밖 팀장에게 한 줄(DIALOG <이름> <pane> <종류> <요약>, 종료 코드 10)로 알린다.

읽기 전용:
  팀원 화면에 입력하는 명령(send-keys·send-text·prompt·rename 등)은 절대 실행하지 않으며,
  오직 `herdr agent get`과 `herdr agent read`만 호출한다.

한계(보장 범위):
  - 화면에 보이지 않는(가려지거나 접힌) 문구는 판정하지 못한다.
  - 지문은 끝 15줄이고 상태 파일은 마지막 한 건이다. 그래서 주변 출력이 바뀌거나 A→B→A로 돌아오면 다시 알린다.
  - 응답은 하지 않는다.

사용 예:
  # 팀장이 Claude Code의 run_in_background로 상시 감시를 돌릴 때 (알릴 창이 뜨면 한 줄 출력 후 rc 10 종료)
  python3 scripts/dialog-watch.py

  # 지금 한 번만 판정할 때 (상태 파일을 만들거나 바꾸지 않음; 없으면 none 출력 후 rc 0)
  python3 scripts/dialog-watch.py --once

  # 감시 대상·주기·시간 상한·상태 파일 지정
  python3 scripts/dialog-watch.py --names gjc-herdr-mate,gjc-herdr-critic --interval 15 --timeout 300
"""

import argparse
import datetime
import hashlib
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
DEFAULT_NAMES = "gjc-herdr-mate,gjc-herdr-critic"
DEFAULT_INTERVAL = 15.0
DEFAULT_STATE_PATH = os.path.join(ROOT, ".local", "team", "dialog-watch.state")
BOTTOM_WINDOW_LINES = 15
CONSECUTIVE_FAIL_LIMIT = 3

ANSI_RE = re.compile(r"\x1b\[[0-9;:]*[A-Za-z]")
AGY_TRUST_RE = re.compile(
    r"Do\s+you\s+trust\s+the\s+contents\s+of\s+this\s+project\?",
    re.IGNORECASE,
)
RUN_THIS_CMD_RE = re.compile(r"Run\s+this\s+command\?", re.IGNORECASE)
NO_CANCEL_RE = re.compile(r"No,\s*cancel", re.IGNORECASE)
NAVIGATE_RE = re.compile(r"↑/↓\s*Navigate", re.IGNORECASE)
REQ_PERM_RE = re.compile(r"Requesting\s+permission\s+for:\s*", re.IGNORECASE)
CTRL_G_EXPAND_RE = re.compile(r"ctrl\+g\s+edit\s*/\s*expand", re.IGNORECASE)
ENTER_CONFIRM_RE = re.compile(r"enter\s+confirm", re.IGNORECASE)
FULL_COMMAND_RE = re.compile(r"Full\s+Command", re.IGNORECASE)
TRUST_FOLDER_RE = re.compile(r"Trust\s+this\s+folder\?", re.IGNORECASE)
TRUST_CONTINUE_RE = re.compile(r"Trust\s+and\s+continue", re.IGNORECASE)
ENTER_SELECT_RE = re.compile(r"enter\s+select", re.IGNORECASE)
WHERE_SHOULD_RE = re.compile(r"Where\s+should", re.IGNORECASE)
TRUST_WORD_RE = re.compile(r"\bTrust\b", re.IGNORECASE)
CODEX_NUMBERED_PICK_RE = re.compile(r"^›\s*(\d+)\.\s+.+$")
AUTH_ERROR_RE = re.compile(
    r"(refresh\s+token\s+was\s+already\s+used|sign\s+in\s+again)",
    re.IGNORECASE,
)
AUTH_ERROR_LINE_PREFIX_RE = re.compile(
    r"^\s*(?:[■⚠✗✖×!](?:\s+|:)|(?:\[[A-Za-z0-9_.:-]+\]\s*)?(?:error|fatal|warning|warn|auth(?:entication)?\s+error|session\s+expired|token\s+expired|login\s+required|unauthorized)\s*:)",
    re.IGNORECASE,
)

KNOWN_AGY_CONFIRM_TITLES = {
    "create file": "Create file",
    "edit file": "Edit file",
    "write file": "Write file",
    "delete file": "Delete file",
    "modify file": "Modify file",
    "overwrite file": "Overwrite file",
    "remove file": "Remove file",
}

PATH_TOKEN_RE = re.compile(r"(?:~|/|\.\.?/)[^\s]*")
SECRET_TOKEN_RE = re.compile(
    r"(?:\b(?:sk|ghp|gho|ghu|ghs|ghr|AIza|xox[baprs])[-_A-Za-z0-9]+|\beyJ[A-Za-z0-9_.-]+|\b\S*=\S+)"
)


def now_iso() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="milliseconds")


def positive_finite_float(raw: str) -> float:
    try:
        val = float(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid float value: {raw!r}") from exc
    if not math.isfinite(val) or val <= 0:
        raise argparse.ArgumentTypeError("must be a finite positive number (> 0)")
    return val


def non_negative_finite_float(raw: str) -> float:
    try:
        val = float(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid float value: {raw!r}") from exc
    if not math.isfinite(val) or val < 0:
        raise argparse.ArgumentTypeError("must be a finite non-negative number (>= 0)")
    return val


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only watcher for GJCH member confirmation dialogs and questions."
    )
    parser.add_argument(
        "--names",
        type=str,
        default=DEFAULT_NAMES,
        help="Comma-separated agent names to watch (default: gjc-herdr-mate,gjc-herdr-critic).",
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
        help="Judge once without writing state file (prints DIALOG ... with rc 10, or none with rc 0).",
    )
    parser.add_argument(
        "--state",
        type=str,
        default=DEFAULT_STATE_PATH,
        help="State file path for deduplicating identical dialog notifications.",
    )
    parser.add_argument(
        "--timeout",
        type=non_negative_finite_float,
        default=0.0,
        help="Overall watch timeout in seconds (default: 0 = infinite).",
    )
    return parser.parse_args(argv)


def run_herdr_raw(
    args: List[str], timeout: float = 10.0
) -> Tuple[int, str, str]:
    try:
        res = subprocess.run(
            ["herdr", *args],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return res.returncode, res.stdout or "", res.stderr or ""
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except Exception as exc:
        return -1, "", str(exc)


def fetch_agent_info(
    name: str, cmd_timeout: float = 10.0
) -> Tuple[str, Optional[Dict[str, Any]], str]:
    """`herdr agent get <name>` 실행.

    반환: (kind, agent_dict, err_detail)
      - kind == 'ok': agent_dict에 pane_id·agent_status 포함
      - kind == 'not_found': 대상 이름 없음(agent_not_found)
      - kind == 'error': 조회·파싱 실패
    """
    rc, out, err = run_herdr_raw(["agent", "get", name], timeout=cmd_timeout)
    raw = out.strip() or err.strip()
    parsed: Optional[Dict[str, Any]] = None
    if raw:
        try:
            doc = json.loads(raw)
            if isinstance(doc, dict):
                parsed = doc
        except Exception:
            parsed = None

    if parsed is None and out.strip() and err.strip():
        try:
            doc = json.loads(err.strip())
            if isinstance(doc, dict):
                parsed = doc
        except Exception:
            parsed = None

    if rc != 0:
        err_obj = (parsed or {}).get("error")
        err_code = err_obj.get("code") if isinstance(err_obj, dict) else None
        if err_code == "agent_not_found":
            return "not_found", None, ""
        return "error", None, f"agent get {name} failed (rc={rc})"

    if not isinstance(parsed, dict):
        return "error", None, f"agent get {name} invalid json"

    err_obj = parsed.get("error")
    if isinstance(err_obj, dict):
        if err_obj.get("code") == "agent_not_found":
            return "not_found", None, ""
        return "error", None, f"agent get {name} error ({err_obj.get('code')})"

    res_obj = parsed.get("result")
    agent_obj = res_obj.get("agent") if isinstance(res_obj, dict) else None
    if not isinstance(agent_obj, dict):
        return "error", None, f"agent get {name} missing result.agent"

    pane_id = agent_obj.get("pane_id")
    agent_status = agent_obj.get("agent_status")
    if not isinstance(pane_id, str) or not pane_id.strip():
        return "error", None, f"agent get {name} missing pane_id"
    if not isinstance(agent_status, str) or not agent_status.strip():
        return "error", None, f"agent get {name} missing agent_status"

    return "ok", agent_obj, ""


def fetch_agent_screen(
    name: str, cmd_timeout: float = 10.0
) -> Tuple[str, str, str]:
    """`herdr agent read <name> --source visible` 실행.

    도움말 기준 기본 출력은 평문(text)이며, 혹시 JSON(`result.read.text`·`result.text`·`text`)으로
    감싸져 오더라도 텍스트를 꺼낸다.
    반환: (status, screen_text, err_detail)
      - status == 'ok': 읽기 성공
      - status == 'not_idle': agent_not_idle 오류 코드(조용히 건너뜀)
      - status == 'error': 그 밖의 읽기 실패
    """
    rc, out, err = run_herdr_raw(
        [
            "agent",
            "read",
            name,
            "--source",
            "visible",
        ],
        timeout=cmd_timeout,
    )
    if rc != 0:
        for raw in (err.strip(), out.strip()):
            if not raw:
                continue
            try:
                doc = json.loads(raw)
                if isinstance(doc, dict):
                    err_obj = doc.get("error")
                    if isinstance(err_obj, dict) and err_obj.get("code") == "agent_not_idle":
                        return "not_idle", "", ""
            except Exception:
                pass
        return "error", "", f"agent read {name} failed (rc={rc})"

    stripped = out.lstrip()
    if stripped.startswith("{"):
        try:
            doc = json.loads(stripped)
            if isinstance(doc, dict):
                res_obj = doc.get("result")
                if isinstance(res_obj, dict):
                    read_obj = res_obj.get("read")
                    if isinstance(read_obj, dict) and isinstance(read_obj.get("text"), str):
                        return "ok", read_obj["text"], ""
                    if isinstance(res_obj.get("text"), str):
                        return "ok", res_obj["text"], ""
                if isinstance(doc.get("text"), str):
                    return "ok", doc["text"], ""
        except Exception:
            pass

    return "ok", out, ""


def prepare_window(
    raw_screen: str, bottom_lines: int = BOTTOM_WINDOW_LINES
) -> Tuple[str, str]:
    """마지막 글 줄(비어 있지 않은 마지막 줄)에서 위로 bottom_lines줄 범위와 sha256 앞 16자 지문을 반환한다."""
    clean = ANSI_RE.sub("", raw_screen).replace("\r\n", "\n").replace("\r", "\n")
    all_lines = [ln.rstrip() for ln in clean.split("\n")]
    while all_lines and not all_lines[-1].strip():
        all_lines.pop()
    tail_lines = all_lines[-bottom_lines:] if all_lines else []
    window_text = "\n".join(tail_lines)
    fingerprint_basis = window_text.strip()
    fingerprint = hashlib.sha256(fingerprint_basis.encode("utf-8")).hexdigest()[:16]
    return window_text, fingerprint


def sanitize_word(token: str) -> str:
    cleaned = token.strip().strip("'\"`")
    if not cleaned:
        return "unknown"
    if "=" in cleaned and not cleaned.startswith("-"):
        key = cleaned.split("=", 1)[0].strip()
        return f"{key}=..." if key else "env"
    if "/" in cleaned:
        base = os.path.basename(cleaned.rstrip("/"))
        cleaned = base if base else "cmd"
    cleaned = SECRET_TOKEN_RE.sub("[redacted]", cleaned)
    cleaned = PATH_TOKEN_RE.sub("[path]", cleaned)
    return cleaned or "unknown"


def count_choices(text: str) -> int:
    numbered = 0
    for ln in text.splitlines():
        if re.match(r"^\s*(?:[>›]\s*)?\d+\.\s+", ln):
            numbered += 1
    if numbered > 0:
        return numbered
    yes_no = 0
    for ln in text.splitlines():
        if re.match(r"^\s*(?:[>›]\s*)?(?:Yes\b|No,\s*(?:cancel|exit)\b)", ln, re.IGNORECASE):
            yes_no += 1
    return yes_no


def has_normal_prompt_after(tail_text: str) -> bool:
    """확인창 문구 뒤(아래)에 보통 입력란 줄이 있는지 확인한다.

    - Codex: 번호 목록(`› N. `)이 아닌 0번째 칸 `›` 입력란
    - agy: 빈 `>`(또는 `❯`) 입력란, 또는 선택지(`> N. ...`, `> Yes/No...`)가 아닌 `>`/`❯` 입력란
    """
    for ln in tail_text.splitlines():
        stripped_r = ln.rstrip("\r\n")
        if stripped_r.startswith("›") and not CODEX_NUMBERED_PICK_RE.match(stripped_r):
            return True
        s = stripped_r.strip()
        if not s:
            continue
        if re.match(r"^[>❯]\s*$", s):
            return True
        if s.startswith(">") or s.startswith("❯"):
            if re.match(r"^[>❯]\s*\d+\.\s+", s):
                continue
            if re.match(r"^[>❯]\s*(?:Yes|No)\b", s, re.IGNORECASE):
                continue
            return True
    return False


def _match_auth_error_in_json_value(val: Any) -> Optional[str]:
    if isinstance(val, str):
        m_auth = AUTH_ERROR_RE.search(val)
        if m_auth is not None:
            return " ".join(m_auth.group(1).lower().split())
        return None
    if isinstance(val, dict):
        for v in val.values():
            found = _match_auth_error_in_json_value(v)
            if found is not None:
                return found
        return None
    if isinstance(val, list):
        for item in val:
            found = _match_auth_error_in_json_value(item)
            if found is not None:
                return found
        return None
    return None


def detect_auth_error(window_text: str) -> Optional[str]:
    """오류 행 꼴(줄머리 오류 표식 또는 줄 전체가 파싱되는 JSON의 error 필드)일 때만 인증 오류 문구를 감지한다."""
    for ln in window_text.splitlines():
        stripped = ln.strip()
        if not stripped:
            continue
        if AUTH_ERROR_LINE_PREFIX_RE.match(ln):
            m_auth = AUTH_ERROR_RE.search(ln)
            if m_auth is not None:
                return " ".join(m_auth.group(1).lower().split())
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                parsed = json.loads(stripped)
            except Exception:
                parsed = None
            if isinstance(parsed, dict) and "error" in parsed:
                matched = _match_auth_error_in_json_value(parsed["error"])
                if matched is not None:
                    return matched
    return None


def extract_agy_command_summary(
    window_text: str, prev_dialog_end: int, run_match: re.Match[str], next_dialog_start: int
) -> str:
    before_run = window_text[prev_dialog_end : run_match.start()]
    after_run = window_text[run_match.end() : next_dialog_start]

    req_matches = list(REQ_PERM_RE.finditer(before_run))
    if req_matches:
        cmd_region = before_run[req_matches[-1].end() :]
    else:
        non_empty_block: List[str] = []
        for ln in reversed(before_run.splitlines()):
            s = ln.strip()
            if not s:
                if non_empty_block:
                    break
                continue
            non_empty_block.append(s)
        non_empty_block.reverse()
        cmd_region = "\n".join(non_empty_block)

    cmd_lines = [ln.strip() for ln in cmd_region.splitlines() if ln.strip()]
    visible_cmd = " ".join(cmd_lines)
    char_count = len(visible_cmd)

    tokens = visible_cmd.split()
    first_word = "unknown"
    for tok in tokens:
        if "=" in tok and not tok.startswith("-") and len(tokens) > 1:
            continue
        first_word = sanitize_word(tok)
        break
    if first_word == "unknown" and tokens:
        first_word = sanitize_word(tokens[0])

    ends_with_dots = any(
        ln.endswith("...") or ln.endswith("…") for ln in cmd_lines
    ) or visible_cmd.endswith("...") or visible_cmd.endswith("…")
    has_ctrl_g_expand = bool(CTRL_G_EXPAND_RE.search(after_run))
    truncated = has_ctrl_g_expand or ends_with_dots
    trunc_label = "예" if truncated else "아니오"

    return (
        f"cmd={first_word} chars={char_count} 잘림={trunc_label} "
        "(1. Yes, run command / 4. No, cancel)"
    )


def extract_agy_confirm_summary(
    window_text: str, prev_dialog_end: int, m_no: re.Match[str]
) -> str:
    region = window_text[prev_dialog_end : m_no.end()]
    lines = region.splitlines()

    first_choice_idx = len(lines)
    for idx, ln in enumerate(lines):
        if re.match(r"^\s*(?:[>›]\s*)?(?:\d+\.\s+|\bYes\b|\bNo,\s*cancel\b)", ln, re.IGNORECASE):
            first_choice_idx = idx
            break

    header_lines = lines[:first_choice_idx]
    known_title = ""
    for ln in header_lines:
        s = ln.strip()
        if not s:
            continue
        if REQ_PERM_RE.match(s):
            rest = REQ_PERM_RE.sub("", s).strip()
            if rest:
                s = rest
            else:
                continue
        norm = " ".join(s.lower().split()).rstrip(":")
        if norm in KNOWN_AGY_CONFIRM_TITLES:
            known_title = KNOWN_AGY_CONFIRM_TITLES[norm]
            break

    choice_count = count_choices(region)
    if known_title:
        return f"{known_title} (선택지 {choice_count}개)"
    return f"확인창(선택지 {choice_count}개)"


def extract_codex_worktree_summary(window_text: str) -> str:
    for ln in reversed(window_text.splitlines()):
        m = CODEX_NUMBERED_PICK_RE.match(ln)
        if m:
            num = m.group(1)
            if num == "1":
                return "Where should the new conversation run? (선택: 1. Use current Git worktree)"
            if num == "2":
                return "Where should the new conversation run? (선택: 2. Create a new Git worktree)"
    return "Where should the new conversation run? (enter select)"


def extract_codex_menu_summary(window_text: str, from_offset: int) -> str:
    before_lines = window_text[:from_offset].splitlines()
    preceding_numbered = 0
    for ln in reversed(before_lines):
        if not ln.strip():
            continue
        if re.match(r"^\s*(?:[>›]\s*)?\d+\.\s+", ln):
            preceding_numbered += 1
        else:
            break
    tail_numbered = count_choices(window_text[from_offset:])
    total = preceding_numbered + tail_numbered
    return f"선택지 {total}개"


def extract_question_summary(window_text: str) -> str:
    choice_count = count_choices(window_text)
    return f"선택지 {choice_count}개"


def detect_codex_worktree(window_text: str) -> Optional[Tuple[int, int]]:
    """화면 맨 아래 글 줄에 'enter select'가 있고, 그 위 10줄 안에 'Where should'가 있는지 확인."""
    lines = [ln.rstrip() for ln in window_text.splitlines()]
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return None
    last_line = lines[-1]
    if not ENTER_SELECT_RE.search(last_line):
        return None
    above_10 = "\n".join(lines[max(0, len(lines) - 11) : len(lines) - 1])
    m_where = WHERE_SHOULD_RE.search(above_10)
    if m_where is None:
        return None
    if has_normal_prompt_after(above_10[m_where.end() :]):
        return None
    return (len(window_text), m_where.start())


def detect_last_zero_col_chevron(
    window_text: str,
) -> Optional[Tuple[int, int, str, str]]:
    """마지막 0번째 칸 `›` 줄을 찾아 번호 목록(`› N. …`)이면 (line_start, text_end, line, tail_text)를 반환한다."""
    last_match: Optional[Tuple[int, str]] = None
    offset = 0
    for ln in window_text.splitlines(keepends=True):
        stripped_ln = ln.rstrip("\r\n")
        if stripped_ln.startswith("›"):
            last_match = (offset, stripped_ln)
        offset += len(ln)

    if last_match is None:
        return None
    line_start, line_str = last_match
    if not CODEX_NUMBERED_PICK_RE.match(line_str):
        return None
    after_line = window_text[line_start + len(line_str) :]
    if has_normal_prompt_after(after_line):
        return None
    tail_text = window_text[line_start:]
    return (line_start, len(window_text), line_str, tail_text)


def judge_screen(window_text: str, status: str) -> Optional[Tuple[str, str]]:
    """화면 끝쪽 범위(`window_text`)와 `agent_status`로 확인창·질문·인증 오류를 판정한다.

    순서: 더 구체적인 것을 먼저 본다
      (worktree·trust·command·editor → confirm·menu → auth-error → question),
      같은 범위 안에서는 마지막에 나온 창을 우선한다.
    반환: (종류, 요약) 또는 해당 없으면 None.
    """
    if not window_text.strip():
        return None

    # 후보 항목: (끝 위치, 구체성 우선순위(높을수록 우선), 시작 위치, 종류, 부가 데이터)
    # 구체성 그룹: 2 = worktree·trust·command·editor, 1 = confirm·menu
    candidates: List[Tuple[int, int, int, str, Any]] = []

    wt = detect_codex_worktree(window_text)
    if wt is not None:
        wt_end, wt_start = wt
        candidates.append((wt_end, 2, wt_start, "codex-worktree", None))

    for m in AGY_TRUST_RE.finditer(window_text):
        if not has_normal_prompt_after(window_text[m.end() :]):
            candidates.append((m.end(), 2, m.start(), "agy-trust", m))

    # No, cancel 블록: 앞에 Run this command?가 있으면 agy-command(그룹 2),
    # 없고 뒤에 ↑/↓ Navigate가 있으면 agy-confirm(그룹 1)
    no_cancel_matches = list(NO_CANCEL_RE.finditer(window_text))
    for idx, m_no in enumerate(no_cancel_matches):
        if has_normal_prompt_after(window_text[m_no.end() :]):
            continue
        prev_no_end = no_cancel_matches[idx - 1].end() if idx > 0 else 0
        next_no_start = (
            no_cancel_matches[idx + 1].start()
            if idx + 1 < len(no_cancel_matches)
            else len(window_text)
        )
        run_in_block = list(
            RUN_THIS_CMD_RE.finditer(window_text, prev_no_end, m_no.start())
        )
        if run_in_block:
            m_run = run_in_block[-1]
            candidates.append(
                (
                    m_no.end(),
                    2,
                    m_run.start(),
                    "agy-command",
                    (prev_no_end, m_run, m_no, next_no_start),
                )
            )
        else:
            m_nav = NAVIGATE_RE.search(window_text, m_no.end(), next_no_start)
            if m_nav is not None:
                trailing = [
                    ln.strip()
                    for ln in window_text[m_nav.end() :].splitlines()
                    if ln.strip()
                ]
                if len(trailing) <= 3:
                    candidates.append(
                        (
                            m_nav.end(),
                            1,
                            prev_no_end,
                            "agy-confirm",
                            (prev_no_end, m_no, m_nav),
                        )
                    )

    for m_ec in ENTER_CONFIRM_RE.finditer(window_text):
        search_start = max(0, m_ec.start() - 120)
        search_end = min(len(window_text), m_ec.end() + 200)
        m_fc = FULL_COMMAND_RE.search(window_text, search_start, search_end)
        if m_fc is not None:
            start_pos = min(m_ec.start(), m_fc.start())
            end_pos = max(m_ec.end(), m_fc.end())
            if has_normal_prompt_after(window_text[end_pos:]):
                continue
            trailing = [
                ln.strip()
                for ln in window_text[end_pos:].splitlines()
                if ln.strip()
            ]
            if len(trailing) <= 3:
                candidates.append((end_pos, 2, start_pos, "agy-editor", (m_ec, m_fc)))

    # codex-trust (1회차 문구: Trust this folder? + Trust and continue)
    trust_folder_matches = list(TRUST_FOLDER_RE.finditer(window_text))
    for idx, m_tf in enumerate(trust_folder_matches):
        next_tf_start = (
            trust_folder_matches[idx + 1].start()
            if idx + 1 < len(trust_folder_matches)
            else len(window_text)
        )
        m_tc = TRUST_CONTINUE_RE.search(window_text, m_tf.end(), next_tf_start)
        if m_tc is not None and not has_normal_prompt_after(window_text[m_tc.end() :]):
            candidates.append((m_tc.end(), 2, m_tf.start(), "codex-trust", None))

    # Codex 일반 선택 목록 (마지막 0번째 칸 › 줄이 › N. … 번호 목록)
    chevron_pick = detect_last_zero_col_chevron(window_text)
    if chevron_pick is not None and wt is None:
        c_start, c_end, _c_line, c_tail = chevron_pick
        if TRUST_WORD_RE.search(c_tail):
            candidates.append((c_end, 2, c_start, "codex-trust", None))
        else:
            has_phrase_trust = any(item[3] == "codex-trust" for item in candidates)
            if not has_phrase_trust:
                candidates.append((c_end, 1, c_start, "codex-menu", c_start))

    if candidates:
        candidates.sort(key=lambda item: (item[0], item[1], item[2]))
        _end_pos, _prio, _start_pos, kind, payload = candidates[-1]

        if kind == "codex-worktree":
            return "codex-worktree", extract_codex_worktree_summary(window_text)

        if kind == "agy-trust":
            return (
                "agy-trust",
                "Do you trust the contents of this project? (Yes, I trust this folder / No, exit)",
            )

        if kind == "agy-command":
            prev_no_end, m_run, _m_no, next_no_start = payload
            prev_end = prev_no_end
            for end_p, _pr, _st, _k, _pl in candidates[:-1]:
                if end_p <= m_run.start() and end_p > prev_end:
                    prev_end = end_p
            summary = extract_agy_command_summary(
                window_text, prev_end, m_run, next_no_start
            )
            return "agy-command", summary

        if kind == "agy-editor":
            return "agy-editor", "Full Command 편집기 (enter confirm · esc back)"

        if kind == "codex-trust":
            return (
                "codex-trust",
                "Trust this folder? (1. Trust and continue / 2. Back to Agent Command Center)",
            )

        if kind == "agy-confirm":
            prev_no_end, m_no, _m_nav = payload
            prev_end = prev_no_end
            for end_p, _pr, _st, _k, _pl in candidates[:-1]:
                if end_p <= m_no.start() and end_p > prev_end:
                    prev_end = end_p
            summary = extract_agy_confirm_summary(window_text, prev_end, m_no)
            return "agy-confirm", summary

        if kind == "codex-menu":
            return "codex-menu", extract_codex_menu_summary(window_text, int(payload))

    # auth-error: 상태가 blocked가 아닐 때만 (오류 행 꼴만 감지)
    if status != "blocked":
        matched_phrase = detect_auth_error(window_text)
        if matched_phrase is not None:
            return "auth-error", f"인증 오류 ({matched_phrase})"
        return None

    return "question", extract_question_summary(window_text)


def judge_raw_screen(raw_screen: str, status: str) -> Optional[Tuple[str, str]]:
    """원시 화면 문자열에서 끝쪽 범위를 잘라 확인창·질문·인증 오류를 판정한다."""
    window_text, _ = prepare_window(raw_screen, bottom_lines=BOTTOM_WINDOW_LINES)
    return judge_screen(window_text, status)


def read_state_file(state_path: str) -> Optional[Dict[str, Any]]:
    try:
        if not os.path.exists(state_path):
            return None
        with open(state_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_state_file(state_path: str, record: Dict[str, Any]) -> None:
    tmp_path: Optional[str] = None
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
        sys.stderr.write("dialog-watch: failed to write state file\n")
        sys.stderr.flush()


def is_same_dialog(
    prev_state: Optional[Dict[str, Any]],
    name: str,
    kind: str,
    fingerprint: str,
) -> bool:
    if not isinstance(prev_state, dict):
        return False
    return (
        prev_state.get("name") == name
        and prev_state.get("kind") == kind
        and prev_state.get("fingerprint") == fingerprint
    )


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    names = [n.strip() for n in args.names.split(",") if n.strip()]
    if not names:
        sys.stderr.write("dialog-watch: --names must include at least one agent name\n")
        return 2

    started_at = time.monotonic()
    deadline: Optional[float] = (
        started_at + args.timeout if args.timeout and args.timeout > 0 else None
    )

    last_seq: Dict[str, Tuple[Any, Any]] = {}
    consecutive_all_failed = 0

    while True:
        if deadline is not None and time.monotonic() >= deadline:
            print("DIALOG-WATCH timeout", flush=True)
            return 0

        cycle_failures = 0
        cycle_ok = 0

        for name in names:
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

            kind_status, agent_obj, err_msg = fetch_agent_info(
                name, cmd_timeout=cmd_timeout
            )
            if kind_status == "not_found":
                last_seq.pop(name, None)
                continue
            if kind_status != "ok" or agent_obj is None:
                if deadline is not None and time.monotonic() >= deadline:
                    print("DIALOG-WATCH timeout", flush=True)
                    return 0
                sys.stderr.write(f"dialog-watch: {err_msg}\n")
                sys.stderr.flush()
                cycle_failures += 1
                continue

            # agent get 성공 시 연속 조회 실패(unavailable) 카운트에서 제외
            cycle_ok += 1

            pane_id = str(agent_obj["pane_id"]).strip()
            status = str(agent_obj["agent_status"]).strip()
            seq_key = (
                agent_obj.get("state_change_seq"),
                agent_obj.get("revision"),
            )

            should_read = False
            if status == "blocked":
                last_seq.pop(name, None)
                should_read = True
            else:
                if name not in last_seq or last_seq[name] != seq_key:
                    should_read = True

            if not should_read:
                continue

            if deadline is not None:
                rem = deadline - time.monotonic()
                if rem <= 0:
                    print("DIALOG-WATCH timeout", flush=True)
                    return 0
                cmd_timeout = min(10.0, rem)

            read_status, raw_screen, read_err = fetch_agent_screen(
                name, cmd_timeout=cmd_timeout
            )
            if read_status == "not_idle":
                continue
            if read_status != "ok":
                if deadline is not None and time.monotonic() >= deadline:
                    print("DIALOG-WATCH timeout", flush=True)
                    return 0
                sys.stderr.write(f"dialog-watch: {read_err}\n")
                sys.stderr.flush()
                continue

            window_text, fingerprint = prepare_window(
                raw_screen, bottom_lines=BOTTOM_WINDOW_LINES
            )
            if not window_text.strip():
                continue

            if status != "blocked":
                last_seq[name] = seq_key

            judged = judge_screen(window_text, status)
            if judged is None:
                continue

            dialog_kind, summary = judged
            single_line_summary = " ".join(summary.split())

            prev_state = read_state_file(args.state)
            if is_same_dialog(prev_state, name, dialog_kind, fingerprint):
                continue

            if not args.once:
                record = {
                    "name": name,
                    "pane": pane_id,
                    "kind": dialog_kind,
                    "summary": single_line_summary,
                    "fingerprint": fingerprint,
                    "at": now_iso(),
                }
                write_state_file(args.state, record)

            print(
                f"DIALOG {name} {pane_id} {dialog_kind} {single_line_summary}",
                flush=True,
            )
            return 10

        if args.once:
            print("none", flush=True)
            return 0

        if cycle_failures > 0 and cycle_ok == 0:
            consecutive_all_failed += 1
            if consecutive_all_failed >= CONSECUTIVE_FAIL_LIMIT:
                print("DIALOG-WATCH unavailable", flush=True)
                return 2
        elif cycle_ok > 0:
            consecutive_all_failed = 0
        else:
            consecutive_all_failed = 0

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
