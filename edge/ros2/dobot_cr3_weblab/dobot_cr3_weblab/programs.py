"""Sequencing teach-pendant programs on the lab computer.

Programs run here rather than in the operator's browser, and that is a safety
decision, not a performance one. A browser-side sequencer stops issuing steps
the instant a laptop lid closes or a tunnel blips — mid-sequence, with the arm
wherever the last commanded step left it — and it needs the control lease to
survive uninterrupted for the program's whole duration or the next person in
the queue inherits the hardware halfway through somebody else's motion.

Running here also makes the program visible: the step counter goes into the
telemetry document every viewer receives, so a spectator sees which step is
executing rather than watching an arm move for reasons they cannot see.

The runner is cooperative: every step checks the abort flag before it starts,
so a stop or an emergency stop takes effect at the next step boundary and
immediately at the hardware through the driver's own disable.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any, Callable, Dict, List, Optional

# How long a single waypoint is given before the runner gives up on it and
# aborts the rest of the program. A step that never completes must not wedge
# the lab.
STEP_TIMEOUT_S = 30.0

# Polling interval while waiting for the arm to reach a waypoint.
ARRIVAL_POLL_S = 0.1

# How close (degrees) the arm has to be to count as having arrived.
ARRIVAL_TOLERANCE_DEG = 2.0


class ProgramRunner:
    """Executes one program at a time, on its own thread."""

    def __init__(self, bridge, log: Optional[Callable[[str], None]] = None):
        self.bridge = bridge
        self._log = log or (lambda _msg: None)
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._abort = threading.Event()
        self._status: Dict[str, Any] = {
            'running': False,
            'stepIndex': -1,
            'stepCount': 0,
            'programName': '',
            'operatorName': '',
        }

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._status)

    # ── Control ─────────────────────────────────────────────────────────────

    def start(self, name: str, steps_json: str, operator: str = '') -> Dict[str, Any]:
        with self._lock:
            if self._status['running']:
                return {'ok': False, 'message': 'ya hay un programa en ejecución'}

        try:
            steps = json.loads(steps_json or '[]')
        except Exception:
            return {'ok': False, 'message': 'programa mal formado'}
        if not isinstance(steps, list) or not steps:
            return {'ok': False, 'message': 'el programa no tiene pasos'}

        self._abort.clear()
        with self._lock:
            self._status = {
                'running': True,
                'stepIndex': -1,
                'stepCount': len(steps),
                'programName': name,
                'operatorName': operator,
            }
        self._thread = threading.Thread(
            target=self._run, args=(steps,), daemon=True,
            name='weblab-program')
        self._thread.start()
        return {'ok': True, 'message': f'ejecutando {len(steps)} pasos'}

    def stop(self) -> Dict[str, Any]:
        """Ask the running program to stop at the next step boundary.

        The caller is expected to stop the hardware separately — this only ends
        the sequence, it does not by itself halt motion already commanded.
        """
        self._abort.set()
        self.bridge.jog_stop()
        return {'ok': True, 'message': 'programa detenido'}

    # ── Execution ───────────────────────────────────────────────────────────

    def _finish(self) -> None:
        with self._lock:
            self._status['running'] = False
            self._status['stepIndex'] = -1

    def _run(self, steps: List[Dict[str, Any]]) -> None:
        try:
            for index, step in enumerate(steps):
                if self._abort.is_set():
                    self._log('programa abortado')
                    return
                with self._lock:
                    self._status['stepIndex'] = index

                result = self._execute(step)
                if not result.get('ok'):
                    self._log(f'paso {index + 1} falló: {result.get("message")}')
                    return
        finally:
            self._finish()

    def _execute(self, step: Dict[str, Any]) -> Dict[str, Any]:
        kind = step.get('kind')

        if kind == 'waypoint':
            joints = [float(v) for v in (step.get('joints') or [])]
            result = self.bridge.joint_move(joints)
            if not result.get('ok'):
                return result
            return self._await_arrival(joints)

        if kind == 'gripper':
            return self.bridge.gripper(float(step.get('position', 0.0)))

        if kind == 'wait':
            seconds = max(0.0, min(60.0, float(step.get('seconds', 1.0))))
            # Interruptible: a stop during a long wait must not have to sit it
            # out.
            if self._abort.wait(timeout=seconds):
                return {'ok': False, 'message': 'abortado'}
            return {'ok': True}

        return {'ok': False, 'message': f'tipo de paso desconocido: {kind}'}

    def _await_arrival(self, target_deg: List[float]) -> Dict[str, Any]:
        """Block until the arm reaches the target, aborts, or times out."""
        deadline = time.time() + STEP_TIMEOUT_S
        while time.time() < deadline:
            if self._abort.is_set():
                return {'ok': False, 'message': 'abortado'}
            current = self.bridge.snapshot().get('joints_deg') or []
            if len(current) >= len(target_deg) and all(
                abs(current[i] - target_deg[i]) <= ARRIVAL_TOLERANCE_DEG
                for i in range(len(target_deg))
            ):
                return {'ok': True}
            time.sleep(ARRIVAL_POLL_S)
        return {'ok': False, 'message': 'el robot no alcanzó el punto a tiempo'}
