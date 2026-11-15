// Render Page Object classes from the code model.
import type { FlowModel, PageClassDef } from './model';
import { q, regexLiteral } from '../locators/render';
import { formatTs, indent } from './format';

export function renderPageClass(cls: PageClassDef, model: FlowModel): string {
  const lines: string[] = [];
  const body = cls.methods.map((m) => m.body.join('\n')).join('\n');
  const smart = [...model.smartHelpers].filter((h) => body.includes(h + '('));
  const types = new Set(['Locator', 'Page']);
  for (const m of cls.methods) if (m.returns === 'Download') types.add('Download');

  lines.push(`import { expect, ${[...types].sort().map((t) => 'type ' + t).join(', ')} } from '@playwright/test';`);
  if (smart.length) lines.push(`import { ${smart.sort().join(', ')} } from '../utils/smart';`);
  lines.push('');
  lines.push(`export class ${cls.name} {`);

  const plain = cls.props.filter((p) => !p.param);
  const scoped = cls.props.filter((p) => p.param);
  for (const p of plain) {
    if (p.weak) lines.push(`  // Warning: weak locator (score ${p.target.score}). ${p.target.warnings[0] ?? ''}`.trimEnd());
    lines.push(`  readonly ${p.name}: Locator;`);
  }
  if (plain.length) lines.push('');
  lines.push('  constructor(private readonly page: Page) {');
  for (const p of plain) lines.push(`    this.${p.name} = ${p.code.replace(/^this\.page\b/, 'page')};`);
  lines.push('  }');

  for (const p of scoped) {
    lines.push('');
    lines.push(`  /** ${p.target.describe} inside the item that contains \`${p.param}\` */`);
    lines.push(`  ${p.name}(${p.param}: string): Locator {`);
    lines.push(`    return ${p.code};`);
    lines.push('  }');
  }

  if (cls.gotoUrl !== null) {
    lines.push('');
    lines.push('  async goto() {');
    lines.push(`    await this.page.goto(${q(cls.gotoUrl)});`);
    lines.push('  }');
  }

  lines.push('');
  lines.push('  /** Readiness check used by the spec when it arrives on this page. */');
  lines.push('  async expectLoaded() {');
  const ready: string[] = [];
  if (cls.loadedUrlRegex) ready.push(`await expect(this.page).toHaveURL(${regexLiteral(cls.loadedUrlRegex)});`);
  if (cls.loadedProp) ready.push(`await expect(this.${cls.loadedProp.name}).toBeVisible();`);
  if (!ready.length) ready.push("await this.page.waitForLoadState('domcontentloaded');");
  lines.push(...indent(ready, 4));
  lines.push('  }');

  for (const m of cls.methods) {
    lines.push('');
    const sig = m.params.map((p) => `${p}: ${m.paramTypes?.[p] ?? 'string'}`).join(', ');
    const ret = m.returns ? `: Promise<${m.returns}>` : '';
    lines.push(`  async ${m.name}(${sig})${ret} {`);
    lines.push(...indent(m.body, 4));
    lines.push('  }');
  }
  lines.push('}');
  return formatTs(lines.join('\n'));
}

export const SMART_TS = `import type { Locator, Page } from '@playwright/test';

type Point = { x: number; y: number } | { rx: number; ry: number };

/** Convert a point stored as viewport ratios into pixels for the current viewport. */
function toPixels(page: Page, point: Point): { x: number; y: number } {
  if ('x' in point) return point;
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  return { x: Math.round(viewport.width * point.rx), y: Math.round(viewport.height * point.ry) };
}

/**
 * Click with the locator first. If that fails within 3 s (element missing, covered or
 * renamed), click the point that was recorded instead and log a warning.
 */
export async function clickOrAt(page: Page, locator: Locator, point: Point): Promise<void> {
  try {
    await locator.click({ timeout: 3000 });
  } catch (error) {
    const { x, y } = toPixels(page, point);
    console.warn(\`clickOrAt: locator failed (\${String(error).split('\\n')[0]}); clicking (\${x}, \${y}) instead\`);
    await page.mouse.click(x, y);
  }
}

/** Click a point stored as a ratio of the viewport (0..1), so it adapts to the viewport size. */
export async function clickAtRatio(page: Page, rx: number, ry: number): Promise<void> {
  const { x, y } = toPixels(page, { rx, ry });
  await page.mouse.click(x, y);
}

// A portable test-context clipboard. No operating-system clipboard permissions are needed.
const copiedValues = new WeakMap<object, string>();
export async function copyText(page: Page, locator: Locator): Promise<void> {
  const value = await locator.evaluate(el => 'value' in el ? String((el as HTMLInputElement).value) : (el as HTMLElement).innerText ?? el.textContent ?? '');
  copiedValues.set(page.context(), value);
}
export async function pasteText(page: Page, locator: Locator): Promise<void> {
  const value = copiedValues.get(page.context());
  if (value === undefined) throw new Error('Recorder clipboard is empty: execute Copy value/text first.');
  await locator.fill(value);
}
`;
