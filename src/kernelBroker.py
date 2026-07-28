# Jupyter broker: launches any installed kernelspec via jupyter_client and
# relays its iopub/shell messages as ___OPHI_ markers — the same protocol the
# marker driver speaks, so the JS transport is reused unchanged. This is the
# "extract just what we need from Jupyter" layer: kernel launch + protocol,
# nothing else (no notebook server, no nbformat).
#
# argv[1] = kernelspec name (e.g. python3, gophernotes, xcpp17, haskell)
# Requires: pip install jupyter_client ipykernel  (+ the kernelspec installed)

import sys, json, re, threading, queue

try:
    from jupyter_client.manager import start_new_kernel
except ImportError:
    print('___OPHI_FATAL___jupyter_client not available (' + sys.executable + '). pip install jupyter_client ipykernel', flush=True)
    sys.exit(1)

kernel_name = sys.argv[1] if len(sys.argv) > 1 else 'python3'

# Config line (protocol parity with the driver; unused for now).
sys.stdin.readline()

try:
    km, kc = start_new_kernel(kernel_name=kernel_name)
except Exception as e:
    print('___OPHI_FATAL___could not start kernel ' + repr(kernel_name) + ': ' + str(e), flush=True)
    sys.exit(1)

_ANSI = re.compile('\x1b\\[[0-9;]*m')
def _strip(s): return _ANSI.sub('', s or '')
def _clean_data(data):
    # Strip ANSI from the plain-text repr — some kernels (Deno) colorize it, and
    # the console renders text/plain verbatim. HTML/images pass through untouched.
    if isinstance(data, dict) and isinstance(data.get('text/plain'), str):
        data = dict(data); data['text/plain'] = _strip(data['text/plain'])
    return data

# Stdout line buffer: partial (newline-less) output stays buffered so it can
# never fuse with a marker line. Flushed before any marker and at cell end.
# A '\r'-terminated segment (progress bars) is passed through with its \r so
# the transport tags it as an in-place update; a trailing \r waits for the
# next chunk, since only the next byte says whether it was really CRLF.
_partial = ['']
def _raw_line(line):
    sys.stdout.write(line + '\n'); sys.stdout.flush()
def _stdout(text):
    _partial[0] += text
    while True:
        j = -1; sep = ''
        for k in ('\n', '\r'):
            i = _partial[0].find(k)
            if i >= 0 and (j < 0 or i < j): j = i; sep = k
        if j < 0: break
        if sep == '\r' and j == len(_partial[0]) - 1: break
        line = _partial[0][:j]; _partial[0] = _partial[0][j + 1:]
        if sep == '\r' and _partial[0][:1] == '\n':
            _partial[0] = _partial[0][1:]; sep = '\n'
        if sep == '\r':
            sys.stdout.write(line + '\r'); sys.stdout.flush()
        else:
            _raw_line(line)
def _flush_partial():
    if _partial[0]:
        _raw_line(_partial[0]); _partial[0] = ''
def _emit(marker):
    _flush_partial()
    sys.stdout.write(marker + '\n'); sys.stdout.flush()

# Stderr, same discipline: streamed as it arrives, '\r' updates marked as such.
_errbuf = ['']
def _stderr_text(text):
    _errbuf[0] += text
    while True:
        j = -1; sep = ''
        for k in ('\n', '\r'):
            i = _errbuf[0].find(k)
            if i >= 0 and (j < 0 or i < j): j = i; sep = k
        if j < 0: break
        if sep == '\r' and j == len(_errbuf[0]) - 1: break
        line = _errbuf[0][:j]; _errbuf[0] = _errbuf[0][j + 1:]
        if sep == '\r' and _errbuf[0][:1] == '\n':
            _errbuf[0] = _errbuf[0][1:]; sep = '\n'
        if line or sep == '\n':
            _emit(('___OPHI_STDERRCR___' if sep == '\r' else '___OPHI_STDERR___') + line)
def _flush_stderr():
    if _errbuf[0]:
        _emit('___OPHI_STDERR___' + _errbuf[0]); _errbuf[0] = ''

# Reader thread: INTERRUPT acts out of band; everything else queues.
_q = queue.Queue()
def _reader():
    while True:
        rl = sys.stdin.readline()
        if not rl:
            _q.put(None); return
        rl = rl.rstrip('\n').rstrip('\r')
        if rl == '___OPHI_INTERRUPT___':
            try: km.interrupt_kernel()
            except Exception: pass
            continue
        _q.put(rl)
threading.Thread(target=_reader, daemon=True).start()

print('___OPHI_READY___', flush=True)

def _shell_reply(msg_id):
    while True:
        try:
            reply = kc.get_shell_msg(timeout=120)
        except Exception:
            return {}
        if reply.get('parent_header', {}).get('msg_id') == msg_id:
            return reply.get('content', {})

def _run(code):
    msg_id = kc.execute(code, store_history=True, allow_stdin=False)
    _emit('___OPHI_CELL_START___')
    while True:
        try:
            msg = kc.get_iopub_msg(timeout=1)
        except queue.Empty:
            if not km.is_alive():
                break
            continue
        except Exception:
            break
        if msg.get('parent_header', {}).get('msg_id') != msg_id:
            continue
        t = msg.get('msg_type'); c = msg.get('content', {})
        if t == 'status':
            if c.get('execution_state') == 'idle':
                break
        elif t == 'stream':
            if c.get('name') == 'stderr':
                _stderr_text(c.get('text', ''))
            else:
                _stdout(c.get('text', ''))
        elif t == 'execute_result':
            _emit('___OPHI_DISPLAY___' + json.dumps({"kind": "result", "data": _clean_data(c.get('data', {}))}))
        elif t == 'display_data':
            _emit('___OPHI_DISPLAY___' + json.dumps({"kind": "display", "data": _clean_data(c.get('data', {}))}))
        elif t == 'error':
            _emit('___OPHI_ERROR___' + json.dumps({
                "ename": c.get('ename', ''), "evalue": c.get('evalue', ''),
                "frames": [], "traceback": _strip('\n'.join(c.get('traceback', []))),
            }))
    _flush_stderr()
    content = _shell_reply(msg_id)
    _emit('___OPHI_CELL_END___' if content.get('status') != 'error' else '___OPHI_CELL_ERROR___')

_buf = ''; _collecting = False
_cbuf = ''; _ccollecting = False
while True:
    line = _q.get()
    if line is None:
        break
    if line == '___OPHI_CHECK_START___':
        _ccollecting = True; _cbuf = ''; continue
    if line == '___OPHI_CHECK_END___':
        _ccollecting = False
        try:
            c = _shell_reply(kc.is_complete(_cbuf))
            st = c.get('status')
        except Exception:
            st = 'unknown'
        if st == 'complete':
            _emit('___OPHI_CHECK_OK___')
        else:
            _emit('___OPHI_CHECK_FAIL___' + json.dumps({"message": st or 'incomplete', "line": 0}))
        continue
    if _ccollecting:
        _cbuf += line + '\n'; continue
    if line.startswith('___OPHI_COMPLETE___'):
        try:
            req = json.loads(line[len('___OPHI_COMPLETE___'):])
            c = _shell_reply(kc.complete(req['code'], req['cursor']))
            _emit('___OPHI_COMPLETE_RESULT___' + json.dumps({
                "matches": [{"text": m, "type": ""} for m in c.get('matches', [])],
                "start": c.get('cursor_start', req['cursor']),
                "end": c.get('cursor_end', req['cursor']),
            }))
        except Exception:
            _emit('___OPHI_COMPLETE_RESULT___' + json.dumps({"matches": [], "start": 0, "end": 0}))
        continue
    if line.startswith('___OPHI_INSPECT___'):
        try:
            req = json.loads(line[len('___OPHI_INSPECT___'):])
            c = _shell_reply(kc.inspect(req['name'], len(req['name']), 0))
            data = c.get('data', {}) or {}
            _emit('___OPHI_INSPECT_RESULT___' + json.dumps({
                "found": bool(c.get('found')), "name": req['name'], "type": "", "signature": "",
                "doc": _strip(data.get('text/plain', ''))[:2000],
            }))
        except Exception:
            _emit('___OPHI_INSPECT_RESULT___' + json.dumps({"found": False, "name": "", "type": "", "signature": "", "doc": ""}))
        continue
    if line == '___OPHI_EXEC_START___':
        _collecting = True; _buf = ''; continue
    if line == '___OPHI_EXEC_END___':
        _collecting = False; _run(_buf); continue
    if _collecting:
        _buf += line + '\n'

try:
    kc.stop_channels(); km.shutdown_kernel(now=True)
except Exception:
    pass
