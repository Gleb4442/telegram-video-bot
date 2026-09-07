import { z } from 'zod';
import { MediaItem, ResolvedVideo, ResolverError, SupportedPlatform, VideoResolver } from '../../types/resolver.js';
import { fetchWithTimeout } from '../../utils/http.js';
import { getConfig } from '../../config.js';

// Modern Cobalt v10+ schema
const CobaltModernSchema = z.object({
  status: z.enum(['tunnel', 'redirect', 'picker', 'local-processing', 'error']),
  url: z.string().url().optional(),
  filename: z.string().optional(),
  audio: z.string().url().optional(),
  picker: z
    .array(
      z.object({
        type: z.string().optional(),
        url: z.string().url(),
        thumb: z.string().optional(),
      })
    )
    .optional(),
  tunnel: z.array(z.string().url()).optional(),
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
  url: z.string().url().optional(),
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
 * Executes request to Cobalt API instance and extracts direct playable video URL.
 */
export async function resolveWithCobalt(
  url: string,
  platform: SupportedPlatform
): Promise<ResolvedVideo> {
  const config = getConfig();
  const baseUrl = config.COBALT_API_URL.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'TelegramVideoBot/1.0',
  };

  if (config.COBALT_API_KEY) {
    const key = config.COBALT_API_KEY.trim();
    if (key.startsWith('Bearer ') || key.startsWith('Api-Key ')) {
      headers['Authorization'] = key;
    } else {
      headers['Authorization'] = `Api-Key ${key}`;
    }
  }

  const payload = {
    url: url.trim(),
    videoQuality: 'max',
    downloadMode: 'auto',
    youtubeVideoCodec: 'h264',
    youtubeBetterAudio: true,
    disableMetadata: false,
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 8000,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('timed out')) {
      throw new ResolverError(
        'Cobalt API request timed out after 8 seconds',
        platform,
        'TIMEOUT',
        err
      );
    }
    throw new ResolverError(
      `Could not reach Cobalt API at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      platform,
      'SCRAPER_DOWN',
      err
    );
  }

  const rawJson: unknown = await response.json().catch(() => null);

  if (!rawJson || typeof rawJson !== 'object') {
    throw new ResolverError(
      `Cobalt API returned invalid non-JSON response with HTTP ${response.status}`,
      platform,
      'SCRAPER_DOWN'
    );
  }

  const modernResult = CobaltModernSchema.safeParse(rawJson);
  if (modernResult.success) {
    const data = modernResult.data;

    if (data.status === 'error' && data.error) {
      const code = data.error.code;

      if (code.includes('auth')) {
        throw new ResolverError(
          `Cobalt instance requires authentication (${code}). Please configure COBALT_API_KEY or set COBALT_API_URL to a self-hosted instance.`,
          platform,
          'SCRAPER_DOWN'
        );
      }

      if (code.includes('private')) {
        throw new ResolverError(
          'This video is private and cannot be downloaded.',
          platform,
          'PRIVATE_OR_DELETED'
        );
      }

      if (code.includes('deleted') || code.includes('not_found')) {
        throw new ResolverError(
          'The requested video could not be found or has been deleted.',
          platform,
          'NOT_FOUND'
        );
      }

      if (code.includes('rate_limit')) {
        throw new ResolverError(
          'The scraper service is currently rate limited. Please try again shortly.',
          platform,
          'RATE_LIMITED'
        );
      }

      throw new ResolverError(
        `Cobalt scraper error: ${code}`,
        platform,
        'UNKNOWN'
      );
    }

    if ((data.status === 'tunnel' || data.status === 'redirect') && data.url) {
      return {
        directUrl: data.url,
        audioUrl: data.audio,
        title: data.filename,
        platform,
      };
    }

    if (data.status === 'picker' && data.picker && data.picker.length > 0) {
      // Multi-item carousel/album (e.g. Instagram 2-10 photos/videos)
      if (data.picker.length > 1) {
        const albumItems: MediaItem[] = data.picker.map((item) => ({
          type: item.type === 'video' ? 'video' : 'photo',
          url: item.url,
        }));

        return {
          directUrl: albumItems[0]?.url ?? '',
          isAlbum: true,
          albumItems,
          audioUrl: data.audio,
          title: data.filename,
          platform,
        };
      }

      // Single item in picker
      const videoItem = data.picker.find((p) => p.type === 'video') ?? data.picker[0];
      if (videoItem && videoItem.url) {
        return {
          directUrl: videoItem.url,
          audioUrl: data.audio,
          platform,
        };
      }
    }

    if (data.status === 'local-processing' && data.tunnel && data.tunnel.length > 0) {
      const firstTunnel = data.tunnel[0];
      if (firstTunnel) {
        return {
          directUrl: firstTunnel,
          audioUrl: data.audio,
          platform,
        };
      }
    }
  }

  // Fallback to legacy Cobalt response formats
  const legacyResult = CobaltLegacySchema.safeParse(rawJson);
  if (legacyResult.success && legacyResult.data.url) {
    return {
      directUrl: legacyResult.data.url,
      title: legacyResult.data.text,
      platform,
    };
  }

  throw new ResolverError(
    `Failed to extract video stream from Cobalt API (HTTP ${response.status})`,
    platform,
    'UNKNOWN'
  );
}

export class InstagramResolver implements VideoResolver {
  readonly name = 'Instagram Reels Cobalt Resolver';
  readonly platform = 'instagram' as const;
  supports(url: string): boolean { return INSTAGRAM_URL_REGEX.test(url.trim()); }
  async resolve(url: string): Promise<ResolvedVideo> { return resolveWithCobalt(url, this.platform); }
}

export class YouTubeResolver implements VideoResolver {
  readonly name = 'YouTube Shorts Cobalt Resolver';
  readonly platform = 'youtube' as const;
  supports(url: string): boolean { return YOUTUBE_SHORTS_REGEX.test(url.trim()); }
  async resolve(url: string): Promise<ResolvedVideo> { return resolveWithCobalt(url, this.platform); }
}

export class TwitterResolver implements VideoResolver {
  readonly name = 'Twitter/X Cobalt Resolver';
  readonly platform = 'twitter' as const;
  supports(url: string): boolean { return TWITTER_URL_REGEX.test(url.trim()); }
  async resolve(url: string): Promise<ResolvedVideo> { return resolveWithCobalt(url, this.platform); }
}

export class RedditResolver implements VideoResolver {
  readonly name = 'Reddit Cobalt Resolver';
  readonly platform = 'reddit' as const;
  supports(url: string): boolean { return REDDIT_URL_REGEX.test(url.trim()); }
  async resolve(url: string): Promise<ResolvedVideo> { return resolveWithCobalt(url, this.platform); }
}

export class ThreadsResolver implements VideoResolver {
  readonly name = 'Threads Cobalt Resolver';
  readonly platform = 'threads' as const;
  supports(url: string): boolean { return THREADS_URL_REGEX.test(url.trim()); }
  async resolve(url: string): Promise<ResolvedVideo> { return resolveWithCobalt(url, this.platform); }
}

export class PinterestResolver implements VideoResolver {
  readonly name = 'Pinterest Cobalt Resolver';
  readonly platform = 'pinterest' as const;
  supports(url: string): boolean { return PINTEREST_URL_REGEX.test(url.trim()); }
  async resolve(url: string): Promise<ResolvedVideo> { return resolveWithCobalt(url, this.platform); }
}
