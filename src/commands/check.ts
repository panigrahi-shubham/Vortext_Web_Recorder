// `check <snapshot.html>`: print the locator the recorder would choose for every
// interactive element of a saved page, with its score and alternatives.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Frame, type Page } from 'playwright';
import { buildInitScript } from '../recorder/inject';
import { chooseLocator } from '../locators/verify';
import { scoreColor } from '../locators/rank';
import { hasUtf16Bom, readTextFile } from '../util/files';
import type { ElementDescriptor, LocatorChoice } from '../types';

export interface CheckOptions {
  selector?: string;
  testIdAttr: string;
  allowCss: boolean;
  json?: boolean;
  alternatives?: number;
}

export interface CheckResult {
  element: string;
  frame: string;
  choice: LocatorChoice;
}

const COLORS = { green: '\x1b[32m', amber: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' };

export async function loadSnapshotPage(page: Page, input: string): Promise<void> {
  if (/^https?:\/\//i.test(input)) {
    await page.goto(input, { waitUntil: 'load' });
    return;
  }
  const file = path.resolve(input);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}. Pass the path to a saved .html file (quote it if it contains spaces).`);
  if (hasUtf16Bom(file)) {
    // PowerShell (Out-File / >) writes UTF-16: decode it ourselves.
    await page.setContent(readTextFile(file), { waitUntil: 'load' });
  } else {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  }
}

export async function analyzeFrame(frame: Frame, opts: CheckOptions): Promise<CheckResult[]> {
  const hasTphub = await frame.evaluate('!!window.__tphub').catch(() => false);
  if (!hasTphub) return [];
  const expr = opts.selector
    ? `window.__tphub.deepAll(document, ${JSON.stringify(opts.selector)}).filter(e => !window.__tphub.isOwnUi(e)).map(e => window.__tphub.describe(e, true))`
    : `window.__tphub.interactiveElements().map(e => window.__tphub.describe(e, true))`;
  const descriptors = (await frame.evaluate(expr)) as ElementDescriptor[];
  const out: CheckResult[] = [];
  for (const d of descriptors) {
    const choice = await chooseLocator(frame, d, { allowCss: opts.allowCss });
    const label = `<${d.tag}${d.inputType ? ` type=${d.inputType}` : ''}> ${d.name || d.text || d.placeholder || ''}`.trim();
    out.push({ element: label.slice(0, 70), frame: frame.parentFrame() ? frame.url() : 'main', choice });
  }
  return out;
}

export function formatResults(results: CheckResult[], alternatives = 3, color = true): string {
  const c = (k: keyof typeof COLORS, s: string) => (color ? COLORS[k] + s + COLORS.reset : s);
  const lines: string[] = [];
  results.forEach((r, i) => {
    const b = r.choice.best;
    const col = scoreColor(b.score);
    lines.push(`${String(i + 1).padStart(2)}. ${r.element}${r.frame !== 'main' ? c('dim', `  [frame ${r.frame}]`) : ''}`);
    const code = b.kind === 'coords' ? '(no unique locator: coordinate click)' : b.code;
    lines.push(`    ${c(col, `[${String(b.score).padStart(3)}]`)} ${code}`);
    for (const w of b.warnings) lines.push(`          ${c('amber', '! ' + w)}`);
    const alts = r.choice.alternatives.filter((a) => a.kind !== 'coords').slice(0, alternatives);
    for (const a of alts) {
      const why = a.usable ? '' : ` (${a.warnings[a.warnings.length - 1] ?? 'not unique'})`;
      lines.push(c('dim', `          ${String(a.score).padStart(3)}  ${a.code}${why}`));
    }
  });
  return lines.join('\n');
}

export async function runCheck(input: string, opts: CheckOptions): Promise<CheckResult[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    if (opts.testIdAttr !== 'data-testid') {
      const { selectors } = await import('playwright');
      selectors.setTestIdAttribute(opts.testIdAttr);
    }
    await context.addInitScript({ content: buildInitScript({ testIdAttr: opts.testIdAttr, capture: false, ui: false }) });
    const page = await context.newPage();
    await loadSnapshotPage(page, input);
    // setContent bypasses init scripts on some navigations: make sure the helpers exist.
    for (const f of page.frames()) {
      const ok = await f.evaluate('!!window.__tphub').catch(() => true);
      if (!ok) await f.evaluate(buildInitScript({ testIdAttr: opts.testIdAttr, capture: false, ui: false })).catch(() => {});
    }
    const results: CheckResult[] = [];
    for (const f of page.frames()) results.push(...(await analyzeFrame(f, opts)));
    return results;
  } finally {
    await browser.close();
  }
}
