# jCode sandbox runner (Python). Runs every case in cases.py against the
# function named there (FN), capturing each case's prints as the human's own
# output (tagged for the "My logs" view). Protocol lines are 0x1e-prefixed
# JSON records: one per case start, one summary at the end.
# Don't edit this file: it is copied fresh from the app on every publish.
import io, json, os, sys, time, traceback
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import solution  # noqa: E402
import cases as spec  # noqa: E402

RS = chr(0x1E)
CASES = getattr(spec, 'CASES', None) or getattr(spec, 'cases', [])
FN = getattr(spec, 'FN', None) or os.environ.get('JCODE_FN')
fn = getattr(solution, FN, None) if FN else None
if fn is None:
    fns = [v for v in vars(solution).values() if callable(v) and getattr(v, '__module__', '') == 'solution']
    fn = fns[0] if len(fns) == 1 else None
if fn is None:
    print(f"! solution.py defines no function{f' named {FN}' if FN else ''}")
    sys.exit(2)

def show(v):
    try:
        s = json.dumps(v, default=str)
    except Exception:
        s = repr(v)
    return s if len(s) <= 400 else s[:400] + '…'

def mine(text):
    for line in text.rstrip('\n').split('\n') if text else []:
        print(RS + json.dumps({'level': 'log', 'text': line}))

passed, results = 0, []
for c in CASES:
    print(RS + json.dumps({'jcode': True, 'type': 'case', 'name': c['name']}))
    t0 = time.perf_counter(); ok = False; error = None; actual = None; reason = None
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            actual = c['call'](fn) if 'call' in c else fn(*c.get('args', []), **c.get('kwargs', {}))
        if 'check' in c:
            r = c['check'](actual); ok = r is True
            if isinstance(r, str): reason = r
        else:
            ok = actual == c.get('expected')
    except Exception as e:  # noqa: BLE001
        error = ''.join(traceback.format_exception_only(type(e), e)).strip()
        if 'jcode:' in error: error = 'not implemented yet (the stub still raises)'
    mine(buf.getvalue())
    ms = int((time.perf_counter() - t0) * 1000)
    if ok: passed += 1
    tail = '' if ok else (f' — threw: {error}' if error else (f' — {reason}' if reason else f" — expected {show(c.get('expected'))}, got {show(actual)}"))
    print(('✓' if ok else '✗') + f" {c['name']}{tail}")
    results.append({'name': c['name'], 'pass': ok, 'ms': ms, 'expected': None if 'check' in c else show(c.get('expected')), 'actual': None if error else show(actual), 'error': error, 'reason': reason})
print(f"\n{passed}/{len(CASES)} cases passed")
print(RS + json.dumps({'jcode': True, 'type': 'summary', 'passed': passed, 'total': len(CASES), 'cases': results}))
sys.exit(0 if passed == len(CASES) and CASES else 1)
