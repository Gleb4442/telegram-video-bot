import { platformForUrl, publicMediaUrl } from "../../utils/urls.js";
import { z } from "zod";
import {
  MediaItem,
  ResolvedVideo,
  ResolverError,
  SupportedPlatform,
  VideoResolver,
} from "../../types/resolver.js";
import { fetchJsonWithTimeout } from "../../utils/http.js";
import { getConfig, getAllCobaltUrls } from "../../config.js";
import { resolveInstagramDirect } from "./instagram.js";

// Modern Cobalt v10+ schema
const CobaltModernSchema = z.object({
  status: z.enum(["tunnel", "redirect", "picker", "local-processing", "error"]),
  url: z
    .string()
    .refine((v) => {
      try {
        publicMediaUrl(v);
        return true;
      } catch {
        return false;
      }
    }, "Unsafe media URL")
    .optional(),
  filename: z.string().optional(),
  audio: z
    .string()
    .refine((v) => {
      try {
        publicMediaUrl(v);
        return true;
      } catch {
        return false;
      }
    }, "Unsafe media URL")
    .optional(),
  picker: z
    .array(
      z.object({
        type: z.string().optional(),
        url: z.string().refine((v) => {
          try {
            publicMediaUrl(v);
            return true;
          } catch {
            return false;
          }
        }, "Unsafe media URL"),
        thumb: z.string().optional(),
      }),
    )
    .optional(),
  tunnel: z
    .array(
      z.string().refine((v) => {
        try {
          publicMediaUrl(v);
          return true;
        } catch {
          return false;
        }
      }, "Unsafe media URL"),
    )
    .optional(),
  error: z
    .object({
      code: z.string(),
      context: z.record(z.unknown()).optional(),
    })
    .optional(),
});

// Legacy Cobalt schema (v7/v8) fallback
const CobaltLegacySchema = z.object({
  status: z.string().optional(),
  url: z
    .string()
    .refine((v) => {
      try {
        publicMediaUrl(v);
        return true;
      } catch {
        return false;
      }
    }, "Unsafe media URL")
    .optional(),
  text: z.string().optional(),
});

export const INSTAGRAM_URL_REGEX =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|share)\/([A-Za-z0-9_.-]+)/i;

export const YOUTUBE_SHORTS_REGEX =
  /https?:\/\/(?:(?:www|m)\.)?youtube\.com\/(?:shorts\/|watch\?v=)|https?:\/\/youtu\.be\/([A-Za-z0-9_-]+)/i;

export const TWITTER_URL_REGEX =
  /https?:\/\/(?:(?:www|mobile)\.)?(?:twitter\.com|x\.com)\/(?:#!\/)?[a-zA-Z0-9_]+\/status\/(\d+)/i;

export const REDDIT_URL_REGEX =
  /https?:\/\/(?:(?:www|v|old)\.)?reddit\.com\/r\/[a-zA-Z0-9_]+\/comments\/[a-zA-Z0-9_]+|https?:\/\/redd\.it\/[a-zA-Z0-9_]+/i;

export const THREADS_URL_REGEX =
  /https?:\/\/(?:www\.)?threads\.(?:net|com)\/(?:@[a-zA-Z0-9_.-]+\/post|t)\/([a-zA-Z0-9_-]+)/i;

export const PINTEREST_URL_REGEX =
  /https?:\/\/(?:[a-zA-Z0-9_.-]+\.)?(?:pinterest\.[a-z.]+|pin\.it)\/[a-zA-Z0-9_./-]+/i;

/**
 * Executes request to Cobalt API instances with automatic failover and extracts direct playable video URL.
 */
export async function resolveWithCobalt(
  url: string,
  platform: SupportedPlatform,
  videoQuality = "max",
): Promise<ResolvedVideo> {
  const config = getConfig();
  const instances = getAllCobaltUrls();
  if (instances.length === 0) {
    instances.push(config.COBALT_API_URL.replace(/\/+$/, ""));
  }

  let lastError: unknown = null;

  for (let i = 0; i < instances.length; i++) {
    const rawInstance = instances[i];
    if (!rawInstance) {
      continue;
    }
    const baseUrl = rawInstance.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/`;
    const isLastInstance = i === instances.length - 1;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };

    if (
      config.COBALT_API_KEY &&
      baseUrl === config.COBALT_API_URL.replace(/\/+$/, "")
    ) {
      const key = config.COBALT_API_KEY.trim();
      if (key.startsWith("Bearer ") || key.startsWith("Api-Key ")) {
        headers["Authorization"] = key;
      } else {
        headers["Authorization"] = `Api-Key ${key}`;
      }
    }

    const payload = {
      url: url.trim(),
      videoQuality,
      downloadMode: "auto",
      youtubeVideoCodec: "h264",
      youtubeBetterAudio: true,
      disableMetadata: false,
      localProcessing: "disabled",
    };

    let response: Response;
    let rawJson: unknown;
    try {
      ({ response, data: rawJson } = await fetchJsonWithTimeout(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeoutMs: config.COBALT_TIMEOUT_MS,
        redirect: "error",
      }));
    } catch (err: unknown) {
      lastError = err;
      if (!isLastInstance) {
        console.warn(
          `[Cobalt] Request to ${baseUrl} failed (${err instanceof Error ? err.message : String(err)}). Trying next instance...`,
        );
        continue;
      }

      if (err instanceof Error && err.message.includes("timed out")) {
        throw new ResolverError(
          "Cobalt API request timed out within the configured deadline",
          platform,
          "TIMEOUT",
          err,
        );
      }
      throw new ResolverError(
        `Could not reach Cobalt API at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        platform,
        "SCRAPER_DOWN",
        err,
      );
    }

    if (response.status === 429 || response.status >= 500) {
      const err = new ResolverError(
        `Cobalt API returned HTTP ${response.status}`,
        platform,
        response.status === 429 ? "RATE_LIMITED" : "SCRAPER_DOWN",
      );
      lastError = err;
      if (!isLastInstance) continue;
      throw err;
    }

    if (
      rawJson &&
      typeof rawJson === "object" &&
      "status" in rawJson &&
      rawJson.status === "local-processing"
    ) {
      const err = new ResolverError(
        "This instance requires local media processing, which this bot does not support.",
        platform,
        "UNSUPPORTED",
      );
      lastError = err;
      if (!isLastInstance) continue;
      throw err;
    }

    if (!rawJson || typeof rawJson !== "object") {
      const err = new ResolverError(
        `Cobalt API returned invalid non-JSON response with HTTP ${response.status}`,
        platform,
        "SCRAPER_DOWN",
      );
      lastError = err;
      if (!isLastInstance) {
        console.warn(
          `[Cobalt] Invalid response from ${baseUrl}. Trying next instance...`,
        );
        continue;
      }
      throw err;
    }

    const modernResult = CobaltModernSchema.safeParse(rawJson);
    if (modernResult.success) {
      const data = modernResult.data;

      if (data.status === "error" && data.error) {
        const code = data.error.code;

        // If it's a server restriction / login / bot check, try next instance if available
        const isServerRestriction =
          code.includes("youtube.login") ||
          code.includes("auth") ||
          code.includes("rate_limit") ||
          code.includes("fetch.fail") ||
          code.includes("fetch.empty") ||
          code.includes("content.video.unavailable");

        if (
          !isLastInstance &&
          (isServerRestriction || !code.includes("private"))
        ) {
          console.warn(
            `[Cobalt] Instance ${baseUrl} returned server restriction (${code}). Trying next instance...`,
          );
          lastError = new ResolverError(
            `Cobalt instance ${baseUrl} returned: ${code}`,
            platform,
            "SCRAPER_DOWN",
          );
          continue;
        }

        if (code.includes("auth")) {
          throw new ResolverError(
            `Cobalt instance requires authentication (${code}). Please configure COBALT_API_KEY or set COBALT_API_URL to a self-hosted instance.`,
            platform,
            "SCRAPER_DOWN",
          );
        }

        if (code.includes("youtube.login")) {
          throw new ResolverError(
            "YouTube временно ограничил доступ к видео со стороны сервера парсера (требуется авторизация).",
            platform,
            "SCRAPER_DOWN",
          );
        }

        if (code.includes("private")) {
          throw new ResolverError(
            "This video is private and cannot be downloaded.",
            platform,
            "PRIVATE_OR_DELETED",
          );
        }

        if (code.includes("deleted") || code.includes("not_found")) {
          throw new ResolverError(
            "The requested video could not be found or has been deleted.",
            platform,
            "NOT_FOUND",
          );
        }

        if (code.includes("content.video.unavailable")) {
          throw new ResolverError(
            "Видео недоступно (возможно, оно удалено, приватное или ограничено по региону/возрасту).",
            platform,
            "NOT_FOUND",
          );
        }

        if (code.includes("fetch.empty") || code.includes("fetch.fail")) {
          throw new ResolverError(
            "The source did not return media to this scraper instance.",
            platform,
            "SCRAPER_DOWN",
          );
        }

        if (code.includes("rate_limit")) {
          throw new ResolverError(
            "The scraper service is currently rate limited. Please try again shortly.",
            platform,
            "RATE_LIMITED",
          );
        }

        throw new ResolverError(
          `Cobalt scraper error: ${code}`,
          platform,
          "UNKNOWN",
        );
      }

      if (
        response.ok &&
        (data.status === "tunnel" || data.status === "redirect") &&
        data.url
      ) {
        return {
          directUrl: data.url,
          audioUrl: data.audio,
          title: data.filename,
          platform,
        };
      }

      if (
        response.ok &&
        data.status === "picker" &&
        data.picker &&
        data.picker.length > 0
      ) {
        // Multi-item carousel/album (e.g. Instagram 2-10 photos/videos)
        if (data.picker.length > 1) {
          const albumItems: MediaItem[] = data.picker.map((item) => ({
            type: item.type === "video" ? "video" : "photo",
            url: item.url,
          }));

          return {
            directUrl: albumItems[0]?.url ?? "",
            isAlbum: true,
            albumItems,
            audioUrl: data.audio,
            title: data.filename,
            platform,
          };
        }

        // Single item in picker
        const videoItem =
          data.picker.find((p) => p.type === "video") ?? data.picker[0];
        if (videoItem && videoItem.url) {
          return {
            directUrl: videoItem.url,
            mediaType: videoItem.type === "photo" ? "photo" : "video",
            thumbnailUrl: videoItem.thumb,
            audioUrl: data.audio,
            platform,
          };
        }
      }
    }

    // Fallback to legacy Cobalt response formats
    const legacyResult = CobaltLegacySchema.safeParse(rawJson);
    if (
      response.ok &&
      legacyResult.success &&
      legacyResult.data.url &&
      !["error", "local-processing"].includes(legacyResult.data.status ?? "")
    ) {
      return {
        directUrl: legacyResult.data.url,
        title: legacyResult.data.text,
        platform,
      };
    }

    const err = new ResolverError(
      `Failed to extract video stream from Cobalt API (HTTP ${response.status})`,
      platform,
      "UNKNOWN",
    );
    lastError = err;
    if (!isLastInstance) {
      console.warn(
        `[Cobalt] Failed to extract stream from ${baseUrl}. Trying next instance...`,
      );
      continue;
    }
    throw err;
  }

  if (lastError instanceof ResolverError) {
    throw lastError;
  }
  throw new ResolverError(
    `All Cobalt scraper instances failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    platform,
    "SCRAPER_DOWN",
    lastError,
  );
}

export class InstagramResolver implements VideoResolver {
  readonly name = "Instagram Direct + Cobalt Resolver";
  readonly platform = "instagram" as const;
  supports(url: string): boolean {
    return platformForUrl(url) === this.platform;
  }
  async resolve(url: string): Promise<ResolvedVideo> {
    try {
      return await resolveInstagramDirect(url);
    } catch (error) {
      if (error instanceof ResolverError && error.code === "AGE_RESTRICTED") throw error;
      return resolveWithCobalt(url, this.platform);
    }
  }
}

export class YouTubeResolver implements VideoResolver {
  readonly name = "YouTube Shorts Cobalt Resolver";
  readonly platform = "youtube" as const;
  supports(url: string): boolean {
    return platformForUrl(url) === this.platform;
  }
  async resolve(url: string): Promise<ResolvedVideo> {
    return resolveWithCobalt(url, this.platform);
  }
}

export class TwitterResolver implements VideoResolver {
  readonly name = "Twitter/X Cobalt Resolver";
  readonly platform = "twitter" as const;
  supports(url: string): boolean {
    return platformForUrl(url) === this.platform;
  }
  async resolve(url: string): Promise<ResolvedVideo> {
    return resolveWithCobalt(url, this.platform);
  }
}

export class RedditResolver implements VideoResolver {
  readonly name = "Reddit Cobalt Resolver";
  readonly platform = "reddit" as const;
  supports(url: string): boolean {
    return platformForUrl(url) === this.platform;
  }
  async resolve(url: string): Promise<ResolvedVideo> {
    return resolveWithCobalt(url, this.platform);
  }
}

export class ThreadsResolver implements VideoResolver {
  readonly name = "Threads Cobalt Resolver";
  readonly platform = "threads" as const;
  supports(url: string): boolean {
    return platformForUrl(url) === this.platform;
  }
  async resolve(url: string): Promise<ResolvedVideo> {
    return resolveWithCobalt(url, this.platform);
  }
}

export class PinterestResolver implements VideoResolver {
  readonly name = "Pinterest Cobalt Resolver";
  readonly platform = "pinterest" as const;
  supports(url: string): boolean {
    return platformForUrl(url) === this.platform;
  }
  async resolve(url: string): Promise<ResolvedVideo> {
    return resolveWithCobalt(url, this.platform);
  }
}
