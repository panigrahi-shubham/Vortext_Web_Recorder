// LocatorChain -> TypeScript code, and LocatorChain -> live Playwright Locator.
import type { Frame, FrameLocator, Locator, Page } from 'playwright';
import type { LocatorChain, LocatorPart, TextMatch } from '../types';

/** Single-quoted TS string literal. */
export function q(s: string): string {
  return (
    "'" +
    s
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029') +
    "'"
  );
}

export function regexLiteral(source: string, flags = ''): string {
  // Sources are produced by escapeRegex(), which already escapes "/".
  const safe = source.replace(/(^|[^\\])\//g, '$1\\/');
  return `/${safe}/${flags}`;
}

export function textMatchCode(t: TextMatch): string {
  return typeof t === 'string' ? q(t) : regexLiteral(t.regex, t.flags);
}

function toRegExp(t: TextMatch): string | RegExp {
  return typeof t === 'string' ? t : new RegExp(t.regex, t.flags);
}

export function partCode(p: LocatorPart): string {
  switch (p.kind) {
    case 'testId':
      return `getByTestId(${q(p.value)})`;
    case 'role': {
      const opts: string[] = [];
      if (p.name !== undefined) opts.push(`name: ${textMatchCode(p.name)}`);
      if (p.exact && typeof p.name === 'string') opts.push('exact: true');
      return opts.length ? `getByRole(${q(p.role)}, { ${opts.join(', ')} })` : `getByRole(${q(p.role)})`;
    }
    case 'label':
    case 'placeholder':
    case 'altText':
    case 'title':
    case 'text': {
      const method = { label: 'getByLabel', placeholder: 'getByPlaceholder', altText: 'getByAltText', title: 'getByTitle', text: 'getByText' }[p.kind];
      const exact = p.exact && typeof p.value === 'string' ? ', { exact: true }' : '';
      return `${method}(${textMatchCode(p.value)}${exact})`;
    }
    case 'css':
      return `locator(${q(p.selector)})`;
    case 'filter':
      return `filter({ hasText: ${textMatchCode(p.hasText)} })`;
    case 'nth':
      return p.index === 0 ? 'first()' : p.index === -1 ? 'last()' : `nth(${p.index})`;
  }
}

/** Render a chain against a root expression such as `page` or `this.page`. */
export function renderChain(chain: LocatorChain, root = 'page'): string {
  let code = root;
  for (const f of chain.frames) code += `.frameLocator(${q(f)})`;
  for (const p of chain.parts) code += '.' + partCode(p);
  return code;
}

/**
 * Render with a parameter in place of the scoped anchor text, so a page-object method
 * can take the row text as an argument: `filter({ hasText: itemName })`.
 */
export function renderChainWithParam(chain: LocatorChain, root: string, paramName: string): string {
  let code = root;
  for (const f of chain.frames) code += `.frameLocator(${q(f)})`;
  let replaced = false;
  for (const p of chain.parts) {
    if (!replaced && p.kind === 'filter' && typeof p.hasText === 'string') {
      code += `.filter({ hasText: ${paramName} })`;
      replaced = true;
    } else code += '.' + partCode(p);
  }
  return code;
}

type Root = Page | Frame | Locator | FrameLocator;

function applyPart(root: Root, p: LocatorPart): Locator {
  const r = root as Page; // all roots share these methods
  switch (p.kind) {
    case 'testId':
      return r.getByTestId(p.value);
    case 'role':
      return r.getByRole(p.role as Parameters<Page['getByRole']>[0], {
        ...(p.name !== undefined ? { name: toRegExp(p.name) } : {}),
        ...(p.exact ? { exact: true } : {}),
      });
    case 'label':
      return r.getByLabel(toRegExp(p.value), p.exact ? { exact: true } : undefined);
    case 'placeholder':
      return r.getByPlaceholder(toRegExp(p.value), p.exact ? { exact: true } : undefined);
    case 'altText':
      return r.getByAltText(toRegExp(p.value), p.exact ? { exact: true } : undefined);
    case 'title':
      return r.getByTitle(toRegExp(p.value), p.exact ? { exact: true } : undefined);
    case 'text':
      return r.getByText(toRegExp(p.value), p.exact ? { exact: true } : undefined);
    case 'css':
      return r.locator(p.selector);
    case 'filter':
      return (root as Locator).filter({ hasText: toRegExp(p.hasText) });
    case 'nth':
      return p.index === -1 ? (root as Locator).last() : (root as Locator).nth(p.index);
  }
}

/** Build a live Locator. When `root` is already the target Frame, pass `skipFrames`. */
export function toLocator(root: Page | Frame, chain: LocatorChain, skipFrames = false): Locator {
  let cur: Root = root;
  if (!skipFrames) for (const f of chain.frames) cur = (cur as Page).frameLocator(f);
  if (!chain.parts.length) throw new Error('Empty locator chain');
  for (const p of chain.parts) cur = applyPart(cur, p);
  return cur as Locator;
}

/** Short human description: button "Login" */
export function describeChain(chain: LocatorChain): string {
  const last = [...chain.parts].reverse().find((p) => p.kind !== 'filter' && p.kind !== 'nth');
  if (!last) return 'element';
  const t = (m: TextMatch | undefined) => (m === undefined ? '' : typeof m === 'string' ? m : `/${m.regex}/`);
  switch (last.kind) {
    case 'role':
      return last.name !== undefined ? `${last.role} "${t(last.name)}"` : last.role;
    case 'testId':
      return `test id "${last.value}"`;
    case 'css':
      return `"${last.selector}"`;
    default:
      return `${last.kind} "${t(last.value)}"`;
  }
}
