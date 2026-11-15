import {
  PageCtx, bestFor, buildCss, codeFor, generate, lookup, retarget, scanPage, UI_TAG,
  type FrameRef, type PickResult,
} from '../engine';
import {
  DEFAULT_SETTINGS, loadSettings,
  type FromContent, type LookupResponse, type ScanItem, type ScanResponse, type Settings, type ToContent,
} from '../shared/protocol';
import { Overlay } from './overlay';

declare global {
  interface Window {
    __locatorScout?: boolean;
  }
}

function main(): void {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  void loadSettings().then((s) => (settings = s));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue ?? {}) };
  });

  const overlay = new Overlay();
  const registry = new Map<number, WeakRef<Element>>();
  let nextRef = Math.floor(Math.random() * 1e9);
  const register = (el: Element): number => {
    const id = nextRef++;
    registry.set(id, new WeakRef(el));
    return id;
  };

  /** Title and URL of the top page when reachable (same origin), otherwise of this frame. */
  const pageMeta = (): { title: string; url: string } => {
    try {
      const top = window.top!;
      return { title: top.document.title, url: top.location.href };
    } catch {
      return { title: document.title, url: location.href };
    }
  };

  const newCtx = () => new PageCtx(document, { testIdAttrs: settings.testIdAttrs });

  const emit = (msg: FromContent) => {
    try {
      void chrome.runtime.sendMessage(msg).catch(() => undefined);
    } catch {
      /* extension was reloaded; this content script is orphaned */
    }
  };

  /** Locators for the iframes between the top page and this document. */
  function frameChain(): FrameRef[] {
    const chain: FrameRef[] = [];
    let win: Window = window;
    while (win !== win.top) {
      let ref: FrameRef = { selector: 'iframe', verified: false };
      try {
        const frameEl = win.frameElement; // null or throws when the parent is another origin
        if (frameEl) {
          const css = buildCss(frameEl, new PageCtx(frameEl.ownerDocument, { testIdAttrs: settings.testIdAttrs }));
          if (css) ref = { selector: css.selector, verified: true };
        } else if (win === window) {
          ref = { selector: window.name ? `iframe[name="${window.name}"]` : `iframe[src*="${location.hostname}"]`, verified: false };
        }
      } catch {
        /* keep the generic fallback */
      }
      chain.unshift(ref);
      try {
        win = win.parent;
      } catch {
        break;
      }
    }
    return chain;
  }

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.documentElement.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  function tipFor(el: Element, result?: PickResult): { head: string; sub?: string; code?: string } {
    const head = `<${el.localName}>`;
    if (!result) return { head };
    const best = bestFor(result.candidates, settings.format);
    const sub = [result.info.role, result.info.name ? `"${result.info.name}"` : ''].filter(Boolean).join(' ');
    return { head, sub, code: best ? `${codeFor(best, settings.format)}   [${best.stability}]` : 'no unique locator found' };
  }

  // ---------------------------------------------------------------- picker
  let picking = false;
  let current: Element | null = null;
  let childStack: Element[] = [];
  let previewTimer = 0;
  let lastContext: Element | null = null;
  let cursorStyle: HTMLStyleElement | null = null;

  const targetOf = (e: Event): Element | null => {
    const t = e.composedPath()[0];
    if (!(t instanceof Element) || t.localName === UI_TAG) return null;
    return t;
  };

  function preview(el: Element): void {
    overlay.show(el, tipFor(el));
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      if (current !== el || !picking) return;
      overlay.show(el, tipFor(el, generate(el, newCtx(), { frames: frameChain() })));
    }, 110);
  }

  function setCurrent(el: Element): void {
    if (el === current) return;
    current = el;
    preview(el);
  }

  async function pick(el: Element, from?: Element): Promise<void> {
    const result = generate(el, newCtx(), {
      frames: frameChain(),
      retargetedFrom: from && from !== el ? `<${from.localName}>` : undefined,
    });
    result.refId = register(el);
    Object.assign(result, pageMeta());
    emit({ type: 'ls:picked', result, title: result.title ?? document.title });
    const best = bestFor(result.candidates, settings.format);
    const code = best ? codeFor(best, settings.format) : null;
    overlay.show(el, tipFor(el, result), 'ok');
    if (code && settings.autoCopy) {
      const ok = await copy(code);
      overlay.toast(ok ? `Copied: ${code.length > 90 ? `${code.slice(0, 87)}...` : code}` : 'Picked (clipboard is blocked on this page, copy from the panel)');
    } else if (!code) {
      overlay.toast('No unique locator found for this element');
    }
    if (!settings.keepPicking) setPicking(false, true);
  }

  const swallow = (e: Event) => {
    if (!targetOf(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onMove = (e: MouseEvent) => {
    const t = targetOf(e);
    if (!t) return;
    childStack = [];
    setCurrent(e.shiftKey ? t : retarget(t));
  };

  const onClick = (e: MouseEvent) => {
    const t = targetOf(e);
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const chosen = current && childStack.length ? current : e.shiftKey ? t : retarget(t);
    void pick(chosen, t);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPicking(false, true);
    } else if (e.key === 'ArrowUp' && current?.parentElement && current.parentElement !== document.documentElement) {
      e.preventDefault();
      e.stopImmediatePropagation();
      childStack.push(current);
      const parent = current.parentElement;
      current = null;
      setCurrent(parent);
    } else if (e.key === 'ArrowDown' && childStack.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const child = childStack.pop()!;
      current = null;
      setCurrent(child);
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      e.stopImmediatePropagation();
      void pick(current);
    }
  };

  const onLeave = (e: MouseEvent) => {
    if (!e.relatedTarget) {
      current = null;
      overlay.hide();
    }
  };

  const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'submit'] as const;

  function setPicking(on: boolean, broadcast: boolean): void {
    if (on === picking) return;
    picking = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('mousemove', onMove as EventListener, true);
    window[method]('click', onClick as EventListener, true);
    window[method]('keydown', onKey as EventListener, true);
    window[method]('mouseout', onLeave as EventListener, true);
    for (const type of BLOCKED) window[method](type, swallow, true);
    if (on) {
      cursorStyle = document.createElement('style');
      cursorStyle.textContent = '* { cursor: crosshair !important; }';
      (document.head ?? document.documentElement).appendChild(cursorStyle);
      overlay.clearMany();
    } else {
      cursorStyle?.remove();
      cursorStyle = null;
      current = null;
      childStack = [];
      clearTimeout(previewTimer);
      overlay.hide();
    }
    overlay.showBar(on);
    if (broadcast) emit({ type: 'ls:pick-state', on });
  }

  window.addEventListener(
    'contextmenu',
    (e) => {
      const t = targetOf(e);
      if (t) lastContext = retarget(t);
    },
    true,
  );

  // ---------------------------------------------------------------- scan / lookup / highlight
  function scan(): ScanResponse {
    const result = scanPage(newCtx(), { limit: 300 });
    const items: ScanItem[] = result.items.map(({ el, result: r, repeat }) => {
      r.refId = register(el);
      r.rejected = [];
      r.title = document.title;
      return { result: r, repeat };
    });
    return { items, total: result.total, truncated: result.truncated, ms: result.ms, title: document.title, url: location.href };
  }

  function runLookup(expr: string): LookupResponse {
    if (!expr.trim()) {
      overlay.clearMany();
      return { kind: '', count: 0 };
    }
    const found = lookup(expr, newCtx());
    overlay.highlightMany(found.elements);
    const first = found.elements[0];
    if (first) {
      const r = first.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) first.scrollIntoView({ block: 'center' });
    }
    return { kind: found.kind, count: found.elements.length, error: found.error };
  }

  function highlight(refId: number | null): void {
    const el = refId === null ? undefined : registry.get(refId)?.deref();
    if (!el || !el.isConnected) {
      if (!picking) overlay.hide();
      overlay.clearMany();
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: 'center' });
    overlay.highlightMany([el]);
  }

  chrome.runtime.onMessage.addListener((msg: ToContent, _sender, respond) => {
    switch (msg.type) {
      case 'ls:ping':
        respond(picking);
        break;
      case 'ls:pick':
        if (msg.relay) setPicking(msg.on === true, false);
        else setPicking(msg.on === 'toggle' ? !picking : msg.on, true);
        respond(picking);
        break;
      case 'ls:pick-context':
        if (lastContext?.isConnected) void pick(lastContext);
        break;
      case 'ls:scan':
        respond(scan());
        break;
      case 'ls:lookup':
        respond(runLookup(msg.expr));
        break;
      case 'ls:highlight':
        highlight(msg.refId);
        break;
    }
    return false;
  });
}

if (!window.__locatorScout) {
  window.__locatorScout = true;
  main();
}
