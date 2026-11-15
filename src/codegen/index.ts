// Entry point: steps -> generated files (spec, page objects, fixtures, helpers).
import type { GeneratedFile, GenerateOptions, Step } from '../types';
import { buildModel, type FlowModel } from './model';
import { renderPageClass, SMART_TS } from './pageObjects';
import { renderSpec } from './spec';
import { words } from './format';

export function defaultFlowName(steps: Step[]): string {
  const verbs = steps
    .filter((s) => s.kind !== 'goto' && s.target && ['click', 'fill', 'select', 'check'].includes(s.kind))
    .map((s) => (s.kind === 'click' ? s.target!.name || s.target!.text : ''))
    .filter((n) => n && words(n).length <= 4)
    .slice(0, 3)
    .map((n) => n.toLowerCase());
  if (!verbs.length) return 'recorded flow';
  return 'user can ' + verbs.join(', then ');
}

export function generate(steps: Step[], opts: GenerateOptions): { files: GeneratedFile[]; model: FlowModel } {
  const model = buildModel(steps, opts);
  const files: GeneratedFile[] = [];
  const stepCount = steps.filter((s) => s.kind !== 'goto').length;
  files.push({ path: `specs/${model.slug}.spec.ts`, content: renderSpec(model, stepCount, opts.stepGroupThreshold ?? 8) });
  if (opts.style === 'pom') for (const cls of model.classes) files.push({ path: `pages/${cls.name}.ts`, content: renderPageClass(cls, model) });
  if (Object.keys(model.data).length) files.push({ path: `fixtures/${model.slug}.data.json`, content: JSON.stringify(model.data, null, 2) + '\n' });
  if (model.smartHelpers.size) files.push({ path: 'utils/smart.ts', content: SMART_TS });
  for (const a of model.assets) files.push({ path: `assets/${a}`, content: `placeholder for ${a}: replace with a real file\n` });
  return { files, model };
}
