// Render the spec file from the code model.
import type { FlowModel } from './model';
import { q } from '../locators/render';
import { envVarName } from './naming';
import { formatTs, indent } from './format';

const HOIST = /^const (\w+) = (await .+|new (\w+)\(.+\));$/;

export function renderSpec(model: FlowModel, stepCount: number, threshold = 8): string {
  const lines: string[] = [];
  const useSteps = stepCount > threshold && model.blocks.length > 1;
  const specTypes = new Set<string>();

  // hoist popup/page-object declarations when blocks become test.step callbacks
  const hoisted: string[] = [];
  const blocks = model.blocks.map((b) => {
    if (!useSteps) return b;
    return {
      title: b.title,
      lines: b.lines.map((l) => {
        const m = HOIST.exec(l);
        if (!m || /^download\d*$/.test(m[1]) || /Promise$/.test(m[1])) return l;
        const type = m[3] ?? 'Page';
        if (type === 'Page') specTypes.add('Page');
        hoisted.push(`let ${m[1]}: ${type};`);
        return `${m[1]} = ${m[2]};`;
      }),
    };
  });

  // unique `download` names in one scope
  let dl = 0;
  for (const b of blocks) {
    b.lines = b.lines.map((l) => {
      if (/^const download = /.test(l)) {
        dl++;
        return dl === 1 ? l : l.replace('const download =', `const download${dl} =`);
      }
      if (dl > 1 && /^expect\(download\.suggestedFilename/.test(l)) return l.replace('download.', `download${dl}.`);
      return l;
    });
  }

  lines.push(`import { expect, test${[...specTypes].map((t) => ', type ' + t).join('')} } from '@playwright/test';`);
  if (model.usesAxe) lines.push("import AxeBuilder from '@axe-core/playwright';");
  if (model.style === 'pom') {
    const used = new Set(model.topInstances.map((i) => i.cls));
    for (const b of model.blocks) for (const l of b.lines) for (const c of model.classes) if (l.includes(`new ${c.name}(`)) used.add(c.name);
    for (const c of [...used].sort()) lines.push(`import { ${c} } from '../pages/${c}';`);
  }
  if (model.smartHelpers.size && model.style === 'flat') lines.push(`import { ${[...model.smartHelpers].sort().join(', ')} } from '../utils/smart';`);
  if (Object.keys(model.data).length) lines.push(`import data from '../fixtures/${model.slug}.data.json';`);
  lines.push('');
  if (model.secrets.length) {
    lines.push('// Secrets are not stored in the fixtures file. Set them before running, for example in PowerShell:');
    for (const k of model.secrets) lines.push(`//   $env:${envVarName(k)} = '...'`);
  }
  const use = [`viewport: { width: ${model.viewport.width}, height: ${model.viewport.height} }`];
  if (model.testIdAttr) use.push(`testIdAttribute: ${q(model.testIdAttr)}`);
  if (model.storageState) use.push(`storageState: ${q(model.storageState)}`);
  if (model.storageState) lines.push('// Recorded while logged in: reuses the saved login state (refresh it with --save-state).');
  lines.push(`test.use({ ${use.join(', ')} });`);
  lines.push('');
  lines.push(`test(${q(model.title)}, async ({ page }) => {`);
  const body: string[] = [];
  for (const i of model.topInstances) body.push(`const ${i.varName} = new ${i.cls}(page);`);
  body.push(...hoisted);
  if (body.length) body.push('');
  blocks.forEach((b, i) => {
    if (useSteps) {
      body.push(`await test.step(${q(b.title)}, async () => {`);
      body.push(...indent(b.lines, 2));
      body.push('});');
    } else body.push(...b.lines);
    if (i < blocks.length - 1) body.push('');
  });
  lines.push(...indent(body, 2));
  lines.push('});');
  return formatTs(lines.join('\n'));
}
