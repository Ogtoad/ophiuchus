// node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}

class Channel {
  constructor(onmessage) {
    _Channel_onmessage.set(this, undefined);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, undefined);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {}), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = new WeakMap, _Channel_nextMessageIndex = new WeakMap, _Channel_pendingMessages = new WeakMap, _Channel_messageEndIndex = new WeakMap, SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
class Resource {
  get rid() {
    return __classPrivateFieldGet(this, _Resource_rid, "f");
  }
  constructor(rid) {
    _Resource_rid.set(this, undefined);
    __classPrivateFieldSet(this, _Resource_rid, rid, "f");
  }
  async close() {
    return invoke("plugin:resources|close", {
      rid: this.rid
    });
  }
}
_Resource_rid = new WeakMap;

// node_modules/@tauri-apps/api/dpi.js
class LogicalSize {
  constructor(...args) {
    this.type = "Logical";
    if (args.length === 1) {
      if ("Logical" in args[0]) {
        this.width = args[0].Logical.width;
        this.height = args[0].Logical.height;
      } else {
        this.width = args[0].width;
        this.height = args[0].height;
      }
    } else {
      this.width = args[0];
      this.height = args[1];
    }
  }
  toPhysical(scaleFactor) {
    return new PhysicalSize(this.width * scaleFactor, this.height * scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      width: this.width,
      height: this.height
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}

class PhysicalSize {
  constructor(...args) {
    this.type = "Physical";
    if (args.length === 1) {
      if ("Physical" in args[0]) {
        this.width = args[0].Physical.width;
        this.height = args[0].Physical.height;
      } else {
        this.width = args[0].width;
        this.height = args[0].height;
      }
    } else {
      this.width = args[0];
      this.height = args[1];
    }
  }
  toLogical(scaleFactor) {
    return new LogicalSize(this.width / scaleFactor, this.height / scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      width: this.width,
      height: this.height
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}

class Size {
  constructor(size) {
    this.size = size;
  }
  toLogical(scaleFactor) {
    return this.size instanceof LogicalSize ? this.size : this.size.toLogical(scaleFactor);
  }
  toPhysical(scaleFactor) {
    return this.size instanceof PhysicalSize ? this.size : this.size.toPhysical(scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      [`${this.size.type}`]: {
        width: this.size.width,
        height: this.size.height
      }
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}

class LogicalPosition {
  constructor(...args) {
    this.type = "Logical";
    if (args.length === 1) {
      if ("Logical" in args[0]) {
        this.x = args[0].Logical.x;
        this.y = args[0].Logical.y;
      } else {
        this.x = args[0].x;
        this.y = args[0].y;
      }
    } else {
      this.x = args[0];
      this.y = args[1];
    }
  }
  toPhysical(scaleFactor) {
    return new PhysicalPosition(this.x * scaleFactor, this.y * scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      x: this.x,
      y: this.y
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}

class PhysicalPosition {
  constructor(...args) {
    this.type = "Physical";
    if (args.length === 1) {
      if ("Physical" in args[0]) {
        this.x = args[0].Physical.x;
        this.y = args[0].Physical.y;
      } else {
        this.x = args[0].x;
        this.y = args[0].y;
      }
    } else {
      this.x = args[0];
      this.y = args[1];
    }
  }
  toLogical(scaleFactor) {
    return new LogicalPosition(this.x / scaleFactor, this.y / scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      x: this.x,
      y: this.y
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}

class Position {
  constructor(position) {
    this.position = position;
  }
  toLogical(scaleFactor) {
    return this.position instanceof LogicalPosition ? this.position : this.position.toLogical(scaleFactor);
  }
  toPhysical(scaleFactor) {
    return this.position instanceof PhysicalPosition ? this.position : this.position.toPhysical(scaleFactor);
  }
  [SERIALIZE_TO_IPC_FN]() {
    return {
      [`${this.position.type}`]: {
        x: this.position.x,
        y: this.position.y
      }
    };
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}
// node_modules/@tauri-apps/api/event.js
var TauriEvent;
(function(TauriEvent2) {
  TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
  TauriEvent2["WINDOW_MOVED"] = "tauri://move";
  TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
  TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
  TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
  TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
  TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
  TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
  TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
  TauriEvent2["WINDOW_SUSPENDED"] = "tauri://suspended";
  TauriEvent2["WINDOW_RESUMED"] = "tauri://resumed";
  TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
  TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
  TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
  TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
  TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
})(TauriEvent || (TauriEvent = {}));
async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId
  });
}
async function listen(event, handler, options) {
  var _a;
  const target = typeof (options === null || options === undefined ? undefined : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === undefined ? undefined : options.target) !== null && _a !== undefined ? _a : { kind: "Any" };
  return invoke("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler)
  }).then((eventId) => {
    return async () => _unlisten(event, eventId);
  });
}
async function once(event, handler, options) {
  return listen(event, (eventData) => {
    _unlisten(event, eventData.id);
    handler(eventData);
  }, options);
}
async function emit(event, payload) {
  await invoke("plugin:event|emit", {
    event,
    payload
  });
}
async function emitTo(target, event, payload) {
  const eventTarget = typeof target === "string" ? { kind: "AnyLabel", label: target } : target;
  await invoke("plugin:event|emit_to", {
    target: eventTarget,
    event,
    payload
  });
}

// node_modules/@tauri-apps/api/image.js
class Image extends Resource {
  constructor(rid) {
    super(rid);
  }
  static async new(rgba, width, height) {
    return invoke("plugin:image|new", {
      rgba: transformImage(rgba),
      width,
      height
    }).then((rid) => new Image(rid));
  }
  static async fromBytes(bytes) {
    return invoke("plugin:image|from_bytes", {
      bytes: transformImage(bytes)
    }).then((rid) => new Image(rid));
  }
  static async fromPath(path) {
    return invoke("plugin:image|from_path", { path }).then((rid) => new Image(rid));
  }
  async rgba() {
    return invoke("plugin:image|rgba", {
      rid: this.rid
    }).then((buffer) => new Uint8Array(buffer));
  }
  async size() {
    return invoke("plugin:image|size", { rid: this.rid });
  }
}
function transformImage(image) {
  const ret = image == null ? null : typeof image === "string" ? image : image instanceof Image ? image.rid : image;
  return ret;
}

// node_modules/@tauri-apps/api/window.js
var UserAttentionType;
(function(UserAttentionType2) {
  UserAttentionType2[UserAttentionType2["Critical"] = 1] = "Critical";
  UserAttentionType2[UserAttentionType2["Informational"] = 2] = "Informational";
})(UserAttentionType || (UserAttentionType = {}));

class CloseRequestedEvent {
  constructor(event) {
    this._preventDefault = false;
    this.event = event.event;
    this.id = event.id;
  }
  preventDefault() {
    this._preventDefault = true;
  }
  isPreventDefault() {
    return this._preventDefault;
  }
}
var ProgressBarStatus;
(function(ProgressBarStatus2) {
  ProgressBarStatus2["None"] = "none";
  ProgressBarStatus2["Normal"] = "normal";
  ProgressBarStatus2["Indeterminate"] = "indeterminate";
  ProgressBarStatus2["Paused"] = "paused";
  ProgressBarStatus2["Error"] = "error";
})(ProgressBarStatus || (ProgressBarStatus = {}));
function getCurrentWindow() {
  return new Window(window.__TAURI_INTERNALS__.metadata.currentWindow.label, {
    skip: true
  });
}
async function getAllWindows() {
  return invoke("plugin:window|get_all_windows").then((windows) => windows.map((w) => new Window(w, {
    skip: true
  })));
}
var localTauriEvents = ["tauri://created", "tauri://error"];

class Window {
  constructor(label, options = {}) {
    var _a;
    this.label = label;
    this.listeners = Object.create(null);
    if (!(options === null || options === undefined ? undefined : options.skip)) {
      invoke("plugin:window|create", {
        options: {
          ...options,
          parent: typeof options.parent === "string" ? options.parent : (_a = options.parent) === null || _a === undefined ? undefined : _a.label,
          label
        }
      }).then(async () => this.emit("tauri://created")).catch(async (e) => this.emit("tauri://error", e));
    }
  }
  static async getByLabel(label) {
    var _a;
    return (_a = (await getAllWindows()).find((w) => w.label === label)) !== null && _a !== undefined ? _a : null;
  }
  static getCurrent() {
    return getCurrentWindow();
  }
  static async getAll() {
    return getAllWindows();
  }
  static async getFocusedWindow() {
    for (const w of await getAllWindows()) {
      if (await w.isFocused()) {
        return w;
      }
    }
    return null;
  }
  async listen(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return listen(event, handler, {
      target: { kind: "Window", label: this.label }
    });
  }
  async once(event, handler) {
    if (this._handleTauriEvent(event, handler)) {
      return () => {
        const listeners = this.listeners[event];
        listeners.splice(listeners.indexOf(handler), 1);
      };
    }
    return once(event, handler, {
      target: { kind: "Window", label: this.label }
    });
  }
  async emit(event, payload) {
    if (localTauriEvents.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emit(event, payload);
  }
  async emitTo(target, event, payload) {
    if (localTauriEvents.includes(event)) {
      for (const handler of this.listeners[event] || []) {
        handler({
          event,
          id: -1,
          payload
        });
      }
      return;
    }
    return emitTo(target, event, payload);
  }
  _handleTauriEvent(event, handler) {
    if (localTauriEvents.includes(event)) {
      if (!(event in this.listeners)) {
        this.listeners[event] = [handler];
      } else {
        this.listeners[event].push(handler);
      }
      return true;
    }
    return false;
  }
  async scaleFactor() {
    return invoke("plugin:window|scale_factor", {
      label: this.label
    });
  }
  async innerPosition() {
    return invoke("plugin:window|inner_position", {
      label: this.label
    }).then((p) => new PhysicalPosition(p));
  }
  async outerPosition() {
    return invoke("plugin:window|outer_position", {
      label: this.label
    }).then((p) => new PhysicalPosition(p));
  }
  async innerSize() {
    return invoke("plugin:window|inner_size", {
      label: this.label
    }).then((s) => new PhysicalSize(s));
  }
  async outerSize() {
    return invoke("plugin:window|outer_size", {
      label: this.label
    }).then((s) => new PhysicalSize(s));
  }
  async isFullscreen() {
    return invoke("plugin:window|is_fullscreen", {
      label: this.label
    });
  }
  async isMinimized() {
    return invoke("plugin:window|is_minimized", {
      label: this.label
    });
  }
  async isMaximized() {
    return invoke("plugin:window|is_maximized", {
      label: this.label
    });
  }
  async isFocused() {
    return invoke("plugin:window|is_focused", {
      label: this.label
    });
  }
  async isDecorated() {
    return invoke("plugin:window|is_decorated", {
      label: this.label
    });
  }
  async isResizable() {
    return invoke("plugin:window|is_resizable", {
      label: this.label
    });
  }
  async isMaximizable() {
    return invoke("plugin:window|is_maximizable", {
      label: this.label
    });
  }
  async isMinimizable() {
    return invoke("plugin:window|is_minimizable", {
      label: this.label
    });
  }
  async isClosable() {
    return invoke("plugin:window|is_closable", {
      label: this.label
    });
  }
  async isVisible() {
    return invoke("plugin:window|is_visible", {
      label: this.label
    });
  }
  async title() {
    return invoke("plugin:window|title", {
      label: this.label
    });
  }
  async theme() {
    return invoke("plugin:window|theme", {
      label: this.label
    });
  }
  async isAlwaysOnTop() {
    return invoke("plugin:window|is_always_on_top", {
      label: this.label
    });
  }
  async activityName() {
    return invoke("plugin:window|activity_name", {
      label: this.label
    });
  }
  async sceneIdentifier() {
    return invoke("plugin:window|scene_identifier", {
      label: this.label
    });
  }
  async center() {
    return invoke("plugin:window|center", {
      label: this.label
    });
  }
  async requestUserAttention(requestType) {
    let requestType_ = null;
    if (requestType) {
      if (requestType === UserAttentionType.Critical) {
        requestType_ = { type: "Critical" };
      } else {
        requestType_ = { type: "Informational" };
      }
    }
    return invoke("plugin:window|request_user_attention", {
      label: this.label,
      value: requestType_
    });
  }
  async setResizable(resizable) {
    return invoke("plugin:window|set_resizable", {
      label: this.label,
      value: resizable
    });
  }
  async setEnabled(enabled) {
    return invoke("plugin:window|set_enabled", {
      label: this.label,
      value: enabled
    });
  }
  async isEnabled() {
    return invoke("plugin:window|is_enabled", {
      label: this.label
    });
  }
  async setMaximizable(maximizable) {
    return invoke("plugin:window|set_maximizable", {
      label: this.label,
      value: maximizable
    });
  }
  async setMinimizable(minimizable) {
    return invoke("plugin:window|set_minimizable", {
      label: this.label,
      value: minimizable
    });
  }
  async setClosable(closable) {
    return invoke("plugin:window|set_closable", {
      label: this.label,
      value: closable
    });
  }
  async setTitle(title) {
    return invoke("plugin:window|set_title", {
      label: this.label,
      value: title
    });
  }
  async maximize() {
    return invoke("plugin:window|maximize", {
      label: this.label
    });
  }
  async unmaximize() {
    return invoke("plugin:window|unmaximize", {
      label: this.label
    });
  }
  async toggleMaximize() {
    return invoke("plugin:window|toggle_maximize", {
      label: this.label
    });
  }
  async minimize() {
    return invoke("plugin:window|minimize", {
      label: this.label
    });
  }
  async unminimize() {
    return invoke("plugin:window|unminimize", {
      label: this.label
    });
  }
  async show() {
    return invoke("plugin:window|show", {
      label: this.label
    });
  }
  async hide() {
    return invoke("plugin:window|hide", {
      label: this.label
    });
  }
  async close() {
    return invoke("plugin:window|close", {
      label: this.label
    });
  }
  async destroy() {
    return invoke("plugin:window|destroy", {
      label: this.label
    });
  }
  async setDecorations(decorations) {
    return invoke("plugin:window|set_decorations", {
      label: this.label,
      value: decorations
    });
  }
  async setShadow(enable) {
    return invoke("plugin:window|set_shadow", {
      label: this.label,
      value: enable
    });
  }
  async setEffects(effects) {
    return invoke("plugin:window|set_effects", {
      label: this.label,
      value: effects
    });
  }
  async clearEffects() {
    return invoke("plugin:window|set_effects", {
      label: this.label,
      value: null
    });
  }
  async setAlwaysOnTop(alwaysOnTop) {
    return invoke("plugin:window|set_always_on_top", {
      label: this.label,
      value: alwaysOnTop
    });
  }
  async setAlwaysOnBottom(alwaysOnBottom) {
    return invoke("plugin:window|set_always_on_bottom", {
      label: this.label,
      value: alwaysOnBottom
    });
  }
  async setContentProtected(protected_) {
    return invoke("plugin:window|set_content_protected", {
      label: this.label,
      value: protected_
    });
  }
  async setSize(size) {
    return invoke("plugin:window|set_size", {
      label: this.label,
      value: size instanceof Size ? size : new Size(size)
    });
  }
  async setMinSize(size) {
    return invoke("plugin:window|set_min_size", {
      label: this.label,
      value: size instanceof Size ? size : size ? new Size(size) : null
    });
  }
  async setMaxSize(size) {
    return invoke("plugin:window|set_max_size", {
      label: this.label,
      value: size instanceof Size ? size : size ? new Size(size) : null
    });
  }
  async setSizeConstraints(constraints) {
    function logical(pixel) {
      return pixel ? { Logical: pixel } : null;
    }
    return invoke("plugin:window|set_size_constraints", {
      label: this.label,
      value: {
        minWidth: logical(constraints === null || constraints === undefined ? undefined : constraints.minWidth),
        minHeight: logical(constraints === null || constraints === undefined ? undefined : constraints.minHeight),
        maxWidth: logical(constraints === null || constraints === undefined ? undefined : constraints.maxWidth),
        maxHeight: logical(constraints === null || constraints === undefined ? undefined : constraints.maxHeight)
      }
    });
  }
  async setPosition(position) {
    return invoke("plugin:window|set_position", {
      label: this.label,
      value: position instanceof Position ? position : new Position(position)
    });
  }
  async setFullscreen(fullscreen) {
    return invoke("plugin:window|set_fullscreen", {
      label: this.label,
      value: fullscreen
    });
  }
  async setSimpleFullscreen(fullscreen) {
    return invoke("plugin:window|set_simple_fullscreen", {
      label: this.label,
      value: fullscreen
    });
  }
  async setFocus() {
    return invoke("plugin:window|set_focus", {
      label: this.label
    });
  }
  async setFocusable(focusable) {
    return invoke("plugin:window|set_focusable", {
      label: this.label,
      value: focusable
    });
  }
  async setIcon(icon) {
    return invoke("plugin:window|set_icon", {
      label: this.label,
      value: transformImage(icon)
    });
  }
  async setSkipTaskbar(skip) {
    return invoke("plugin:window|set_skip_taskbar", {
      label: this.label,
      value: skip
    });
  }
  async setCursorGrab(grab) {
    return invoke("plugin:window|set_cursor_grab", {
      label: this.label,
      value: grab
    });
  }
  async setCursorVisible(visible) {
    return invoke("plugin:window|set_cursor_visible", {
      label: this.label,
      value: visible
    });
  }
  async setCursorIcon(icon) {
    return invoke("plugin:window|set_cursor_icon", {
      label: this.label,
      value: icon
    });
  }
  async setBackgroundColor(color) {
    return invoke("plugin:window|set_background_color", { color });
  }
  async setCursorPosition(position) {
    return invoke("plugin:window|set_cursor_position", {
      label: this.label,
      value: position instanceof Position ? position : new Position(position)
    });
  }
  async setIgnoreCursorEvents(ignore) {
    return invoke("plugin:window|set_ignore_cursor_events", {
      label: this.label,
      value: ignore
    });
  }
  async startDragging() {
    return invoke("plugin:window|start_dragging", {
      label: this.label
    });
  }
  async startResizeDragging(direction) {
    return invoke("plugin:window|start_resize_dragging", {
      label: this.label,
      value: direction
    });
  }
  async setBadgeCount(count) {
    return invoke("plugin:window|set_badge_count", {
      label: this.label,
      value: count
    });
  }
  async setBadgeLabel(label) {
    return invoke("plugin:window|set_badge_label", {
      label: this.label,
      value: label
    });
  }
  async setOverlayIcon(icon) {
    return invoke("plugin:window|set_overlay_icon", {
      label: this.label,
      value: icon ? transformImage(icon) : undefined
    });
  }
  async setProgressBar(state) {
    return invoke("plugin:window|set_progress_bar", {
      label: this.label,
      value: state
    });
  }
  async setVisibleOnAllWorkspaces(visible) {
    return invoke("plugin:window|set_visible_on_all_workspaces", {
      label: this.label,
      value: visible
    });
  }
  async setTitleBarStyle(style) {
    return invoke("plugin:window|set_title_bar_style", {
      label: this.label,
      value: style
    });
  }
  async setTheme(theme) {
    return invoke("plugin:window|set_theme", {
      label: this.label,
      value: theme
    });
  }
  async onResized(handler) {
    return this.listen(TauriEvent.WINDOW_RESIZED, (e) => {
      e.payload = new PhysicalSize(e.payload);
      handler(e);
    });
  }
  async onMoved(handler) {
    return this.listen(TauriEvent.WINDOW_MOVED, (e) => {
      e.payload = new PhysicalPosition(e.payload);
      handler(e);
    });
  }
  async onCloseRequested(handler) {
    return this.listen(TauriEvent.WINDOW_CLOSE_REQUESTED, async (event) => {
      const evt = new CloseRequestedEvent(event);
      await handler(evt);
      if (!evt.isPreventDefault()) {
        await this.destroy();
      }
    });
  }
  async onDragDropEvent(handler) {
    const unlistenDrag = await this.listen(TauriEvent.DRAG_ENTER, (event) => {
      handler({
        ...event,
        payload: {
          type: "enter",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDragOver = await this.listen(TauriEvent.DRAG_OVER, (event) => {
      handler({
        ...event,
        payload: {
          type: "over",
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenDrop = await this.listen(TauriEvent.DRAG_DROP, (event) => {
      handler({
        ...event,
        payload: {
          type: "drop",
          paths: event.payload.paths,
          position: new PhysicalPosition(event.payload.position)
        }
      });
    });
    const unlistenCancel = await this.listen(TauriEvent.DRAG_LEAVE, (event) => {
      handler({ ...event, payload: { type: "leave" } });
    });
    return () => {
      unlistenDrag();
      unlistenDrop();
      unlistenDragOver();
      unlistenCancel();
    };
  }
  async onFocusChanged(handler) {
    const unlistenFocus = await this.listen(TauriEvent.WINDOW_FOCUS, (event) => {
      handler({ ...event, payload: true });
    });
    const unlistenBlur = await this.listen(TauriEvent.WINDOW_BLUR, (event) => {
      handler({ ...event, payload: false });
    });
    return () => {
      unlistenFocus();
      unlistenBlur();
    };
  }
  async onScaleChanged(handler) {
    return this.listen(TauriEvent.WINDOW_SCALE_FACTOR_CHANGED, handler);
  }
  async onThemeChanged(handler) {
    return this.listen(TauriEvent.WINDOW_THEME_CHANGED, handler);
  }
}
var BackgroundThrottlingPolicy;
(function(BackgroundThrottlingPolicy2) {
  BackgroundThrottlingPolicy2["Disabled"] = "disabled";
  BackgroundThrottlingPolicy2["Throttle"] = "throttle";
  BackgroundThrottlingPolicy2["Suspend"] = "suspend";
})(BackgroundThrottlingPolicy || (BackgroundThrottlingPolicy = {}));
var ScrollBarStyle;
(function(ScrollBarStyle2) {
  ScrollBarStyle2["Default"] = "default";
  ScrollBarStyle2["FluentOverlay"] = "fluentOverlay";
})(ScrollBarStyle || (ScrollBarStyle = {}));
var Effect;
(function(Effect2) {
  Effect2["AppearanceBased"] = "appearanceBased";
  Effect2["Light"] = "light";
  Effect2["Dark"] = "dark";
  Effect2["MediumLight"] = "mediumLight";
  Effect2["UltraDark"] = "ultraDark";
  Effect2["Titlebar"] = "titlebar";
  Effect2["Selection"] = "selection";
  Effect2["Menu"] = "menu";
  Effect2["Popover"] = "popover";
  Effect2["Sidebar"] = "sidebar";
  Effect2["HeaderView"] = "headerView";
  Effect2["Sheet"] = "sheet";
  Effect2["WindowBackground"] = "windowBackground";
  Effect2["HudWindow"] = "hudWindow";
  Effect2["FullScreenUI"] = "fullScreenUI";
  Effect2["Tooltip"] = "tooltip";
  Effect2["ContentBackground"] = "contentBackground";
  Effect2["UnderWindowBackground"] = "underWindowBackground";
  Effect2["UnderPageBackground"] = "underPageBackground";
  Effect2["Mica"] = "mica";
  Effect2["Blur"] = "blur";
  Effect2["Acrylic"] = "acrylic";
  Effect2["Tabbed"] = "tabbed";
  Effect2["TabbedDark"] = "tabbedDark";
  Effect2["TabbedLight"] = "tabbedLight";
})(Effect || (Effect = {}));
var EffectState;
(function(EffectState2) {
  EffectState2["FollowsWindowActiveState"] = "followsWindowActiveState";
  EffectState2["Active"] = "active";
  EffectState2["Inactive"] = "inactive";
})(EffectState || (EffectState = {}));

// node_modules/@tauri-apps/plugin-shell/dist-js/index.js
class EventEmitter {
  constructor() {
    this.eventListeners = Object.create(null);
  }
  addListener(eventName, listener) {
    return this.on(eventName, listener);
  }
  removeListener(eventName, listener) {
    return this.off(eventName, listener);
  }
  on(eventName, listener) {
    if (eventName in this.eventListeners) {
      this.eventListeners[eventName].push(listener);
    } else {
      this.eventListeners[eventName] = [listener];
    }
    return this;
  }
  once(eventName, listener) {
    const wrapper = (arg) => {
      this.removeListener(eventName, wrapper);
      listener(arg);
    };
    return this.addListener(eventName, wrapper);
  }
  off(eventName, listener) {
    if (eventName in this.eventListeners) {
      this.eventListeners[eventName] = this.eventListeners[eventName].filter((l) => l !== listener);
    }
    return this;
  }
  removeAllListeners(event) {
    if (event) {
      delete this.eventListeners[event];
    } else {
      this.eventListeners = Object.create(null);
    }
    return this;
  }
  emit(eventName, arg) {
    if (eventName in this.eventListeners) {
      const listeners = this.eventListeners[eventName];
      for (const listener of listeners)
        listener(arg);
      return true;
    }
    return false;
  }
  listenerCount(eventName) {
    if (eventName in this.eventListeners)
      return this.eventListeners[eventName].length;
    return 0;
  }
  prependListener(eventName, listener) {
    if (eventName in this.eventListeners) {
      this.eventListeners[eventName].unshift(listener);
    } else {
      this.eventListeners[eventName] = [listener];
    }
    return this;
  }
  prependOnceListener(eventName, listener) {
    const wrapper = (arg) => {
      this.removeListener(eventName, wrapper);
      listener(arg);
    };
    return this.prependListener(eventName, wrapper);
  }
}

class Child {
  constructor(pid) {
    this.pid = pid;
  }
  async write(data) {
    await invoke("plugin:shell|stdin_write", {
      pid: this.pid,
      buffer: data
    });
  }
  async kill() {
    await invoke("plugin:shell|kill", {
      cmd: "killChild",
      pid: this.pid
    });
  }
}

class Command extends EventEmitter {
  constructor(program, args = [], options) {
    super();
    this.stdout = new EventEmitter;
    this.stderr = new EventEmitter;
    this.program = program;
    this.args = typeof args === "string" ? [args] : args;
    this.options = options ?? {};
  }
  static create(program, args = [], options) {
    return new Command(program, args, options);
  }
  static sidecar(program, args = [], options) {
    const instance = new Command(program, args, options);
    instance.options.sidecar = true;
    return instance;
  }
  async spawn() {
    const program = this.program;
    const args = this.args;
    const options = this.options;
    if (typeof args === "object") {
      Object.freeze(args);
    }
    const onEvent = new Channel;
    onEvent.onmessage = (event) => {
      switch (event.event) {
        case "Error":
          this.emit("error", event.payload);
          break;
        case "Terminated":
          this.emit("close", event.payload);
          break;
        case "Stdout":
          this.stdout.emit("data", event.payload);
          break;
        case "Stderr":
          this.stderr.emit("data", event.payload);
          break;
      }
    };
    return await invoke("plugin:shell|spawn", {
      program,
      args,
      options,
      onEvent
    }).then((pid) => new Child(pid));
  }
  async execute() {
    const program = this.program;
    const args = this.args;
    const options = this.options;
    if (typeof args === "object") {
      Object.freeze(args);
    }
    return await invoke("plugin:shell|execute", {
      program,
      args,
      options
    });
  }
}

// src/tauriShim.js
var RESIZE_DIR = { n: "North", s: "South", e: "East", w: "West", nw: "NorthWest", ne: "NorthEast", sw: "SouthWest", se: "SouthEast" };
function createTauriShim({ messages = {} } = {}) {
  const win = getCurrentWindow();
  const dbg = (line) => {
    console.error("[shim]", line);
    invoke("gate_report", { line: "[shim] " + line }).catch(() => {});
  };
  let child = null;
  let nextId = 1;
  let respawned = false;
  const pending = new Map;
  function feedLine(line) {
    if (!line.trim())
      return;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      dbg("bad frame: " + line.slice(0, 120));
      return;
    }
    if (m.push) {
      messages[m.push] && messages[m.push](m.payload);
      return;
    }
    const p = pending.get(m.id);
    if (!p)
      return;
    pending.delete(m.id);
    if (m.error)
      p.reject(new Error(m.error));
    else
      p.resolve(m.result);
  }
  async function start() {
    const dec = new TextDecoder;
    let buf = "";
    const asLines = (d, onLine) => {
      if (typeof d === "string") {
        onLine(d);
        return;
      }
      buf += dec.decode(d, { stream: true });
      let i;
      while ((i = buf.indexOf(`
`)) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    };
    const cmd = Command.sidecar("binaries/ophi-core");
    cmd.stdout.on("data", (d) => asLines(d, feedLine));
    cmd.stderr.on("data", (d) => asLines(d, (text) => {
      console.error("[core]", text);
      invoke("gate_report", { line: "[core] " + String(text).slice(0, 300) }).catch(() => {});
    }));
    cmd.on("error", (e) => dbg("core spawn error: " + (e?.message ?? String(e))));
    cmd.on("close", (c) => {
      dbg("core exited: " + JSON.stringify(c));
      child = null;
      for (const p of pending.values())
        p.reject(new Error("ophi-core exited"));
      pending.clear();
      if (!respawned) {
        respawned = true;
        ready = start();
      }
    });
    child = await cmd.spawn();
    dbg("core spawned, pid " + child.pid);
  }
  let ready = start();
  const request = new Proxy({}, {
    get: (_t, method) => async (args = {}) => {
      await ready;
      if (!child)
        throw new Error("ophi-core is not running");
      const id = nextId++;
      const line = JSON.stringify({ id, method, args }) + `
`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.write(line).catch((e) => {
          pending.delete(id);
          reject(e);
        });
      });
    }
  });
  const send = {
    windowDragStart: () => {},
    windowMove: () => {},
    windowClose: () => {
      win.close();
    },
    windowToggleMaximize: () => {
      win.toggleMaximize();
    },
    windowResize: ({ edge }) => {
      const d = RESIZE_DIR[edge];
      if (d)
        win.startResizeDragging(d);
    }
  };
  return { rpc: { request, send } };
}

// src/workspaceKeys.js
var DEFAULT_KEYBINDINGS = {
  sendToConsole: { key: "Enter", ctrl: true },
  sendToChat: { key: "Enter", alt: true }
};
function matchBinding(e, b) {
  if (e.key !== b.key)
    return false;
  const isAltGr = e.getModifierState && e.getModifierState("AltGraph") || e.ctrlKey && e.altKey;
  const altGrAsAlt = isAltGr && !b.altGr && !!b.alt && !b.ctrl;
  const ctrl = altGrAsAlt ? false : e.ctrlKey;
  const alt = altGrAsAlt ? true : e.altKey;
  if (b.altGr) {
    if (!isAltGr)
      return false;
  } else {
    if (isAltGr && !altGrAsAlt)
      return false;
    if (!!b.ctrl !== ctrl)
      return false;
    if (!!b.alt !== alt)
      return false;
  }
  if (!!b.shift !== e.shiftKey)
    return false;
  if (!!b.meta !== e.metaKey)
    return false;
  return true;
}
function createKeybindings(map = DEFAULT_KEYBINDINGS) {
  return {
    matchAction(e) {
      let fallback = null;
      for (const [action, binding] of Object.entries(map)) {
        if (!matchBinding(e, binding))
          continue;
        if (binding.altGr)
          return action;
        if (fallback === null)
          fallback = action;
      }
      return fallback;
    },
    format(action) {
      const b = map[action];
      if (!b)
        return "";
      const parts = [];
      if (b.ctrl)
        parts.push("ctrl");
      if (b.alt)
        parts.push(b.ctrl ? "alt" : "alt/altgr");
      if (b.altGr)
        parts.push("altgr");
      if (b.shift)
        parts.push("shift");
      parts.push(b.key === "Enter" ? "↵" : b.key);
      return parts.join("+");
    }
  };
}
if (false) {}

// src/consoleText.js
var KEYWORDS = {
  python: new Set(["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "try", "except", "with", "as", "lambda", "async", "await", "True", "False", "None"]),
  deno: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "try", "catch", "class", "import", "from", "export", "new", "await", "async", "true", "false", "null", "undefined"]),
  c: new Set(["int", "char", "long", "short", "float", "double", "void", "unsigned", "signed", "struct", "union", "enum", "typedef", "const", "static", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "sizeof", "include", "define"])
};
KEYWORDS.ipython = KEYWORDS.python3 = KEYWORDS.python;
var TOKEN_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
function tokenizeLine(line, lang) {
  const marker = lang === "deno" || lang === "c" ? "//" : "#";
  const at = line.indexOf(marker);
  const body = at >= 0 ? line.slice(0, at) : line;
  const comment = at >= 0 ? line.slice(at) : "";
  const keywords = KEYWORDS[lang] || KEYWORDS.python;
  const parts = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last)
      parts.push({ text: body.slice(last, m.index), kind: "plain" });
    const t = m[0];
    const kind = /^["'`]/.test(t) ? "string" : /^\d/.test(t) ? "number" : keywords.has(t) ? "keyword" : "plain";
    parts.push({ text: t, kind });
    last = m.index + t.length;
  }
  if (last < body.length)
    parts.push({ text: body.slice(last), kind: "plain" });
  if (comment)
    parts.push({ text: comment, kind: "comment" });
  return parts.length ? parts : [{ text: line, kind: "plain" }];
}
function highlight(text, lang) {
  const frag = document.createDocumentFragment();
  const lines = String(text == null ? "" : text).split(`
`);
  for (let i = 0;i < lines.length; i++) {
    if (i)
      frag.appendChild(document.createTextNode(`
`));
    for (const { text: t, kind } of tokenizeLine(lines[i], lang)) {
      if (kind === "plain") {
        frag.appendChild(document.createTextNode(t));
        continue;
      }
      const span = document.createElement("span");
      span.className = "t-" + kind;
      span.textContent = t;
      frag.appendChild(span);
    }
  }
  return frag;
}
if (false) {}

// src/consolePanel.js
function initConsole(electrobun, familiar) {
  const req = electrobun.rpc.request;
  const $ = (id) => document.getElementById(id);
  const output = $("output"), input = $("input"), overlay = $("overlay");
  const inputRow = $("inputRow"), ps1 = $("ps1");
  const keys = createKeybindings();
  const consoleHint = keys.format("sendToConsole");
  const chatHint = keys.format("sendToChat");
  let lang = "python";
  let executing = false;
  let kernelUp = true;
  const history = [];
  let historyIndex = -1;
  const trimEnd = (s) => String(s || "").replace(/\n+$/, "");
  const stick = () => {
    output.scrollTop = output.scrollHeight;
  };
  const place = (el) => {
    output.insertBefore(el, inputRow);
    stick();
  };
  let cellNo = 0;
  const promptLabel = (n) => `In [${n}]:`;
  const STORE = "ophi.transcript.v1";
  const log = [];
  let saveT = 0;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try {
        let slice = log.slice(-150);
        let json = JSON.stringify({ cellNo, entries: slice });
        while (json.length > 3500000 && slice.length > 1) {
          slice = slice.slice(Math.ceil(slice.length / 4));
          json = JSON.stringify({ cellNo, entries: slice });
        }
        localStorage.setItem(STORE, json);
      } catch {}
    }, 400);
  }
  function restoreSession() {
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(STORE) || "");
    } catch {}
    if (!s || !s.entries || !s.entries.length)
      return;
    for (const rec of s.entries) {
      cellNo = (rec.n || cellNo + 1) - 1;
      const entry = addEntry(rec.code, rec.who);
      for (const o of rec.outs || []) {
        if (o.d)
          addDisplay(entry, o.d);
        else
          addOutput(entry, o.t, o.k);
      }
    }
    cellNo = Math.max(cellNo, s.cellNo || 0);
    updatePrompt();
    addNote("— session restored · kernel state does not persist, re-run what you need —");
  }
  function addEntry(code, who) {
    cellNo += 1;
    const entry = document.createElement("div");
    entry.className = "entry " + (who || "human");
    entry._n = cellNo;
    entry._rec = { n: cellNo, who: who || "human", code, outs: [] };
    log.push(entry._rec);
    saveSoon();
    const line = document.createElement("div");
    line.className = "input-line";
    const ps = document.createElement("span");
    ps.className = "ps";
    ps.textContent = promptLabel(cellNo);
    const pre = document.createElement("pre");
    pre.appendChild(highlight(code, lang));
    line.append(ps, pre);
    entry.appendChild(line);
    if (who === "familiar") {
      const tag = document.createElement("span");
      tag.className = "by";
      tag.textContent = "familiar";
      line.appendChild(tag);
    }
    place(entry);
    updatePrompt();
    return entry;
  }
  function addOutput(entry, text, type) {
    if (!text)
      return null;
    if (entry._rec) {
      entry._rec.outs.push({ k: type || "", t: text });
      saveSoon();
    }
    const pre = document.createElement("pre");
    pre.className = "out-line" + (type ? " " + type : "");
    if (type === "stderr" || type === "error")
      pre.textContent = trimEnd(text);
    else
      pre.appendChild(highlight(trimEnd(text), lang));
    entry.appendChild(pre);
    stick();
    return pre;
  }
  function addDisplay(entry, bundle) {
    if (entry._rec) {
      entry._rec.outs.push({ d: bundle });
      saveSoon();
    }
    const data = bundle && bundle.data || {};
    if (data["image/png"]) {
      const img = document.createElement("img");
      img.src = "data:image/png;base64," + data["image/png"];
      entry.appendChild(img);
      stick();
      return;
    }
    if (data["text/plain"]) {
      const isResult = bundle && bundle.kind === "result";
      const pre = document.createElement("pre");
      pre.className = "out-line" + (isResult ? " result" : "");
      if (isResult) {
        const lbl = document.createElement("span");
        lbl.className = "outlabel";
        lbl.textContent = `Out[${entry._n}]: `;
        pre.appendChild(lbl);
      }
      pre.appendChild(highlight(trimEnd(data["text/plain"]), lang));
      entry.appendChild(pre);
      stick();
    }
  }
  function attachResult(entry, r) {
    addOutput(entry, r.stdout, "");
    for (const d of r.displays || [])
      addDisplay(entry, d);
    addOutput(entry, r.stderr, "stderr");
    addOutput(entry, r.error, "error");
  }
  function addNote(text) {
    const el = document.createElement("pre");
    el.className = "out-line info";
    el.textContent = text;
    place(el);
  }
  function setKernelState(state) {
    kernelUp = state !== "dead";
    inputRow.classList.toggle("busy", state === "busy" || state === "dead");
    paintOverlay();
  }
  function placeholder() {
    return kernelUp ? "" : `${lang} not running`;
  }
  function updatePrompt() {
    ps1.textContent = promptLabel(cellNo + 1);
  }
  const SETTLE_MS = 1000;
  let borns = [];
  let prevVal = "";
  let settleTimer = 0;
  function trackBirths() {
    const v = input.value, now = performance.now();
    let p = 0;
    while (p < v.length && p < prevVal.length && v[p] === prevVal[p])
      p++;
    borns.length = p;
    while (borns.length < v.length)
      borns.push(now);
    prevVal = v;
  }
  function paintOverlay() {
    trackBirths();
    clearTimeout(settleTimer);
    settleTimer = 0;
    overlay.replaceChildren();
    const v = input.value;
    if (!v) {
      const t = placeholder();
      if (t) {
        const ph = document.createElement("span");
        ph.className = "placeholder";
        ph.textContent = t;
        overlay.appendChild(ph);
      }
      overlay.scrollTop = input.scrollTop;
      return;
    }
    const now = performance.now();
    let split = v.length;
    for (let i = 0;i < v.length; i++)
      if (now - borns[i] < SETTLE_MS) {
        split = i;
        break;
      }
    if (split > 0)
      overlay.appendChild(highlight(v.slice(0, split), lang));
    for (let i = split;i < v.length; i++) {
      if (v[i] === `
`) {
        overlay.appendChild(document.createTextNode(`
`));
        continue;
      }
      const s = document.createElement("span");
      s.className = "ch";
      s.style.animationDelay = -(now - borns[i]) + "ms";
      s.textContent = v[i];
      overlay.appendChild(s);
    }
    if (v.endsWith(`
`))
      overlay.appendChild(document.createTextNode("​"));
    if (split < v.length)
      settleTimer = setTimeout(paintOverlay, SETTLE_MS - (now - borns[split]) + 30);
    overlay.scrollTop = input.scrollTop;
  }
  async function inspectName(name) {
    const entry = addEntry("?" + name, "human");
    try {
      const r = await req.inspect({ name, lang });
      if (!r || !r.found) {
        addOutput(entry, "no object named " + name + " in this session", "stderr");
        return;
      }
      const head = [r.type && "type: " + r.type, r.signature].filter(Boolean).join(`
`);
      if (head)
        addOutput(entry, head, "");
      addOutput(entry, r.doc || "(no docstring)", r.doc ? "info" : "");
    } catch (e) {
      addOutput(entry, "inspect failed: " + (e && e.message || e), "error");
    }
  }
  let liveEntry = null;
  function liveOutput(o) {
    if (!liveEntry || !o)
      return;
    if (o.kind === "display")
      return addDisplay(liveEntry, o.bundle);
    if (o.kind === "error")
      liveEntry._streamedError = true;
    const cls = o.kind === "stdout" ? "" : o.kind;
    if (liveEntry._crEl && liveEntry._crCls === cls) {
      liveEntry._crEl.textContent = o.text;
      const outs = liveEntry._rec && liveEntry._rec.outs;
      if (outs && outs.length)
        outs[outs.length - 1] = { k: cls, t: o.text };
      if (!o.cr)
        liveEntry._crEl = null;
      stick();
      return;
    }
    const el = addOutput(liveEntry, o.text === "" ? " " : o.text, cls);
    if (o.cr && el) {
      liveEntry._crEl = el;
      liveEntry._crCls = cls;
    }
  }
  async function runCode(code) {
    if (executing)
      return;
    const t = code.trim();
    if (t.startsWith("§"))
      return meta(t);
    if (t === "%")
      return runCode("%lsmagic");
    const q = !t.includes(`
`) && (/^\?\s*(\S.*)$/.exec(t) || /^(\S.*?)\s*\?$/.exec(t));
    if (q)
      return inspectName(q[1].trim());
    const entry = addEntry(code, "human");
    executing = true;
    liveEntry = entry;
    setKernelState("busy");
    paintOverlay();
    const cursor = document.createElement("div");
    cursor.className = "executing";
    cursor.textContent = "|";
    place(cursor);
    try {
      const r = await req.runCell({ code, lang });
      if (r && r.error && !entry._streamedError)
        addOutput(entry, r.error, "error");
    } catch (e) {
      addOutput(entry, "kernel error: " + (e && e.message || e), "error");
    } finally {
      cursor.remove();
      liveEntry = null;
      executing = false;
      setKernelState("ready");
      input.focus();
    }
  }
  function submitConsole() {
    const code = input.value.trimEnd();
    if (!code.trim() || executing)
      return;
    history.push(code);
    historyIndex = -1;
    input.value = "";
    autogrow();
    paintOverlay();
    runCode(code);
  }
  function submitChat() {
    const text = input.value.trim();
    if (!text)
      return;
    history.push(text);
    historyIndex = -1;
    input.value = "";
    autogrow();
    paintOverlay();
    if (familiar)
      familiar.sendFromConsole(text, lang);
    else
      addNote("(familiar not mounted)");
  }
  async function meta(cmd) {
    const [name, ...rest] = cmd.slice(1).trim().split(/\s+/).filter(Boolean);
    try {
      if (!name) {
        addNote([
          "§lang [name] — list kernels | switch",
          "§provider [id] — list providers | set the active familiar's",
          "§model [name] — list/show models | set the active familiar's",
          "§set [key value] — list settings | change one",
          "§familiar [name | new <name> | <name> <key> <value> | clear]",
          "§clear [chat|all] — console | chat | both + kernel restart",
          "§save / §load [name] — snapshot / restore kernel + conversation (python, needs dill)",
          "§setup — provider/model setup guide",
          "§restart · §interrupt",
          `?name inspects · ${consoleHint} run · ${chatHint} chat`
        ].join(`
`));
      } else if (name === "clear") {
        const scope = rest[0] || "console";
        if (!["console", "chat", "all"].includes(scope)) {
          addNote("§clear [chat|all] — console (default) | chat | both + kernel restart");
        } else {
          if (scope !== "chat") {
            output.replaceChildren(inputRow);
            cellNo = 0;
            log.length = 0;
            saveSoon();
            updatePrompt();
          }
          if (scope !== "console") {
            familiar && familiar.clearTranscript();
            addNote("— familiar transcript cleared —");
          }
          if (scope === "all") {
            req.restartKernel({ lang });
            addNote("— " + lang + " kernel restarted —");
          }
        }
      } else if (name === "setup") {
        await setupGuide();
      } else if (name === "save" || name === "load") {
        const snap = rest[0];
        if (!snap) {
          const s = await req.snapshots({});
          addNote(s.names.length ? "snapshots: " + s.names.join("  ") + `
§save <name> stores · §load <name> restores` : "no snapshots yet — §save <name> stores kernel state + familiar conversation");
        } else if (lang !== "python") {
          addNote("§save/§load need the python kernel — §lang python first");
        } else if (name === "save") {
          const r = await req.snapshotSave({ name: snap });
          if (r.error)
            addNote(r.error);
          else {
            await runCode("import dill; dill.dump_session(r'" + r.dillPath + "')");
            addNote("— snapshot " + snap + ": kernel + conversation (dill missing? !pip install dill) —");
          }
        } else {
          const r = await req.snapshotLoad({ name: snap });
          if (r.error)
            addNote(r.error);
          else {
            familiar && familiar.endReply();
            const t = await req.transcript({});
            familiar && familiar.renderTranscript(t.items || []);
            await runCode("import dill; dill.load_session(r'" + r.dillPath + "')");
            addNote("— snapshot " + snap + " restored —");
          }
        }
      } else if (name === "restart") {
        req.restartKernel({ lang });
        addNote("— " + lang + " kernel restarted —");
        if (lang === "python" && await checkKernelDeps(false))
          setKernelState("ready");
      } else if (name === "interrupt") {
        req.interruptKernel({ lang });
        addNote("— interrupt sent —");
      } else if (name === "lang") {
        if (!rest.length)
          addNote("languages: " + languages.map((l) => l === lang ? "▸" + l : l).join("  "));
        else
          switchLang(rest[0]);
      } else if (name === "provider") {
        const p = await req.providers({});
        if (!rest.length) {
          addNote("providers: " + p.ids.map((id) => id === p.active.provider ? "▸" + id : id).join("  ") + `
active familiar (${p.active.name}): ${p.active.provider}${p.active.model ? " · " + p.active.model : ""}`);
        } else {
          const r = await req.familiarEdit({ name: p.active.name, key: "provider", value: rest[0] });
          addNote(r.error ? r.error : "— " + p.active.name + " → " + rest[0] + " —");
        }
      } else if (name === "model") {
        const p = await req.providers({});
        if (!rest.length) {
          const m = await req.models({});
          if (m.listable)
            addNote("models (" + p.active.provider + "): " + m.models.map((x) => x === m.current ? "▸" + x : x).join("  "));
          else
            addNote("model: " + (m.current || "(provider default)") + (m.error ? `
` + m.error : `
(§model <id> sets it — ` + p.active.provider + " takes any model id)"));
        } else {
          const r = await req.familiarEdit({ name: p.active.name, key: "model", value: rest[0] });
          addNote(r.error ? r.error : "— " + p.active.name + " model → " + rest[0] + " —");
        }
      } else if (name === "set") {
        if (!rest.length) {
          const c = await req.config({});
          const pad = (window.__pad && window.__pad.get()) ?? 0.6;
          addNote(`settings:
  user ${c.user}
  pad ${pad.toFixed(2)}  (vmin — also alt+wheel)`);
        } else if (rest[0] === "user" && rest[1]) {
          const r = await req.setUser({ name: rest[1] });
          familiar && familiar.setNames && familiar.setNames({ user: r.user });
          addNote("— user → " + r.user + " —");
        } else if (rest[0] === "pad" && rest[1] !== undefined) {
          const v = parseFloat(rest[1]);
          if (isNaN(v) || !window.__pad)
            addNote("pad is a number of vmin, e.g. §set pad 1.2");
          else {
            window.__pad.set(v);
            addNote("— pad → " + window.__pad.get().toFixed(2) + " —");
          }
        } else
          addNote("no such setting: " + rest[0] + " (bare §set lists them)");
      } else if (name === "familiar") {
        if (!rest.length) {
          const c = await req.config({});
          addNote(`familiars:
` + c.familiars.map((f) => `  ${f.active ? "▸" : " "} ${f.name} — ${f.provider}${f.model ? " · " + f.model : ""}`).join(`
`));
        } else if (rest[0] === "clear") {
          familiar && familiar.clearTranscript();
          addNote("— familiar transcript cleared —");
        } else if (rest[0] === "new" && rest[1]) {
          const r = await req.familiarNew({ name: rest[1] });
          if (r.error)
            addNote(r.error);
          else {
            familiar && familiar.setNames({ familiar: rest[1] });
            familiar && familiar.renderTranscript([]);
            addNote("— familiar → " + rest[1] + " (new, config cloned; edit with §familiar " + rest[1] + " <key> <value>) —");
          }
        } else if (rest.length === 3) {
          const r = await req.familiarEdit({ name: rest[0], key: rest[1], value: rest[2] });
          addNote(r.error ? r.error : "— " + rest[0] + "." + rest[1] + " → " + rest[2] + " —");
        } else if (rest.length === 1) {
          const r = await req.familiarUse({ name: rest[0] });
          if (r.error)
            addNote(r.error + " (§familiar new " + rest[0] + " creates it)");
          else {
            familiar && familiar.setNames({ familiar: rest[0] });
            const t = await req.transcript({});
            familiar && familiar.renderTranscript(t.items || []);
            addNote("— familiar → " + rest[0] + " —");
          }
        } else
          addNote("§familiar [name | new <name> | <name> <key> <value> | clear]");
      } else
        addOutput(addEntry(cmd), "unknown § command: §" + name + " (bare § lists them)", "error");
    } catch (e) {
      addNote("§ failed: " + (e && e.message || e));
    }
    input.focus();
  }
  async function setupGuide() {
    try {
      const p = await req.providers({});
      const f = p.active;
      addNote([
        "— setup —",
        `familiar "${f.name}"`,
        `  provider ${f.provider || "(not set)"} · model ${f.model || "(provider default)"}`,
        `  endpoint ${f.baseUrl || "(provider default)"} · apiKey ${f.apiKey ? "set" : "not set"}`,
        "",
        "providers:",
        ...(p.list || p.ids.map((id) => ({ id, desc: "" }))).map((x) => `  ${x.id === f.provider ? "▸" : " "} ${x.id}${x.desc ? " — " + x.desc : ""}`),
        "",
        `(type a command at the prompt below, run it with ${consoleHint})`,
        "",
        "1. §provider <id> — pick one",
        "2. §model <name> — set the model (bare §model shows what's available)",
        `3. §familiar ${f.name} apiKey <key> — if the provider needs one`,
        `4. §familiar ${f.name} baseUrl <url> — optional custom endpoint (any /v1-compatible server, ollama daemon, …)`,
        `5. ${chatHint} sends what you typed to the familiar — try: hi`,
        "",
        "§setup shows this again · bare § lists every command"
      ].join(`
`));
      await checkKernelDeps(true);
    } catch (e) {
      addNote("setup guide unavailable: " + (e && e.message || e));
    }
  }
  const OPTIONAL = [
    ["dill", "dill", "§save/§load snapshots"],
    ["winpty", "pywinpty", "live ! command output"],
    ["jupyter_client", "jupyter_client ipykernel", "more languages via §lang"],
    ["matplotlib_inline", "matplotlib-inline", "inline plots"]
  ];
  async function checkKernelDeps(verbose) {
    try {
      const h = await req.kernelHealth({});
      if (!h.ok) {
        setKernelState("dead");
        addNote([
          "python was not found — the console needs it.",
          "  1. install python: https://python.org  (or: winget install Python.Python.3.12)",
          "  2. pip install ipython jedi",
          "  3. §restart"
        ].join(`
`));
        return false;
      }
      const core = ["IPython", "jedi"].filter((m) => !h.mods[m]);
      if (core.length) {
        setKernelState("dead");
        addNote(`python ${h.python} found, but the console needs ${core.join(" + ")}:
  pip install ipython jedi   then §restart`);
        return false;
      }
      const opt = OPTIONAL.filter(([mod]) => !h.mods[mod]);
      if (verbose) {
        addNote(`console: python ${h.python} · ${h.exe}` + (opt.length ? `
optional, not installed:` + opt.map(([, pkg, why]) => `
  pip install ${pkg} — ${why}`).join("") : " · all optional packages present"));
      }
      return true;
    } catch {
      return true;
    }
  }
  let languages = ["python"];
  function switchLang(name) {
    if (!name || !languages.includes(name)) {
      addNote("no such language: " + name);
      return;
    }
    lang = name;
    updatePrompt();
    if (familiar && familiar.setLang)
      familiar.setLang(lang);
    setKernelState("ready");
    addNote("— language → " + lang + " —");
  }
  async function complete() {
    const { value: code, selectionStart: cursor } = input;
    try {
      const r = await req.complete({ code, cursor, lang });
      const matches = (r.matches || []).map((m) => m.text).filter(Boolean);
      if (!matches.length)
        return;
      let prefix = matches[0];
      for (const m of matches)
        while (!m.startsWith(prefix))
          prefix = prefix.slice(0, -1);
      if (prefix && r.start != null && r.end != null) {
        input.value = code.slice(0, r.start) + prefix + code.slice(r.end);
        const pos = r.start + prefix.length;
        input.setSelectionRange(pos, pos);
        paintOverlay();
      }
      if (matches.length > 1)
        addNote(matches.slice(0, 40).join("   "));
    } catch {}
  }
  function autogrow() {
    stick();
  }
  input.addEventListener("input", () => {
    historyIndex = -1;
    paintOverlay();
    stick();
  });
  async function cancelInFlight() {
    const busy = executing || familiar && familiar.isStreaming && familiar.isStreaming();
    if (!busy)
      return false;
    try {
      await req.interruptKernel({ lang });
    } catch {}
    try {
      await req.cancelFamiliar({});
    } catch {}
    if (familiar && familiar.endReply)
      familiar.endReply();
    addNote("^C");
    executing = false;
    setKernelState("ready");
    return true;
  }
  input.addEventListener("keydown", (e) => {
    if (e.ctrlKey && !e.altKey && (e.key === "c" || e.key === "C")) {
      if (String(window.getSelection()))
        return;
      e.preventDefault();
      cancelInFlight();
      return;
    }
    const action = keys.matchAction(e);
    if (action === "sendToConsole") {
      e.preventDefault();
      submitConsole();
      return;
    }
    if (action === "sendToChat") {
      e.preventDefault();
      submitChat();
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const { selectionStart: start, selectionEnd: end } = input;
      const before = input.value.slice(0, start);
      const line = before.slice(before.lastIndexOf(`
`) + 1);
      let indent = /^[ \t]*/.exec(line)[0];
      if (/[:{]\s*$/.test(line))
        indent += "  ";
      input.value = before + `
` + indent + input.value.slice(end);
      const pos = start + 1 + indent.length;
      input.setSelectionRange(pos, pos);
      historyIndex = -1;
      paintOverlay();
      stick();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: start, selectionEnd: end } = input;
      if (start === end && /[\w.)\]'"]$/.test(input.value.slice(0, start))) {
        complete();
        return;
      }
      input.value = input.value.slice(0, start) + "  " + input.value.slice(end);
      input.setSelectionRange(start + 2, start + 2);
      paintOverlay();
      return;
    }
    if (e.key === "ArrowUp" && !e.shiftKey && input.selectionStart === 0 && input.selectionEnd === 0) {
      if (!history.length)
        return;
      e.preventDefault();
      historyIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      input.value = history[historyIndex];
      paintOverlay();
      return;
    }
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (e.key === "ArrowDown" && !e.shiftKey && atEnd && historyIndex >= 0) {
      e.preventDefault();
      historyIndex += 1;
      if (historyIndex >= history.length) {
        historyIndex = -1;
        input.value = "";
      } else
        input.value = history[historyIndex];
      paintOverlay();
    }
  });
  function famResult(code, result) {
    if (!code)
      return;
    const entry = addEntry(code, "familiar");
    attachResult(entry, result);
  }
  const focusInput = () => {
    if (!String(window.getSelection()))
      input.focus();
  };
  window.addEventListener("load", () => input.focus());
  $("console").addEventListener("click", focusInput);
  restoreSession();
  (async () => {
    try {
      languages = await req.languages() || ["python"];
    } catch {}
    setKernelState("ready");
    updatePrompt();
    paintOverlay();
    input.focus();
    try {
      const c = await req.config({});
      const active = c.familiars.find((f) => f.active);
      if (c.firstRun || !(active && active.provider))
        await setupGuide();
      else
        checkKernelDeps(false);
    } catch {}
  })();
  return {
    refreshPlaceholder: paintOverlay,
    note: addNote,
    liveOutput,
    famResult
  };
}

// src/familiarType.js
var SETTLE_MS = 1000;
var BASE_CPS = 120;
var CATCHUP_AT = 80;
var MAX_CPS = 2400;
function createTypewriter(host, { charsPerSecond = BASE_CPS } = {}) {
  const settled = document.createTextNode("");
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.textContent = "█";
  host.append(settled, cursor);
  let queue = "";
  let live = [];
  let raf = 0;
  let carry = 0;
  let last = 0;
  let done = false;
  let onIdle = null;
  function rate() {
    if (queue.length <= CATCHUP_AT)
      return charsPerSecond;
    return Math.min(MAX_CPS, charsPerSecond * (queue.length / CATCHUP_AT));
  }
  function emit2(ch) {
    if (ch === `
`) {
      settled.appendData(flushLive() + `
`);
      return;
    }
    const span = document.createElement("span");
    span.className = "ch";
    span.textContent = ch;
    span.dataset.born = String(performance.now());
    host.insertBefore(span, cursor);
    live.push(span);
  }
  function flushLive() {
    let text = "";
    for (const span of live) {
      text += span.textContent;
      span.remove();
    }
    live = [];
    return text;
  }
  function reap(now) {
    let n = 0;
    while (n < live.length && now - Number(live[n].dataset.born) >= SETTLE_MS)
      n += 1;
    if (!n)
      return;
    let text = "";
    for (let i = 0;i < n; i++) {
      text += live[i].textContent;
      live[i].remove();
    }
    settled.appendData(text);
    live = live.slice(n);
  }
  function frame(now) {
    raf = 0;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (queue.length) {
      carry += rate() * dt;
      let n = Math.floor(carry);
      if (n > 0) {
        carry -= n;
        n = Math.min(n, queue.length);
        let k = 0;
        while (k < n) {
          const u = queue.charCodeAt(k);
          if (u >= 55296 && u <= 56319 && k + 1 === queue.length)
            break;
          const ch = String.fromCodePoint(queue.codePointAt(k));
          emit2(ch);
          k += ch.length;
        }
        queue = queue.slice(k);
        host.dispatchEvent(new CustomEvent("typed", { bubbles: true }));
      }
    }
    reap(now);
    if (queue.length || live.length) {
      schedule();
      return;
    }
    if (done) {
      cursor.remove();
      if (onIdle)
        onIdle();
    }
  }
  function schedule() {
    if (!raf)
      raf = requestAnimationFrame(frame);
  }
  return {
    push(text) {
      if (!text)
        return;
      queue += text;
      done = false;
      if (!raf) {
        last = 0;
      }
      schedule();
    },
    finish(cb) {
      done = true;
      onIdle = cb || null;
      if (!queue.length && !live.length) {
        cursor.remove();
        if (onIdle)
          onIdle();
        return;
      }
      schedule();
    },
    flush() {
      settled.appendData(flushLive() + queue);
      queue = "";
      done = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      cursor.remove();
    },
    get pending() {
      return queue.length;
    }
  };
}
if (false) {}

// src/familiarPanel.js
var STICK = 48;
var MD_INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
function mdRender(text) {
  const frag = document.createDocumentFragment();
  for (const rawLine of String(text).split(`
`)) {
    if (frag.childNodes.length)
      frag.appendChild(document.createTextNode(`
`));
    const h = /^#{1,4}\s+(.*)$/.exec(rawLine);
    const line = h ? h[1] : rawLine;
    const target = h ? document.createElement("strong") : frag;
    let last = 0;
    for (const m of line.matchAll(MD_INLINE)) {
      if (m.index > last)
        target.appendChild(document.createTextNode(line.slice(last, m.index)));
      const t = m[0];
      const el = document.createElement(t[0] === "`" ? "code" : t.startsWith("**") ? "strong" : "em");
      el.textContent = t.replace(/^\*\*|\*\*$|^\*|\*$|^`|`$/g, "");
      target.appendChild(el);
      last = m.index + t.length;
    }
    if (last < line.length)
      target.appendChild(document.createTextNode(line.slice(last)));
    if (h)
      frag.appendChild(target);
  }
  return frag;
}
function initFamiliar(electrobun) {
  const req = electrobun.rpc.request;
  const chat = document.getElementById("fchat");
  let streaming = false;
  let current = null;
  let typer = null;
  let onStateChange = null;
  let names = { user: "user", familiar: "familiar" };
  const stick = () => {
    chat.scrollTop = chat.scrollHeight;
  };
  let pinned = true;
  chat.addEventListener("scroll", () => {
    pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight <= STICK;
  });
  function setStreaming(on) {
    if (streaming === on)
      return;
    streaming = on;
    if (onStateChange)
      onStateChange();
  }
  function bubble(role, text) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    const prompt = document.createElement("span");
    prompt.className = "prompt";
    prompt.textContent = "$" + (role === "you" ? names.user : names.familiar) + ">";
    const body = document.createElement("span");
    body.className = "body";
    body.textContent = text || "";
    el.append(prompt, document.createTextNode(" "), body);
    el._body = body;
    return el;
  }
  function addUserMsg(text) {
    current = null;
    const turn = document.createElement("div");
    turn.className = "turn";
    turn.appendChild(bubble("you", text));
    chat.appendChild(turn);
    chat._turn = turn;
    pinned = true;
    stick();
  }
  let working = null;
  function showWorking() {
    if (working || current)
      return;
    working = bubble("familiar", "");
    working._body.className = "body thinking";
    working._body.textContent = "…";
    (chat._turn || chat).appendChild(working);
    if (pinned)
      stick();
  }
  function hideWorking() {
    if (working) {
      working.remove();
      working = null;
    }
  }
  function addChatDelta(text) {
    if (!current) {
      if (working) {
        current = working;
        working = null;
        current._body.className = "body";
        current._body.textContent = "";
      } else {
        current = bubble("familiar", "");
        (chat._turn || chat).appendChild(current);
      }
      typer = createTypewriter(current._body);
      current._body.addEventListener("typed", () => {
        if (pinned)
          stick();
      });
      setStreaming(true);
    }
    typer.push(text);
  }
  function endReply() {
    hideWorking();
    const t = typer, body = current && current._body;
    current = null;
    typer = null;
    const done = () => {
      if (body)
        body.replaceChildren(mdRender(body.textContent));
      setStreaming(false);
    };
    if (t)
      t.finish(done);
    else
      done();
  }
  function addError(text) {
    const el = document.createElement("div");
    el.className = "ferror";
    el.textContent = text;
    chat.appendChild(el);
    stick();
  }
  function renderTranscript(items) {
    if (typer)
      typer.flush();
    chat.replaceChildren();
    current = null;
    typer = null;
    working = null;
    let turn = null;
    for (const it of items || []) {
      if (it.who === "you") {
        turn = document.createElement("div");
        turn.className = "turn";
        turn.appendChild(bubble("you", it.text));
        chat.appendChild(turn);
      } else {
        const b = bubble("familiar", "");
        b._body.appendChild(mdRender(it.text));
        (turn || chat).appendChild(b);
      }
    }
    chat._turn = turn;
    stick();
  }
  function clearTranscript() {
    if (typer)
      typer.flush();
    chat.replaceChildren();
    current = null;
    typer = null;
    working = null;
    setStreaming(false);
    try {
      req.clearFamiliar && req.clearFamiliar({});
    } catch {}
  }
  async function send(text, lang) {
    const t = (text || "").trim();
    if (!t)
      return;
    addUserMsg(t);
    setStreaming(true);
    showWorking();
    try {
      await req.sendToFamiliar({ text: t, lang });
    } catch (e) {
      addError("familiar error — " + (e && e.message || e));
      endReply();
    }
  }
  return {
    addChatDelta,
    endReply,
    clearTranscript,
    renderTranscript,
    sendFromConsole: send,
    setNames: (n) => {
      names = { ...names, ...n };
    },
    isStreaming: () => streaming,
    onStateChange: (fn) => {
      onStateChange = fn;
    }
  };
}

// src/workspaceBoxes.js
var MIN_W = 160;
var MIN_H = 110;
var DEFAULT_PX = 340;
var GAP = 0;
var HIT = 8;
var EDGE = 0.28;
var isSplit = (n) => n && n.type === "split";
var num = (v, d) => typeof v === "number" && isFinite(v) && v > 0 ? v : d;
function minSize(node, dir) {
  if (!isSplit(node))
    return dir === "horizontal" ? MIN_W : MIN_H;
  if (node.direction === dir)
    return node.children.reduce((s, c) => s + minSize(c, dir), 0);
  return node.children.reduce((m, c) => Math.max(m, minSize(c, dir)), 0);
}
function childSizes(node, total) {
  const n = node.children.length;
  const mins = node.children.map((c) => minSize(c, node.direction));
  const sizes = node.children.map((c, i) => Math.max(mins[i], num(node.sizes && node.sizes[i], DEFAULT_PX)));
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum <= total) {
    sizes[n - 1] += total - sum;
    return sizes;
  }
  const extra = sum - mins.reduce((a, b) => a + b, 0);
  if (extra <= 0)
    return sizes;
  const shrink = Math.min(1, (sum - total) / extra);
  return sizes.map((s, i) => Math.max(mins[i], Math.round(s - (s - mins[i]) * shrink)));
}
function layout(node, rect, path, boxes, seams) {
  if (!isSplit(node)) {
    boxes.push({ boxId: node.boxId, rect });
    return;
  }
  const horiz = node.direction === "horizontal";
  const total = horiz ? rect.width : rect.height;
  const sizes = childSizes(node, total);
  let cursor = 0, prev = null;
  for (let i = 0;i < node.children.length; i++) {
    const main = sizes[i];
    const cr = horiz ? { left: rect.left + cursor, top: rect.top, width: main, height: rect.height } : { left: rect.left, top: rect.top + cursor, width: rect.width, height: main };
    if (prev)
      seams.push({
        direction: node.direction,
        splitPath: path.slice(),
        first: i - 1,
        second: i,
        firstSize: horiz ? prev.width : prev.height,
        secondSize: horiz ? cr.width : cr.height,
        firstMin: minSize(node.children[i - 1], node.direction),
        secondMin: minSize(node.children[i], node.direction),
        x: horiz ? cr.left - HIT / 2 : rect.left,
        y: horiz ? rect.top : cr.top - HIT / 2,
        w: horiz ? HIT : rect.width,
        h: horiz ? rect.height : HIT
      });
    cursor += main;
    layout(node.children[i], cr, path.concat(i), boxes, seams);
    prev = cr;
  }
}
function normalize(node) {
  if (!node)
    return null;
  if (!isSplit(node))
    return node;
  const children = [], sizes = [];
  node.children.forEach((c, i) => {
    const nc = normalize(c);
    if (!nc)
      return;
    const sz = num(node.sizes && node.sizes[i], DEFAULT_PX);
    if (isSplit(nc) && nc.direction === node.direction) {
      nc.children.forEach((gc, j) => {
        children.push(gc);
        sizes.push(num(nc.sizes && nc.sizes[j], DEFAULT_PX));
      });
    } else {
      children.push(nc);
      sizes.push(sz);
    }
  });
  if (!children.length)
    return null;
  if (children.length === 1)
    return children[0];
  return { type: "split", direction: node.direction, children, sizes };
}
function removeBox(node, boxId) {
  if (!isSplit(node))
    return node.boxId === boxId ? null : node;
  const children = [], sizes = [];
  node.children.forEach((c, i) => {
    const nc = removeBox(c, boxId);
    if (nc) {
      children.push(nc);
      sizes.push(num(node.sizes && node.sizes[i], DEFAULT_PX));
    }
  });
  if (!children.length)
    return null;
  if (children.length === 1)
    return children[0];
  return { type: "split", direction: node.direction, children, sizes };
}
var dirFor = (pos, fallback) => pos === "left" || pos === "right" ? "horizontal" : pos === "top" || pos === "bottom" ? "vertical" : fallback;
function insertRel(node, targetId, pos, boxId) {
  const dir = dirFor(pos, isSplit(node) ? node.direction : "horizontal");
  const after = pos === "right" || pos === "bottom" || pos === "center";
  if (!isSplit(node)) {
    if (node.boxId !== targetId)
      return { node, ok: false };
    const leaf = { type: "leaf", boxId }, self = { type: "leaf", boxId: node.boxId };
    return { ok: true, node: { type: "split", direction: dir, children: after ? [self, leaf] : [leaf, self], sizes: [DEFAULT_PX, DEFAULT_PX] } };
  }
  const di = node.children.findIndex((c) => !isSplit(c) && c.boxId === targetId);
  if (di >= 0 && node.direction === dir) {
    const at = after ? di + 1 : di;
    const children = node.children.slice();
    children.splice(at, 0, { type: "leaf", boxId });
    const sizes = (node.sizes || node.children.map(() => DEFAULT_PX)).slice();
    sizes.splice(at, 0, DEFAULT_PX);
    return { ok: true, node: { ...node, children, sizes } };
  }
  for (let i = 0;i < node.children.length; i++) {
    const r = insertRel(node.children[i], targetId, pos, boxId);
    if (!r.ok)
      continue;
    const children = node.children.slice();
    children[i] = r.node;
    return { ok: true, node: { ...node, children } };
  }
  return { node, ok: false };
}
function moveBox(root, boxId, targetId, pos) {
  if (boxId === targetId)
    return root;
  const without = removeBox(root, boxId);
  if (!without)
    return root;
  const r = insertRel(without, targetId, pos, boxId);
  return normalize(r.ok ? r.node : root);
}
function updateAtPath(node, path, depth, fn) {
  if (!isSplit(node))
    return node;
  if (depth >= path.length)
    return fn(node);
  const head = path[depth];
  const child = updateAtPath(node.children[head], path, depth + 1, fn);
  if (child === node.children[head])
    return node;
  const children = node.children.slice();
  children[head] = child;
  return { ...node, children };
}
function applyResize(root, seam, first, second) {
  return normalize(updateAtPath(root, seam.splitPath, 0, (split) => {
    const sizes = split.children.map((c, i) => num(split.sizes && split.sizes[i], DEFAULT_PX));
    sizes[seam.first] = Math.max(1, first);
    sizes[seam.second] = Math.max(1, second);
    return { ...split, sizes };
  }));
}
function dropPosition(px, py, w, h) {
  const xr = px / Math.max(1, w), yr = py / Math.max(1, h);
  const inL = xr <= EDGE, inR = xr >= 1 - EDGE, inT = yr <= EDGE, inB = yr >= 1 - EDGE;
  if ((inT || inB) && !(inL || inR))
    return inT ? "top" : "bottom";
  if ((inL || inR) && !(inT || inB))
    return inL ? "left" : "right";
  if (inL || inR || inT || inB) {
    const d = { top: yr, bottom: 1 - yr, left: xr, right: 1 - xr };
    return Object.keys(d).reduce((a, b) => d[b] < d[a] ? b : a);
  }
  return "center";
}
var STORE_KEY = "ophi.workspace.v2";
var leaves = (n) => isSplit(n) ? n.children.flatMap(leaves) : [n.boxId];
function mountWorkspace(container, tree) {
  let dragged = null;
  const wrappers = new Map;
  const panels = {};
  for (const el of document.querySelectorAll("[data-box]"))
    panels[el.dataset.box] = el;
  let stored = null;
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (s)
      stored = normalize(JSON.parse(s));
  } catch {}
  let root = stored && leaves(stored).every((id) => panels[id]) ? stored : normalize(tree);
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(root));
    } catch {}
  };
  const seamLayer = document.createElement("div");
  seamLayer.className = "wseams";
  container.appendChild(seamLayer);
  const indicator = document.createElement("div");
  indicator.className = "wdrop";
  indicator.hidden = true;
  container.appendChild(indicator);
  function boxRect(boxId) {
    const w = wrappers.get(boxId);
    return w ? { width: w.clientWidth, height: w.clientHeight } : { width: 1, height: 1 };
  }
  function showIndicator(boxId, pos) {
    const w = wrappers.get(boxId);
    if (!w)
      return;
    const r = { left: w.offsetLeft, top: w.offsetTop, width: w.clientWidth, height: w.clientHeight };
    const s = indicator.style;
    indicator.hidden = false;
    if (pos === "left" || pos === "right") {
      s.left = (pos === "left" ? r.left : r.left + r.width - 3) + "px";
      s.top = r.top + 8 + "px";
      s.width = "3px";
      s.height = Math.max(16, r.height - 16) + "px";
    } else if (pos === "top" || pos === "bottom") {
      s.top = (pos === "top" ? r.top : r.top + r.height - 3) + "px";
      s.left = r.left + 8 + "px";
      s.height = "3px";
      s.width = Math.max(16, r.width - 16) + "px";
    } else {
      s.left = r.left + r.width / 2 - 1.5 + "px";
      s.top = r.top + 8 + "px";
      s.width = "3px";
      s.height = Math.max(16, r.height - 16) + "px";
    }
  }
  const hideIndicator = () => {
    indicator.hidden = true;
  };
  function makeWrapper(boxId) {
    const w = document.createElement("div");
    w.className = "wbox";
    const panel = panels[boxId];
    w.addEventListener("mousedown", (e) => {
      w.draggable = e.altKey && !e.target.closest("button, select, input, textarea, a, [data-no-box-drag]");
    }, true);
    w.addEventListener("dragstart", (e) => {
      if (!w.draggable) {
        e.preventDefault();
        return;
      }
      dragged = boxId;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", boxId);
      w.classList.add("dragging");
    });
    w.addEventListener("dragend", () => {
      dragged = null;
      hideIndicator();
      w.classList.remove("dragging");
      w.draggable = false;
    });
    const localPos = (e) => {
      const b = w.getBoundingClientRect();
      return dropPosition(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    };
    w.addEventListener("dragover", (e) => {
      if (!dragged || dragged === boxId)
        return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      showIndicator(boxId, localPos(e));
    });
    w.addEventListener("drop", (e) => {
      if (!dragged || dragged === boxId)
        return;
      e.preventDefault();
      const pos = localPos(e);
      root = moveBox(root, dragged, boxId, pos);
      dragged = null;
      hideIndicator();
      render();
    });
    w.appendChild(panel);
    container.appendChild(w);
    return w;
  }
  function beginResize(seam, e) {
    e.preventDefault();
    const horiz = seam.direction === "horizontal";
    const start = horiz ? e.clientX : e.clientY;
    const combined = seam.firstSize + seam.secondSize;
    document.body.classList.add(horiz ? "wresize-col" : "wresize-row");
    const move = (ev) => {
      const delta = (horiz ? ev.clientX : ev.clientY) - start;
      const first = Math.max(seam.firstMin, Math.min(seam.firstSize + delta, combined - seam.secondMin));
      root = applyResize(root, seam, first, combined - first);
      render();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("wresize-col", "wresize-row");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function render() {
    const rect = { left: 0, top: 0, width: container.clientWidth, height: container.clientHeight };
    const boxes = [], seams = [];
    layout(root, rect, [], boxes, seams);
    const live = new Set;
    for (const b of boxes) {
      live.add(b.boxId);
      const w = wrappers.get(b.boxId) || makeWrapper(b.boxId);
      wrappers.set(b.boxId, w);
      const s = w.style;
      s.left = b.rect.left + GAP / 2 + "px";
      s.top = b.rect.top + GAP / 2 + "px";
      s.width = Math.max(0, b.rect.width - GAP) + "px";
      s.height = Math.max(0, b.rect.height - GAP) + "px";
    }
    for (const [boxId, w] of wrappers) {
      if (live.has(boxId))
        continue;
      w.remove();
      wrappers.delete(boxId);
    }
    seamLayer.replaceChildren();
    for (const seam of seams) {
      const el = document.createElement("div");
      el.className = "wseam " + (seam.direction === "horizontal" ? "col" : "row");
      const s = el.style;
      s.left = seam.x + "px";
      s.top = seam.y + "px";
      s.width = seam.w + "px";
      s.height = seam.h + "px";
      el.addEventListener("pointerdown", (e) => beginResize(seam, e));
      seamLayer.appendChild(el);
    }
    container.appendChild(seamLayer);
    container.appendChild(indicator);
    save();
  }
  render();
  new ResizeObserver(render).observe(container);
  return { render, restored: !!stored && root === stored };
}
if (false) {}

// src/workspaceIndex.ts
var fam = null;
var con = null;
var electrobun = createTauriShim({
  messages: {
    cellOutput: (o) => con && con.liveOutput(o),
    familiarDelta: ({ text }) => fam && fam.addChatDelta(text),
    familiarDone: () => {
      if (fam)
        fam.endReply();
    },
    familiarStatus: ({ text }) => con && con.note(text),
    familiarConsoleStart: () => {},
    familiarConsoleResult: ({ code, result }) => con && con.famResult(code, result)
  }
});
var ws = mountWorkspace(document.getElementById("workspace"), {
  type: "split",
  direction: "horizontal",
  children: [
    { type: "leaf", boxId: "console" },
    { type: "leaf", boxId: "familiar" }
  ],
  sizes: [936, 624]
});
fam = initFamiliar(electrobun);
con = initConsole(electrobun, fam);
fam.onStateChange(con.refreshPlaceholder);
var bar = document.getElementById("titlebar");
bar.setAttribute("data-tauri-drag-region", "");
for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
  const el = document.body.appendChild(document.createElement("div"));
  el.className = "wedge " + edge;
  el.addEventListener("pointerdown", (e) => {
    if (e.button === 0)
      electrobun.rpc.send.windowResize({ edge, dx: 0, dy: 0 });
  });
}
document.getElementById("closeBtn").addEventListener("click", () => electrobun.rpc.send.windowClose({}));
var PAD_KEY = "ophi.pad.vmin";
var pad = parseFloat(localStorage.getItem(PAD_KEY) || "") || 0.6;
var applyPad = () => document.documentElement.style.setProperty("--pad", pad + "vmin");
applyPad();
window.__pad = {
  get: () => pad,
  set: (v) => {
    pad = Math.min(5, Math.max(0, v));
    localStorage.setItem(PAD_KEY, String(pad));
    applyPad();
  }
};
var ZOOM_KEY = "ophi.zoom.";
for (const panel of Array.from(document.querySelectorAll(".panel"))) {
  const saved = parseFloat(localStorage.getItem(ZOOM_KEY + panel.id) || "");
  if (saved)
    panel.style.zoom = String(saved);
  panel.addEventListener("wheel", (e) => {
    if (!e.ctrlKey)
      return;
    e.preventDefault();
    const cur = parseFloat(panel.style.zoom || "1") || 1;
    const next = Math.min(3, Math.max(0.5, cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    panel.style.zoom = next.toFixed(3);
    localStorage.setItem(ZOOM_KEY + panel.id, next.toFixed(3));
  }, { passive: false });
}
addEventListener("keydown", (e) => {
  if (e.key === "Alt")
    document.body.classList.add("alt-held");
});
addEventListener("keyup", (e) => {
  if (e.key === "Alt")
    document.body.classList.remove("alt-held");
});
addEventListener("blur", () => document.body.classList.remove("alt-held"));
addEventListener("wheel", (e) => {
  if (!e.altKey)
    return;
  e.preventDefault();
  window.__pad.set(pad + (e.deltaY < 0 ? 0.15 : -0.15));
}, { passive: false });
electrobun.rpc.request.identity({}).then((id) => fam.setNames(id)).then(() => electrobun.rpc.request.transcript({})).then((t) => {
  if (t.items && t.items.length)
    fam.renderTranscript(t.items);
}).catch(() => {});
electrobun.rpc.request.viewReady({
  boxes: document.querySelectorAll(".wbox").length,
  console: !!document.getElementById("output"),
  familiar: !!document.getElementById("fchat"),
  inputs: document.querySelectorAll("textarea, input[type=text]").length,
  layout: ws.restored ? "restored" : "default",
  drag: document.elementFromPoint(innerWidth / 2, 5)?.id || "NOT ON TOP"
}).catch(() => {});
