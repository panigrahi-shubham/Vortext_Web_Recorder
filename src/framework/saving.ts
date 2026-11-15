import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../codegen';
import { slug } from '../codegen/naming';
import { recordingFile } from '../commands/recording';
import { saveFiles, type SaveEntry } from '../codegen/save';
import type { GenerateOptions, GeneratedFile, Step } from '../types';
import { moduleDirectory } from './modules';
import { validateGenerated } from './validate';

export function recordingDestination(root: string, module: string, name: string): string {
  const base = moduleDirectory(root, module);
  if (!name.trim() || name.trim() === 'recorded flow') throw new Error('Enter a test case name before saving.');
  const flow = slug(name);
  if (!flow || flow === '.' || flow === '..') throw new Error('Enter a meaningful test case name.');
  return path.join(base, flow);
}

export function frameworkPreview(root: string, module: string, steps: Step[], options: GenerateOptions) {
  const directory = recordingDestination(root, module, options.flowName);
  const gen = { ...options, outDirFromCwd: path.relative(root, directory).replace(/\\/g, '/') };
  return { directory, options: gen, files: generate(steps, gen).files };
}

export function saveRecording(root: string, module: string, steps: Step[], options: GenerateOptions, editedFiles?: GeneratedFile[]): { file: string; entries: SaveEntry[] } {
  if (steps.length < 2) throw new Error('Record an action or assertion before saving a test.');
  const preview = frameworkPreview(root, module, steps, options);
  const generated = editedFiles ?? preview.files;
  if (generated.some(f => !preview.files.some(p => p.path === f.path))) throw new Error('Code edits must target an existing generated file.');
  const files = [...generated, recordingFile(steps, preview.options)];
  validateGenerated(generated, preview.directory);
  // Each recording owns its Page Objects and fixtures. Never overwrite another flow.
  if (fs.existsSync(preview.directory)) throw new Error('A recording with this name already exists in this module. Choose a new test name; edit the saved files directly to maintain an existing test.');
  fs.mkdirSync(preview.directory); // exclusive creation also prevents two panels racing
  const entries = saveFiles(files, preview.directory, { cwd: root });
  return { file: path.join(preview.directory, 'specs', `${slug(options.flowName)}.spec.ts`), entries };
}
