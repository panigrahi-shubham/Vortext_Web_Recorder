/**
 * Reverse lookup: take a locator the way it is written in a test (CSS, XPath, a Playwright chain or a
 * Selenium By) and return the elements it matches on the current page.
 */
import { PageCtx, cssAttr, cssEscape, normalizeText } from './ctx';
import { byAttr, byLabel, byRole, byTestId, byText, evalXPath, matchText } from './queries';
import type { TextMatch } from './types';

export interface LookupResult {
  kind: 'css' | 'xpath' | 'playwright' | 'selenium';
  elements: Element[];
  error?: string;
}

interface Call {
  name: string;
  args: string;
}

/** Split "page.locator('a').filter({ hasText: 'x' }).getByRole('button')" into calls. */
function splitCalls(src: string): Call[] {
  const calls: Call[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && /[\s.]/.test(src[i])) i++;
    if (i >= n) break;
    const ident = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (!ident) throw new Error(`cannot parse near "${src.slice(i, i + 20)}"`);
    i += ident[0].length;
    if (src[i] !== '(') continue; // page / this / frame
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      const ch = src[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        for (i++; i < n && src[i] !== ch; i++) if (src[i] === '\\') i++;
      } else if (ch === '/' && /[(,:]\s*$/.test(src.slice(0, i))) {
        let inClass = false;
        for (i++; i < n; i++) {
          if (src[i] === '\\') i++;
          else if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
        }
      } else if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error('unbalanced brackets');
    calls.push({ name: ident[0], args: src.slice(start, i).trim() });
    i++;
  }
  return calls;
}

const STRING_RE = /^(['"`])((?:\\.|(?!\1)[^\\])*)\1/s;
const REGEX_RE = /^\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+)\/([a-z]*)/s;

function unescapeJs(s: string): string {
  return s.replace(/\\(.)/gs, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

function readValue(src: string, exact: boolean): { match: TextMatch; rest: string } | null {
  const s = STRING_RE.exec(src);
  if (s) return { match: { kind: 'string', value: unescapeJs(s[2]), exact }, rest: src.slice(s[0].length) };
  const r = REGEX_RE.exec(src);
  if (r) return { match: { kind: 'regex', source: r[1], flags: r[2].replace(/[gy]/g, '') }, rest: src.slice(r[0].length) };
  return null;
}

function prop(args: string, key: string, exact: boolean): TextMatch | undefined {
  const at = new RegExp(`\\b${key}\\s*:\\s*`).exec(args);
  if (!at) return undefined;
  return readValue(args.slice(at.index + at[0].length), exact)?.match;
}

function unique(els: Element[]): Element[] {
  return Array.from(new Set(els));
}

function runChain(calls: Call[], ctx: PageCtx): Element[] {
  let scope: Element[] | null = null;
  const each = (fn: (root?: Element) => Element[]): Element[] => (scope === null ? fn(undefined) : unique(scope.flatMap((el) => fn(el))));

  for (const call of calls) {
    const exact = /\bexact\s*:\s*true\b/.test(call.args);
    const first = readValue(call.args, exact);
    const text = (): TextMatch => {
      if (!first) throw new Error(`${call.name}() needs a string or regex`);
      return first.match;
    };
    switch (call.name) {
      case 'locator':
      case '$':
      case '$$': {
        const sel = text();
        if (sel.kind !== 'string') throw new Error('locator() needs a string selector');
        let value = sel.value.trim();
        const isXpath = /^(xpath=|\/\/|\.\.?\/|\()/.test(value);
        value = value.replace(/^(xpath|css)=/, '');
        const hasText = prop(first!.rest, 'hasText', false);
        let found: Element[];
        if (isXpath) found = each((root) => evalXPath(ctx.doc, root && value.startsWith('//') ? `.${value}` : value, root));
        else {
          ctx.doc.querySelector(value); // throws on invalid CSS so the user sees the error
          found = each((root) => ctx.queryAll(value, root));
        }
        scope = hasText ? found.filter((el) => matchText(el.textContent, hasText)) : found;
        break;
      }
      case 'getByRole': {
        const role = text();
        if (role.kind !== 'string') throw new Error('getByRole() needs a role name');
        const name = prop(first!.rest, 'name', exact);
        scope = each((root) => byRole(ctx, role.value, name, root));
        break;
      }
      case 'getByText':
        scope = each((root) => byText(ctx, text(), root));
        break;
      case 'getByLabel':
        scope = each((root) => byLabel(ctx, text(), root));
        break;
      case 'getByPlaceholder':
        scope = each((root) => byAttr(ctx, 'placeholder', text(), root));
        break;
      case 'getByAltText':
        scope = each((root) => byAttr(ctx, 'alt', text(), root));
        break;
      case 'getByTitle':
        scope = each((root) => byAttr(ctx, 'title', text(), root));
        break;
      case 'getByTestId': {
        const id = text();
        if (id.kind !== 'string') throw new Error('getByTestId() regex is not supported here');
        scope = each((root) => byTestId(ctx, id.value, root));
        break;
      }
      case 'filter': {
        const hasText = prop(call.args, 'hasText', false);
        const hasAt = /\bhas\s*:\s*/.exec(call.args);
        const current: Element[] = scope ?? [];
        if (hasText) scope = current.filter((el) => matchText(el.textContent, hasText));
        else if (hasAt) {
          const inner = splitCalls(call.args.slice(hasAt.index + hasAt[0].length).replace(/\}\s*$/, ''));
          scope = current.filter((el) => {
            const sub = runChainScoped(inner, ctx, el);
            return sub.length > 0;
          });
        } else throw new Error('filter() supports hasText and has');
        break;
      }
      case 'first':
        scope = (scope ?? []).slice(0, 1);
        break;
      case 'last':
        scope = (scope ?? []).slice(-1);
        break;
      case 'nth': {
        const index = Number(call.args);
        const current: Element[] = scope ?? [];
        scope = Number.isInteger(index) ? current.slice(index, index + 1 || undefined) : [];
        break;
      }
      default:
        throw new Error(`${call.name}() is not supported in Verify yet`);
    }
  }
  return scope ?? [];
}

function runChainScoped(calls: Call[], ctx: PageCtx, root: Element): Element[] {
  // Evaluate the inner chain page-wide, then keep what lives inside `root` (semantics of filter({ has })).
  return runChain(calls, ctx).filter((el) => root !== el && root.contains(el));
}

function runSelenium(method: string, value: string, ctx: PageCtx): Element[] {
  switch (method) {
    case 'id':
      return ctx.queryAll(`[id=${cssAttr(value)}]`);
    case 'name':
      return ctx.queryAll(`[name=${cssAttr(value)}]`);
    case 'className':
      return ctx.queryAll(`.${cssEscape(value)}`);
    case 'tagName':
      return ctx.queryAll(value);
    case 'cssSelector':
      ctx.doc.querySelector(value);
      return ctx.queryAll(value);
    case 'xpath':
      return evalXPath(ctx.doc, value);
    case 'linkText':
      return ctx.queryAll('a').filter((a) => normalizeText(a.textContent) === normalizeText(value));
    case 'partialLinkText':
      return ctx.queryAll('a').filter((a) => normalizeText(a.textContent).includes(normalizeText(value)));
    default:
      throw new Error(`By.${method} is not supported`);
  }
}

export function lookup(input: string, ctx: PageCtx): LookupResult {
  let src = input.trim().replace(/;$/, '').replace(/^await\s+/, '').trim();
  if (!src) return { kind: 'css', elements: [] };

  const by = /By\.(\w+)\(\s*"((?:\\.|[^"\\])*)"\s*\)/s.exec(src);
  try {
    if (by) return { kind: 'selenium', elements: runSelenium(by[1], unescapeJs(by[2]), ctx) };
    if (/^((this\.)?page\b|getBy\w+\(|locator\()/.test(src)) return { kind: 'playwright', elements: runChain(splitCalls(src), ctx) };
    if (/^(xpath=|\/|\.\.?\/|\()/.test(src)) {
      src = src.replace(/^xpath=/, '');
      ctx.doc.evaluate(src, ctx.doc, null, 7, null); // surface syntax errors
      return { kind: 'xpath', elements: evalXPath(ctx.doc, src) };
    }
    src = src.replace(/^css=/, '');
    ctx.doc.querySelector(src);
    return { kind: 'css', elements: ctx.queryAll(src) };
  } catch (err) {
    const kind = by ? 'selenium' : /^((this\.)?page\b|getBy|locator\()/.test(src) ? 'playwright' : /^(\/|\(|\.\.?\/)/.test(src) ? 'xpath' : 'css';
    return { kind, elements: [], error: err instanceof Error ? err.message : String(err) };
  }
}
