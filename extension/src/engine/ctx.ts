import { computeAccessibleName } from 'dom-accessibility-api';
import type { EngineSettings } from './types';

export function normalizeText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function cssEscape(ident: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(ident);
  return ident.replace(/^(\d)/, '\\3$1 ').replace(/([^\w-\u00A0-\uFFFD]|^\\3\d )/g, (m) => (m.startsWith('\\3') ? m : `\\${m}`));
}

/** Quoted CSS attribute value. */
export function cssAttr(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface TextEntry {
  el: Element;
  text: string;
  lower: string;
}

const NO_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'html']);
/** Tag of the extension's own overlay; never part of the page under test. */
export const UI_TAG = 'locator-scout-ui';

/**
 * Per-operation view of the page. Holds the caches that make a pick or a full page scan cheap:
 * open shadow roots, accessible names, aria-hidden state and a text index.
 * Create one per pick / scan / lookup so it never goes stale.
 */
export class PageCtx {
  readonly doc: Document;
  readonly settings: EngineSettings;
  private _shadowRoots?: ShadowRoot[];
  private _textEntries?: TextEntry[];
  private nameCache = new WeakMap<Element, string>();
  private queryCache = new Map<string, Element[]>();
  private memoCache = new Map<string, unknown>();
  private hiddenCache = new WeakMap<Element, boolean>();

  constructor(doc: Document, settings: EngineSettings) {
    this.doc = doc;
    this.settings = settings;
  }

  get shadowRoots(): ShadowRoot[] {
    if (!this._shadowRoots) {
      const roots: ShadowRoot[] = [];
      const walk = (root: ParentNode) => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          if (el.shadowRoot && el.localName !== UI_TAG) {
            roots.push(el.shadowRoot);
            walk(el.shadowRoot);
          }
        }
      };
      walk(this.doc);
      this._shadowRoots = roots;
    }
    return this._shadowRoots;
  }

  /** querySelectorAll that also searches open shadow roots, the way Playwright's CSS engine does. */
  queryAll(selector: string, scope?: Element): Element[] {
    if (!scope) {
      // The DOM does not change during one pick or scan, so page-wide results are computed once.
      let cached = this.queryCache.get(selector);
      if (!cached) {
        cached = this.queryUncached(selector);
        this.queryCache.set(selector, cached);
      }
      return cached;
    }
    return this.queryUncached(selector, scope);
  }

  /** Cache for anything derived from the page that is asked for repeatedly (XPath results, container texts). */
  memo<T>(key: string, compute: () => T): T {
    if (!this.memoCache.has(key)) this.memoCache.set(key, compute());
    return this.memoCache.get(key) as T;
  }

  private queryUncached(selector: string, scope?: Element): Element[] {
    try {
      const out = Array.from((scope ?? this.doc).querySelectorAll(selector));
      for (const root of this.shadowRoots) {
        if (scope && !composedContains(scope, root.host)) continue;
        out.push(...Array.from(root.querySelectorAll(selector)));
      }
      return out;
    } catch {
      return [];
    }
  }

  count(selector: string, scope?: Element): number {
    return this.queryAll(selector, scope).length;
  }

  accName(el: Element): string {
    let name = this.nameCache.get(el);
    if (name === undefined) {
      try {
        name = normalizeText(computeAccessibleName(el));
      } catch {
        name = '';
      }
      this.nameCache.set(el, name);
    }
    return name;
  }

  /** Hidden from the accessibility tree: aria-hidden or display:none on the element or an ancestor. */
  isHidden(el: Element): boolean {
    // visibility is inherited but can be overridden by a child, so it is only checked on the element itself.
    const view = this.doc.defaultView;
    if (view && view.getComputedStyle(el).visibility === 'hidden') return true;
    return this.subtreeHidden(el);
  }

  private subtreeHidden(el: Element): boolean {
    const cached = this.hiddenCache.get(el);
    if (cached !== undefined) return cached;
    let hidden = false;
    if (el.getAttribute('aria-hidden') === 'true') hidden = true;
    else {
      const view = this.doc.defaultView;
      if (view && view.getComputedStyle(el).display === 'none') hidden = true;
      else {
        const parent = composedParent(el);
        hidden = parent ? this.subtreeHidden(parent) : false;
      }
    }
    this.hiddenCache.set(el, hidden);
    return hidden;
  }

  /** Normalized text of every element that could be a text match (containers over 500 chars are skipped). */
  textEntries(): TextEntry[] {
    if (!this._textEntries) {
      const entries: TextEntry[] = [];
      const add = (root: ParentNode) => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          if (NO_TEXT_TAGS.has(el.localName) || el.localName === UI_TAG) continue;
          const raw = el.textContent;
          if (!raw || raw.length > 4000) continue;
          const text = normalizeText(raw);
          if (!text || text.length > 500) continue;
          entries.push({ el, text, lower: text.toLowerCase() });
        }
      };
      add(this.doc);
      for (const root of this.shadowRoots) add(root);
      this._textEntries = entries;
    }
    return this._textEntries;
  }
}

export function composedParent(node: Node): Element | null {
  const parent = node.parentNode;
  if (!parent) return null;
  if (parent.nodeType === 11 && (parent as ShadowRoot).host) return (parent as ShadowRoot).host;
  return parent.nodeType === 1 ? (parent as Element) : null;
}

export function composedContains(scope: Element, node: Node): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur === scope) return true;
    cur = cur.parentNode ?? ((cur as ShadowRoot).host as Node | undefined) ?? null;
  }
  return false;
}

export function inShadow(el: Element): boolean {
  return el.getRootNode() !== el.ownerDocument;
}
