import { resolveInstagramDirect } from "../src/services/resolvers/instagram.js";
import { downloadMedia } from "../src/services/download.js";
import { ResolverError } from "../src/types/resolver.js";
import { execFileSync } from "node:child_process";

for (const id of ["DeXA5froeiC", "Dd-4gKENRms"]) {
  const started = Date.now();
  try {
    const media = await resolveInstagramDirect(`https://www.instagram.com/reel/${id}/`);
    const file = await downloadMedia(media.directUrl, 50_000_000, 60_000);
    try {
      const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height", "-of", "json", file.path], { encoding: "utf8" }));
      console.log(JSON.stringify({ id, ok: true, elapsed_ms: Date.now() - started, media: probe }));
    } finally { await file.cleanup(); }
  } catch (error) {
    console.log(JSON.stringify({ id, ok: false, elapsed_ms: Date.now() - started, code: error instanceof ResolverError ? error.code : "DOWNLOAD_FAILED" }));
  }
}
