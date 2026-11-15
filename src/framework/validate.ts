import path from 'node:path';
import ts from 'typescript';
import type { GeneratedFile } from '../types';

/** Compile the proposed files at their final paths without writing them to disk. */
export function validateGenerated(files: GeneratedFile[], directory: string): void {
  const key = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const virtual = new Map(files.map(f => [key(path.join(directory, f.path)), f.content]));
  const dirs = new Set<string>();
  for (const f of files) {
    let d = path.dirname(path.resolve(directory, f.path));
    while (!dirs.has(key(d))) {
      dirs.add(key(d));
      const parent = path.dirname(d);
      if (parent === d) break;
      d = parent;
    }
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
    resolveJsonModule: true, esModuleInterop: true, skipLibCheck: true,
    noEmit: true, types: ['node'],
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  const dirExists = host.directoryExists?.bind(host);
  host.readFile = p => virtual.get(key(p)) ?? read(p);
  host.fileExists = p => virtual.has(key(p)) || exists(p);
  host.directoryExists = p => dirs.has(key(p)) || !!dirExists?.(p);
  host.getSourceFile = (p, languageVersion) => {
    const content = host.readFile(p);
    return content === undefined ? undefined : ts.createSourceFile(p, content, languageVersion);
  };
  const program = ts.createProgram(files.filter(f => f.path.endsWith('.ts')).map(f => path.resolve(directory, f.path)), options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error('Generated TypeScript validation failed:\n' + ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: p => p, getCurrentDirectory: () => directory, getNewLine: () => '\n',
  }));
}
