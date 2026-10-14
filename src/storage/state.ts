import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
import { getConfig } from "../config.js";
import { MemoryCache } from "../utils/cache.js";

export interface Preferences {
  cleanMode: boolean;
  asDocument: boolean;
}
const defaults = (): Preferences => ({ cleanMode: false, asDocument: false });
const memory = new MemoryCache<Preferences>(5000, 24 * 3600 * 1000);
let connection: Redis | undefined;
export async function redis() {
  const config = getConfig();
  if (!config.UPSTASH_REDIS_REST_URL || !config.UPSTASH_REDIS_REST_TOKEN)
    return null;
  connection ??= new Redis({
    url: config.UPSTASH_REDIS_REST_URL,
    token: config.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
    retry: false,
    signal: () => AbortSignal.timeout(5000),
  });
  const c = connection;
  return {
    get: (key: string) => c.get<string>(key),
    eval: (script: string, options: { keys: string[]; arguments: string[] }) =>
      c.eval(script, options.keys, options.arguments),
    sIsMember: (key: string, member: string) => c.sismember(key, member),
    sAdd: (key: string, member: string) => c.sadd(key, member),
    expire: (key: string, seconds: number) => c.expire(key, seconds),
    set: (key: string, value: string, seconds: number) =>
      c.set(key, value, { ex: seconds }),
  };
}
export async function closeState() {
  connection = undefined;
}
export function namespace() {
  return `tvb:{${createHash("sha256").update(getConfig().TELEGRAM_BOT_TOKEN.split(":")[0]!).digest("hex").slice(0, 16)}}:`;
}
export async function preferences(id: number): Promise<Preferences> {
  const client = await redis();
  if (!client) return memory.get(String(id)) ?? defaults();
  const raw = await client.get(`${namespace()}prefs:${id}`);
  return raw ? (JSON.parse(raw) as Preferences) : defaults();
}
export async function togglePreference(
  id: number,
  field: keyof Preferences,
  updateId?: number,
): Promise<Preferences> {
  const client = await redis();
  if (!client) {
    const p = await preferences(id);
    p[field] = !p[field];
    memory.set(String(id), p);
    return p;
  }
  const raw = await client.eval(
    `if ARGV[2]~='' then local old=redis.call('GET',KEYS[2]); if old then return old end end; local p=cjson.decode(redis.call('GET',KEYS[1]) or '{"cleanMode":false,"asDocument":false}'); p[ARGV[1]]=not p[ARGV[1]]; local out=cjson.encode(p); redis.call('SET',KEYS[1],out); if ARGV[2]~='' then redis.call('SET',KEYS[2],out,'EX',604800) end; return out`,
    {
      keys: [
        `${namespace()}prefs:${id}`,
        `${namespace()}toggle:${updateId ?? 0}`,
      ],
      arguments: [field, updateId === undefined ? "" : String(updateId)],
    },
  );
  return JSON.parse(String(raw)) as Preferences;
}

export async function quota(id: number, updateId: number): Promise<boolean> {
  const c = await redis();
  if (!c) {
    const key = `rate:${id}`;
    const current = rateMemory.get(key) ?? 0;
    if (current >= 10) return false;
    rateMemory.set(key, current + 1);
    return true;
  }
  const p = namespace();
  return (
    Number(
      await c.eval(
        `
    local existing=redis.call('GET',KEYS[1]); if existing then return tonumber(existing) end
    local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],60) end
    local g=redis.call('INCR',KEYS[3]); if g==1 then redis.call('EXPIRE',KEYS[3],60) end
    local allow=1; if n>10 or g>120 then allow=0 end
    redis.call('SET',KEYS[1],allow,'EX',604800); return allow`,
        {
          keys: [p + `admit:${updateId}`, p + `rate:${id}`, p + "rate:global"],
          arguments: [],
        },
      ),
    ) === 1
  );
}
const rateMemory = new MemoryCache<number>(5000, 60000);

export async function checkpoint<T>(
  id: number,
  part: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  const c = await redis();
  const key = `${namespace()}sent:${id}`;
  if (c && (await c.sIsMember(key, part))) return undefined;
  const result = await action();
  if (c) {
    await c.sAdd(key, part);
    await c.expire(key, 604800);
  }
  return result;
}
