import fs from 'node:fs';

/** Read a text file written by any tool, including PowerShell's UTF-16 output. */
export function readTextFile(file: string): string {
  const buf = fs.readFileSync(file);
  return decodeBuffer(buf);
}

export function decodeBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

export function hasUtf16Bom(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    return (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
  } finally {
    fs.closeSync(fd);
  }
}
