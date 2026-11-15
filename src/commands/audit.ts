// Extra feature: `audit <dir>` scans existing Playwright specs/page objects for the
// patterns this recorder avoids (fixed waits, XPath, $ / $$, nth(), CSS classes...).
import fs from 'node:fs';
import path from 'node:path';
import { readTextFile } from '../util/files';
import { looksGenerated, looksUtilityClass } from '../locators/rank';

export interface Finding {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  text: string;
  fix: string;
}

interface Rule {
  id: string;
  severity: Finding['severity'];
  test: (line: string) => boolean;
  fix: string;
}

const RULES: Rule[] = [
  { id: 'fixed-wait', severity: 'error', test: (l) => /\bwaitForTimeout\s*\(/.test(l), fix: 'Wait for a state instead: await expect(locator).toBeVisible() or toHaveURL()' },
  { id: 'element-handle', severity: 'error', test: (l) => /\bpage\.\$\$?\(|\.\$eval\(|\.\$\$eval\(/.test(l), fix: 'Use page.locator()/getBy* locators; they auto-wait and re-resolve' },
  { id: 'wait-for-selector', severity: 'warning', test: (l) => /\.waitForSelector\(/.test(l), fix: 'Use a web-first assertion: await expect(locator).toBeVisible()' },
  { id: 'absolute-xpath', severity: 'error', test: (l) => /['"`](?:xpath=)?\/html\//.test(l) || /['"`]\/\/(?:div|span|a|button|input)\[\d+\]/.test(l), fix: 'Use getByRole/getByLabel/getByTestId; absolute XPath breaks on any layout change' },
  { id: 'xpath', severity: 'warning', test: (l) => /locator\(\s*['"`](?:xpath=|\/\/)/.test(l), fix: 'Prefer getByRole(name) or a test id over XPath' },
  { id: 'nth', severity: 'warning', test: (l) => /\.(nth\(\d+\)|first\(\)|last\(\))/.test(l), fix: 'Scope by a unique row text: .filter({ hasText: "..." }) instead of position' },
  { id: 'non-web-first', severity: 'warning', test: (l) => /expect\(\s*await\s+.*?\.(isVisible|textContent|innerText|isChecked|count)\(\)/.test(l), fix: 'Use web-first assertions that retry: expect(locator).toBeVisible()/toHaveText()/toHaveCount()' },
  { id: 'force-click', severity: 'warning', test: (l) => /force:\s*true/.test(l), fix: 'force skips actionability checks and hides real bugs; fix the overlay or wait for it to disappear' },
  { id: 'hardcoded-secret', severity: 'error', test: (l) => /(password|passwd|secret|token|apikey|api_key)\w*['"]?\s*[:=,]\s*['"][^'"<]{4,}['"]/i.test(l) && !/process\.env/.test(l), fix: 'Read secrets from environment variables or a gitignored file' },
];

function cssClassFindings(line: string): string[] {
  const out: string[] = [];
  const re = /locator\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    for (const cls of m[1].match(/\.[A-Za-z_][\w-]*/g) ?? []) {
      const name = cls.slice(1);
      if (looksGenerated(name) || looksUtilityClass(name)) out.push(name);
    }
  }
  return out;
}

export function auditText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const r of RULES) {
      if (r.test(code)) findings.push({ file, line: i + 1, rule: r.id, severity: r.severity, text: line.trim().slice(0, 140), fix: r.fix });
    }
    for (const cls of cssClassFindings(code)) {
      findings.push({ file, line: i + 1, rule: 'unstable-class', severity: 'warning', text: line.trim().slice(0, 140), fix: `".${cls}" looks generated or utility-only; use a role, label or test id` });
    }
  });
  return findings;
}

export function auditPath(target: string): Finding[] {
  const files: string[] = [];
  const walk = (p: string) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f !== 'node_modules' && !f.startsWith('.')) walk(path.join(p, f));
    } else if (/\.(ts|js|mjs|cjs)$/.test(p) && !p.endsWith('.d.ts')) files.push(p);
  };
  if (!fs.existsSync(target)) throw new Error(`Path not found: ${target}`);
  walk(target);
  return files.flatMap((f) => auditText(path.relative(process.cwd(), f) || f, readTextFile(f)));
}

export function formatFindings(findings: Finding[]): string {
  if (!findings.length) return 'No problems found.';
  const lines = findings.map((f) => `${f.file}:${f.line}  [${f.severity}] ${f.rule}\n    ${f.text}\n    fix: ${f.fix}`);
  const errors = findings.filter((f) => f.severity === 'error').length;
  return lines.join('\n') + `\n\n${findings.length} finding(s), ${errors} error(s).`;
}
