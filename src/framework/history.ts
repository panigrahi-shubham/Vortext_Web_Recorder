import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunSelection } from './runner';

export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'interrupted';
  exitCode?: number;
  selection: RunSelection;
  htmlReport: boolean;
}

export function runDirectory(root: string, id: string): string {
  if (!/^[0-9TZ.-]+_[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid run ID. Use vortex-qa history to find a run.');
  const directory = path.join(root, 'reports', 'history', id);
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('Run directories must not be symbolic links.');
  return directory;
}

function persist(root: string, record: RunRecord): void {
  const directory = runDirectory(root, record.id);
  const temporary = path.join(directory, 'run.json.tmp');
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(temporary, path.join(directory, 'run.json'));
}

export function beginRun(root: string, selection: RunSelection): RunRecord {
  const startedAt = new Date().toISOString();
  const record: RunRecord = { id: `${startedAt.replace(/:/g, '-')}_${randomUUID()}`, startedAt, status: 'running', selection, htmlReport: false };
  fs.mkdirSync(runDirectory(root, record.id), { recursive: true });
  persist(root, record);
  return record;
}

export function finishRun(root: string, record: RunRecord, code: number, output: string): void {
  const directory = runDirectory(root, record.id);
  fs.writeFileSync(path.join(directory, 'output.log'), output);
  record.finishedAt = new Date().toISOString();
  record.exitCode = code;
  record.status = code === 0 ? 'passed' : code === 130 ? 'interrupted' : 'failed';
  record.htmlReport = fs.existsSync(path.join(directory, 'html', 'index.html'));
  persist(root, record);
  // Only publish freshly produced native reports. Custom configs may ignore VORTEX_REPORT_DIR.
  if (record.htmlReport) {
    const latest = path.join(root, 'reports', 'latest');
    fs.rmSync(latest, { recursive: true, force: true });
    fs.cpSync(directory, latest, { recursive: true });
  }
}

export function listRuns(root: string): RunRecord[] {
  const directory = path.join(root, 'reports', 'history');
  if (!fs.existsSync(directory)) return [];
  const records: RunRecord[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(runDirectory(root, entry.name), 'run.json'), 'utf8')) as RunRecord;
      if (record.id === entry.name && typeof record.startedAt === 'string' && ['running', 'passed', 'failed', 'interrupted'].includes(record.status)) records.push(record);
    } catch { /* An incomplete or unrelated directory must not hide valid runs. */ }
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
}

export function reportDirectory(root: string, id: string): string {
  const record = listRuns(root).find(run => run.id === id);
  if (!record) throw new Error('Run not found. Use vortex-qa history to find a run.');
  const directory = path.join(runDirectory(root, id), 'html');
  if (!fs.existsSync(path.join(directory, 'index.html'))) throw new Error('This run has no HTML report. Its output.log is retained; custom Playwright configs must honor VORTEX_REPORT_DIR to preserve native reports.');
  return directory;
}
