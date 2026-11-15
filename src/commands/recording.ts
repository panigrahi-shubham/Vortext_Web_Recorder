// Extra feature: every Save also writes the recorded steps as JSON (secrets removed), so the
// code can be regenerated later with other options without recording again.
//   npx tsx src/cli.ts generate --from tests/recordings/my-flow.recording.json --style flat
import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../codegen/index';
import { slug } from '../codegen/naming';
import { formatSaveReport, saveFiles } from '../codegen/save';
import type { GeneratedFile, GenerateOptions, Step } from '../types';
import { readTextFile } from '../util/files';

export interface RecordingFile {
  tool: 'tphub-web-recorder';
  version: 1;
  savedAt: string;
  options: GenerateOptions;
  steps: Step[];
}

/** Remove secret values so the recording can be committed safely. */
export function stripSecrets(steps: Step[]): Step[] {
  return steps.map((s) => (s.secret ? { ...s, value: '' } : s));
}

export function recordingFile(steps: Step[], options: GenerateOptions): GeneratedFile {
  const body: RecordingFile = { tool: 'tphub-web-recorder', version: 1, savedAt: new Date().toISOString(), options, steps: stripSecrets(steps) };
  return { path: `recordings/${slug(options.flowName)}.recording.json`, content: JSON.stringify(body, null, 2) + '\n' };
}

export function loadRecording(file: string): RecordingFile {
  if (!fs.existsSync(file)) throw new Error(`Recording not found: ${file}`);
  const data = JSON.parse(readTextFile(file)) as RecordingFile;
  if (data.tool !== 'tphub-web-recorder' || !Array.isArray(data.steps)) throw new Error(`${file} is not a TPHub recording`);
  return data;
}

export function runGenerate(opts: { from: string; out?: string; style?: 'pom' | 'flat'; name?: string; overwrite: boolean; baseURL?: string; keepSecrets?: boolean }): string {
  const rec = loadRecording(opts.from);
  const options: GenerateOptions = {
    ...rec.options,
    ...(opts.style ? { style: opts.style } : {}),
    ...(opts.name ? { flowName: opts.name } : {}),
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
  };
  const outDir = path.resolve(opts.out ?? path.join(path.dirname(path.resolve(opts.from)), '..'));
  const { files } = generate(rec.steps, options);
  const entries = saveFiles(files, outDir, { overwrite: opts.overwrite });
  return formatSaveReport(entries);
}
