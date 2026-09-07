import { ResolvedVideo, ResolverError, VideoResolver } from '../../types/resolver.js';
import { TikTokResolver, TIKTOK_URL_REGEX } from './tiktok.js';
import { InstagramResolver, INSTAGRAM_URL_REGEX, YouTubeResolver, YOUTUBE_SHORTS_REGEX } from './cobalt.js';

export class ResolverRegistry {
  private resolvers: VideoResolver[] = [];

  constructor() {
    // Default resolvers in priority order
    this.register(new TikTokResolver());
    this.register(new InstagramResolver());
    this.register(new YouTubeResolver());
  }

  register(resolver: VideoResolver): void {
    this.resolvers.push(resolver);
  }

  findResolver(url: string): VideoResolver | null {
    return this.resolvers.find((r) => r.supports(url)) || null;
  }

  async resolve(url: string): Promise<ResolvedVideo> {
    const resolver = this.findResolver(url);
    if (!resolver) {
      throw new ResolverError(
        'Unsupported video URL. Only TikTok, Instagram Reels, and YouTube Shorts are supported.',
        'tiktok', // fallback platform
        'UNSUPPORTED'
      );
    }

    return resolver.resolve(url);
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
  // Regex to match any http/https URL in text
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`]+)/gi;
  const matches = text.match(urlRegex) || [];

  const supportedUrls: string[] = [];
  for (const match of matches) {
    // Clean trailing punctuation commonly attached in chat messages (e.g., "Check this https://...!")
    const cleaned = match.replace(/[),.;:!?]+$/, '');
    if (
      TIKTOK_URL_REGEX.test(cleaned) ||
      INSTAGRAM_URL_REGEX.test(cleaned) ||
      YOUTUBE_SHORTS_REGEX.test(cleaned)
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
