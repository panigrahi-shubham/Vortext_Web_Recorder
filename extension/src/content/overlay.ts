import { UI_TAG } from '../engine';

const STYLE = `
:host { all: initial; }
.box { position: fixed; pointer-events: none; box-sizing: border-box; border: 2px solid #0891b2;
  background: rgba(8, 145, 178, .14); border-radius: 3px; display: none; z-index: 2147483646; }
.box.ok { border-color: #16a34a; background: rgba(22, 163, 74, .18); }
.box.many { border-color: #d97706; background: rgba(217, 119, 6, .14); }
.tip { position: fixed; pointer-events: none; display: none; max-width: min(640px, 92vw); z-index: 2147483647;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #f8fafc; background: #0f172a;
  padding: 5px 8px; border-radius: 5px; box-shadow: 0 4px 14px rgba(0,0,0,.3); white-space: pre-wrap; word-break: break-word; }
.tip b { color: #67e8f9; font-weight: 600; }
.tip .dim { color: #94a3b8; }
.toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); pointer-events: none; display: none;
  font: 13px/1.4 system-ui, sans-serif; color: #fff; background: #166534; padding: 8px 14px; border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0,0,0,.3); max-width: 80vw; z-index: 2147483647; }
.bar { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); pointer-events: none; display: none;
  font: 12px/1.4 system-ui, sans-serif; color: #e2e8f0; background: #0f172a; padding: 6px 12px; border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0,0,0,.3); z-index: 2147483647; white-space: nowrap; }
.bar kbd { font: inherit; background: #334155; border-radius: 4px; padding: 0 5px; margin: 0 2px; }
`;

/** Everything the extension draws on the page. Lives in a closed shadow root so page CSS and the engine never see it. */
export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private box: HTMLElement;
  private tip: HTMLElement;
  private toastEl: HTMLElement;
  private bar: HTMLElement;
  private many: HTMLElement[] = [];
  private tracked: Element[] = [];
  private toastTimer = 0;
  private raf = 0;

  constructor() {
    this.host = document.createElement(UI_TAG);
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.box = this.div('box');
    this.tip = this.div('tip');
    this.toastEl = this.div('toast');
    this.bar = this.div('bar');
    const hint: [string, string[]][] = [
      ['Locator Scout: click to pick ', []],
      [' parent / child ', ['↑', '↓']],
      [' exact element ', ['Shift']],
      [' stop', ['Esc']],
    ];
    for (const [text, keys] of hint) {
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        this.bar.append(kbd);
      }
      this.bar.append(text);
    }
    this.root.append(style, this.box, this.tip, this.toastEl, this.bar);
    const reposition = () => {
      if (!this.tracked.length || this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.placeMany();
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);
  }

  private div(cls: string): HTMLElement {
    const el = document.createElement('div');
    el.className = cls;
    return el;
  }

  private mount(): void {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  showBar(on: boolean): void {
    this.mount();
    this.bar.style.display = on && window === window.top ? 'block' : 'none';
  }

  /** Highlight one element with an optional tooltip made of [bold, dim, code] parts. */
  show(el: Element, parts?: { head: string; sub?: string; code?: string }, state: '' | 'ok' = ''): void {
    this.mount();
    const r = el.getBoundingClientRect();
    this.box.className = `box ${state}`;
    Object.assign(this.box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    if (!parts) {
      this.tip.style.display = 'none';
      return;
    }
    this.tip.textContent = '';
    const head = document.createElement('b');
    head.textContent = parts.head;
    this.tip.append(head);
    if (parts.sub) {
      const sub = document.createElement('span');
      sub.className = 'dim';
      sub.textContent = `  ${parts.sub}`;
      this.tip.append(sub);
    }
    if (parts.code) this.tip.append(`\n${parts.code}`);
    this.tip.style.display = 'block';
    const th = this.tip.offsetHeight;
    const tw = this.tip.offsetWidth;
    let top = r.bottom + 6;
    if (top + th > window.innerHeight - 4) top = Math.max(4, r.top - th - 6);
    const left = Math.max(4, Math.min(r.left, window.innerWidth - tw - 8));
    Object.assign(this.tip.style, { top: `${top}px`, left: `${left}px` });
  }

  hide(): void {
    this.box.style.display = 'none';
    this.tip.style.display = 'none';
  }

  highlightMany(elements: Element[]): void {
    this.clearMany();
    this.mount();
    this.tracked = elements.slice(0, 80);
    for (let i = 0; i < this.tracked.length; i++) {
      const b = this.div(`box ${elements.length === 1 ? 'ok' : 'many'}`);
      b.style.display = 'block';
      this.root.append(b);
      this.many.push(b);
    }
    this.placeMany();
  }

  private placeMany(): void {
    this.tracked.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      Object.assign(this.many[i].style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    });
  }

  clearMany(): void {
    for (const b of this.many) b.remove();
    this.many = [];
    this.tracked = [];
  }

  toast(text: string): void {
    this.mount();
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.style.display = 'none'), 1800);
  }
}
