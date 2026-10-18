#!/usr/bin/env python3
"""Herdr 팀 탭 배치 감시 스크립트 (#55).

사이드바 등으로 팀 탭(팀장 위 + 아래 팀원 | 검토) 배치가 풀리면
조용해진 뒤 scripts/team-up.sh --layout을 자동으로 한 번 실행한다.
"""
import argparse
import datetime
import fcntl
import json
import math
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

SUBSCRIPTION_TYPES = (
    "layout.updated",
    "pane.moved",
    "pane.created",
    "pane.closed",
    "tab.created",
    "tab.closed",
    "workspace.closed",
)


def now_iso() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="milliseconds")


class Logger:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._fh = open(path, "a", encoding="utf-8", buffering=1)

    def log(self, message: str) -> None:
        line = f"{now_iso()} {message}\n"
        with self._lock:
            self._fh.write(line)
            self._fh.flush()

    def close(self) -> None:
        with self._lock:
            try:
                self._fh.close()
            except Exception:
                pass


def run_herdr(args: List[str], timeout: float = 10.0) -> Tuple[int, Optional[Dict[str, Any]]]:
    try:
        res = subprocess.run(
            ["herdr", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except Exception:
        return -1, None
    raw = (res.stdout or "").strip() or (res.stderr or "").strip()
    if not raw:
        return res.returncode, None
    try:
        parsed = json.loads(raw)
    except Exception:
        return res.returncode, None
    return res.returncode, parsed if isinstance(parsed, dict) else None


GONE_ERROR_CODES = ("pane_not_found", "tab_not_found", "workspace_not_found")


def check_lead_pane(lead_pane: str) -> Tuple[str, str]:
    """팀장 pane 생존·유효성 확인. 반환: (status, detail). status는 ok | gone | unknown."""
    rc, data = run_herdr(["pane", "get", lead_pane])
    if rc == 0 and data:
        pane = (data.get("result") or {}).get("pane")
        if isinstance(pane, dict) and pane.get("pane_id") == lead_pane:
            return "ok", ""
        err = data.get("error")
        err_code = err.get("code") if isinstance(err, dict) else None
        if err_code in GONE_ERROR_CODES:
            return "gone", str(err_code)
        return "unknown", "pane_invalid"

    if isinstance(data, dict):
        err = data.get("error")
        err_code = err.get("code") if isinstance(err, dict) else None
        if err_code in GONE_ERROR_CODES:
            return "gone", str(err_code)
    return "unknown", "pane_lookup_failed"


def is_lead_pane_gone(lead_pane: str) -> bool:
    status, _ = check_lead_pane(lead_pane)
    return status == "gone"


def valid_rect(rect: Any) -> Optional[Dict[str, int]]:
    if not isinstance(rect, dict):
        return None
    out: Dict[str, int] = {}
    for key in ("x", "y", "width", "height"):
        val = rect.get(key)
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            return None
        out[key] = int(val)
    return out


def check_layout(
    lead_pane: str,
    mate_name: str,
    critic_name: str,
    on_lead_ok: Optional[Any] = None,
) -> Tuple[str, str, str, Optional[str], Optional[str]]:
    """반환: (status, tab_id, detail, mate_pane, critic_pane). status는 ok | off | skip | unknown | gone."""
    lead_status, lead_detail = check_lead_pane(lead_pane)
    if lead_status == "gone":
        return "gone", "", lead_detail, None, None
    if lead_status != "ok":
        return "unknown", "", lead_detail, None, None
    if on_lead_ok is not None:
        on_lead_ok()

    mate_rc, mate_data = run_herdr(["agent", "get", mate_name])
    if mate_rc == 0 and mate_data:
        mate_agent = (mate_data.get("result") or {}).get("agent")
        mate_pane = mate_agent.get("pane_id") if isinstance(mate_agent, dict) else None
        if not isinstance(mate_pane, str) or not mate_pane:
            return "unknown", "", "mate_invalid", None, None
    else:
        err_code = ((mate_data or {}).get("error") or {}).get("code") if mate_data else None
        if err_code == "agent_not_found":
            return "skip", "", "mate_not_found", None, None
        return "unknown", "", "mate_lookup_failed", None, None

    critic_pane: Optional[str] = None
    critic_rc, critic_data = run_herdr(["agent", "get", critic_name])
    if critic_rc == 0 and critic_data:
        critic_agent = (critic_data.get("result") or {}).get("agent")
        cp = critic_agent.get("pane_id") if isinstance(critic_agent, dict) else None
        if not isinstance(cp, str) or not cp:
            return "unknown", "", "critic_invalid", mate_pane, None
        critic_pane = cp
    else:
        err_code = ((critic_data or {}).get("error") or {}).get("code") if critic_data else None
        if err_code != "agent_not_found":
            return "unknown", "", "critic_lookup_failed", mate_pane, None

    layout_rc, layout_data = run_herdr(["pane", "layout", "--pane", lead_pane])
    if layout_rc != 0 or not layout_data:
        err_code = ((layout_data or {}).get("error") or {}).get("code") if layout_data else None
        if err_code in GONE_ERROR_CODES:
            return "gone", "", "layout_pane_not_found", mate_pane, critic_pane
        return "unknown", "", "layout_lookup_failed", mate_pane, critic_pane

    layout = (layout_data.get("result") or {}).get("layout")
    if not isinstance(layout, dict) or not isinstance(layout.get("panes"), list):
        return "unknown", "", "layout_invalid", mate_pane, critic_pane

    tab_id = layout.get("tab_id") if isinstance(layout.get("tab_id"), str) else ""
    rects: Dict[str, Dict[str, int]] = {}
    for item in layout["panes"]:
        if not isinstance(item, dict):
            continue
        pid = item.get("pane_id")
        r = valid_rect(item.get("rect"))
        if isinstance(pid, str) and pid and r is not None:
            rects[pid] = r

    if lead_pane not in rects:
        return "gone", tab_id, "lead_not_in_layout", mate_pane, critic_pane

    if mate_pane not in rects:
        return "skip", tab_id, "mate_not_in_tab", mate_pane, critic_pane

    L = rects[lead_pane]
    M = rects[mate_pane]
    if critic_pane is not None:
        if critic_pane not in rects:
            return "skip", tab_id, "critic_not_in_tab", mate_pane, critic_pane
        C = rects[critic_pane]
        ok = (
            M["x"] == L["x"]
            and M["y"] == L["y"] + L["height"]
            and C["x"] == M["x"] + M["width"]
            and C["y"] == M["y"]
            and C["height"] == M["height"]
            and M["width"] + C["width"] == L["width"]
        )
        return ("ok" if ok else "off"), tab_id, "3-pane", mate_pane, critic_pane

    ok = (
        M["x"] == L["x"]
        and M["y"] == L["y"] + L["height"]
        and M["width"] == L["width"]
    )
    return ("ok" if ok else "off"), tab_id, "2-pane", mate_pane, critic_pane


def is_relevant_event(msg: Dict[str, Any], lead_ws: str) -> bool:
    data = msg.get("data")
    if not isinstance(data, dict):
        return False

    ws_Prefix = f"{lead_ws}:"

    if data.get("workspace_id") == lead_ws:
        return True
    for subkey in ("layout", "tab", "created_tab", "workspace"):
        sub = data.get(subkey)
        if isinstance(sub, dict) and sub.get("workspace_id") == lead_ws:
            return True

    def has_ws_prefix(obj: Any) -> bool:
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("pane_id", "tab_id") and isinstance(v, str) and v.startswith(ws_Prefix):
                    return True
                if isinstance(v, (dict, list)) and has_ws_prefix(v):
                    return True
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)) and has_ws_prefix(item):
                    return True
        return False

    return has_ws_prefix(data)


def is_lead_workspace_closed(msg: Dict[str, Any], lead_ws: str) -> bool:
    if not is_relevant_event(msg, lead_ws):
        return False
    ev = msg.get("event")
    data = msg.get("data")
    ev_type = data.get("type") if isinstance(data, dict) else None
    return ev in ("workspace_closed", "workspace.closed") or ev_type in (
        "workspace_closed",
        "workspace.closed",
    )


def write_state(
    state_path: str,
    status: str,
    tab_id: str,
    last_rc: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    payload: Dict[str, Any] = {
        "status": status,
        "tab": tab_id,
        "at": int(time.time()),
        "last_rc": last_rc,
    }
    if extra:
        payload.update(extra)
    tmp_path = f"{state_path}.tmp.{os.getpid()}"
    try:
        with open(tmp_path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
        os.replace(tmp_path, state_path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception:
            pass


def lookup_pane_tab(pane_id: Optional[str]) -> Dict[str, Optional[str]]:
    if not isinstance(pane_id, str) or not pane_id:
        return {"pane": None, "tab": None}
    rc, data = run_herdr(["pane", "get", pane_id])
    tab_id: Optional[str] = None
    if rc == 0 and isinstance(data, dict):
        pane_obj = (data.get("result") or {}).get("pane")
        if isinstance(pane_obj, dict):
            t = pane_obj.get("tab_id")
            if isinstance(t, str) and t:
                tab_id = t
    return {"pane": pane_id, "tab": tab_id}


def lookup_workspace_tabs(lead_ws: str) -> List[str]:
    tabs: List[str] = []
    rc, data = run_herdr(["tab", "list"])
    if rc == 0 and isinstance(data, dict):
        raw_tabs = (data.get("result") or {}).get("tabs")
        if isinstance(raw_tabs, list):
            ws_prefix = f"{lead_ws}:"
            for item in raw_tabs:
                if not isinstance(item, dict):
                    continue
                tid = item.get("tab_id")
                ws_id = item.get("workspace_id")
                if isinstance(tid, str) and tid:
                    if ws_id == lead_ws or (ws_id is None and tid.startswith(ws_prefix)):
                        tabs.append(tid)
    return tabs


def record_relayout_timeout(
    *,
    logger: Logger,
    state_path: str,
    orig_tab_id: str,
    lead_pane: str,
    mate_pane: Optional[str],
    critic_pane: Optional[str],
    lead_ws: str,
) -> None:
    lead_info = lookup_pane_tab(lead_pane)
    mate_info = lookup_pane_tab(mate_pane)
    critic_info = lookup_pane_tab(critic_pane)
    workspace_tabs = lookup_workspace_tabs(lead_ws)

    write_state(
        state_path,
        "relayout_timeout",
        orig_tab_id,
        None,
        extra={
            "panes": {
                "lead": lead_info,
                "mate": mate_info,
                "critic": critic_info,
            },
            "workspace_tabs": workspace_tabs,
        },
    )

    lead_str = f"{lead_info['pane'] or '-'}@{lead_info['tab'] or '-'}"
    mate_str = f"{mate_info['pane'] or '-'}@{mate_info['tab'] or '-'}"
    critic_str = f"{critic_info['pane'] or '-'}@{critic_info['tab'] or '-'}"
    tabs_str = ",".join(workspace_tabs) if workspace_tabs else "-"
    logger.log(
        f"relayout timeout panes lead={lead_str} mate={mate_str} "
        f"critic={critic_str} tabs={tabs_str}"
    )


def notify_limit(tab_id: str, window: float, limit: int) -> None:
    win_str = str(int(window)) if float(window).is_integer() else str(window)
    tab_label = tab_id or "팀 탭"
    body = (
        f"{tab_label} 배치가 {win_str}초 안에 {limit}회 풀려 자동 복구를 멈춤. "
        "scripts/team-up.sh --layout으로 확인"
    )
    try:
        subprocess.run(
            [
                "herdr",
                "notification",
                "show",
                "GJCH 팀 배치 자동 복구 중단",
                "--body",
                body,
                "--sound",
                "request",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        pass


def _terminate_process_group(proc: subprocess.Popen[str], pgid: int) -> bool:
    """프로세스 그룹에 SIGTERM을 보내고 최대 5초 대기한 뒤 남아 있으면 SIGKILL을 보낸다.
    반환: 그룹 내 프로세스가 모두 소멸했으면 True, 남아 있으면 False.
    """
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except OSError:
        pass

    deadline = time.monotonic() + 5.0
    group_gone = False
    while time.monotonic() < deadline:
        if proc.poll() is None:
            try:
                proc.wait(timeout=0.05)
            except subprocess.TimeoutExpired:
                pass
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            group_gone = True
            break
        except PermissionError:
            pass
        time.sleep(0.02)

    if not group_gone or proc.poll() is None:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            group_gone = True
        except OSError:
            pass
        if proc.poll() is None:
            try:
                proc.wait(timeout=1.0)
            except Exception:
                pass
        kill_deadline = time.monotonic() + 0.5
        while time.monotonic() < kill_deadline:
            try:
                os.killpg(pgid, 0)
            except ProcessLookupError:
                group_gone = True
                break
            except PermissionError:
                break
            time.sleep(0.02)

    try:
        os.killpg(pgid, 0)
        return False
    except ProcessLookupError:
        return True
    except PermissionError:
        return False


def run_relayout(
    logger: Logger, relayout_timeout: float = 120.0
) -> Tuple[Optional[int], bool]:
    custom = os.environ.get("GJCH_LAYOUT_WATCH_CMD", "").strip()
    if custom:
        cmd = custom.split()
    else:
        cmd = ["/bin/bash", os.path.join(ROOT, "scripts", "team-up.sh"), "--layout"]

    t0 = time.monotonic()
    timed_out = False
    group_terminated = True
    eff_timeout = float(relayout_timeout) if relayout_timeout and relayout_timeout > 0 else None
    proc: Optional[subprocess.Popen[str]] = None
    rc: Optional[int] = 1
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=ROOT,
            env=os.environ.copy(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            pgid = os.getpgid(proc.pid)
        except Exception:
            pgid = proc.pid
        try:
            out_str, err_str = proc.communicate(timeout=eff_timeout)
            rc = proc.returncode if proc.returncode is not None else 1
            combined = (out_str or "") + (err_str or "")
        except subprocess.TimeoutExpired:
            timed_out = True
            rc = None
            group_terminated = _terminate_process_group(proc, pgid)
            try:
                out_str, err_str = proc.communicate(timeout=1.0)
            except Exception:
                out_str, err_str = "", ""
            combined = (out_str or "") + (err_str or "")
    except Exception as exc:
        rc = 1
        combined = f"relayout exec error: {exc}\n"
    finally:
        if proc is not None:
            for stream in (proc.stdout, proc.stderr):
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass

    elapsed = time.monotonic() - t0
    for line in combined.splitlines():
        logger.log(f"relayout: {line}")
    if timed_out:
        t_str = (
            str(int(eff_timeout))
            if eff_timeout is not None and float(eff_timeout).is_integer()
            else str(eff_timeout)
        )
        logger.log(f"relayout timeout after {t_str}s")
        logger.log(
            "relayout timeout: group terminated"
            if group_terminated
            else "relayout timeout: group still alive"
        )
        logger.log(f"relayout rc=timeout took={elapsed:.2f}s")
        return None, True

    logger.log(f"relayout rc={rc} took={elapsed:.2f}s")
    return rc, False


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
        raise argparse.ArgumentTypeError("must be a finite non-negative number (>= 0, 0 disables)")
    return val


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Watch and restore GJCH Herdr team layout.")
    parser.add_argument("--once", action="store_true", help="Check once (and repair if needed) without socket.")
    parser.add_argument("--quiet", type=float, default=2.0, help="Quiet seconds after last event before checking.")
    parser.add_argument("--limit", type=int, default=2, help="Max repairs within window.")
    parser.add_argument("--window", type=float, default=600.0, help="Repair limit window in seconds.")
    parser.add_argument("--max-run", type=float, default=None, help="Max runtime in seconds.")
    parser.add_argument("--liveness", type=float, default=60.0, help="Lead pane liveness check interval in seconds.")
    parser.add_argument(
        "--retry",
        type=positive_finite_float,
        default=10.0,
        help="Retry interval in seconds after an unknown check (> 0).",
    )
    parser.add_argument(
        "--unavailable-grace",
        type=non_negative_finite_float,
        default=300.0,
        help="Exit if lead pane liveness remains unknown for this many seconds (0 disables).",
    )
    parser.add_argument(
        "--relayout-timeout",
        type=non_negative_finite_float,
        default=120.0,
        help="Timeout in seconds for relayout command (0 disables).",
    )
    parser.add_argument("--backoff-min", type=float, default=1.0, help="Initial reconnect backoff in seconds.")
    parser.add_argument("--backoff-max", type=float, default=30.0, help="Max reconnect backoff in seconds.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    if os.environ.get("GJCH_LAYOUT_WATCH") == "0":
        return 0

    if os.environ.get("GJCH_EXTERNAL_LEAD") == "1":
        sys.stderr.write(
            "layout-watch: external lead tab (mate | critic) is not restacked by the sidebar; nothing to watch\n"
        )
        return 0

    lead_pane = os.environ.get("HERDR_PANE_ID", "").strip()
    if os.environ.get("HERDR_ENV") != "1" or not lead_pane or ":" not in lead_pane:
        sys.stderr.write(
            "layout-watch: HERDR_ENV=1 and HERDR_PANE_ID are required (run inside the Herdr lead pane)\n"
        )
        return 1

    watch_dir = os.environ.get("GJCH_LAYOUT_WATCH_DIR", "").strip() or os.path.join(
        ROOT, ".local", "team"
    )
    os.makedirs(watch_dir, exist_ok=True)

    lock_path = os.path.join(watch_dir, "layout-watch.lock")
    lock_fh = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.stderr.write("layout-watch: already running\n")
        lock_fh.close()
        return 0

    log_path = os.path.join(watch_dir, "layout-watch.log")
    state_path = os.path.join(watch_dir, "layout-watch.state")
    logger = Logger(log_path)

    mate_name = os.environ.get("GJCH_MATE_NAME", "").strip() or "gjc-herdr-mate"
    critic_name = os.environ.get("GJCH_CRITIC_NAME", "").strip() or "gjc-herdr-critic"
    lead_ws = lead_pane.split(":", 1)[0]
    sock_path = os.environ.get("HERDR_SOCKET_PATH", "").strip() or os.path.expanduser(
        "~/.config/herdr/herdr.sock"
    )

    started_at = time.monotonic()
    logger.log(
        f"start lead={lead_pane} ws={lead_ws} mate={mate_name} critic={critic_name} "
        f"mode={'once' if args.once else 'watch'}"
    )

    repairs: List[float] = []
    limit_notified = False
    last_repair_rc: Optional[int] = None
    awaiting_post_repair_ok = False
    state_Lock = threading.Lock()
    first_event_at: Optional[float] = None
    last_event_at: Optional[float] = None
    event_count = 0
    event_pending = False
    immediate_event_pending = False
    subscribed_pending = False
    reconnect_pending = False
    retry_at: Optional[float] = None
    stop_event = threading.Event()
    wake_event = threading.Event()
    gone_detected = threading.Event()
    unavailable_detected = threading.Event()
    relayout_timed_out = threading.Event()
    last_liveness_at = started_at
    last_lead_ok_at = started_at
    lead_unknown = False

    def mark_lead_ok() -> None:
        nonlocal last_lead_ok_at, lead_unknown
        last_lead_ok_at = time.monotonic()
        lead_unknown = False

    def handle_check(
        trigger: str,
        *,
        ev_count: int = 0,
        ev_waited: float = 0.0,
        allow_repair: bool = True,
    ) -> str:
        nonlocal repairs, limit_notified, last_repair_rc, awaiting_post_repair_ok
        nonlocal first_event_at, last_event_at, event_pending, retry_at
        nonlocal last_liveness_at, lead_unknown
        status, tab_id, detail, mate_pane, critic_pane = check_layout(
            lead_pane, mate_name, critic_name, on_lead_ok=mark_lead_ok
        )
        last_liveness_at = time.monotonic()
        if status == "unknown" and detail in ("pane_lookup_failed", "pane_invalid"):
            lead_unknown = True
        if trigger == "event":
            logger.log(
                f"check trigger={trigger} status={status} tab={tab_id or '-'} "
                f"detail={detail} events={ev_count} waited={ev_waited:.2f}s"
            )
        else:
            logger.log(
                f"check trigger={trigger} status={status} tab={tab_id or '-'} detail={detail}"
            )
        if status == "unknown":
            if (
                not args.once
                and lead_unknown
                and args.unavailable_grace is not None
                and args.unavailable_grace > 0
                and (time.monotonic() - last_lead_ok_at) >= args.unavailable_grace
            ):
                unavailable_detected.set()
                stop_event.set()
                wake_event.set()
                return "unavailable"
            with state_Lock:
                retry_at = time.monotonic() + max(0.01, float(args.retry))
            return status

        with state_Lock:
            retry_at = None

        if status == "gone":
            gone_detected.set()
            stop_event.set()
            wake_event.set()
            return status
        if status == "ok":
            limit_notified = False
            if awaiting_post_repair_ok:
                write_state(state_path, "ok", tab_id, last_repair_rc)
                awaiting_post_repair_ok = False
            return status
        if status != "off" or not allow_repair:
            return status

        now = time.monotonic()
        repairs = [t for t in repairs if now - t < args.window]
        if len(repairs) >= args.limit:
            logger.log(
                f"limit reached tab={tab_id or '-'} repairs={len(repairs)}/{args.limit} window={args.window}s"
            )
            write_state(state_path, "limit", tab_id, last_repair_rc)
            awaiting_post_repair_ok = False
            if not limit_notified:
                limit_notified = True
                notify_limit(tab_id, args.window, args.limit)
            return status

        rc, timed_out = run_relayout(logger, args.relayout_timeout)
        if timed_out:
            record_relayout_timeout(
                logger=logger,
                state_path=state_path,
                orig_tab_id=tab_id,
                lead_pane=lead_pane,
                mate_pane=mate_pane,
                critic_pane=critic_pane,
                lead_ws=lead_ws,
            )
            logger.log("exit reason=relayout_timeout rc=2")
            relayout_timed_out.set()
            stop_event.set()
            wake_event.set()
            return "relayout_timeout"

        repairs.append(now)
        last_repair_rc = rc
        if rc == 3:
            logger.log("exit reason=lock_lost rc=0")
            stop_event.set()
            wake_event.set()
            return "lock_lost"
        awaiting_post_repair_ok = True
        with state_Lock:
            now_after = time.monotonic()
            if first_event_at is None:
                first_event_at = now_after
            last_event_at = now_after
            event_pending = True
        return status

    try:
        first_status = handle_check("start")
        if first_status == "relayout_timeout":
            return 2
        if args.once or first_status in ("gone", "lock_lost", "unavailable"):
            if args.once:
                if awaiting_post_repair_ok and first_status == "off":
                    verify_status = handle_check("verify", allow_repair=False)
                    if verify_status == "gone":
                        logger.log("exit reason=gone rc=0")
                        return 0
                logger.log("exit reason=once rc=0")
            elif first_status == "gone":
                logger.log("exit reason=gone rc=0")
            elif first_status == "unavailable":
                logger.log("exit reason=unavailable rc=0")
            return 0

        def reader_loop() -> None:
            nonlocal first_event_at, last_event_at, event_count
            nonlocal event_pending, immediate_event_pending, subscribed_pending, reconnect_pending
            attempt = 0
            has_subscribed_once = False
            backoff = max(0.01, float(args.backoff_min))
            max_backoff = max(backoff, float(args.backoff_max))

            while not stop_event.is_set():
                attempt += 1
                s: Optional[socket.socket] = None
                had_event = False
                try:
                    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    s.settimeout(0.5)
                    s.connect(sock_path)
                    req_id = f"gjch-layout-watch-{attempt}"
                    sub_msg = {
                        "id": req_id,
                        "method": "events.subscribe",
                        "params": {
                            "subscriptions": [{"type": t} for t in SUBSCRIPTION_TYPES]
                        },
                    }
                    s.sendall((json.dumps(sub_msg) + "\n").encode("utf-8"))
                    buf = b""
                    while not stop_event.is_set():
                        try:
                            chunk = s.recv(65536)
                        except socket.timeout:
                            continue
                        if not chunk:
                            logger.log("socket closed (eof)")
                            break
                        buf += chunk
                        while b"\n" in buf:
                            raw_line, buf = buf.split(b"\n", 1)
                            line_str = raw_line.decode("utf-8", errors="replace").strip()
                            if not line_str:
                                continue
                            try:
                                msg = json.loads(line_str)
                            except Exception:
                                continue
                            if not isinstance(msg, dict):
                                continue
                            res_obj = msg.get("result")
                            if (
                                msg.get("id") == req_id
                                or (
                                    isinstance(res_obj, dict)
                                    and res_obj.get("type") == "subscription_started"
                                )
                            ):
                                logger.log(f"subscribed id={req_id} attempt={attempt}")
                                with state_Lock:
                                    if not has_subscribed_once:
                                        has_subscribed_once = True
                                        subscribed_pending = True
                                    else:
                                        subscribed_pending = False
                                        reconnect_pending = True
                                wake_event.set()
                                continue
                            had_event = True
                            if is_relevant_event(msg, lead_ws):
                                now_ev = time.monotonic()
                                ws_closed = is_lead_workspace_closed(msg, lead_ws)
                                with state_Lock:
                                    if first_event_at is None:
                                        first_event_at = now_ev
                                    last_event_at = now_ev
                                    event_count += 1
                                    event_pending = True
                                    if ws_closed:
                                        immediate_event_pending = True
                                if ws_closed:
                                    wake_event.set()
                except Exception as exc:
                    if not stop_event.is_set():
                        logger.log(f"socket error: {exc}")
                finally:
                    if s is not None:
                        try:
                            s.close()
                        except Exception:
                            pass

                if stop_event.is_set():
                    break

                if had_event:
                    backoff = max(0.01, float(args.backoff_min))
                wait_sec = backoff
                logger.log(f"reconnect wait={wait_sec:.2f}s attempt={attempt + 1}")
                wait_deadline = time.monotonic() + wait_sec
                while not stop_event.is_set():
                    remaining = wait_deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    time.sleep(min(0.05, remaining))
                backoff = min(max_backoff, backoff * 2.0)

        reader = threading.Thread(target=reader_loop, daemon=True)
        reader.start()

        liveness_interval = float(args.liveness) if args.liveness and args.liveness > 0 else 0.0
        if (
            args.unavailable_grace is not None
            and args.unavailable_grace > 0
            and (liveness_interval <= 0 or float(args.unavailable_grace) / 2.0 < liveness_interval)
        ):
            liveness_interval = max(0.05, float(args.unavailable_grace) / 2.0)

        liveness_step = liveness_interval / 6.0 if liveness_interval > 0 else 0.1
        retry_step = float(args.retry) / 4.0 if args.retry and args.retry > 0 else 0.1
        step = max(0.02, min(0.1, float(args.quiet) / 4.0, liveness_step, retry_step))
        while not stop_event.is_set():
            if args.max_run is not None and (time.monotonic() - started_at) >= args.max_run:
                stop_event.set()
                logger.log("exit reason=max_run rc=0")
                break

            check_trigger: Optional[str] = None
            ev_count = 0
            ev_first: Optional[float] = None
            now_loop = time.monotonic()
            with state_Lock:
                event_ready = event_pending and (
                    immediate_event_pending
                    or (
                        last_event_at is not None
                        and (now_loop - last_event_at) >= args.quiet
                    )
                )
                retry_ready = retry_at is not None and now_loop >= retry_at
                if reconnect_pending or subscribed_pending:
                    check_trigger = "reconnect" if reconnect_pending else "subscribed"
                    reconnect_pending = False
                    subscribed_pending = False
                    if event_ready:
                        event_count = 0
                        first_event_at = None
                        event_pending = False
                        immediate_event_pending = False
                elif event_ready:
                    ev_count = event_count
                    ev_first = first_event_at
                    event_count = 0
                    first_event_at = None
                    event_pending = False
                    immediate_event_pending = False
                    check_trigger = "event"
                elif retry_ready:
                    retry_at = None
                    check_trigger = "retry"

            if check_trigger is not None:
                check_started = time.monotonic()
                if check_trigger == "event":
                    ev_waited = (
                        max(0.0, check_started - ev_first)
                        if ev_first is not None
                        else 0.0
                    )
                    st = handle_check("event", ev_count=ev_count, ev_waited=ev_waited)
                else:
                    st = handle_check(check_trigger)
                if st in ("gone", "lock_lost", "unavailable", "relayout_timeout"):
                    break
                with state_Lock:
                    if (
                        event_pending
                        and last_event_at is not None
                        and last_event_at >= check_started
                    ):
                        last_event_at = max(last_event_at, time.monotonic())
                continue

            if (
                args.unavailable_grace is not None
                and args.unavailable_grace > 0
                and (time.monotonic() - last_lead_ok_at) >= args.unavailable_grace
            ):
                last_liveness_at = time.monotonic()
                lead_st, _ = check_lead_pane(lead_pane)
                if lead_st == "ok":
                    mark_lead_ok()
                elif lead_st == "gone":
                    gone_detected.set()
                    stop_event.set()
                    break
                else:
                    lead_unknown = True
                    unavailable_detected.set()
                    stop_event.set()
                    break

            if liveness_interval > 0 and (time.monotonic() - last_liveness_at) >= liveness_interval:
                last_liveness_at = time.monotonic()
                lead_st, _ = check_lead_pane(lead_pane)
                if lead_st == "ok":
                    mark_lead_ok()
                elif lead_st == "gone":
                    gone_detected.set()
                    stop_event.set()
                    break
                else:
                    lead_unknown = True
                    if (
                        args.unavailable_grace is not None
                        and args.unavailable_grace > 0
                        and (time.monotonic() - last_lead_ok_at) >= args.unavailable_grace
                    ):
                        unavailable_detected.set()
                        stop_event.set()
                        break

            wake_event.wait(step)
            wake_event.clear()

        if relayout_timed_out.is_set():
            return 2
        if gone_detected.is_set():
            logger.log("exit reason=gone rc=0")
        elif unavailable_detected.is_set():
            logger.log("exit reason=unavailable rc=0")
        return 0
    finally:
        stop_event.set()
        wake_event.set()
        logger.close()
        try:
            lock_fh.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
