// Small formatting and naming helpers (no Prettier dependency).

export const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements',
  'interface', 'package', 'private', 'protected', 'public', 'await', 'async', 'of', 'page', 'expect', 'test', 'data',
  'constructor', 'goto', 'expectLoaded', 'context', 'request', 'browser',
]);

/** Split any text into words: "Add to cart (3)" -> [add, to, cart] ; "userName" -> [user, name] */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function camelCase(text: string, maxWords = 4): string {
  const w = words(text).slice(0, maxWords);
  if (!w.length) return '';
  let s = w[0] + w.slice(1).map((x) => x[0].toUpperCase() + x.slice(1)).join('');
  if (/^\d/.test(s)) s = 'n' + s;
  return s;
}

export function pascalCase(text: string, maxWords = 4): string {
  const c = camelCase(text, maxWords);
  return c ? c[0].toUpperCase() + c.slice(1) : '';
}

/** "addToCart" -> "Add to cart" */
export function humanize(identifier: string): string {
  const w = words(identifier);
  if (!w.length) return identifier;
  const s = w.join(' ');
  return s[0].toUpperCase() + s.slice(1);
}

export function safeIdentifier(name: string, fallback: string): string {
  let n = name || fallback;
  if (RESERVED.has(n)) n = n + 'Item';
  return n;
}

/** Make `name` unique in `taken` by adding a deterministic suffix (2, 3, ...). */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  for (let i = 2; ; i++) {
    const n = `${name}${i}`;
    if (!taken.has(n)) {
      taken.add(n);
      return n;
    }
  }
}

/**
 * Break a long `x = a.b().c().d()` chain the way Prettier does:
 *   x = a
 *     .b()
 *     .c();
 * Only splits at top-level `.method(` boundaries outside strings/regex.
 */
export function wrapChain(line: string, max = 100): string {
  // trailing comments do not count (Prettier keeps them on the line)
  const codeOnly = line.replace(/;\s*\/\/.*$/, ';');
  if (codeOnly.length <= max) return line;
  const exp = wrapExpect(line, max);
  if (exp) return exp;
  const indent = /^\s*/.exec(line)![0];
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === '.' && depth === 0 && /[a-zA-Z]/.test(line[i + 1] ?? '') && i > 0 && /[)\w]/.test(line[i - 1])) {
      // split before ".getBy", ".filter", ".locator", ".nth", ".first"
      if (/^\.(getBy\w+|filter|locator|nth|first|last|frameLocator|click|fill|check|uncheck|press|hover|dblclick|selectOption|setInputFiles|dragTo|scrollIntoViewIfNeeded|toBe\w+|toHave\w+|toContain\w+|not)\(?/.test(line.slice(i))) {
        parts.push(line.slice(start, i));
        start = i;
      }
    }
  }
  parts.push(line.slice(start));
  if (parts.length < 3) return line;
  // keep `this.page` / `page` / `await expect(...)` head together with its first call
  const head = parts.shift()!;
  return [head, ...parts.map((p) => indent + '  ' + p)].join('\n');
}

/**
 * `await expect(<long locator>).toBeVisible(); // comment` ->
 *   await expect(
 *     <locator, chain-wrapped>,
 *   ).toBeVisible(); // comment
 */
function wrapExpect(line: string, max: number): string | null {
  const m = /^(\s*)(await )?expect\(/.exec(line);
  if (!m) return null;
  const start = m[0].length;
  let depth = 1;
  let quote: string | null = null;
  let end = -1;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const ind = m[1];
  const inner = line.slice(start, end);
  if (inner.length + ind.length + 4 <= 30) return null;
  const innerLine = wrapChain(ind + '  ' + inner, max);
  return `${line.slice(0, start)}\n${innerLine},\n${ind}${line.slice(end)}`;
}

/** Final pass: trim trailing spaces, collapse blank lines, wrap long chains, end with a newline. */
export function formatTs(code: string): string {
  const lines = code.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const out: string[] = [];
  for (const l of lines) {
    if (l === '' && out[out.length - 1] === '') continue;
    out.push(/^\s*\/\//.test(l) ? l : wrapChain(l));
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

export function indent(lines: string[], n: number): string[] {
  const pad = ' '.repeat(n);
  return lines.map((l) => (l ? pad + l : l));
}
