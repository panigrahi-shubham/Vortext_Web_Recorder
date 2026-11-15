/**
 * DOM-side equivalents of the Playwright getBy* locators. One implementation serves two jobs:
 * verifying that a generated candidate matches exactly one element, and the Verify tab's reverse lookup.
 */
import { getRole, roleSelector } from './a11y';
import { PageCtx, composedContains, cssAttr, normalizeText } from './ctx';
import type { TextMatch } from './types';

export function matchText(actual: string | null | undefined, m: TextMatch): boolean {
  const a = normalizeText(actual);
  if (m.kind === 'regex') {
    try {
      return new RegExp(m.source, m.flags).test(a);
    } catch {
      return false;
    }
  }
  const wanted = normalizeText(m.value);
  return m.exact ? a === wanted : a.toLowerCase().includes(wanted.toLowerCase());
}

export function byRole(ctx: PageCtx, role: string, name?: TextMatch, scope?: Element): Element[] {
  return ctx.queryAll(roleSelector(role), scope).filter((el) => {
    if (getRole(el) !== role || ctx.isHidden(el)) return false;
    return name ? matchText(ctx.accName(el), name) : true;
  });
}

/** getByText: the deepest elements whose text matches. */
export function byText(ctx: PageCtx, m: TextMatch, scope?: Element): Element[] {
  const matched = new Set<Element>();
  for (const entry of ctx.textEntries()) {
    if (scope && (entry.el === scope || !composedContains(scope, entry.el))) continue;
    if (matchText(entry.text, m)) matched.add(entry.el);
  }
  const out: Element[] = [];
  for (const el of matched) {
    let childMatches = false;
    for (const child of Array.from(el.children)) {
      if (matched.has(child)) {
        childMatches = true;
        break;
      }
    }
    if (!childMatches) out.push(el);
  }
  return out;
}

export function labelTexts(el: Element): string[] {
  const out: string[] = [];
  const labels = (el as HTMLInputElement).labels;
  if (labels) for (const label of Array.from(labels)) out.push(normalizeText(label.textContent));
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const text = labelledBy
      .split(/\s+/)
      .map((id) => normalizeText(root.getElementById?.(id)?.textContent))
      .filter(Boolean)
      .join(' ');
    if (text) out.push(text);
  }
  const ariaLabel = normalizeText(el.getAttribute('aria-label'));
  if (ariaLabel) out.push(ariaLabel);
  return out.filter(Boolean);
}

export function byLabel(ctx: PageCtx, m: TextMatch, scope?: Element): Element[] {
  const selector = 'input,select,textarea,button,meter,output,progress,[aria-label],[aria-labelledby]';
  return ctx.queryAll(selector, scope).filter((el) => labelTexts(el).some((t) => matchText(t, m)));
}

export function byAttr(ctx: PageCtx, attr: 'placeholder' | 'alt' | 'title', m: TextMatch, scope?: Element): Element[] {
  return ctx.queryAll(`[${attr}]`, scope).filter((el) => matchText(el.getAttribute(attr), m));
}

export function byTestId(ctx: PageCtx, value: string, scope?: Element): Element[] {
  const seen = new Set<Element>();
  for (const attr of ctx.settings.testIdAttrs) {
    for (const el of ctx.queryAll(`[${attr}=${cssAttr(value)}]`, scope)) seen.add(el);
  }
  return Array.from(seen);
}

/** Page-wide XPath, memoised for the lifetime of the ctx. */
export function xpathAll(ctx: PageCtx, expr: string): Element[] {
  return ctx.memo(`xp:${expr}`, () => evalXPath(ctx.doc, expr));
}

export function evalXPath(doc: Document, expr: string, context?: Node): Element[] {
  try {
    const result = doc.evaluate(expr, context ?? doc, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
    const out: Element[] = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (node && node.nodeType === 1) out.push(node as Element);
    }
    return out;
  } catch {
    return [];
  }
}
