import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TikTokResolver } from '../src/services/resolvers/tiktok.js';
import { InstagramResolver, YouTubeResolver } from '../src/services/resolvers/cobalt.js';
import { defaultRegistry } from '../src/services/resolvers/index.js';
import { resetConfigForTesting } from '../src/config.js';

describe('Video Resolvers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetConfigForTesting();
    process.env['TELEGRAM_BOT_TOKEN'] = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';
    process.env['TELEGRAM_SECRET_TOKEN'] = 'valid_secret_token_123';
    process.env['COBALT_API_URL'] = 'https://api.cobalt.tools/';
    delete process.env['COBALT_API_KEY'];
  });

  afterEach(() => {
    resetConfigForTesting();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('TikTokResolver', () => {
    const resolver = new TikTokResolver();

    it('successfully extracts clean video URL from TikWM response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          msg: 'success',
          data: {
            id: '7106594312292453678',
            title: 'Sample TikTok Video Title',
            play: 'https://v16m.tiktokcdn.com/clean-video.mp4',
            duration: 15,
            author: { nickname: 'CoolCreator' },
          },
        }),
      } as unknown as Response);

      const result = await resolver.resolve('https://www.tiktok.com/@user/video/7106594312292453678');
      expect(result.platform).toBe('tiktok');
      expect(result.directUrl).toBe('https://v16m.tiktokcdn.com/clean-video.mp4');
      expect(result.title).toBe('Sample TikTok Video Title');
      expect(result.author).toBe('CoolCreator');
      expect(result.durationSeconds).toBe(15);
    });

    it('prepends domain when TikWM returns relative URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          msg: 'success',
          data: {
            play: '/video/media_stream_123.mp4',
          },
        }),
      } as unknown as Response);

      const result = await resolver.resolve('https://vm.tiktok.com/ZM8xyZ123/');
      expect(result.directUrl).toBe('https://www.tikwm.com/video/media_stream_123.mp4');
    });

    it('throws NOT_FOUND when video URL is invalid according to TikWM', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: -1,
          msg: 'Url parsing is failed! Please check url.',
        }),
      } as unknown as Response);

      await expect(
        resolver.resolve('https://www.tiktok.com/@user/video/9999999999')
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('throws PRIVATE_OR_DELETED when video is removed or private', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: -1,
          msg: 'This video is private or deleted',
        }),
      } as unknown as Response);

      await expect(
        resolver.resolve('https://www.tiktok.com/@user/video/1111111111')
      ).rejects.toMatchObject({
        code: 'PRIVATE_OR_DELETED',
      });
    });
  });

  describe('Cobalt Resolver (Instagram & YouTube)', () => {
    const instagramResolver = new InstagramResolver();
    const youtubeResolver = new YouTubeResolver();

    it('successfully extracts direct URL from modern Cobalt tunnel status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'tunnel',
          url: 'https://cdn.cobalt.tools/tunnel/video-clean.mp4',
          filename: 'instagram_reel_123.mp4',
        }),
      } as unknown as Response);

      const result = await instagramResolver.resolve('https://www.instagram.com/reel/C3zYAbCdEfG/');
      expect(result.platform).toBe('instagram');
      expect(result.directUrl).toBe('https://cdn.cobalt.tools/tunnel/video-clean.mp4');
      expect(result.title).toBe('instagram_reel_123.mp4');
    });

    it('successfully extracts URL from Cobalt redirect status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'redirect',
          url: 'https://rr2---sn-youtube-cdn.googlevideo.com/videoplayback?id=123',
          filename: 'yt_short.mp4',
        }),
      } as unknown as Response);

      const result = await youtubeResolver.resolve('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      expect(result.platform).toBe('youtube');
      expect(result.directUrl).toContain('googlevideo.com');
    });

    it('extracts first video from picker array response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'picker',
          picker: [
            { type: 'photo', url: 'https://cdn.example.com/photo.jpg' },
            { type: 'video', url: 'https://cdn.example.com/video.mp4' },
          ],
        }),
      } as unknown as Response);

      const result = await instagramResolver.resolve('https://www.instagram.com/p/C3zYAbCdEfG/');
      expect(result.directUrl).toBe('https://cdn.example.com/video.mp4');
    });

    it('passes Authorization header when COBALT_API_KEY is configured', async () => {
      process.env['COBALT_API_KEY'] = 'test-api-key-999';
      resetConfigForTesting();

      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            status: 'tunnel',
            url: 'https://cdn.cobalt.tools/file.mp4',
          }),
        } as unknown as Response);
      });

      await youtubeResolver.resolve('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      expect(capturedHeaders['Authorization']).toBe('Api-Key test-api-key-999');
    });

    it('handles Cobalt auth missing error with descriptive instructions', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'error',
          error: { code: 'error.api.auth.jwt.missing' },
        }),
      } as unknown as Response);

      await expect(
        youtubeResolver.resolve('https://www.youtube.com/shorts/dQw4w9WgXcQ')
      ).rejects.toThrow(/requires authentication/);
    });
  });

  describe('Resolver Registry', () => {
    it('finds appropriate resolver by URL', () => {
      const tiktok = defaultRegistry.findResolver('https://www.tiktok.com/@user/video/123');
      expect(tiktok?.platform).toBe('tiktok');

      const insta = defaultRegistry.findResolver('https://www.instagram.com/reel/123');
      expect(insta?.platform).toBe('instagram');

      const yt = defaultRegistry.findResolver('https://www.youtube.com/shorts/123');
      expect(yt?.platform).toBe('youtube');

      const unknown = defaultRegistry.findResolver('https://example.com/video.mp4');
      expect(unknown).toBeNull();
    });
  });
});
