# Ophiuchus kernel driver — a persistent IPython InteractiveShell over a
# line-based marker protocol. Cherry-picked from logos's driver: execution
# core, display seams (rich repr / display() / plots), structured errors,
# stderr ordering + output budget, tab-completion / hover-inspect /
# check-complete, and Ctrl-C interrupt. Dropped: namespace introspection,
# the logos.* cross-namespace accessors, and the in-kernel tool proxy.
#
# Protocol
#   in : config JSON line (once), then EXEC_START/code/EXEC_END,
#        CHECK_START/lines/CHECK_END, COMPLETE{json}, INSPECT{json}, INTERRUPT
#   out: READY, CELL_START, <raw stdout>, DISPLAY{json}, ERROR{json},
#        STDERR<line>, CELL_END|CELL_ERROR, CHECK_OK|CHECK_FAIL{json},
#        COMPLETE_RESULT{json}, INSPECT_RESULT{json}, FATAL<msg>

import sys, os, re, json, io, time, traceback, base64, threading, queue, signal, ast

try:
    from IPython.core.interactiveshell import InteractiveShell
    from IPython.core.completer import provisionalcompleter, rectify_completions
    from IPython.core.displayhook import DisplayHook
    from IPython.core.displaypub import DisplayPublisher
    from traitlets import Type
    from traitlets.config import Config
except ImportError:
    print('___OPHI_FATAL___IPython is not available in this interpreter (' + sys.executable + '). Install it: pip install ipython jedi', flush=True)
    sys.exit(1)

# Marker channel: protocol prints bypass the per-cell byte cap so a truncated
# marker can never corrupt the stream.
_real_stdout = sys.stdout
_out_budget = 2000000

# Children of this session (pip, %pip, subprocess python) write to a pipe, not
# a tty, so python children block-buffer 8KB and short runs flush only at exit
# — a pip install looked mute until done. Unbuffer every python descendant.
os.environ['PYTHONUNBUFFERED'] = '1'

class _CapIO(io.TextIOBase):
    def __init__(self, target, budget):
        self._t = target; self._left = budget; self.dropped = 0; self.endnl = True
    def writable(self): return True
    def write(self, s):
        if not s: return 0
        n = len(s)
        if self._left <= 0:
            self.dropped += n; return n
        if n > self._left:
            kept = s[:self._left]; self._t.write(kept)
            self.dropped += n - self._left; self._left = 0; self.endnl = kept.endswith(chr(10))
        else:
            self._t.write(s); self._left -= n; self.endnl = s.endswith(chr(10))
        return n
    def flush(self): self._t.flush()

# Live stderr: forwarded line-by-line AS the cell writes it — pip, tqdm,
# logging, warnings all speak on stderr, and dumping them at cell end made a
# running process look silent. A CR-terminated segment is a progress update
# and goes out under the STDERRCR marker so the console can overwrite the
# previous one instead of stacking thousands of lines.
class _StderrLive(io.TextIOBase):
    def __init__(self, budget, out_cap):
        self._left = budget; self.dropped = 0; self._buf = ''; self._out = out_cap
    def writable(self): return True
    def _emit(self, marker, line):
        # Never let a marker fuse onto a partial stdout line.
        if not self._out.endnl:
            _real_stdout.write(chr(10)); self._out.endnl = True
        print(marker + line, file=_real_stdout, flush=True)
    def write(self, s):
        if not s: return 0
        n = len(s)
        if self._left <= 0:
            self.dropped += n; return n
        if n > self._left:
            self.dropped += n - self._left; s = s[:self._left]
        self._left -= len(s)
        self._buf += s
        while True:
            j = -1; sep = ''
            for k in (chr(10), chr(13)):
                i = self._buf.find(k)
                if i >= 0 and (j < 0 or i < j): j = i; sep = k
            if j < 0: break
            line = self._buf[:j]; self._buf = self._buf[j + 1:]
            if sep == chr(13) and self._buf[:1] == chr(10):   # CRLF is one break
                self._buf = self._buf[1:]; sep = chr(10)
            if line or sep == chr(10):
                self._emit('___OPHI_STDERRCR___' if sep == chr(13) else '___OPHI_STDERR___', line)
        return n
    def flush(self): pass
    def finish(self):
        if self._buf:
            self._emit('___OPHI_STDERR___', self._buf)
        self._buf = ''

def _clean_bundle(data):
    out = {}
    for k, v in (data or {}).items():
        if isinstance(v, bytes): out[k] = base64.b64encode(v).decode()
        elif isinstance(v, str): out[k] = v
        else:
            try: json.dumps(v); out[k] = v
            except Exception: out[k] = repr(v)
    return out

# Display seams, swapped exactly where ipykernel swaps them: last-expression
# result and IPython.display.display() emit mime bundles instead of Out[N] text.
class _OphiDisplayHook(DisplayHook):
    def start_displayhook(self): self._bundle = None
    def write_output_prompt(self): pass
    def write_format_data(self, format_dict, md_dict=None): self._bundle = format_dict
    def finish_displayhook(self):
        if self._bundle:
            print('___OPHI_DISPLAY___' + json.dumps({"kind": "result", "data": _clean_bundle(self._bundle)}), file=_real_stdout, flush=True)
        self._bundle = None

class _OphiDisplayPub(DisplayPublisher):
    def publish(self, data, metadata=None, source=None, **kwargs):
        print('___OPHI_DISPLAY___' + json.dumps({"kind": "display", "data": _clean_bundle(data)}), file=_real_stdout, flush=True)
    def clear_output(self, wait=False): pass

# VT/ANSI control stripping for pty output. A pty child speaks to a screen —
# colours, cursor moves, title sets — and until the view renders VT itself the
# text is kept and the control is dropped. \r and \n survive: they carry the
# progress-overwrite semantics the transport already understands. Sequences
# split across read chunks are held back until they complete.
_VT = re.compile('\x1b\\[[0-9;?]*[ -/]*[@-~]|\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)|\x1b[@-_]|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]')
_VT_PARTIAL = re.compile('\x1b(\\[[0-9;?]*[ -/]*|\\][^\x07\x1b]*)?$')

# Conhost ends its lines "\r\r\n". Downstream, a \r NOT followed by \n is the
# progress-overwrite signal — so that stray \r made every pty line overwrite
# itself with the empty line behind it, and ! commands looked mute. \r runs
# followed by \n collapse to a plain newline; a bare \r (a real progress
# frame) passes through. A trailing \r run is held back until the next chunk
# says which case it is.
_CRNL = re.compile('\r+\n')

class _VtStrip:
    def __init__(self): self._carry = ''; self._cr = ''
    def _clean(self, text):
        out = _CRNL.sub(chr(10), self._cr + text)
        self._cr = ''
        i = len(out)
        while i and out[i - 1] == chr(13): i -= 1
        self._cr = out[i:]
        return out[:i]
    def feed(self, s):
        s = self._carry + s
        m = _VT_PARTIAL.search(s)
        self._carry = s[m.start():] if m else ''
        return self._clean(_VT.sub('', s[:m.start()] if m else s))
    def finish(self):
        s = self._carry; self._carry = ''
        out = _CRNL.sub(chr(10), self._cr + _VT.sub('', s))
        self._cr = ''
        return out

class _OphiShell(InteractiveShell):
    displayhook_class = Type(_OphiDisplayHook)
    display_pub_class = Type(_OphiDisplayPub)
    # The ! escape (and %pip through it) runs its child in a REAL pty — ConPTY
    # via pywinpty on Windows, the stdlib pty elsewhere — so programs see a
    # terminal and behave as themselves: line buffering, progress bars, no
    # pipe-mode fallbacks to emulate. (IPython's own Windows `system` captures
    # the child and prints everything at exit; a pip install looked mute until
    # done.) The pty wraps only shell children — the marker protocol itself
    # stays on clean pipes, where a screen renderer can't rewrap it.
    def system(self, cmd):
        try:
            if sys.platform == 'win32':
                code = self._system_winpty(cmd)
            else:
                code = self._system_pty(cmd)
        except ImportError:
            code = self._system_pipes(cmd)
        self.user_ns['_exit_code'] = code

    def _system_winpty(self, cmd):
        import winpty
        strip = _VtStrip()
        # The low-level PTY, not PtyProcess: it is the only pywinpty surface
        # that passes the command line VERBATIM (PtyProcess re-quotes argv and
        # mangles embedded quotes). WinPTY backend, not ConPTY: same terminal
        # illusion for the child, but ConPTY lingers ~8s at EOF per command
        # while WinPTY closes in half a second. cmd /s /c "<raw>" preserves
        # the user's own quoting.
        pty = winpty.PTY(200, 25, backend=winpty.Backend.WinPTY)
        if not pty.spawn(os.environ.get('COMSPEC', 'cmd.exe'), cmdline=' /s /c "' + cmd + '"'):
            return self._system_pipes(cmd)
        _active_pty[0] = pty
        try:
            while True:
                try:
                    data = pty.read(True)          # read(blocking) — WinptyError is EOF
                except KeyboardInterrupt:
                    raise
                except Exception:
                    break
                if not data:
                    if pty.iseof(): break
                    continue
                sys.stdout.write(strip.feed(data)); sys.stdout.flush()
        except KeyboardInterrupt:
            del pty                                # tears down the agent and its children
            raise
        finally:
            _active_pty[0] = None
        tail = strip.finish()
        if tail: sys.stdout.write(tail); sys.stdout.flush()
        code = pty.get_exitstatus()
        return code if code is not None else 0

    def _system_pty(self, cmd):
        import pty as _pty, subprocess
        strip = _VtStrip()
        m, s = _pty.openpty()
        p = subprocess.Popen(cmd, shell=True, stdin=s, stdout=s, stderr=s, close_fds=True)
        os.close(s)
        try:
            while True:
                try:
                    chunk = os.read(m, 4096)
                except OSError:
                    break
                if not chunk: break
                sys.stdout.write(strip.feed(chunk.decode('utf-8', 'replace'))); sys.stdout.flush()
        except KeyboardInterrupt:
            p.kill()
            raise
        finally:
            os.close(m)
            tail = strip.finish()
            if tail: sys.stdout.write(tail); sys.stdout.flush()
        return p.wait()

    # No pty available (pywinpty not installed): plain pipes, still streamed.
    def _system_pipes(self, cmd):
        import subprocess
        p = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
        try:
            for chunk in iter(lambda: p.stdout.read(4096), b''):
                sys.stdout.write(chunk.decode('utf-8', 'replace')); sys.stdout.flush()
        except KeyboardInterrupt:
            p.kill(); p.wait()
            raise
        return p.wait()
    # One override turns every runtime and syntax error into a structured
    # bundle: real frame paths for click-to-source, plus the rendered text.
    def _showtraceback(self, etype, evalue, stb):
        frames = []
        try:
            for fr in traceback.extract_tb(getattr(evalue, '__traceback__', None)):
                frames.append({"file": fr.filename or '', "line": fr.lineno or 0, "name": fr.name or ''})
        except Exception:
            frames = []
        if not frames and isinstance(evalue, SyntaxError) and evalue.filename:
            frames.append({"file": evalue.filename, "line": evalue.lineno or 0, "name": ''})
        text = chr(10).join(stb) if isinstance(stb, list) else str(stb)
        print('___OPHI_ERROR___' + json.dumps({
            "ename": getattr(etype, '__name__', '') or str(etype),
            "evalue": str(evalue), "frames": frames, "traceback": text,
        }), file=_real_stdout, flush=True)

# Shell config (the four kept lines): no ~/.ipython history pollution, compact
# tracebacks, side-effect-limited completion, no ANSI color.
_c = Config()
_c.HistoryManager.enabled = False
_c.InteractiveShell.xmode = 'Plain'
_c.IPCompleter.evaluation = 'limited'
shell = _OphiShell.instance(config=_c)
shell.colors = 'NoColor'

# Plots: a bare InteractiveShell has no GUI loop, so matplotlib lands on Agg
# and plt.show() warns it cannot draw. The inline backend (matplotlib_inline,
# ipykernel's own, standalone package) routes every figure through the display
# seam instead — the same DISPLAY marker the view already renders as an image.
# Enabled on the first cell that runs AFTER matplotlib appears in sys.modules,
# so sessions that never plot never pay the import.
_mpl_inline = [False]
def _ophi_auto_inline(*_a):
    if not _mpl_inline[0] and 'matplotlib' in sys.modules:
        _mpl_inline[0] = True
        try:
            shell.enable_matplotlib('inline')
        except Exception:
            pass   # matplotlib_inline not installed — Agg behavior stands
shell.events.register('pre_run_cell', _ophi_auto_inline)

# First stdin line carries runtime config (before READY).
_config_line = sys.stdin.readline().strip()
if _config_line:
    try:
        _cfg = json.loads(_config_line)
        _out_budget = int(_cfg.get('outputByteLimit') or _out_budget)
    except Exception:
        pass

# Cells must never read stdin — the protocol owns it, and a blocking input()
# (bare %reset's y/n prompt, any input() call) deadlocks the session against
# the reader thread. EOFError is ipykernel's answer too: IPython's ask_yes_no
# falls back to its default ('n' for %reset — "Nothing done"), and a plain
# input() raises immediately instead of hanging forever.
class _StdinEOF(io.TextIOBase):
    def readable(self): return True
    def read(self, *a): raise EOFError('stdin is not available in this session')
    def readline(self, *a): raise EOFError('stdin is not available in this session')
sys.stdin = _StdinEOF()

# A reader thread owns stdin so INTERRUPT acts out of band, never queued behind
# a running cell. raise_signal, NOT _thread.interrupt_main: interrupt_main only
# sets the Python-level flag, which a cell blocked in a C call (time.sleep, a
# long numpy op) never checks — a sleep(60) rode out its full 60s and raised
# KeyboardInterrupt afterwards. raise_signal goes through the C signal handler,
# the same path a real console Ctrl+C takes: it trips the interpreter's SIGINT
# event, which the blocking calls actually wait on.
#
# The thread must NEVER sit inside a blocking read on the pipe: with the host's
# async (overlapped) stdin pipe, a thread parked in ReadFile deadlocks OpenBLAS
# initialisation — a casual `import numpy` froze the kernel solid, and only
# under the app (a terminal's stdin never reproduced it). So it POLLS for
# readiness — PeekNamedPipe on Windows, select elsewhere — and reads raw bytes
# only when some are already there; between polls stdin is untouched.
# (The config readline above is safe: it completes before READY is printed, and
# the host sends nothing more until it has seen READY.)
_in_cell = False
_q = queue.Queue()
# The pty a ! command is currently reading, so INTERRUPT can unblock it:
# raise_signal alone cannot wake a thread parked inside pty.read.
_active_pty = [None]

if sys.platform == 'win32':
    import ctypes, msvcrt
    _h_stdin = msvcrt.get_osfhandle(0)
    _avail = ctypes.c_ulong(0)
    def _stdin_ready():
        if not ctypes.windll.kernel32.PeekNamedPipe(ctypes.c_void_p(_h_stdin), None, 0, None, ctypes.byref(_avail), None):
            return -1                      # pipe closed/broken
        return _avail.value
else:
    import select
    def _stdin_ready():
        return 1 if select.select([0], [], [], 0)[0] else 0

def _reader():
    buf = ''
    while True:
        n = _stdin_ready()
        if n == 0:
            time.sleep(0.03); continue     # ~30ms interrupt latency, no blocking read
        if n < 0:
            _q.put(None); return
        try:
            chunk = os.read(0, 65536)
        except OSError:
            _q.put(None); return
        if not chunk:
            _q.put(None); return
        buf += chunk.decode('utf-8', 'replace')
        while chr(10) in buf:
            line, buf = buf.split(chr(10), 1)
            line = line.rstrip(chr(13))
            if line == '___OPHI_INTERRUPT___':
                if _in_cell:
                    signal.raise_signal(signal.SIGINT)
                    p = _active_pty[0]
                    if p is not None:
                        try: p.cancel_io()
                        except Exception: pass
                continue
            _q.put(line)
threading.Thread(target=_reader, daemon=True).start()

print('___OPHI_READY___', flush=True)

_buf = ''; _collecting = False
_cbuf = ''; _ccollecting = False
while True:
    try:
        _line = _q.get()
    except KeyboardInterrupt:
        continue
    if _line is None:
        break
    if _line == '___OPHI_CHECK_START___':
        _ccollecting = True; _cbuf = ''; continue
    if _line == '___OPHI_CHECK_END___':
        _ccollecting = False
        try:
            _status = shell.check_complete(_cbuf)[0]
        except Exception:
            _status = 'invalid'
        # `status` distinguishes "not finished yet" from "actually wrong" — the
        # difference a streaming caller needs: incomplete means wait for more
        # text, invalid means run it now so the author sees the error.
        if _status == 'complete':
            print('___OPHI_CHECK_OK___', flush=True)
        elif _status == 'incomplete':
            print('___OPHI_CHECK_FAIL___' + json.dumps({"status": "incomplete", "message": "incomplete input", "line": 0}), flush=True)
        else:
            try:
                compile(shell.transform_cell(_cbuf), '<session>', 'exec')
                print('___OPHI_CHECK_OK___', flush=True)
            except SyntaxError as ce:
                print('___OPHI_CHECK_FAIL___' + json.dumps({"status": "invalid", "message": ce.msg or 'syntax error', "line": ce.lineno or 0}), flush=True)
            except Exception as ce:
                print('___OPHI_CHECK_FAIL___' + json.dumps({"status": "invalid", "message": str(ce), "line": 0}), flush=True)
        continue
    if _ccollecting:
        _cbuf += _line + chr(10); continue
    if _line.startswith('___OPHI_SPLIT___'):
        # Split a block into its top-level statements so each declaration can be
        # executed as its own cell — the interactive contract: a declaration is
        # executed as it is declared, then callable from the session heap.
        # Python's own parser decides the boundaries; decorators, multi-line
        # defs, strings and brackets all come out intact. Unparseable input is
        # returned whole so the kernel still reports the real SyntaxError.
        try:
            req = json.loads(_line[len('___OPHI_SPLIT___'):])
            src = req['code']
            parts = []
            # `ok` says the buffer is valid Python as it stands. A stream is fed
            # here half-written, so "does not parse yet" is the normal case and
            # must be distinguishable from "the model wrote a syntax error".
            ok = True
            try:
                tree = ast.parse(src)
                lines = src.split(chr(10))
                for node in tree.body:
                    start = min([node.lineno] + [d.lineno for d in getattr(node, 'decorator_list', [])]) - 1
                    end = getattr(node, 'end_lineno', node.lineno)
                    seg = chr(10).join(lines[start:end]).rstrip()
                    if seg.strip():
                        # `end` is how many lines of the ORIGINAL buffer this
                        # statement consumed. A streaming caller keeps the raw
                        # remainder by line, never the rstripped segment — that
                        # would silently drop the newline separating it from
                        # whatever arrives next.
                        parts.append({"text": seg, "end": end})
            except SyntaxError:
                ok = False
                parts = [{"text": src, "end": len(src.split(chr(10)))}]
            print('___OPHI_SPLIT_RESULT___' + json.dumps({"parts": parts or [{"text": src, "end": len(src.split(chr(10)))}], "ok": ok}), flush=True)
        except Exception:
            print('___OPHI_SPLIT_RESULT___' + json.dumps({"parts": [], "ok": False}), flush=True)
        continue
    if _line.startswith('___OPHI_COMPLETE___'):
        try:
            req = json.loads(_line[len('___OPHI_COMPLETE___'):])
            with provisionalcompleter():
                comps = list(rectify_completions(req['code'], shell.Completer.completions(req['code'], req['cursor'])))[:50]
            print('___OPHI_COMPLETE_RESULT___' + json.dumps({
                "matches": [{"text": c.text, "type": c.type or ''} for c in comps],
                "start": comps[0].start if comps else req['cursor'],
                "end": comps[0].end if comps else req['cursor'],
            }), flush=True)
        except Exception:
            print('___OPHI_COMPLETE_RESULT___' + json.dumps({"matches": [], "start": 0, "end": 0}), flush=True)
        continue
    if _line.startswith('___OPHI_INSPECT___'):
        try:
            req = json.loads(_line[len('___OPHI_INSPECT___'):])
            info = shell.object_inspect(req['name'], detail_level=0)
            doc = info.get('docstring') or ''
            if doc.strip() == '<no docstring>': doc = ''
            print('___OPHI_INSPECT_RESULT___' + json.dumps({
                "found": bool(info.get('found')), "name": req['name'],
                "type": info.get('type_name') or '',
                "signature": (info.get('definition') or info.get('init_definition') or '')[:400],
                "doc": doc[:2000],
            }), flush=True)
        except Exception:
            print('___OPHI_INSPECT_RESULT___' + json.dumps({"found": False, "name": "", "type": "", "signature": "", "doc": ""}), flush=True)
        continue
    if _line == '___OPHI_EXEC_START___':
        _collecting = True; _buf = ''; continue
    if _line == '___OPHI_EXEC_END___':
        _collecting = False
        print('___OPHI_CELL_START___', flush=True)
        _stdout_cap = _CapIO(sys.stdout, _out_budget)
        _stderr_cap = _StderrLive(_out_budget, _stdout_cap)
        _old_stderr = sys.stderr; _old_stdout = sys.stdout
        sys.stderr = _stderr_cap; sys.stdout = _stdout_cap
        _success = False; _in_cell = True
        try:
            _result = shell.run_cell(_buf, store_history=True, silent=False)
            _success = _result.success
        except KeyboardInterrupt:
            pass
        except Exception:
            traceback.print_exc()
        finally:
            _in_cell = False
            sys.stderr = _old_stderr; sys.stdout = _old_stdout
            sys.stdout.flush()
        try:
            # Flush the tail of a stderr line the cell never terminated, then
            # guarantee the terminal marker starts on a fresh line even if the
            # cell's last write had no trailing newline (print(x, end='')).
            _stderr_cap.finish()
            if not _stdout_cap.endnl:
                _real_stdout.write(chr(10)); _real_stdout.flush()
            _dropped = _stdout_cap.dropped + _stderr_cap.dropped
            if _dropped:
                print('___OPHI_STDERR___... [' + str(_dropped) + ' bytes dropped: per-cell budget ' + str(_out_budget) + ']', flush=True)
            print('___OPHI_CELL_END___' if _success else '___OPHI_CELL_ERROR___', flush=True)
        except KeyboardInterrupt:
            print('___OPHI_CELL_ERROR___', flush=True)
        continue
    if _collecting:
        _buf += _line + chr(10)
