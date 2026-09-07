import { z } from 'zod';
import { MediaItem, ResolvedVideo, ResolverError, VideoResolver } from '../../types/resolver.js';
import { fetchWithTimeout } from '../../utils/http.js';

const TikWMApiSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      play: z.string().optional(),
      wmplay: z.string().optional(),
      hdplay: z.string().optional(),
      images: z.array(z.string()).optional(),
      music: z.string().optional(),
      music_info: z
        .object({
          play: z.string().optional(),
          title: z.string().optional(),
          author: z.string().optional(),
        })
        .optional(),
      size: z.number().optional(),
      duration: z.number().optional(),
      author: z
        .object({
          nickname: z.string().optional(),
          unique_id: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const TIKTOK_URL_REGEX =
  /https?:\/\/(?:(?:www|vm|vt|m|t)\.)?tiktok\.com\/(?:@[\w.-]+\/(?:video|photo)\/\d+|[\w./-]+)/i;

export class TikTokResolver implements VideoResolver {
  readonly name = 'TikTok TikWM Resolver';
  readonly platform = 'tiktok' as const;

  supports(url: string): boolean {
    return TIKTOK_URL_REGEX.test(url.trim());
  }

  async resolve(url: string): Promise<ResolvedVideo> {
    const cleanUrl = url.trim();

    try {
      const endpoint = 'https://www.tikwm.com/api/';
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        body: new URLSearchParams({ url: cleanUrl }),
        timeoutMs: 8000,
      });

      if (!response.ok) {
        throw new ResolverError(
          `TikWM API responded with HTTP status ${response.status}`,
          this.platform,
          response.status >= 500 ? 'SCRAPER_DOWN' : 'UNKNOWN'
        );
      }

      const rawJson: unknown = await response.json();
      const parseResult = TikWMApiSchema.safeParse(rawJson);

      if (!parseResult.success) {
        throw new ResolverError(
          'TikWM returned an invalid JSON response structure',
          this.platform,
          'SCRAPER_DOWN',
          parseResult.error
        );
      }

      const { code, msg, data } = parseResult.data;

      if (code !== 0 || !data) {
        const message = msg || 'Could not retrieve video stream';
        if (/url.*fail|invalid|check url/i.test(message)) {
          throw new ResolverError(
            `TikTok link could not be parsed: ${message}`,
            this.platform,
            'NOT_FOUND'
          );
        }
        if (/private|deleted|removed/i.test(message)) {
          throw new ResolverError(
            `TikTok video is private or deleted: ${message}`,
            this.platform,
            'PRIVATE_OR_DELETED'
          );
        }
        throw new ResolverError(
          `TikTok resolution failed: ${message}`,
          this.platform,
          'UNKNOWN'
        );
      }

      // Extract direct audio MP3 stream if available
      let audioUrl = data.music || data.music_info?.play;
      if (audioUrl && audioUrl.startsWith('/')) {
        audioUrl = `https://www.tikwm.com${audioUrl}`;
      }

      // Check if this post is a photo slideshow / album
      if (data.images && data.images.length > 0) {
        const albumItems: MediaItem[] = data.images.map((imgUrl) => ({
          type: 'photo',
          url: imgUrl.startsWith('/') ? `https://www.tikwm.com${imgUrl}` : imgUrl,
        }));

        return {
          directUrl: albumItems[0]?.url ?? '',
          isAlbum: true,
          albumItems,
          audioUrl,
          title: data.title?.trim() || undefined,
          platform: this.platform,
          author: data.author?.nickname || data.author?.unique_id,
        };
      }

      // Prioritize Full HD 1080p stream over standard SD
      let directUrl = data.hdplay || data.play || data.wmplay;
      if (!directUrl) {
        throw new ResolverError(
          'No playable video stream found in TikTok response',
          this.platform,
          'NOT_FOUND'
        );
      }

      if (directUrl.startsWith('/')) {
        directUrl = `https://www.tikwm.com${directUrl}`;
      }

      return {
        directUrl,
        audioUrl,
        title: data.title?.trim() || undefined,
        platform: this.platform,
        durationSeconds: data.duration,
        author: data.author?.nickname || data.author?.unique_id,
      };
    } catch (error: unknown) {
      if (error instanceof ResolverError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timed out')) {
        throw new ResolverError(
          'TikWM API request timed out after 8 seconds',
          this.platform,
          'TIMEOUT',
          error
        );
      }

      throw new ResolverError(
        `Failed to resolve TikTok video: ${error instanceof Error ? error.message : String(error)}`,
        this.platform,
        'UNKNOWN',
        error
      );
    }
  }
}
