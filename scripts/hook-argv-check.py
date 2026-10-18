#!/usr/bin/env python3
"""SessionStart(startup) hook 전용 팀원·검토 argv 동기 점검(#42, #58).

Python 한 프로세스 안에서 단일 time.monotonic() 마감 시각을 공유하며:
1) (inside) 팀장 pane cwd 확인 (herdr pane get)
2) 팀원(mate)·검토(critic, codex_enabled일 때) herdr agent get
3) (external에서 workspace_id·agent·cwd가 비었을 때만) 보조 herdr pane get
4) 존재하는 대상마다 herdr pane process-info --pane <pane>
5) scripts/agent-argv-check.py의 비교 논리로 기대 단위와 대조해 GJCH: 접두사로 출력한다.
"""

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

TIMEOUT_MSG = "GJCH: ↳ 팀원 옵션 점검 시간 초과 — scripts/check-env.sh로 다시 점검"
DEFAULT_TIMEOUT = 3.0
MAX_TIMEOUT = 30.0


def parse_timeout(raw: str) -> float:
	try:
		val = float(raw)
	except Exception:
		return DEFAULT_TIMEOUT
	if not math.isfinite(val) or val <= 0:
		return DEFAULT_TIMEOUT
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


def main() -> int:
	if len(sys.argv) < 9:
		return 0
	raw_timeout = sys.argv[1]
	lead_mode = sys.argv[2]
	root = sys.argv[3]
	herdr_pane_id = sys.argv[4]
	mate_name = sys.argv[5]
	critic_name = sys.argv[6]
	codex_on = sys.argv[7] == "1"

	try:
		mate_argc = int(sys.argv[8])
	except Exception:
		return 0
	if mate_argc < 0:
		return 0
	critic_count_idx = 9 + mate_argc
	if len(sys.argv) < critic_count_idx + 1:
		return 0
	try:
		critic_argc = int(sys.argv[critic_count_idx])
	except Exception:
		return 0
	if critic_argc < 0:
		return 0
	if len(sys.argv) != critic_count_idx + 1 + critic_argc:
		return 0

	mate_start_args = sys.argv[9:critic_count_idx]
	critic_start_args = sys.argv[critic_count_idx + 1 :]

	deadline = time.monotonic() + parse_timeout(raw_timeout)
	real_root = os.path.realpath(root)

	if lead_mode == "external":
		recovery = "idle·빈 입력란 확인 → /quit → GJCH_EXTERNAL_LEAD=1 scripts/team-up.sh --spawn"
	else:
		recovery = "idle·빈 입력란 확인 → /quit → scripts/team-up.sh --spawn"

	expected_by_kind = {
		"agy": checker.parse_expected_units(mate_start_args),
		"codex": checker.parse_expected_units(critic_start_args),
	}

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

