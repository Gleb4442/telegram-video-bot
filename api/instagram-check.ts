import { timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import { getConfig } from "../src/config.js";
import { resolveInstagramDirect } from "../src/services/resolvers/instagram.js";
import { downloadMedia } from "../src/services/download.js";
import { ResolverError } from "../src/types/resolver.js";
import type { VercelRequest, VercelResponse } from "../src/types/vercel.js";

/** Private operational check: verifies extraction + file transfer on Vercel, sends no Telegram messages. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = Buffer.from(getConfig().TELEGRAM_SECRET_TOKEN);
  const supplied = req.headers["x-telegram-bot-api-secret-token"];
  const incoming = Buffer.from(typeof supplied === "string" ? supplied : "");
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected))
    return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const body = req.body;
  if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string" || body.url.length > 1000)
    return res.status(400).json({ error: "Invalid URL" });
  const started = Date.now();
  try {
    const media = await resolveInstagramDirect(body.url);
    const file = await downloadMedia(media.directUrl, 50_000_000, 25000);
    try {
      const handle = await open(file.path, "r");
      let mp4 = false;
      try {
        const buffer = Buffer.alloc(12);
        await handle.read(buffer, 0, buffer.length, 0);
        mp4 = buffer.toString("ascii", 4, 8) === "ftyp";
      } finally { await handle.close(); }
      return res.status(200).json({ ok: true, bytes: file.bytes, mp4, elapsed_ms: Date.now() - started });
    } finally { await file.cleanup(); }
  } catch (error) {
    return res.status(422).json({ ok: false, code: error instanceof ResolverError ? error.code : "DOWNLOAD_FAILED", elapsed_ms: Date.now() - started });
  }
}
