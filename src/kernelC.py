# C backend (marker-driver type): each cell is a program, compiled and run in
# one step by TinyCC (`tcc -run` — no build artifacts, milliseconds). A cell
# without `main` is wrapped in common includes + main, so `printf("%d", 6*7);`
# just works. C has no session heap: cells are stateless, which the familiar's
# prompt is told about via the generic non-IPython note.
#
# Protocol: the same ___OPHI_ markers the python driver speaks — READY,
# CELL_START, raw stdout, STDERR, CELL_END/CELL_ERROR, CHECK is always OK
# (blocks run whole), INTERRUPT kills the running program.
#
# tcc is found via OPHI_TCC, PATH, or the default install location.

import sys, os, json, time, tempfile, threading, queue, subprocess, shutil

def _find_tcc(cfg):
    cands = [
        cfg.get('tcc'),
        os.environ.get('OPHI_TCC'),
        shutil.which('tcc'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'tcc', 'tcc', 'tcc.exe'),
        '/usr/bin/tcc', '/usr/local/bin/tcc',
    ]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None

_cfg = {}
_line = sys.stdin.readline().strip()
if _line:
    try: _cfg = json.loads(_line)
    except Exception: pass

TCC = _find_tcc(_cfg)
if not TCC:
    print('___OPHI_FATAL___tcc not found (set OPHI_TCC or put tcc on PATH) — C cells cannot run', flush=True)
    sys.exit(1)

WRAP_TOP = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\nint main(void) {\n'
WRAP_BOTTOM = '\n; return 0; }\n'

_in_cell = False
_active = [None]           # the running tcc process, for INTERRUPT
_q = queue.Queue()

# Same polling reader as the python driver: never block inside a pipe read.
if sys.platform == 'win32':
    import ctypes, msvcrt
    _h = msvcrt.get_osfhandle(0)
    _n = ctypes.c_ulong(0)
    def _ready():
        if not ctypes.windll.kernel32.PeekNamedPipe(ctypes.c_void_p(_h), None, 0, None, ctypes.byref(_n), None):
            return -1
        return _n.value
else:
    import select
    def _ready():
        return 1 if select.select([0], [], [], 0)[0] else 0

def _reader():
    buf = ''
    while True:
        n = _ready()
        if n == 0:
            time.sleep(0.03); continue
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
                p = _active[0]
                if p is not None:
                    try: p.kill()
                    except Exception: pass
                continue
            _q.put(line)
threading.Thread(target=_reader, daemon=True).start()

print('___OPHI_READY___', flush=True)

def _run_cell(code):
    print('___OPHI_CELL_START___', flush=True)
    src = code if 'main' in code and '(' in code else WRAP_TOP + code + WRAP_BOTTOM
    fd, path = tempfile.mkstemp(suffix='.c'); os.close(fd)
    ok = False
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(src)
        p = subprocess.Popen([TCC, '-run', path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        _active[0] = p
        err_lines = []
        def _drain_err():
            for raw in iter(lambda: p.stderr.readline(), b''):
                err_lines.append(raw.decode('utf-8', 'replace').rstrip())
        t = threading.Thread(target=_drain_err, daemon=True); t.start()
        for raw in iter(lambda: p.stdout.readline(), b''):
            # The child emits CRLF and python's text-mode stdout would add a
            # second \r — the transport then reads \r\r\n as a progress update
            # overwritten by an empty line, eating the output entirely.
            sys.stdout.write(raw.decode('utf-8', 'replace').replace(chr(13) + chr(10), chr(10)))
            sys.stdout.flush()
        code_ = p.wait(); t.join(timeout=2)
        def _clean(s):   # tcc reports the temp path with forward slashes
            return s.replace(path, '<cell>').replace(path.replace(os.sep, '/'), '<cell>')
        for el in err_lines:
            if el:
                print('___OPHI_STDERR___' + _clean(el), flush=True)
        ok = code_ == 0
        if not ok:
            print('___OPHI_ERROR___' + json.dumps({
                "ename": "CError", "evalue": "exit " + str(code_), "frames": [],
                "traceback": chr(10).join(_clean(el) for el in err_lines) or ('process exited ' + str(code_)),
            }), flush=True)
    finally:
        _active[0] = None
        try: os.remove(path)
        except Exception: pass
    print('___OPHI_CELL_END___' if ok else '___OPHI_CELL_ERROR___', flush=True)

_buf = ''; _collecting = False
while True:
    line = _q.get()
    if line is None:
        break
    if line == '___OPHI_CHECK_START___':
        _collecting = 'check'; _buf = ''; continue
    if line == '___OPHI_CHECK_END___':
        _collecting = False
        print('___OPHI_CHECK_OK___', flush=True)   # blocks always run whole
        continue
    if line == '___OPHI_EXEC_START___':
        _collecting = 'exec'; _buf = ''; continue
    if line == '___OPHI_EXEC_END___':
        _collecting = False; _run_cell(_buf); continue
    if _collecting:
        _buf += line + chr(10)
