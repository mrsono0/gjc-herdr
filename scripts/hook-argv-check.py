#!/usr/bin/env python3
"""SessionStart(startup) hook 전용 팀원·검토 argv 동기 점검(#42, #58).

Python 한 프로세스 안에서 단일 time.monotonic() 마감 시각을 공유하며:
1) (inside) 팀장 pane cwd 확인 (herdr pane get)
2) 팀원(mate)·검토(critic, codex_enabled일 때) herdr agent get
3) (external에서 workspace_id·agent·cwd가 비었을 때만) 보조 herdr pane get
4) 존재하는 대상마다 herdr pane process-info --pane <pane>
5) scripts/agent-argv-check.py의 비교 논리로 기대 단위와 대조해 GJCH: 접두사로 출력한다.
"""

import importlib.util
import json
import math
import os
import signal
import subprocess
import sys
import time
from typing import List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
	sys.path.insert(0, SCRIPT_DIR)

sys.dont_write_bytecode = True
checker = __import__("agent-argv-check")


def _load_dialog_watch():
	spec = importlib.util.spec_from_file_location(
		"dialog_watch", os.path.join(SCRIPT_DIR, "dialog-watch.py")
	)
	if spec is None or spec.loader is None:
		raise ImportError("dialog-watch.py 로드 실패")
	mod = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(mod)
	return mod


dialog_watch = _load_dialog_watch()

TIMEOUT_MSG = "GJCH: ↳ 팀원 옵션 점검 시간 초과 — scripts/check-env.sh로 다시 점검"
DEFAULT_TIMEOUT = 3.0
CHECK_DEFAULT_TIMEOUT = 10.0
MAX_TIMEOUT = 30.0


def parse_timeout(raw: str, default: float = DEFAULT_TIMEOUT) -> float:
	try:
		val = float(raw)
	except Exception:
		return default
	if not math.isfinite(val) or val <= 0:
		return default
	return min(val, MAX_TIMEOUT)


def run_herdr(
	args: List[str], deadline: float, *, combined: bool = False
) -> Tuple[int, str]:
	rem = deadline - time.monotonic()
	if rem <= 0:
		return 124, ""
	err = subprocess.STDOUT if combined else subprocess.DEVNULL
	try:
		p = subprocess.Popen(
			["herdr"] + args,
			stdin=subprocess.DEVNULL,
			stdout=subprocess.PIPE,
			stderr=err,
			text=True,
			start_new_session=True,
		)
	except Exception:
		return 1, ""
	try:
		out, _ = p.communicate(timeout=rem)
	except subprocess.TimeoutExpired:
		try:
			os.killpg(p.pid, signal.SIGKILL)
		except Exception:
			p.kill()
		try:
			p.communicate(timeout=0.2)
		except Exception:
			pass
		return 124, ""
	return p.returncode, out or ""


def inside_lead_cwd_ok(pane_id: str, real_root: str, deadline: float) -> int:
	"""0: 프로젝트 안, 1: 프로젝트 밖 또는 조회 실패, 124: 시간 초과."""
	if not pane_id:
		return 1
	rc, out = run_herdr(["pane", "get", pane_id], deadline, combined=False)
	if rc == 124:
		return 124
	if rc != 0:
		return 1
	try:
		d = json.loads(out)
		if not isinstance(d, dict):
			return 1
		res = d.get("result")
		if not isinstance(res, dict):
			return 1
		pane = res.get("pane")
		if not isinstance(pane, dict):
			return 1
		pane_cwd = pane.get("cwd")
		if not isinstance(pane_cwd, str) or not pane_cwd:
			return 1
		real_cwd = os.path.realpath(pane_cwd)
		root_prefix = real_root.rstrip("/") + "/"
		cwd_with_slash = real_cwd.rstrip("/") + "/"
		return 0 if cwd_with_slash.startswith(root_prefix) else 1
	except Exception:
		return 1


def inside_agent_pane_status(
	name: str, deadline: float
) -> Tuple[int, Optional[Tuple[str, str]]]:
	"""(0, (pane_id, status)) 존재, (0, None) 부재, (1, None) 조회·파싱 실패, (124, None) 시간 초과."""
	rc, out = run_herdr(["agent", "get", name], deadline, combined=True)
	if rc == 124:
		return 124, None
	try:
		d = json.loads(out)
		if not isinstance(d, dict):
			return 1, None
		if rc == 0:
			res = d.get("result")
			if not isinstance(res, dict):
				return 1, None
			a = res.get("agent")
			if not isinstance(a, dict):
				return 1, None
			p = a.get("pane_id")
			if not isinstance(p, str) or not p:
				return 1, None
			raw_s = a.get("agent_status")
			s = raw_s if isinstance(raw_s, str) and raw_s else "idle"
			return 0, (p, s)
		err = d.get("error")
		err_code = err.get("code") if isinstance(err, dict) else None
		if err_code == "agent_not_found":
			return 0, None
		return 1, None
	except Exception:
		return 1, None


def ext_agent_pane_status(
	name: str,
	expected_kind: str,
	cwd_mode: str,
	real_root: str,
	deadline: float,
) -> Tuple[int, Optional[Tuple[str, str]]]:
	"""외부 팀장용 기존 agent 검증: (0, (pane_id, status)) 유효, (0, None) 부재, (1, None) 불일치/실패, (124, None) 시간 초과."""
	rc, out = run_herdr(["agent", "get", name], deadline, combined=True)
	if rc == 124:
		return 124, None
	try:
		d = json.loads(out)
		if not isinstance(d, dict):
			return 1, None
		if rc != 0:
			err = d.get("error")
			err_code = err.get("code") if isinstance(err, dict) else None
			if err_code == "agent_not_found":
				return 0, None
			return 1, None
		res = d.get("result")
		if not isinstance(res, dict):
			return 1, None
		a = res.get("agent")
		if not isinstance(a, dict):
			return 1, None
		p = a.get("pane_id")
		if not isinstance(p, str) or not p:
			return 1, None
		w = a.get("workspace_id") if isinstance(a.get("workspace_id"), str) else ""
		k = a.get("agent") if isinstance(a.get("agent"), str) else ""
		fg_c = a.get("foreground_cwd") if isinstance(a.get("foreground_cwd"), str) else ""
		base_c = a.get("cwd") if isinstance(a.get("cwd"), str) else ""
		c = fg_c or base_c
		raw_s = a.get("agent_status")
		s = raw_s if isinstance(raw_s, str) and raw_s else "idle"
	except Exception:
		return 1, None

	if not w or not k or not c:
		pane_rc, pane_out = run_herdr(["pane", "get", p], deadline, combined=False)
		if pane_rc == 124:
			return 124, None
		if pane_rc == 0 and pane_out:
			try:
				pane_doc = json.loads(pane_out)
				pane_res = pane_doc.get("result") if isinstance(pane_doc, dict) else None
				pd = pane_res.get("pane") if isinstance(pane_res, dict) else None
				if isinstance(pd, dict):
					if not w and isinstance(pd.get("workspace_id"), str):
						w = pd.get("workspace_id") or ""
					if not k and isinstance(pd.get("agent"), str):
						k = pd.get("agent") or ""
					if not c:
						p_fg = (
							pd.get("foreground_cwd")
							if isinstance(pd.get("foreground_cwd"), str)
							else ""
						)
						p_c = pd.get("cwd") if isinstance(pd.get("cwd"), str) else ""
						c = p_fg or p_c
			except Exception:
				pass

	if not w or k != expected_kind or not c:
		return 1, None
	try:
		real_c = os.path.realpath(c)
		if cwd_mode == "exact":
			if real_c != real_root:
				return 1, None
		else:
			root_prefix = real_root.rstrip("/") + "/"
			c_with_slash = real_c.rstrip("/") + "/"
			if not c_with_slash.startswith(root_prefix):
				return 1, None
		return 0, (p, s)
	except Exception:
		return 1, None


def inspect_process_info_for_check(
	raw_stdin: str,
	*,
	process_info_failed: bool,
	kind: str,
	expected_units: List[Tuple[str, Optional[str]]],
) -> Tuple[str, str, List[str], List[str]]:
	"""process-info JSON을 비교해 ('ok'|'unknown', 사유, 실제불일치목록, 기대목록)을 돌려준다."""
	if process_info_failed:
		return "unknown", "process-info 실패", [], []

	try:
		doc = json.loads(raw_stdin)
	except Exception:
		return "unknown", "JSON 오류", [], []

	if not isinstance(doc, dict):
		return "unknown", "JSON 오류", [], []

	result_obj = doc.get("result")
	if not isinstance(result_obj, dict):
		return "unknown", "JSON 오류", [], []

	proc_info = result_obj.get("process_info")
	if not isinstance(proc_info, dict):
		return "unknown", "JSON 오류", [], []

	fg_procs = proc_info.get("foreground_processes")
	if not isinstance(fg_procs, list):
		return "unknown", "JSON 오류", [], []

	matched_procs = []
	for entry in fg_procs:
		if not isinstance(entry, dict):
			return "unknown", "JSON 오류", [], []
		proc_name = entry.get("name")
		if (
			isinstance(proc_name, str)
			and proc_name
			and checker.basename_of(proc_name) == kind
		):
			matched_procs.append(entry)

	if len(matched_procs) == 0:
		return "unknown", "agent 프로세스 0개", [], []
	if len(matched_procs) >= 2:
		return "unknown", "agent 프로세스 2개 이상", [], []

	target_proc = matched_procs[0]
	raw_argv = target_proc.get("argv")
	if (
		not isinstance(raw_argv, list)
		or len(raw_argv) == 0
		or any(not isinstance(tok, str) for tok in raw_argv)
	):
		return "unknown", "argv 없음", [], []

	actual_units = checker.group_argv_units(raw_argv[1:])

	actual_parts: List[str] = []
	expected_parts: List[str] = []

	for exp_flag, exp_val in expected_units:
		exp_unit_str = exp_flag if exp_val is None else f"{exp_flag} {exp_val}"
		same_flag_vals = [val for (flag, val) in actual_units if flag == exp_flag]
		if not same_flag_vals:
			actual_parts.append(f"없음:{exp_flag}")
			expected_parts.append(exp_unit_str)
		elif exp_val is not None and exp_val not in same_flag_vals:
			actual_parts.append(f"다름:{exp_flag}")
			expected_parts.append(exp_unit_str)

	return "ok", "", actual_parts, expected_parts


def format_status_member_line(
	name: str,
	pane: str,
	kind: str,
	opt_str: str,
	agent_status: str,
	dialog: str = "없음",
) -> str:
	return f"- 팀원: {name} {pane} {kind} 옵션 일치 {opt_str} resume 해당 없음 확인창 {dialog} 상태 {agent_status}"


def read_member_dialog(
	name: str, status: str, deadline: float
) -> Tuple[Optional[str], str, List[str]]:
	"""팀원 보이는 화면(--source visible)을 읽어 (check용 종류|None, status용 '종류'|'없음'|'모름', 미확인 사유)를 돌려준다."""
	rc, out = run_herdr(
		["agent", "read", name, "--source", "visible"],
		deadline,
		combined=False,
	)
	if rc != 0:
		return None, "모름", [f"{name} 확인창 모름"]
	text = out
	stripped = out.lstrip()
	if stripped.startswith("{"):
		try:
			doc = json.loads(stripped)
			if isinstance(doc, dict):
				res_obj = doc.get("result")
				if isinstance(res_obj, dict):
					read_obj = res_obj.get("read")
					if isinstance(read_obj, dict) and isinstance(read_obj.get("text"), str):
						text = read_obj["text"]
					elif isinstance(res_obj.get("text"), str):
						text = res_obj["text"]
				elif isinstance(doc.get("text"), str):
					text = doc["text"]
		except Exception:
			pass
	window_text, _ = dialog_watch.prepare_window(text)
	if not window_text.strip():
		return None, "모름", [f"{name} 확인창 모름"]
	judged = dialog_watch.judge_screen(window_text, status)
	if judged is not None:
		kind = judged[0]
		return kind, kind, []
	return None, "없음", []


def evaluate_member_base(
	name: str,
	expected_kind: str,
	cwd_mode: str,
	real_root: str,
	expected_units: List[Tuple[str, Optional[str]]],
	deadline: float,
) -> Tuple[str, str, str, str, str, str, List[str], bool]:
	"""화면 읽기 전 팀원 옵션·cwd 점검을 수행한다.

	반환: (state, check_base_line, pane_id, opt_str, status_for_report, effective_status, base_reasons, should_read_dialog)
	"""
	rc, out = run_herdr(["agent", "get", name], deadline, combined=True)
	if rc == 124:
		return (
			"unknown",
			f"{name} - unknown 시간 초과",
			"-",
			"?(시간 초과)",
			"없음",
			"idle",
			[f"{name} 시간 초과"],
			False,
		)
	try:
		d = json.loads(out)
	except Exception:
		d = None
	if not isinstance(d, dict):
		return (
			"unknown",
			f"{name} - unknown JSON 오류",
			"-",
			"?(JSON 오류)",
			"없음",
			"idle",
			[f"{name} JSON 오류"],
			False,
		)
	if rc != 0:
		err = d.get("error")
		err_code = err.get("code") if isinstance(err, dict) else None
		if err_code == "agent_not_found":
			return (
				"mismatch",
				f"{name} - mismatch 실제=없음 기대=실행 중",
				"-",
				"×(실제=없음)",
				"없음",
				"idle",
				[],
				False,
			)
		return (
			"unknown",
			f"{name} - unknown agent 조회 실패",
			"-",
			"?(agent 조회 실패)",
			"없음",
			"idle",
			[f"{name} agent 조회 실패"],
			False,
		)

	res = d.get("result")
	a = res.get("agent") if isinstance(res, dict) else None
	p = a.get("pane_id") if isinstance(a, dict) else None
	if not isinstance(p, str) or not p:
		return (
			"unknown",
			f"{name} - unknown JSON 오류",
			"-",
			"?(JSON 오류)",
			"없음",
			"idle",
			[f"{name} JSON 오류"],
			False,
		)

	k = a.get("agent") if isinstance(a.get("agent"), str) else ""
	fg_c = a.get("foreground_cwd") if isinstance(a.get("foreground_cwd"), str) else ""
	base_c = a.get("cwd") if isinstance(a.get("cwd"), str) else ""
	c = fg_c or base_c
	raw_s = a.get("agent_status")
	s = raw_s if isinstance(raw_s, str) and raw_s else ""

	if not k or not c or not s:
		pane_rc, pane_out = run_herdr(["pane", "get", p], deadline, combined=False)
		if pane_rc == 124:
			bs = " (blocked)" if s == "blocked" else ""
			st_for_status = s if s else "없음"
			eff_s = s if s else "idle"
			reasons = [f"{name} 시간 초과"]
			if not s:
				reasons.append(f"{name} 상태 모름")
			reasons.append(f"{name} 확인창 모름")
			return (
				"unknown",
				f"{name} {p} unknown 시간 초과{bs}",
				p,
				"?(시간 초과)",
				st_for_status,
				eff_s,
				reasons,
				False,
			)
		if pane_rc == 0 and pane_out:
			try:
				pane_doc = json.loads(pane_out)
				pane_res = pane_doc.get("result") if isinstance(pane_doc, dict) else None
				pd = pane_res.get("pane") if isinstance(pane_res, dict) else None
				if isinstance(pd, dict):
					if not k and isinstance(pd.get("agent"), str):
						k = pd.get("agent") or ""
					if not c:
						p_fg = (
							pd.get("foreground_cwd")
							if isinstance(pd.get("foreground_cwd"), str)
							else ""
						)
						p_c = pd.get("cwd") if isinstance(pd.get("cwd"), str) else ""
						c = p_fg or p_c
					if not s and isinstance(pd.get("agent_status"), str):
						s = pd.get("agent_status") or ""
			except Exception:
				pass

	status_for_report = s if s else "없음"
	extra_status_reasons: List[str] = [f"{name} 상태 모름"] if not s else []
	if not s:
		s = "idle"
	blocked_suffix = " (blocked)" if s == "blocked" else ""

	cwd_ok: Optional[bool] = None
	if c:
		try:
			real_c = os.path.realpath(c)
			if cwd_mode == "exact":
				cwd_ok = real_c == real_root
			else:
				root_prefix = real_root.rstrip("/") + "/"
				c_with_slash = real_c.rstrip("/") + "/"
				cwd_ok = c_with_slash.startswith(root_prefix)
		except Exception:
			cwd_ok = None

	info_rc, info_out = run_herdr(
		["pane", "process-info", "--pane", p], deadline, combined=False
	)
	if info_rc == 124:
		return (
			"unknown",
			f"{name} {p} unknown 시간 초과{blocked_suffix}",
			p,
			"?(시간 초과)",
			status_for_report,
			s,
			[f"{name} 시간 초과"] + extra_status_reasons + [f"{name} 확인창 모름"],
			False,
		)

	proc_state, proc_reason, actual_parts, expected_parts = inspect_process_info_for_check(
		info_out if info_rc == 0 else "",
		process_info_failed=(info_rc != 0),
		kind=expected_kind,
		expected_units=expected_units,
	)

	if k and k != expected_kind:
		actual_parts.append("agent:다름")
		expected_parts.append(f"agent:{expected_kind}")
	if cwd_ok is False:
		actual_parts.append("cwd:다름")
		expected_parts.append(f"cwd:{real_root}")

	if proc_state == "unknown":
		if actual_parts:
			act_str = ",".join(actual_parts)
			return (
				"mismatch",
				f"{name} {p} mismatch 실제={act_str} 기대={','.join(expected_parts)}",
				p,
				f"×(실제={act_str})",
				status_for_report,
				s,
				extra_status_reasons,
				True,
			)
		return (
			"unknown",
			f"{name} {p} unknown {proc_reason}",
			p,
			f"?({proc_reason})",
			status_for_report,
			s,
			[f"{name} {proc_reason}"] + extra_status_reasons,
			True,
		)

	if actual_parts:
		act_str = ",".join(actual_parts)
		return (
			"mismatch",
			f"{name} {p} mismatch 실제={act_str} 기대={','.join(expected_parts)}",
			p,
			f"×(실제={act_str})",
			status_for_report,
			s,
			extra_status_reasons,
			True,
		)

	if cwd_ok is None:
		return (
			"unknown",
			f"{name} {p} unknown cwd 미확인",
			p,
			"?(cwd 미확인)",
			status_for_report,
			s,
			[f"{name} cwd 미확인"] + extra_status_reasons,
			True,
		)

	return (
		"ok",
		f"{name} {p} ok",
		p,
		"○",
		status_for_report,
		s,
		extra_status_reasons,
		True,
	)


def finalize_member_dialog(
	name: str,
	expected_kind: str,
	base: Tuple[str, str, str, str, str, str, List[str], bool],
	deadline: float,
) -> Tuple[str, str, str, List[str]]:
	st, check_base, p, opt_str, status_for_report, eff_s, base_reasons, should_read = base
	reasons = list(base_reasons)
	if should_read:
		dialog_kind, dialog_for_status, dialog_reasons = read_member_dialog(
			name, eff_s, deadline
		)
		reasons.extend(dialog_reasons)
		if dialog_kind:
			check_suffix = f" (dialog={dialog_kind})"
		elif eff_s == "blocked":
			check_suffix = " (blocked)"
		else:
			check_suffix = ""
		check_line = f"{check_base}{check_suffix}"
	else:
		check_line = check_base
		dialog_for_status = (
			"모름" if f"{name} 확인창 모름" in reasons else "없음"
		)
	status_line = format_status_member_line(
		name, p, expected_kind, opt_str, status_for_report, dialog_for_status
	)
	return st, check_line, status_line, reasons


def evaluate_member_detail(
	name: str,
	expected_kind: str,
	cwd_mode: str,
	real_root: str,
	expected_units: List[Tuple[str, Optional[str]]],
	deadline: float,
) -> Tuple[str, str, str, List[str]]:
	"""('ok'|'mismatch'|'unknown', check 한 줄, status 한 줄, 미확인 사유 목록)을 돌려준다."""
	base = evaluate_member_base(
		name, expected_kind, cwd_mode, real_root, expected_units, deadline
	)
	return finalize_member_dialog(name, expected_kind, base, deadline)


def evaluate_member_for_check(
	name: str,
	expected_kind: str,
	cwd_mode: str,
	real_root: str,
	expected_units: List[Tuple[str, Optional[str]]],
	deadline: float,
) -> Tuple[str, str]:
	"""('ok'|'mismatch'|'unknown', 출력 한 줄)을 돌려준다."""
	st, check_line, _, _ = evaluate_member_detail(
		name, expected_kind, cwd_mode, real_root, expected_units, deadline
	)
	return st, check_line


def get_lock_line(real_root: str, deadline: float) -> str:
	rem = deadline - time.monotonic()
	if rem <= 0:
		return "lock unknown"
	lead_sh = os.path.join(real_root, "scripts", "team-lead.sh")
	try:
		p = subprocess.Popen(
			["/bin/bash", lead_sh, "status"],
			stdin=subprocess.DEVNULL,
			stdout=subprocess.PIPE,
			stderr=subprocess.DEVNULL,
			text=True,
			start_new_session=True,
		)
	except Exception:
		return "lock unknown"
	try:
		out, _ = p.communicate(timeout=rem)
	except subprocess.TimeoutExpired:
		try:
			os.killpg(p.pid, signal.SIGKILL)
		except Exception:
			p.kill()
		try:
			p.communicate(timeout=0.2)
		except Exception:
			pass
		return "lock unknown"
	if p.returncode != 0:
		return "lock unknown"
	words = (out or "").strip().split()
	if not words:
		return "lock unknown"
	first = words[0]
	if first == "none":
		return "lock none"
	if first == "mine":
		return "lock mine"
	if first == "other":
		return "lock other live"
	if first == "stale":
		return "lock stale"
	return "lock unknown"


def run_git(real_root: str, args: List[str], deadline: float) -> Tuple[int, str]:
	rem = deadline - time.monotonic()
	if rem <= 0:
		return 124, ""
	try:
		p = subprocess.Popen(
			[
				"git",
				"--no-optional-locks",
				"-c",
				"core.fsmonitor=false",
				"-C",
				real_root,
			]
			+ args,
			stdin=subprocess.DEVNULL,
			stdout=subprocess.PIPE,
			stderr=subprocess.DEVNULL,
			text=True,
			start_new_session=True,
		)
	except Exception:
		return 1, ""
	try:
		out, _ = p.communicate(timeout=rem)
	except subprocess.TimeoutExpired:
		try:
			os.killpg(p.pid, signal.SIGKILL)
		except Exception:
			p.kill()
		try:
			p.communicate(timeout=0.2)
		except Exception:
			pass
		return 124, ""
	return p.returncode, out or ""


def get_git_status_line(real_root: str, deadline: float) -> Tuple[str, bool]:
	rc1, out1 = run_git(real_root, ["rev-parse", "--abbrev-ref", "HEAD"], deadline)
	branch = out1.strip()
	if rc1 != 0 or not branch:
		return "- 저장소: 모름", False
	rc2, out2 = run_git(real_root, ["rev-parse", "--short", "HEAD"], deadline)
	short_sha = out2.strip()
	if rc2 != 0 or not short_sha:
		return "- 저장소: 모름", False
	rc3, out3 = run_git(real_root, ["status", "--porcelain"], deadline)
	if rc3 != 0:
		return "- 저장소: 모름", False
	dirty_count = sum(1 for ln in out3.splitlines() if ln.strip())
	tree_str = "깨끗" if dirty_count == 0 else f"미커밋 {dirty_count}"
	return f"- 저장소: {branch} @{short_sha}, 작업 트리 {tree_str}", True


def main() -> int:
	argv = sys.argv[1:]
	fmt = "hook"
	if len(argv) >= 2 and argv[0] == "--format":
		fmt = argv[1]
		argv = argv[2:]
	elif len(argv) >= 1 and argv[0].startswith("--format="):
		fmt = argv[0].split("=", 1)[1]
		argv = argv[1:]

	is_report_fmt = fmt in ("check", "status")
	if len(argv) < 8:
		return 2 if is_report_fmt else 0
	raw_timeout = argv[0]
	lead_mode = argv[1]
	root = argv[2]
	herdr_pane_id = argv[3]
	mate_name = argv[4]
	critic_name = argv[5]
	codex_on = argv[6] == "1"

	try:
		mate_argc = int(argv[7])
	except Exception:
		return 2 if is_report_fmt else 0
	if mate_argc < 0:
		return 2 if is_report_fmt else 0
	critic_count_idx = 8 + mate_argc
	if len(argv) < critic_count_idx + 1:
		return 2 if is_report_fmt else 0
	try:
		critic_argc = int(argv[critic_count_idx])
	except Exception:
		return 2 if is_report_fmt else 0
	if critic_argc < 0:
		return 2 if is_report_fmt else 0
	if len(argv) != critic_count_idx + 1 + critic_argc:
		return 2 if is_report_fmt else 0

	mate_start_args = argv[8:critic_count_idx]
	critic_start_args = argv[critic_count_idx + 1 :]

	default_timeout = CHECK_DEFAULT_TIMEOUT if is_report_fmt else DEFAULT_TIMEOUT
	deadline = time.monotonic() + parse_timeout(raw_timeout, default_timeout)
	real_root = os.path.realpath(root)

	expected_by_kind = {
		"agy": checker.parse_expected_units(mate_start_args),
		"codex": checker.parse_expected_units(critic_start_args),
	}

	if fmt == "check":
		check_targets = [(mate_name, "agy", "inside")]
		if codex_on:
			check_targets.append((critic_name, "codex", "exact"))
		states: List[str] = []
		base_entries = []
		for t_name, t_kind, t_cwd_mode in check_targets:
			base = evaluate_member_base(
				t_name,
				t_kind,
				t_cwd_mode,
				real_root,
				expected_by_kind[t_kind],
				deadline,
			)
			states.append(base[0])
			base_entries.append((t_name, t_kind, base))
		lock_line = get_lock_line(real_root, deadline)
		for t_name, t_kind, base in base_entries:
			_, line, _, _ = finalize_member_dialog(t_name, t_kind, base, deadline)
			print(line, flush=True)
		print(lock_line, flush=True)
		if "mismatch" in states:
			return 1
		if "unknown" in states or lock_line == "lock unknown":
			return 2
		return 0

	if fmt == "status":
		status_targets = [(mate_name, "agy", "inside")]
		if codex_on:
			status_targets.append((critic_name, "codex", "exact"))
		status_states: List[str] = []
		base_entries = []
		for t_name, t_kind, t_cwd_mode in status_targets:
			base = evaluate_member_base(
				t_name,
				t_kind,
				t_cwd_mode,
				real_root,
				expected_by_kind[t_kind],
				deadline,
			)
			status_states.append(base[0])
			base_entries.append((t_name, t_kind, base))
		lock_line = get_lock_line(real_root, deadline)
		lock_val = (
			lock_line[len("lock ") :]
			if lock_line.startswith("lock ")
			else "unknown"
		)
		git_line, git_ok = get_git_status_line(real_root, deadline)
		member_lines: List[str] = []
		unknown_extras: List[str] = []
		for t_name, t_kind, base in base_entries:
			_, _, s_line, u_reasons = finalize_member_dialog(
				t_name, t_kind, base, deadline
			)
			member_lines.append(s_line)
			if u_reasons:
				unknown_extras.extend(u_reasons)
		if lock_val == "unknown":
			unknown_extras.append("잠금 unknown")
		raw_sid = os.environ.get("CLAUDE_CODE_SESSION_ID", "").strip()
		sid8 = raw_sid[:8] if raw_sid else "모름"
		if sid8 == "모름":
			unknown_extras.append("팀장 세션 id 모름")
		mode_label = "herdr 안" if lead_mode == "inside" else "herdr 밖(외부 팀장)"
		if not git_ok:
			unknown_extras.append("저장소 모름")
		unconfirmed_str = ", ".join(unknown_extras) if unknown_extras else "없음"
		print(
			f"- 팀장 세션: 이 세션(id 앞 8자 {sid8}), 팀장 모드 {mode_label}, 잠금 {lock_val}",
			flush=True,
		)
		for m_line in member_lines:
			print(m_line, flush=True)
		print(git_line, flush=True)
		print("- 팀장 감시: 모름(팀장이 채움)", flush=True)
		print("- 띄운 것·바꾼 것: 없음(--status는 읽기 전용)", flush=True)
		print("- 진행 중이던 일·잃은 것: 모름(팀장이 채움)", flush=True)
		print(f"- 미확인: {unconfirmed_str}", flush=True)
		if "mismatch" in status_states:
			return 1
		if "unknown" in status_states or lock_line == "lock unknown":
			return 2
		return 0

	if lead_mode == "external":
		recovery = "idle·빈 입력란 확인 → /quit → GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --spawn"
	else:
		recovery = "idle·빈 입력란 확인 → /quit → scripts/team-up.sh --spawn"

	def check_member(name: str, pane: str, kind: str, status: str) -> int:
		info_rc, info_out = run_herdr(
			["pane", "process-info", "--pane", pane], deadline, combined=False
		)
		if info_rc == 124:
			print(TIMEOUT_MSG, flush=True)
			return 124
		try:
			msg = checker.evaluate_process_info(
				info_out if info_rc == 0 else "",
				process_info_failed=(info_rc != 0),
				status=status or "idle",
				kind=kind,
				name=name,
				recovery=recovery,
				expected_units=expected_by_kind[kind],
			)
		except Exception:
			return 0
		if msg:
			print(f"GJCH: {msg}", flush=True)
		return 0

	if lead_mode == "inside":
		cwd_rc = inside_lead_cwd_ok(herdr_pane_id, real_root, deadline)
		if cwd_rc == 124:
			print(TIMEOUT_MSG, flush=True)
			return 0
		if cwd_rc != 0:
			return 0

		targets = [(mate_name, "agy")]
		if codex_on:
			targets.append((critic_name, "codex"))

		for t_name, t_kind in targets:
			try:
				l_rc, info = inside_agent_pane_status(t_name, deadline)
			except Exception:
				continue
			if l_rc == 124:
				print(TIMEOUT_MSG, flush=True)
				return 0
			if l_rc == 0 and info is not None:
				pane_id, st = info
				if check_member(t_name, pane_id, t_kind, st) == 124:
					return 0
	else:
		ext_targets = [(mate_name, "agy", "inside")]
		if codex_on:
			ext_targets.append((critic_name, "codex", "exact"))

		for t_name, t_kind, t_cwd_mode in ext_targets:
			try:
				l_rc, info = ext_agent_pane_status(
					t_name, t_kind, t_cwd_mode, real_root, deadline
				)
			except Exception:
				continue
			if l_rc == 124:
				print(TIMEOUT_MSG, flush=True)
				return 0
			if l_rc == 0 and info is not None:
				pane_id, st = info
				if check_member(t_name, pane_id, t_kind, st) == 124:
					return 0

	return 0


if __name__ == "__main__":
	sys.exit(main())

