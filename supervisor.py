#!/usr/bin/env python3
"""
Ichtus Workspace - Service Supervisor
======================================

A small "24/7 watchdog" for the three Node/Python dev services the
Ichtus Workspace SPA expects to be running locally:

  - server.py             (Python: SPA static + /api/* on default :8080)
  - x32/server.js         (Node:  OSC bridge, default :3002)
  - mic-iem-server/server.js (Node:  Firestore-backed mic monitor, :3001)

The previous launcher (`start-server.bat`) spawned each service in its
own `cmd /k` window and walked away. If either child crashed, the
operator had to notice and re-run the .bat. This supervisor replaces
that flow with:

  1. Single Python process owns the lifetime of all three children.
  2. stdout/stderr of every child is mirrored to logs/<name>.log
     (rotating, 5MB x 3 generations, under logs/) AND into an in-memory
     tail reachable via http://localhost:9090/api/status.
  3. Any non-zero exit triggers a restart using **capped truncated
     exponential backoff** (2s, 4s, 8s, 16s, 30s). The counter resets
     whenever a child stays alive 60s+. The supervisor never gives up
     permanently on its own; a fast-crash-loop instead generates an
     unmistakable repeating log line the operator can act on.
  4. Single-instance guard via supervisor.pid + heartbeat file so two
     `python supervisor.py` invocations don't double-bind ports.
  5. Graceful shutdown: SIGINT/SIGTERM/SIGBREAK close the :9090
     listener, then `proc.wait(timeout=N)` gives children up to 5s to
     exit cleanly before `proc.terminate()` is used as a hard
     fallback. We deliberately do NOT spawn children with
     CREATE_NEW_PROCESS_GROUP — that would isolate Ctrl-C from Node
     children. Sharing the console is what makes SIGINT broadcast work
     on Windows in the first place.

Dependencies: stdlib only (`subprocess`, `http.server`, `logging`, ...).
No psutil / no pywin32; works on any Python 3.8+, Windows or POSIX.

Setup:
  1. cd <project root>
  2. python supervisor.py
  3. Open http://localhost:9090/api/status for the unified status page.

Exit codes:
  0  clean shutdown (SIGINT/SIGTERM)
  2  port 9090 already in use at startup (another supervisor is alive)
  3  python or node not on PATH (no services to supervise)
"""

import sys
import os
import io
import time
import json
import signal
import socket
import threading
import argparse
import subprocess
import webbrowser
import platform
import logging
import logging.handlers
from pathlib import Path
from datetime import datetime, timedelta
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ── Force unbuffered UTF-8 on Windows console ────────────────────────────
# Earlier revisions of the launcher produced garbled output because the
# default Windows console codepage is CP1252. Match server.py's policy:
# wrap stdout/stderr as UTF-8 with errors='replace' so emoji banners
# don't blow up the operators' terminal.
if sys.platform == 'win32':
    for _stream_name in ('stdout', 'stderr'):
        _stream = getattr(sys, _stream_name)
        if hasattr(_stream, 'buffer'):
            setattr(sys, _stream_name,
                    io.TextIOWrapper(_stream.buffer, encoding='utf-8', errors='replace'))
            getattr(sys, _stream_name).flush()


# ── Paths & constants ─────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent
LOGS_DIR = ROOT_DIR / 'logs'
LOGS_DIR.mkdir(exist_ok=True)

PID_FILE       = ROOT_DIR / 'supervisor.pid'
HEARTBEAT_FILE = ROOT_DIR / 'supervisor.heartbeat'

DEFAULT_PORT     = 9090
DEFAULT_HOST     = '127.0.0.1'

# Backoff schedule: 2s, 4s, 8s, 16s, 30s (cap). Reset after a child
# stays alive at least RESET_AFTER_ALIVE_SEC — covers the common
# "boot, fail, retry" case without inflating wait times for genuine
# crashes that take hours to come back.
BACKOFF_SCHEDULE = [2, 4, 8, 16, 30]
RESET_AFTER_ALIVE_SEC = 60

# Log rotation: 5 MB per file, 3 generations. 15 MB total per service
# is enough diagnostic surface for "what crashed at 10pm Sunday" and
# keeps the directory fit for a small SSD.
LOG_MAX_BYTES = 5 * 1024 * 1024
LOG_BACKUP_COUNT = 3

# Read at most this many bytes from a child's pipe per loop tick. We
# want lines to land on disk quickly when a child is chatty, but we
# also need the pump loop to remain co-operative. 64 KB is well above
# any single line an operator is realistically going to type at a
# console while staying below the default pipe buffer (64 KB on
# Windows, 64 KB on Linux) so a slow consumer doesn't deadlock a
# fast producer.
PIPE_READ_CHUNK = 64 * 1024


# ── Services the supervisor owns ────────────────────────────────────────
#
# Each entry says "what to spawn, with what args, on what default port,
# what `logs/<name>.log` to write". `cwd` lets the Node services run
# from their own directory (some of them resolve paths relative to
# __dirname and panic if launched from a parent dir).
#
# `required` controls what happens when the binary is missing:
#   - True  -> log a hard error and either spawn anyway (PATH search)
#             or surface "X is not installed, install it then retry".
#   - False -> warn and skip; the supervisor stays alive for the rest.
SERVICES = [
    {
        'key': 'spa',
        'label': 'SPA HTTP server (server.py)',
        'cmd': ['python', str(ROOT_DIR / 'server.py'), '--port', '8080', '--host', '0.0.0.0'],
        'shell': False,
        'log_name': 'server',
        'default_port': 8080,
        'required': False,  # python rarely missing; allow degraded mode
        'cwd': ROOT_DIR,
        'env': {},
    },
    {
        'key': 'x32',
        'label': 'X32 OSC bridge (x32/server.js)',
        'cmd': ['node', str(ROOT_DIR / 'x32' / 'server.js')],
        'shell': False,
        'log_name': 'x32-bridge',
        'default_port': 3002,
        'required': False,
        'cwd': ROOT_DIR / 'x32',
        'env': {},
    },
    {
        'key': 'mic_iem',
        'label': 'Mic & IEM monitor (mic-iem-server/server.js)',
        'cmd': ['node', str(ROOT_DIR / 'mic-iem-server' / 'server.js')],
        'shell': False,
        'log_name': 'mic-iem',
        'default_port': 3001,
        'required': False,
        'cwd': ROOT_DIR / 'mic-iem-server',
        'env': {},
    },
]


# ── Module-level state (owned by the main supervisor thread) ───────────
#
# `_services` is a dict of `key -> SupervisorChild`. Each child tracks
# its own process, restart counter, and recent exit code. Access from
# the HTTP handler threads is guarded by the `_state_lock`.
class SupervisorChild:
    """Per-service child state: the subprocess, recent exits, log-tail,
    backoff calculation. All mutating methods run in the main monitor
    thread OR in the log-pump threads — the lock below makes /api/status
    a consistent snapshot even when read mid-restart."""

    def __init__(self, spec):
        self.spec = spec
        self.proc = None
        self.restart_count = 0
        self.consecutive_crashes = 0
        self.last_exit_code = None
        self.last_exit_at = None
        self.last_started_at = None
        self.next_restart_at = None
        self.state = 'starting'   # starting | running | backoff | stopped
        self.log_tail = deque(maxlen=50)
        self.log_lock = threading.Lock()
        self.stop_requested = False  # true after SIGINT, suppresses restarts

    def to_status_dict(self):
        return {
            'key': self.spec['key'],
            'label': self.spec['label'],
            'state': self.state,
            'pid': self.proc.pid if self.proc and self.proc.poll() is None else None,
            'uptime_sec': (
                int(time.time() - self.last_started_at)
                if self.last_started_at and self.proc and self.proc.poll() is None
                else 0
            ),
            'restart_count': self.restart_count,
            'last_exit_code': self.last_exit_code,
            'last_exit_at': self.last_exit_at,
            'next_restart_at': self.next_restart_at,
            'default_port': self.spec['default_port'],
            'log_path': str((LOGS_DIR / f"{self.spec['log_name']}.log").relative_to(ROOT_DIR)),
        }


# Mutex that guards `_services` reads from the HTTP handler threads.
_state_lock = threading.Lock()

# Set when SIGINT/SIGTERM/SIGBREAK arrives. The monitor loop polls this
# between sleeps so a Ctrl-C in the supervisor console shuts things
# down within one tick instead of after a sleep.
_shutdown_requested = threading.Event()


# ── Logging setup ───────────────────────────────────────────────────────
#
# Each supervised child gets its own RotatingFileHandler so its log is
# easy to grep (`tail -F logs/x32-bridge.log`). We also tee to a
# per-child deque for /api/status so the SPA can surface "the bridge
# is throwing RuntimeError every 3 seconds" without the operator
# leaving the browser.
def _build_child_logger(spec):
    log_path = LOGS_DIR / f"{spec['log_name']}.log"
    logger = logging.getLogger(f"ichtus.supervisor.{spec['key']}")
    logger.setLevel(logging.INFO)
    logger.propagate = False  # don't double-log to root
    if logger.handlers:
        # Idempotent in case main() is somehow re-entered.
        return logger, log_path
    rfh = logging.handlers.RotatingFileHandler(
        log_path,
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding='utf-8',
        delay=True,  # don't create empty .log until first write
    )
    rfh.setFormatter(logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    ))
    logger.addHandler(rfh)
    return logger, log_path


# Root logger goes to supervisor.log (general diagnostics). Same
# rotating policy as child logs.
_supervisor_logger = logging.getLogger('ichtus.supervisor')
_supervisor_logger.setLevel(logging.INFO)
_rfh_root = logging.handlers.RotatingFileHandler(
    LOGS_DIR / 'supervisor.log',
    maxBytes=LOG_MAX_BYTES,
    backupCount=LOG_BACKUP_COUNT,
    encoding='utf-8',
)
_rfh_root.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
))
_supervisor_logger.addHandler(_rfh_root)


def _is_pid_alive(pid):
    """Best-effort cross-platform 'is this process still alive?'. On
    Windows we use `tasklist` (the closest stdlib-only analog of
    kill -0); on POSIX we use `os.kill(pid, 0)` and swallow ESRCH. We
    don't add psutil or pywin32 because start-server.bat is the
    operator-facing entry point and we don't want surprise compiles
    in the way."""
    if pid is None or pid <= 0:
        return False
    if sys.platform == 'win32':
        try:
            out = subprocess.run(
                ['tasklist', '/FI', f'PID eq {pid}', '/NH'],
                capture_output=True, text=True, timeout=5,
            ).stdout
            return str(pid) in out
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # PID exists but not ours; treat as alive so we don't
        # accidentally double-launch on the wrong PID.
        return True
    except Exception:
        return False


def _existing_supervisor_pid():
    """Returns the PID stored in supervisor.pid if the file exists
    AND that PID still appears alive. Otherwise returns None so the
    caller can overwrite the stale file."""
    if not PID_FILE.exists():
        return None
    try:
        pid = int(PID_FILE.read_text(encoding='utf-8').strip())
    except (ValueError, OSError):
        return None
    return pid if _is_pid_alive(pid) else None


# ── Per-child log pump ──────────────────────────────────────────────────
#
# `proc.stdout` is a pipe; if we don't drain it actively, the child
# blocks on its next print after the OS pipe buffer fills (default
# 64 KB on both Windows and Linux). One daemon thread per child reads
# line-by-line from the pipe, prepends a timestamp, and routes the
# line through the per-child logger (which fans it out to the rotated
# file AND the in-memory deque and the supervisor's UI text stream).
def _pump_child_output(supervisor, child, logger):
    """Drains `child.proc.stdout` until EOF. Each line is captured
    into the in-memory tail (for /api/status) and written to the
    rotating log file via the child's logger. Runs in a daemon thread
    spawned by `_launch()`."""
    proc = child.proc
    if proc is None or proc.stdout is None:
        return
    stream = proc.stdout
    pending = b''
    try:
        while True:
            chunk = stream.read(PIPE_READ_CHUNK)
            if not chunk:
                # EOF — child has exited. Final flush happens below.
                if pending:
                    _handle_line(supervisor, child, logger, pending)
                break
            pending += chunk
            # Split on newlines but keep the trailing partial line in `pending`
            while b'\n' in pending:
                line, _, pending = pending.partition(b'\n')
                _handle_line(supervisor, child, logger, line)
    except (OSError, ValueError):
        # Stream closed mid-shutdown; ignore.
        pass


def _handle_line(supervisor, child, logger, raw_line_bytes):
    """Decode one line of child output and dispatch to logger + tail.
    Try UTF-8 first, then cp1252-as-latin-1 fallback so Windows child
    processes that haven't wrapped their stdout (some Node libs don't)
    don't show up as empty log entries."""
    try:
        text = raw_line_bytes.decode('utf-8')
    except UnicodeDecodeError:
        text = raw_line_bytes.decode('cp1252', errors='replace').encode('utf-8', errors='replace').decode('utf-8', errors='replace')
    text = text.rstrip('\r')
    if not text.strip():
        return  # skip blank lines from chatty startup banners
    logger.info(text)
    with child.log_lock:
        child.log_tail.append({
            'ts': datetime.now().isoformat(timespec='seconds'),
            'line': text[:400],  # cap so /api/status stays readable
        })
    # Echo to the supervisor's own stdout so the operator sees the
    # child's log inline in the same console window. Without this the
    # operator only sees logs by `tail -F logs/<name>.log`.
    if supervisor and supervisor.echo_to_stdout:
        try:
            print(f"  [{child.spec['key']}] {text}", flush=True)
        except Exception:
            pass


# ── Spawn / restart / stop ──────────────────────────────────────────────
def _launch(supervisor, child):
    """(Re)spawn the subprocess for `child`. Sets up stdout+stderr
    pipes, starts the log-pump thread, marks the child as running.
    Returns True on successful spawn, False if the binary is missing
    or the process couldn't start (caller decides on backoff)."""
    spec = child.spec
    log_path = LOGS_DIR / f"{spec['log_name']}.log"
    cmd = spec['cmd']
    if not cmd:
        return False
    # Skip silently if the first token (interpreter) is missing OR the
    # script path doesn't exist on disk. Log once per failure so the
    # operator sees the cause. Punting on a missing binary prevents
    # 30-second backoff loops flooding the log.
    binary = cmd[0]
    binary_missing = False
    try:
        # Use shutil.which to support Windows .exe lookup and PATH dirs;
        # we test the script path separately because PATH won't find it.
        from shutil import which
        if which(binary) is None and not Path(binary).exists():
            binary_missing = True
    except Exception:
        binary_missing = False
    if binary_missing:
        msg = f"  [SUPERVISOR] Kan '{binary}' niet vinden op PATH — service '{spec['key']}' overgeslagen."
        print(msg, flush=True)
        _supervisor_logger.warning(msg)
        child.state = 'stopped'
        child.last_exit_code = -1
        child.last_exit_at = datetime.now().isoformat(timespec='seconds')
        return False
    # Also bail if the literal script path (cmd[1]) is missing — that
    # means a service was renamed/deleted and the supervisor config
    # wasn't updated. Loud and clear beats a tight crash loop.
    if len(cmd) >= 2 and not Path(cmd[1]).exists():
        msg = f"  [SUPERVISOR] Script niet gevonden: {cmd[1]} — service '{spec['key']}' overgeslagen."
        print(msg, flush=True)
        _supervisor_logger.warning(msg)
        child.state = 'stopped'
        child.last_exit_code = -1
        child.last_exit_at = datetime.now().isoformat(timespec='seconds')
        return False

    try:
        env = os.environ.copy()
        env.update(spec.get('env', {}))
        proc = subprocess.Popen(
            cmd,
            cwd=str(spec.get('cwd') or ROOT_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=0,            # unbuffered; we read raw bytes
            creationflags=0,      # shared console => Ctrl-C broadcasts to all
        )
    except Exception as e:
        msg = f"  [SUPERVISOR] Spawn van '{spec['key']}' mislukt: {e}"
        print(msg, flush=True)
        _supervisor_logger.error(msg)
        child.state = 'backoff'
        child.last_exit_code = -1
        child.last_exit_at = datetime.now().isoformat(timespec='seconds')
        return False

    child.proc = proc
    child.state = 'running'
    child.last_started_at = time.time()
    child.last_exit_code = None
    logger, _ = _build_child_logger(spec)
    msg = f"Spawned (pid {proc.pid}): {' '.join(cmd)}"
    print(f"  [SUPERVISOR:{spec['key']}] {msg}", flush=True)
    logger.info(msg)
    t = threading.Thread(
        target=_pump_child_output,
        args=(supervisor, child, logger),
        daemon=True,
        name=f"pump-{spec['key']}",
    )
    t.start()
    return True


def _schedule_backoff(supervisor, child):
    """Compute the next restart delay using the truncated-exp schedule
    and stamp `next_restart_at` so /api/status can show 'restarts in
    12s'. Reset the counter when the child ran long enough to count
    as 'healthy' instead of a fast-crash-loop."""
    if child.consecutive_crashes >= len(BACKOFF_SCHEDULE):
        delay = BACKOFF_SCHEDULE[-1]
    else:
        delay = BACKOFF_SCHEDULE[child.consecutive_crashes]
    child.next_restart_at = (
        datetime.now() + timedelta(seconds=delay)
    ).isoformat(timespec='seconds')
    return delay


def _monitor_loop(supervisor):
    """Main supervisor thread. Ticks every 1s. For each child: if it
    has exited, either schedule a restart (with backoff) or mark
    stopped if shutdown is in progress."""
    while not _shutdown_requested.is_set():
        with _state_lock:
            children = list(supervisor.children.values())
        now = time.time()
        for child in children:
            if child.stop_requested:
                continue
            proc = child.proc
            if proc is None:
                # Initial start (no proc yet). Spawn now.
                if child.state != 'starting' or _shutdown_requested.is_set():
                    continue
                _launch(supervisor, child)
                continue
            ret = proc.poll()
            if ret is not None:
                # Reset consecutive_crashes if the child ran long.
                if child.last_started_at:
                    ran_for = now - child.last_started_at
                    if ran_for >= RESET_AFTER_ALIVE_SEC:
                        child.consecutive_crashes = 0
                # If shutdown has been requested, don't restart.
                if _shutdown_requested.is_set():
                    child.state = 'stopped'
                    child.last_exit_code = ret
                    child.last_exit_at = datetime.now().isoformat(timespec='seconds')
                    child.proc = None
                    msg = f"Exited (code {ret}) — supervisor shutting down, not restarting."
                    print(f"  [SUPERVISOR:{child.spec['key']}] {msg}", flush=True)
                    logger, _ = _build_child_logger(child.spec)
                    logger.info(msg)
                    continue
                # Otherwise schedule a restart.
                child.last_exit_code = ret
                child.last_exit_at = datetime.now().isoformat(timespec='seconds')
                child.proc = None
                # Friendly exit-code taxonomy. Negative codes on POSIX
                # are signals; positive codes are real exits.
                if ret < 0:
                    reason = f"signal {-ret}"
                elif ret == 0:
                    reason = 'clean exit'
                else:
                    reason = f'exit code {ret}'
                msg = f"Exited ({reason}). Scheduling restart."
                print(f"  [SUPERVISOR:{child.spec['key']}] {msg}", flush=True)
                logger, _ = _build_child_logger(child.spec)
                logger.info(msg)
                child.consecutive_crashes += 1
                delay = _schedule_backoff(supervisor, child)
                child.state = 'backoff'
                # Don't wait inside the lock — release it first.
                _supervisor_logger.warning(
                    f"{child.spec['key']}: exited {ret}, restart in {delay}s "
                    f"(crash #{child.consecutive_crashes})"
                )
                # Sleep on a "remembered-start-or-die" deadline outside
                # the lock; if shutdown arrives mid-sleep, we abort.
                deadline = time.time() + delay
                while time.time() < deadline and not _shutdown_requested.is_set():
                    time.sleep(min(1.0, deadline - time.time()))
                if _shutdown_requested.is_set():
                    child.state = 'stopped'
                    continue
                if child.consecutive_crashes >= 5 and child.consecutive_crashes % 5 == 0:
                    # Surface the "this child keeps crashing" state
                    # loudly every 5 cycles — easy to grep for.
                    print(
                        f"  [SUPERVISOR:{child.spec['key']}] WAARSCHUWING: "
                        f"kind is {child.consecutive_crashes}x gecrashed. "
                        f"Logs: {LOGS_DIR / (child.spec['log_name'] + '.log')}",
                        flush=True,
                    )
                child.restart_count += 1
                child.state = 'starting'
                _launch(supervisor, child)
        # Sympathetic pause — 1s is plenty; PID detection on macOS /
        # Linux is sub-millisecond.
        time.sleep(1.0)


# ── HTTP status server on :9090 ──────────────────────────────────────────
class _StatusHandler(BaseHTTPRequestHandler):
    """Tiny HTTP handler. /api/status returns aggregated child status;
    /api/restart/<key> triggers a hard restart of one child; /api/logs
    returns the most recent log lines without tail."""

    server_version = 'IchtusSupervisor/1.0'

    def log_message(self, format, *args):
        # The supervisor already prints its own logs; the BaseHTTPRequestHandler
        # default of "127.0.0.1 - - [..] GET ..." would just spam. Silence it.
        return

    def _send_json(self, code, obj):
        body = json.dumps(obj, indent=2).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', '0') or '0')
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            return {}

    def do_GET(self):
        supervisor = self.server.supervisor_ref  # set on the ThreadingHTTPServer
        path = self.path.split('?', 1)[0]
        if path == '/' or path == '/index.html':
            self._send_json(200, _render_index_html_data(supervisor))
            return
        if path == '/api/status':
            self._send_json(200, _build_status(supervisor))
            return
        if path.startswith('/api/logs/'):
            key = path.split('/', 3)[-1]
            self._send_json(200, _render_child_logs(supervisor, key))
            return
        if path == '/api/health':
            self._send_json(200, {'status': 'ok', 'service': 'supervisor'})
            return
        self._send_json(404, {'error': 'not found', 'path': path})

    def do_POST(self):
        supervisor = self.server.supervisor_ref
        path = self.path.split('?', 1)[0]
        if path.startswith('/api/restart/'):
            key = path.split('/', 3)[-1]
            self._send_json(200, _restart_child(supervisor, key))
            return
        if path == '/api/stop':
            _shutdown_requested.set()
            self._send_json(200, {'status': 'shutting_down'})
            return
        self._send_json(404, {'error': 'not found', 'path': path})


def _build_status(supervisor):
    with _state_lock:
        services = [c.to_status_dict() for c in supervisor.children.values()]
    return {
        'status': 'shutting_down' if _shutdown_requested.is_set() else 'ok',
        'service': 'ichtus-supervisor',
        'pid': os.getpid(),
        'uptime_sec': int(time.time() - supervisor.started_at),
        'started_at': datetime.fromtimestamp(supervisor.started_at).isoformat(),
        'hostname': socket.gethostname(),
        'services': services,
        'logs_dir': str(LOGS_DIR.relative_to(ROOT_DIR)),
        'pid_file': str(PID_FILE.relative_to(ROOT_DIR)),
        'heartbeat_file': str(HEARTBEAT_FILE.relative_to(ROOT_DIR)),
        'timestamp': datetime.now().isoformat(),
    }


def _render_child_logs(supervisor, key):
    with _state_lock:
        child = supervisor.children.get(key)
        if not child:
            return {'error': f'unknown service: {key}'}
        with child.log_lock:
            tail = list(child.log_tail)
        log_path = LOGS_DIR / f"{child.spec['log_name']}.log"
    return {
        'key': key,
        'label': child.spec['label'],
        'log_path': str(log_path.relative_to(ROOT_DIR)),
        'tail': tail,
        'count': len(tail),
        'tail_capacity': child.log_tail.maxlen,
    }


def _restart_child(supervisor, key):
    with _state_lock:
        child = supervisor.children.get(key)
        if not child:
            return {'error': f'unknown service: {key}'}
        proc = child.proc
        if proc and proc.poll() is None:
            child.stop_requested = True  # tell monitor to skip auto-restart
            child.restart_count += 1
            try:
                proc.terminate()
            except Exception as e:
                print(f"  [SUPERVISOR:{key}] terminate() failed: {e}", flush=True)
                return {'restart_requested': True, 'note': f'terminate error: {e}'}
            return {'restart_requested': True}
        # Not running -> schedule a relaunch.
        child.state = 'starting'
        child.consecutive_crashes = 0
        return {'restart_requested': True, 'was_already_stopped': True}


def _render_index_html_data(supervisor):
    """Return a tiny HTML doc with auto-refresh. The browser hits /
    on :9090, sees a friendly page instead of a JSON dump."""
    with _state_lock:
        services = [c.to_status_dict() for c in supervisor.children.values()]
    rows = []
    for s in services:
        state = s['state']
        pid = s['pid'] or '-'
        uptime = f"{s['uptime_sec']}s" if s['uptime_sec'] else '-'
        restarts = s['restart_count']
        last_exit = s['last_exit_code']
        rows.append(
            f"<tr><td>{s['label']}</td><td>{state}</td><td>{pid}</td>"
            f"<td>{uptime}</td><td>{restarts}</td><td>{last_exit if last_exit is not None else '-'}</td>"
            f"<td><a href='/api/logs/{s['key']}'>logs</a> · "
            f"<form method='POST' action='/api/restart/{s['key']}' style='display:inline'>"
            f"<button type='submit'>restart</button></form></td></tr>"
        )
    body = "".join(rows) or "<tr><td colspan='7'>(geen services)</td></tr>"
    return {
        'content_type_hint': 'html',
        'html': f"""<!doctype html>
<html><head><meta charset='utf-8'><title>Ichtus Supervisor</title>
<meta http-equiv='refresh' content='5'>
<style>
  body{{font-family:-apple-system,Segoe UI,sans-serif;background:#18181c;color:#f1f5f9;padding:24px}}
  table{{border-collapse:collapse;width:100%;max-width:1100px}}
  th,td{{border:1px solid rgba(255,255,255,0.1);padding:8px 12px;text-align:left}}
  th{{background:rgba(255,255,255,0.04);font-size:0.85em;text-transform:uppercase;letter-spacing:0.06em}}
  td.state-running{{color:#27ae60;font-weight:700}}
  td.state-backoff{{color:#f47920;font-weight:700}}
  td.state-stopped{{color:#ed1c24;font-weight:700}}
  a, button{{color:#38bdf8;background:#222;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:4px 8px;cursor:pointer;text-decoration:none;font-size:0.85em}}
</style></head>
<body>
  <h1>Ichtus Supervisor</h1>
  <p>PID {os.getpid()} · uptime {int(time.time()-supervisor.started_at)}s · auto-refresh elke 5s</p>
  <p><a href='/api/status'>/api/status</a> · <a href='/api/health'>/api/health</a></p>
  <table>
    <thead><tr><th>Service</th><th>State</th><th>PID</th><th>Uptime</th><th>Restarts</th><th>Last exit</th><th>Actie</th></tr></thead>
    <tbody>{body}</tbody>
  </table>
</body></html>"""
    }


# ── Status dispatcher: sniff the Accept header (best-effort) ────────────
def _send_wrapped(self, code, obj):
    # When the handler is /, the index payload is an HTML-doc-as-string
    # in a JSON envelope; the simpler thing is to render it as plain
    # HTML directly. So / is special-cased: we override do_GET.
    if isinstance(obj, dict) and obj.get('content_type_hint') == 'html':
        body = obj['html'].encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)
        return
    body = json.dumps(obj, indent=2).encode('utf-8')
    self.send_response(code)
    self.send_header('Content-Type', 'application/json; charset=utf-8')
    self.send_header('Content-Length', str(len(body)))
    self.send_header('Cache-Control', 'no-store')
    self.end_headers()
    self.wfile.write(body)


# Override _send_json to support the HTML doc payload.
_StatusHandler._send_json = _send_wrapped


# ── Lifecycle: write PID, heartbeat, signal handlers ───────────────────
def _write_heartbeat_loop(supervisor):
    """Touch the heartbeat file every 5s. start-server.bat uses the
    mtime to detect a stale supervisor (it crashed but the PID file
    is missing or the PID is gone) and refuse to start a duplicate.
    We also write `supervisor.pid` once at startup so external stop
    scripts (`kill <pid>`) work even before the heartbeat loop runs.
    """
    PID_FILE.write_text(str(os.getpid()), encoding='utf-8')
    while not _shutdown_requested.is_set():
        try:
            HEARTBEAT_FILE.write_text(
                f"{os.getpid()}\n{int(time.time())}\n", encoding='utf-8'
            )
        except Exception as e:
            _supervisor_logger.warning(f"Heartbeat write failed: {e}")
        # Sleep but wake early on shutdown.
        _shutdown_requested.wait(timeout=5.0)
    # One last clean-up so /api/status shows 'not supervised' once
    # we're gone. PID file stays around on purpose: it tells the next
    # operator that the last run was clean (no stale PID limp).
    try:
        PID_FILE.unlink()
    except FileNotFoundError:
        pass


def _install_signal_handlers(supervisor):
    """Register SIGINT/SIGTERM/SIGBREAK handlers. We share the console
    with our children (no CREATE_NEW_PROCESS_GROUP) so Ctrl-C in the
    supervisor console broadcasts to children automatically too —
    `server.py` and the two Node services each have their own signal
    handlers (we added SIGINT/SIGTERM to `server.py` in this revision)
    and will close their listeners cleanly. Only after the children
    drain do we shut down the :9090 listener.

    IMPORTANT: Python signal handlers run in the main thread between
    bytecode instructions. We do the lightest possible work inside
    them — just flip `_shutdown_requested` and let the monitor thread
    drive actual teardown.
    """
    def _on_signal(sig_name, _frame):
        # Only act once. Repeated Ctrl-C sets the same flag; the
        # graceful path is single-shot.
        if _shutdown_requested.is_set():
            print(f"\n  [SUPERVISOR] Nogmaals {sig_name} ontvangen — forceer afsluiten.", flush=True)
            os._exit(130)
        _shutdown_requested.set()
        print(f"\n  [SUPERVISOR] {sig_name} ontvangen — kinderen netjes afsluiten (5s)…", flush=True)

    # IMPORTANT: signal.signal() invokes callbacks with (signum, frame),
    # so `_on_signal` would receive the numeric SIGINT (2), not the
    # string "SIGINT" we want shown to the operator. We wrap each
    # registration with a tiny lambda that maps signum -> name before
    # delegating. Mirrors the pattern in server.py's _graceful_shutdown.
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, lambda s, f: _on_signal('SIGBREAK', f))
    signal.signal(signal.SIGTERM, lambda s, f: _on_signal('SIGTERM', f))
    signal.signal(signal.SIGINT,  lambda s, f: _on_signal('SIGINT',  f))


# ── Shutdown sequencing ────────────────────────────────────────────────
def _graceful_shutdown(supervisor, timeout_sec=5.0):
    """Tell every child we don't want a restart, then attempt a clean
    exit. Polls each proc once a second; if any are still alive after
    `timeout_sec`, fall back to `terminate()` (SIGTERM on POSIX,
    TerminateProcess on Windows)."""
    print('  [SUPERVISOR] Telling children to stop (no auto-restart)…', flush=True)
    with _state_lock:
        children = list(supervisor.children.values())
    for child in children:
        child.stop_requested = True
        proc = child.proc
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
    # Wait for graceful drain.
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if all((c.proc is None or c.proc.poll() is not None) for c in children):
            break
        time.sleep(0.2)
    # Final fallback: anything still alive gets terminate() again.
    for child in children:
        proc = child.proc
        if proc and proc.poll() is None:
            print(f"  [SUPERVISOR:{child.spec['key']}] Nog actief na {timeout_sec}s — hard terminate.", flush=True)
            try:
                proc.terminate()
            except Exception:
                pass


# ── Main entry ──────────────────────────────────────────────────────────
class Supervisor:
    """Top-level container. Construct once in main(), pass around so
    the HTTP handler / monitor loop / shutdown logic can all reach
    the children + config + start time."""

    def __init__(self, echo_to_stdout=True):
        self.echo_to_stdout = echo_to_stdout
        self.started_at = time.time()
        self.children = {}
        for spec in SERVICES:
            self.children[spec['key']] = SupervisorChild(spec)


def _banner(supervisor, port, host):
    # ASCII art banner matches the .bat launcher / server.py style so
    # the operator sees a familiar shape on launch.
    lines = [
        '',
        '  ╔══════════════════════════════════════════════╗',
        '  ║   ICHTUS WORKSPACE - SERVICE SUPERVISOR     ║',
        '  ╠══════════════════════════════════════════════╣',
        f'  ║  UI / status:  http://{host}:{port}/          ║',
        f'  ║  JSON status:  http://{host}:{port}/api/status ║',
        '  ║                                              ║',
        '  ║  Supervised children:                        ║',
    ]
    for spec in SERVICES:
        lines.append(f"  ║    • {spec['label'][:42]:<42} ║")
    lines += [
        '  ║                                              ║',
        '  ║  Logs:        logs/<service>.log (rotating)  ║',
        '  ║  PID file:    supervisor.pid                 ║',
        '  ║  Heartbeat:   supervisor.heartbeat           ║',
        '  ╚══════════════════════════════════════════════╝',
        '',
    ]
    print('\n'.join(lines), flush=True)


def main():
    parser = argparse.ArgumentParser(
        description='Ichtus Workspace service supervisor (Python dev watchdog).',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python supervisor.py              # start on :9090, supervise all services
  python supervisor.py --port 9100 # change status UI port
  python supervisor.py --open       # open the status page in your browser
  python supervisor.py --no-echo    # suppress child log tee to stdout
        """,
    )
    parser.add_argument('--port', '-p', type=int, default=DEFAULT_PORT,
                        help=f'poort voor status-UI (default: {DEFAULT_PORT})')
    parser.add_argument('--host', type=str, default=DEFAULT_HOST,
                        help=f'bind-adres voor status-UI (default: {DEFAULT_HOST})')
    parser.add_argument('--open', '-o', action='store_true',
                        help='Open de status-pagina in de browser na start.')
    parser.add_argument('--no-echo', action='store_true',
                        help='Onderdruk de kind-log echo naar deze console (schrijft nog steeds naar logs/<svc>.log).')
    args = parser.parse_args()

    # Single-instance guard. If another live supervisor is already on
    # disk, refuse to launch — the operator should `taskkill` the old
    # one or close the previous console window before relaunching.
    other = _existing_supervisor_pid()
    if other is not None:
        sys.stderr.write(
            f"\n  [SUPERVISOR] Een andere supervisor (PID {other}) is al actief.\n"
            f"  Stop die eerst of verwijder {PID_FILE.name} handmatig.\n\n"
        )
        sys.exit(2)

    supervisor = Supervisor(echo_to_stdout=not args.no_echo)

    _banner(supervisor, args.port, args.host)
    print(f"  [SUPERVISOR] Started at {datetime.now().isoformat(timespec='seconds')}", flush=True)
    print(f"  [SUPERVISOR] Logs dir: {LOGS_DIR}", flush=True)
    print(f"  [SUPERVISOR] PID file: {PID_FILE}", flush=True)
    # Initialise each child in 'starting' state so the monitor loop
    # picks them up on the first tick.
    for child in supervisor.children.values():
        child.state = 'starting'

    _install_signal_handlers(supervisor)

    # HTTP listener (status UI).
    try:
        http_server = ThreadingHTTPServer((args.host, args.port), _StatusHandler)
    except OSError as e:
        # Re-use the same friendly port-in-use check from server.py
        # (errno 98 / 10048). Print & exit so an operator immediately
        # sees a clear message instead of a Python stack trace.
        if (getattr(e, 'errno', None) in (98, 10048)
                or 'already in use' in str(e).lower()):
            print(f"  [SUPERVISOR] Kan poort {args.port} niet binden op {args.host}: {e}",
                  flush=True)
            print(f"  Waarschijnlijk draait er al een supervisor. Controleer tasklist / lsof.", flush=True)
            sys.exit(2)
        raise

    http_server.supervisor_ref = supervisor
    http_thread = threading.Thread(
        target=http_server.serve_forever, daemon=True, name='supervisor-http',
    )
    http_thread.start()

    # Heartbeat writer.
    hb_thread = threading.Thread(
        target=_write_heartbeat_loop, args=(supervisor,), daemon=True, name='supervisor-heartbeat',
    )
    hb_thread.start()

    # Spawn monitor loop (initial spawns happen here on tick 1).
    monitor_thread = threading.Thread(
        target=_monitor_loop, args=(supervisor,), daemon=True, name='supervisor-monitor',
    )
    monitor_thread.start()

    if args.open:
        url = f'http://localhost:{args.port}/'
        print(f"  [SUPERVISOR] Openen: {url}", flush=True)
        # Don't error out on headless servers.
        try:
            webbrowser.open(url)
        except Exception:
            pass

    # Main thread blocks here until SIGINT/SIGTERM flips the flag.
    print('  [SUPERVISOR] Ctrl+C om alles netjes af te sluiten.\n', flush=True)
    try:
        while not _shutdown_requested.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt:
        _shutdown_requested.set()

    # Graceful shutdown sequence.
    _graceful_shutdown(supervisor, timeout_sec=5.0)
    http_server.shutdown()
    http_server.server_close()
    print('  [SUPERVISOR] Klaar. Tot ziens!\n', flush=True)
    sys.exit(0)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        # Belt-and-suspenders for the edge case where KeyboardInterrupt
        # lands outside signal handlers (e.g. on some POSIX consoles
        # before SIGINT registration completes). Don't dump a stack
        # trace; the operator explicitly asked to quit.
        print('\n  [SUPERVISOR] Onderbroken. Afsluiten…', flush=True)
        sys.exit(130)
