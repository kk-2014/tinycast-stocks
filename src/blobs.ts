const START = /AF_initDataCallback\(\{key: 'ds:\d+', hash: '\d+', data:/g;

/** Slice the JSON array that starts at `start`, honouring strings and escapes. */
function sliceJsonArray(s: string, start: number): string | null {
  if (s[start] !== "[") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Decode every AF_initDataCallback data blob in a Google Finance page. */
export function extractBlobs(html: string): unknown[] {
  const blobs: unknown[] = [];
  START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START.exec(html))) {
    const json = sliceJsonArray(html, m.index + m[0].length);
    if (json === null) continue;
    try {
      blobs.push(JSON.parse(json));
    } catch {
      // A malformed blob is skipped; the parser reports a layout failure if nothing usable remains.
    }
  }
  return blobs;
}

/** Depth-first walk yielding every array nested in `value`, including `value` itself. */
export function* walk(value: unknown): Generator<unknown[]> {
  if (!Array.isArray(value)) return;
  yield value;
  for (const child of value) yield* walk(child);
}
