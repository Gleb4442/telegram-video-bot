import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { publicMediaUrl, isPublicAddress } from "../utils/urls.js";

export class MediaSizeError extends Error {}
/** All DNS answers are validated, then the connection is pinned to an approved IP. */
export function mediaAgent() {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        lookup(hostname, { all: true })
          .then((addresses) => {
            if (
              !addresses.length ||
              addresses.some((a) => !isPublicAddress(a.address))
            )
              throw new Error("Non-public media destination");
            if (typeof options === "object" && options.all)
              callback(null, addresses as any);
            else {
              const a = addresses[0]!;
              callback(null, a.address, a.family);
            }
          })
          .catch((err) => callback(err, "", 4));
      },
    },
  });
}
export async function downloadMedia(
  url: string,
  maxBytes: number,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  const directory = await mkdtemp(join(tmpdir(), "tvb-media-"));
  const path = join(directory, "media");
  const agent = mediaAgent();
  const signal = externalSignal
    ? AbortSignal.any([AbortSignal.timeout(timeoutMs), externalSignal])
    : AbortSignal.timeout(timeoutMs);
  let bytes = 0;
  try {
    let target = publicMediaUrl(url);
    for (let hop = 0; hop <= 5; hop++) {
      const response = await request(target, {
        dispatcher: agent,
        method: "GET",
        signal,
        headersTimeout: Math.min(timeoutMs, 30000),
        bodyTimeout: 30000,
        headers: { "user-agent": "Mozilla/5.0", "accept-encoding": "identity" },
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.body.destroy();
        const location = response.headers.location;
        if (!location || hop === 5) throw new Error("Invalid media redirect");
        target = publicMediaUrl(new URL(String(location), target).href);
        continue;
      }
      if (response.statusCode !== 200) {
        response.body.destroy();
        throw new Error(`Media HTTP ${response.statusCode}`);
      }
      const declared = Number(response.headers["content-length"]);
      const contentType = String(response.headers["content-type"] ?? "").split(
        ";",
      )[0]!;
      if (declared > maxBytes) {
        response.body.destroy();
        throw new MediaSizeError(
          `File exceeds ${Math.floor(maxBytes / 1000000)} MB`,
        );
      }
      if (/(text\/|json|xml|mpegurl)/i.test(contentType)) {
        response.body.destroy();
        throw new Error(
          "Source returned a page or playlist instead of a media file",
        );
      }
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(
            bytes > maxBytes
              ? new MediaSizeError("File exceeds upload limit")
              : null,
            chunk,
          );
        },
      });
      await pipeline(response.body, limiter, createWriteStream(path), {
        signal,
      });
      if (!bytes) throw new Error("Empty media file");
      return {
        path,
        bytes,
        contentType,
        cleanup: () => rm(directory, { recursive: true, force: true }),
      };
    }
    throw new Error("Too many redirects");
  } catch (err) {
    await rm(directory, { recursive: true, force: true });
    throw err;
  } finally {
    await agent.close();
  }
}
