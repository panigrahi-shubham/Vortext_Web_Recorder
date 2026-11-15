/** Minimal argv parser: --flag, --key value, --key=value, positionals. */
export interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export function str(args: ParsedArgs, key: string, fallback?: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : fallback;
}

export function bool(args: ParsedArgs, key: string): boolean {
  const v = args[key];
  return v === true || v === 'true' || v === '1';
}

export function parseViewport(s: string | undefined): { width: number; height: number } {
  const m = /^(\d{2,5})\s*[x×,]\s*(\d{2,5})$/i.exec((s ?? '1280x720').trim());
  if (!m) throw new Error(`Invalid --viewport "${s}". Use WIDTHxHEIGHT, for example --viewport 1280x720`);
  return { width: Number(m[1]), height: Number(m[2]) };
}
