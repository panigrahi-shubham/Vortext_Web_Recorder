import { PageCtx, inShadow, normalizeText } from './ctx';
import { stableHref } from './css';
import { badgeSplit, hasDynamicNumber, isDynamicToken, isMostlyNumeric, isStableValue, numericBadges, stableChunk, stableClasses } from './dynamic';
import { evalXPath, xpathAll } from './queries';

export type XpKind = 'attr' | 'text' | 'class' | 'indexed';

export interface XpResult {
  expr: string;
  kind: XpKind;
  note?: string;
}

export function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return `concat(${s.split("'").map((part) => `'${part}'`).join(`, "'", `)})`;
}

export function xpTag(el: Element): string {
  const html = el.namespaceURI === 'http://www.w3.org/1999/xhtml' || !el.namespaceURI;
  return html ? el.localName : `*[local-name()='${el.localName}']`;
}

export function xpClass(cls: string): string {
  return `[contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')]`;
}

/**
 * Class predicate for `el`. Uses the short contains(@class, 'x') form when it selects exactly the same
 * elements as the strict token match on this page, otherwise the strict form.
 */
export function xpClassFor(el: Element, cls: string, ctx: PageCtx): string {
  const tag = xpTag(el);
  const strict = xpClass(cls);
  const short = `[contains(@class, ${xpathLiteral(cls)})]`;
  const a = xpathAll(ctx, `//${tag}${short}`).length;
  const b = xpathAll(ctx, `//${tag}${strict}`).length;
  return a === b ? short : strict;
}

/** Predicates that describe the element on its own, best first. */
export function simplePredicates(el: Element, ctx: PageCtx): { pred: string; kind: XpKind; note?: string }[] {
  const out: { pred: string; kind: XpKind; note?: string }[] = [];
  const attr = (name: string, value: string) => out.push({ pred: `[@${name}=${xpathLiteral(value)}]`, kind: 'attr' });

  for (const name of ctx.settings.testIdAttrs) {
    const v = el.getAttribute(name);
    if (v) attr(name, v);
  }
  const id = el.getAttribute('id');
  if (id && !isDynamicToken(id)) attr('id', id);
  for (const name of ['name', 'aria-label', 'placeholder', 'title', 'alt']) {
    const v = el.getAttribute(name);
    if (isStableValue(v)) attr(name, v);
  }
  const href = stableHref(el);
  if (href) attr('href', href);

  if (el.localName === 'input') {
    const type = el.getAttribute('type');
    const value = el.getAttribute('value');
    if (type && /^(submit|button|reset)$/i.test(type) && isStableValue(value)) {
      out.push({ pred: `[@type=${xpathLiteral(type)}][@value=${xpathLiteral(value)}]`, kind: 'attr' });
    }
  }

  const text = normalizeText(el.textContent);
  const smallSubtree = el.querySelectorAll('*').length <= 8;
  const badge = badgeSplit(text, numericBadges(el));
  if (text.length >= 2 && text.length <= 60 && smallSubtree && !isMostlyNumeric(text)) {
    if (badge && badge.label.length >= 3) {
      out.push({
        pred: `[starts-with(normalize-space(), ${xpathLiteral(badge.label)})]`,
        kind: 'text',
        note: 'the counter badge is ignored, only the label is matched',
      });
    } else if (hasDynamicNumber(text)) {
      const chunk = stableChunk(text);
      if (chunk) {
        const fn = chunk.isPrefix ? 'starts-with' : 'contains';
        out.push({
          pred: `[${fn}(normalize-space(), ${xpathLiteral(chunk.chunk)})]`,
          kind: 'text',
          note: 'numbers in the text are treated as dynamic, so only the stable part is matched',
        });
      }
    } else {
      out.push({ pred: `[normalize-space()=${xpathLiteral(text)}]`, kind: 'text' });
    }
  }

  if (!inShadow(el)) for (const cls of stableClasses(el).slice(0, 2)) out.push({ pred: xpClassFor(el, cls, ctx), kind: 'class' });
  return out;
}

function indexedStep(el: Element): string {
  const parent = el.parentElement;
  const tag = xpTag(el);
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
  return same.length > 1 ? `${tag}[${same.indexOf(el) + 1}]` : tag;
}

function isOnly(ctx: PageCtx, expr: string, el: Element): boolean {
  const found = xpathAll(ctx, expr);
  return found.length === 1 && found[0] === el;
}

/** Relative XPath candidates that match only this element. XPath cannot enter shadow DOM, so none are built there. */
export function buildXpaths(el: Element, ctx: PageCtx): XpResult[] {
  if (inShadow(el)) return [];
  const tag = xpTag(el);
  const out: XpResult[] = [];
  const seenKinds = new Set<XpKind>();
  for (const p of simplePredicates(el, ctx)) {
    if (seenKinds.has(p.kind)) continue;
    const expr = `//${tag}${p.pred}`;
    if (isOnly(ctx, expr, el)) {
      out.push({ expr, kind: p.kind, note: p.note });
      seenKinds.add(p.kind);
    }
  }
  if (out.length) return out;

  // Fall back to an indexed path hanging off the nearest uniquely identifiable ancestor.
  const steps: string[] = [indexedStep(el)];
  let anc = el.parentElement;
  while (anc && anc.localName !== 'html') {
    const ancTag = xpTag(anc);
    for (const p of simplePredicates(anc, ctx)) {
      if (p.kind === 'text') continue;
      const base = `//${ancTag}${p.pred}`;
      if (!isOnly(ctx, base, anc)) continue;
      const expr = `${base}/${steps.join('/')}`;
      if (isOnly(ctx, expr, el)) return [{ expr, kind: 'indexed' }];
    }
    steps.unshift(indexedStep(anc));
    anc = anc.parentElement;
  }
  const absolute = `/html/${steps.join('/')}`;
  return isOnly(ctx, absolute, el) ? [{ expr: absolute, kind: 'indexed' }] : [];
}

/** XPath for `el` relative to `container`, starting with "//" or "/". Used for anchored Selenium locators. */
export function relativeXpath(el: Element, container: Element, ctx: PageCtx): { path: string; kind: XpKind } | null {
  const tag = xpTag(el);
  for (const p of simplePredicates(el, ctx)) {
    const found = evalXPath(ctx.doc, `.//${tag}${p.pred}`, container);
    if (found.length === 1 && found[0] === el) return { path: `//${tag}${p.pred}`, kind: p.kind };
  }
  const onlyTag = evalXPath(ctx.doc, `.//${tag}`, container);
  if (onlyTag.length === 1 && onlyTag[0] === el) return { path: `//${tag}`, kind: 'class' };

  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== container) {
    steps.unshift(indexedStep(cur));
    cur = cur.parentElement;
  }
  return cur === container ? { path: `/${steps.join('/')}`, kind: 'indexed' } : null;
}
