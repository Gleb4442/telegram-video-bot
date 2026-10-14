import { getConfig } from "../../config.js";
import {
  ResolvedVideo,
  ResolverError,
  VideoResolver,
} from "../../types/resolver.js";
import { MemoryCache } from "../../utils/cache.js";
import { TikTokResolver } from "./tiktok.js";
import {
  InstagramResolver,
  YouTubeResolver,
  TwitterResolver,
  RedditResolver,
  ThreadsResolver,
  PinterestResolver,
} from "./cobalt.js";
import { platformForUrl, validateMedia } from "../../utils/urls.js";

// Global cache for resolved videos (TTL 30 minutes, max 500 items)
export const videoCache = new MemoryCache<ResolvedVideo>(500, 2 * 60 * 1000);

export class ResolverRegistry {
  private pending = new Map<string, Promise<ResolvedVideo>>();
  private resolvers: VideoResolver[] = [];

  constructor() {
    this.register(new TikTokResolver());
    this.register(new InstagramResolver());
    this.register(new YouTubeResolver());
    this.register(new TwitterResolver());
    this.register(new RedditResolver());
    this.register(new ThreadsResolver());
    this.register(new PinterestResolver());
  }

  register(resolver: VideoResolver): void {
    this.resolvers.push(resolver);
  }

  findResolver(url: string): VideoResolver | null {
    return this.resolvers.find((r) => r.supports(url)) || null;
  }

  async resolve(url: string): Promise<ResolvedVideo> {
    const cleanUrl = canonicalUrl(url);

    // Check fast in-memory cache first to save Vercel execution time and avoid rate limits
    const cached = videoCache.get(cleanUrl);
    if (cached) {
      return cached;
    }

    const resolver = this.findResolver(cleanUrl);
    if (!resolver) {
      throw new ResolverError(
        "Unsupported video URL. Supported: TikTok, Instagram, YouTube Shorts, Twitter/X, Reddit, Threads, Pinterest.",
        "tiktok",
        "UNSUPPORTED",
      );
    }

    const existing = this.pending.get(cleanUrl);
    if (existing) return existing;
    const task = resolver
      .resolve(cleanUrl)
      .then(validateMedia)
      .then((resolved) => {
        videoCache.set(cleanUrl, resolved);
        return resolved;
      })
      .finally(() => this.pending.delete(cleanUrl));
    this.pending.set(cleanUrl, task);
    return task;
  }

  getRegisteredResolvers(): readonly VideoResolver[] {
    return this.resolvers;
  }
}

// Global registry singleton
export const defaultRegistry = new ResolverRegistry();

/**
 * Extracts URLs from message text that match our supported platforms.
 */
export function extractSupportedUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`]+)/gi;
  const matches = text.match(urlRegex) || [];

  const supportedUrls: string[] = [];
  for (const match of matches) {
    const cleaned = match.replace(/[),.;:!?]+$/, "");
    if (platformForUrl(cleaned)) {
      supportedUrls.push(cleaned);
    }
  }

  return [...new Set(supportedUrls)];
}

export async function resolveVideo(url: string): Promise<ResolvedVideo> {
  return defaultRegistry.resolve(url);
}

export function findResolver(url: string): VideoResolver | null {
  return defaultRegistry.findResolver(url);
}

export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  const platform = platformForUrl(raw);
  if (platform === "instagram" || platform === "tiktok") {
    u.search = "";
    u.hash = "";
  }
  return u.href;
}

export async function resolveReliably(url: string): Promise<ResolvedVideo> {
  try {
    return await resolveVideo(url);
  } catch (err) {
    if (
      !getConfig().INNGEST_EVENT_KEY ||
      !(err instanceof ResolverError) ||
      !["TIMEOUT", "SCRAPER_DOWN", "RATE_LIMITED"].includes(err.code)
    )
      throw err;
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 + Math.floor(Math.random() * 1000)),
    );
    return resolveVideo(url);
  }
}
