/** Code emitters. Pure string functions: Step / Candidate in, Playwright TypeScript or Selenium Java out. */
import { cssAttr, cssEscape } from './ctx';
import type { Candidate, Step, TextMatch } from './types';

export type Format = 'playwright' | 'selenium';

export function tsString(s: string): string {
  if (s.includes("'") && !s.includes('"') && !s.includes('\\')) return `"${s.replace(/\n/g, '\\n')}"`;
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

export function javaString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function tsMatch(m: TextMatch): string {
  return m.kind === 'regex' ? `/${m.source.replace(/\//g, '\\/')}/${m.flags}` : tsString(m.value);
}

function textArgs(m: TextMatch): string {
  return m.kind === 'string' && m.exact ? `${tsMatch(m)}, { exact: true }` : tsMatch(m);
}

/** A single Playwright locator call, without the leading "page.". */
export function pwStep(step: Step): string {
  switch (step.kind) {
    case 'testid':
      // getByTestId only works out of the box for data-testid; other attributes stay explicit CSS.
      return step.attr === 'data-testid'
        ? `getByTestId(${tsString(step.value)})`
        : `locator(${tsString(`[${step.attr}=${cssAttr(step.value)}]`)})`;
    case 'id':
      return `locator(${tsString(`#${cssEscape(step.id)}`)})`;
    case 'nameAttr':
      return `locator(${tsString(`${step.tag}[name=${cssAttr(step.value)}]`)})`;
    case 'role': {
      if (!step.name) return `getByRole(${tsString(step.role)})`;
      const exact = step.name.kind === 'string' && step.name.exact ? ', exact: true' : '';
      return `getByRole(${tsString(step.role)}, { name: ${tsMatch(step.name)}${exact} })`;
    }
    case 'label':
      return `getByLabel(${textArgs(step.text)})`;
    case 'placeholder':
      return `getByPlaceholder(${textArgs(step.text)})`;
    case 'alt':
      return `getByAltText(${textArgs(step.text)})`;
    case 'title':
      return `getByTitle(${textArgs(step.text)})`;
    case 'text':
      return `getByText(${textArgs(step.text)})`;
    case 'css':
      return `locator(${tsString(step.selector)})`;
    case 'xpath':
      return `locator(${tsString(step.expr.startsWith('(') ? `xpath=${step.expr}` : step.expr)})`;
  }
}

export function codeFor(c: Candidate, format: Format): string | null {
  return format === 'playwright' ? c.playwright : c.selenium;
}

/** Best candidate that has a form in the requested format. */
export function bestFor(candidates: Candidate[], format: Format, preferred = 0): Candidate | null {
  const chosen = candidates[preferred];
  if (chosen && codeFor(chosen, format)) return chosen;
  return candidates.find((c) => codeFor(c, format)) ?? null;
}

export interface PomItem {
  name: string;
  candidate: Candidate | null;
}

export function pageObjectTs(className: string, items: PomItem[]): string {
  const fields: string[] = [];
  const inits: string[] = [];
  const methods: string[] = [];
  for (const { name, candidate } of items) {
    if (!candidate) {
      methods.push(`  // ${name}: no Playwright locator available`);
      continue;
    }
    if (candidate.param) {
      methods.push(
        `  /** e.g. ${name}(${tsString(candidate.param.sample)}) */\n` +
          `  ${name}(text: string): Locator {\n    return ${candidate.param.playwright};\n  }`,
      );
    } else {
      fields.push(`  readonly ${name}: Locator;`);
      inits.push(`    this.${name} = ${candidate.playwright};`);
    }
  }
  const out = [
    `import { type Locator, type Page } from '@playwright/test';`,
    ``,
    `export class ${className} {`,
    `  readonly page: Page;`,
    ...fields,
    ``,
    `  constructor(page: Page) {`,
    `    this.page = page;`,
    ...inits,
    `  }`,
  ];
  if (methods.length) out.push('', methods.join('\n\n'));
  out.push('}', '');
  return out.join('\n');
}

export function pageObjectJava(className: string, items: PomItem[]): string {
  const fields: string[] = [];
  const methods: string[] = [];
  for (const { name, candidate } of items) {
    const by = candidate?.selenium ?? null;
    if (!candidate || !by) {
      fields.push(`    // ${name}: no Selenium locator (element is inside shadow DOM or needs a role-based lookup)`);
      continue;
    }
    if (candidate.param?.selenium) {
      methods.push(
        `    /** e.g. ${name}(${javaString(candidate.param.sample)}) */\n` +
          `    public WebElement ${name}(String text) {\n        return driver.findElement(${candidate.param.selenium});\n    }`,
      );
    } else {
      fields.push(`    private final By ${name} = ${by};`);
      methods.push(`    public WebElement ${name}() {\n        return driver.findElement(${name});\n    }`);
    }
  }
  return [
    `import org.openqa.selenium.By;`,
    `import org.openqa.selenium.WebDriver;`,
    `import org.openqa.selenium.WebElement;`,
    ``,
    `public class ${className} {`,
    `    private final WebDriver driver;`,
    ``,
    ...fields,
    ``,
    `    public ${className}(WebDriver driver) {`,
    `        this.driver = driver;`,
    `    }`,
    ``,
    methods.join('\n\n'),
    `}`,
    ``,
  ].join('\n');
}
