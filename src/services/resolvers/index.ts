import { ResolvedVideo, ResolverError, VideoResolver } from '../../types/resolver.js';
import { MemoryCache } from '../../utils/cache.js';
import { TikTokResolver, TIKTOK_URL_REGEX } from './tiktok.js';
import {
  InstagramResolver,
  INSTAGRAM_URL_REGEX,
  YouTubeResolver,
  YOUTUBE_SHORTS_REGEX,
  TwitterResolver,
  TWITTER_URL_REGEX,
  RedditResolver,
  REDDIT_URL_REGEX,
  ThreadsResolver,
  THREADS_URL_REGEX,
  PinterestResolver,
  PINTEREST_URL_REGEX,
} from './cobalt.js';

// Global cache for resolved videos (TTL 30 minutes, max 500 items)
export const videoCache = new MemoryCache<ResolvedVideo>(500, 30 * 60 * 1000);

export class ResolverRegistry {
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
    const cleanUrl = url.trim();

    // Check fast in-memory cache first to save Vercel execution time and avoid rate limits
    const cached = videoCache.get(cleanUrl);
    if (cached) {
      return cached;
    }

    const resolver = this.findResolver(cleanUrl);
    if (!resolver) {
      throw new ResolverError(
        'Unsupported video URL. Supported: TikTok, Instagram, YouTube Shorts, Twitter/X, Reddit, Threads, Pinterest.',
        'tiktok',
        'UNSUPPORTED'
      );
    }

    const resolved = await resolver.resolve(cleanUrl);

    // Store in cache
    videoCache.set(cleanUrl, resolved);

    return resolved;
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
    const cleaned = match.replace(/[),.;:!?]+$/, '');
    if (
      TIKTOK_URL_REGEX.test(cleaned) ||
      INSTAGRAM_URL_REGEX.test(cleaned) ||
      YOUTUBE_SHORTS_REGEX.test(cleaned) ||
      TWITTER_URL_REGEX.test(cleaned) ||
      REDDIT_URL_REGEX.test(cleaned) ||
      THREADS_URL_REGEX.test(cleaned) ||
      PINTEREST_URL_REGEX.test(cleaned)
    ) {
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
