// The frameless-but-native window shim, compiled at runtime by bun's TinyCC
// (no toolchain on the host needed) and installed as a wndproc subclass.
//
// This is the trick every frameless-yet-native WebView2 wrapper uses (Electron,
// Tauri, Windows Terminal), split across two messages:
//
//   WM_NCCALCSIZE — keep WS_CAPTION|WS_THICKFRAME so the OS treats the window
//   as a normal resizable app window (Win+Arrow, snap, DWM shadow), but answer
//   "the client area is the entire window", so the bar and frame those styles
//   would paint never get any area to be drawn in.
//
//   WM_NCLBUTTONDOWN/HTCAPTION — the drag strip's synthetic caption press.
//   ReleaseCapture on this thread, then DefWindowProc, whose caption handler
//   runs the OS modal move loop: native drag, edge-snap previews, drag-to-top.
//   Chaining it to electrobun's proc instead loses the drag — its proc never
//   forwards the message to DefWindowProc.
//
// Everything else chains to electrobun's own wndproc. WM_NCHITTEST would be
// useless here: the WebView2 child covers the whole client area, so the parent
// never sees mouse hits — which is why the drag/resize REGIONS live in the view
// (drag strip and grips) and only window movement is native.
//
// Deliberately freestanding: bun's TinyCC ships no Windows headers and no
// import libraries, so every type is declared here and every user32 function
// arrives as a pointer through ophiSetup (JS resolves them via GetProcAddress).
// x64 has a single calling convention, which is what makes this legal without
// __stdcall annotations.

typedef long long LP;                 // LONG_PTR / LRESULT / LPARAM
typedef unsigned long long WP;        // WPARAM
typedef struct { int left, top, right, bottom; } RECT;

// The old proc is NOT callable directly: this window's class fell back to a
// system class ("Custom class failed" in the boot log), and GetWindowLongPtr
// on those returns a dispatch TOKEN (0xFFFF....), not a function pointer — a
// direct call segfaults at that token. CallWindowProcW exists precisely to
// dispatch either form.
typedef LP (*CallWindowProcFn)(void* proc, void* hwnd, unsigned int msg, WP w, LP l);
typedef LP (*DefWindowProcFn)(void* hwnd, unsigned int msg, WP w, LP l);
typedef int (*ReleaseCaptureFn)(void);
typedef int (*IsZoomedFn)(void* hwnd);
typedef int (*GetSystemMetricsFn)(int index);

static CallWindowProcFn   callWindowProc;
static DefWindowProcFn    defWindowProc;
static ReleaseCaptureFn   releaseCapture;
static void*              oldProc;        // electrobun's original wndproc (or token)
static IsZoomedFn         isZoomed;
static GetSystemMetricsFn getSystemMetrics;

#define WM_NCCALCSIZE      0x0083
#define WM_NCLBUTTONDOWN   0x00A1
#define HTCAPTION          2
#define SM_CXSIZEFRAME     32
#define SM_CYSIZEFRAME     33
#define SM_CXPADDEDBORDER  92

static LP ophiProc(void* hwnd, unsigned int msg, WP w, LP l) {
    if (!oldProc) return 0;   // never installed before setup — see install order in index.ts
    if (msg == WM_NCCALCSIZE && l) {
        // rgrc[0] is the first member of NCCALCSIZE_PARAMS, and the lone RECT
        // when wParam is FALSE — one cast covers both shapes.
        RECT* r = (RECT*)l;
        if (isZoomed(hwnd)) {
            // Maximized windows are deliberately oversized by the frame width
            // (the frame normally hangs off-screen). With no frame, un-inset
            // content would hang off-screen instead — pull it back in.
            int fx = getSystemMetrics(SM_CXSIZEFRAME) + getSystemMetrics(SM_CXPADDEDBORDER);
            int fy = getSystemMetrics(SM_CYSIZEFRAME) + getSystemMetrics(SM_CXPADDEDBORDER);
            r->left += fx; r->right -= fx;
            r->top  += fy; r->bottom -= fy;
        }
        return 0;   // client area = (adjusted) window rect; nothing non-client remains
    }
    // The drag poke: release this thread's capture (it must happen on the
    // window's own thread, right before the loop), then DefWindowProc runs the
    // OS modal move loop.
    if (msg == WM_NCLBUTTONDOWN && w == HTCAPTION) {
        releaseCapture();
        return defWindowProc(hwnd, msg, w, l);
    }
    return callWindowProc(oldProc, hwnd, msg, w, l);
}

void ophiSetup(void* callWindowProcPtr, void* defWindowProcPtr, void* releaseCapturePtr, void* isZoomedPtr, void* getSystemMetricsPtr) {
    callWindowProc = (CallWindowProcFn)callWindowProcPtr;
    defWindowProc = (DefWindowProcFn)defWindowProcPtr;
    releaseCapture = (ReleaseCaptureFn)releaseCapturePtr;
    isZoomed = (IsZoomedFn)isZoomedPtr;
    getSystemMetrics = (GetSystemMetricsFn)getSystemMetricsPtr;
}

void ophiSetOldProc(void* proc) { oldProc = proc; }
void* ophiGetProc(void) { return (void*)ophiProc; }
