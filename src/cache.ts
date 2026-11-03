export interface KV {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

interface Entry<T> {
  at: number;
  value: T;
}

export async function getFresh<T>(kv: KV, key: string, ttlMs: number, now: number = Date.now()): Promise<T | undefined> {
  const raw = await kv.get(key);
  if (!raw) return undefined;
  try {
    const entry = JSON.parse(raw) as Entry<T>;
    return now - entry.at <= ttlMs ? entry.value : undefined;
  } catch {
    return undefined;
  }
}

export async function putFresh<T>(kv: KV, key: string, value: T, now: number = Date.now()): Promise<void> {
  await kv.set(key, JSON.stringify({ at: now, value } satisfies Entry<T>));
}
