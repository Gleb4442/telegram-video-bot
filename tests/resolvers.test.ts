import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TikTokResolver } from '../src/services/resolvers/tiktok.js';
import {
  InstagramResolver,
  
  TwitterResolver,
  RedditResolver,
  ThreadsResolver,
  PinterestResolver,
} from '../src/services/resolvers/cobalt.js';
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

    it('successfully extracts clean HD video URL and audio URL from TikWM response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          msg: 'success',
          data: {
            id: '7106594312292453678',
            title: 'Sample TikTok Video Title',
            hdplay: 'https://v16m.tiktokcdn.com/hd-clean-video.mp4',
            play: 'https://v16m.tiktokcdn.com/sd-clean-video.mp4',
            music: 'https://v16m.tiktokcdn.com/audio-track.mp3',
            duration: 15,
            author: { nickname: 'CoolCreator' },
          },
        }),
      } as unknown as Response);

      const result = await resolver.resolve('https://www.tiktok.com/@user/video/7106594312292453678');
      expect(result.platform).toBe('tiktok');
      expect(result.directUrl).toBe('https://v16m.tiktokcdn.com/hd-clean-video.mp4');
      expect(result.audioUrl).toBe('https://v16m.tiktokcdn.com/audio-track.mp3');
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

  describe('Cobalt Resolvers (Multi-platform)', () => {
    const instagramResolver = new InstagramResolver();
    // const youtubeResolver = new YouTubeResolver();
    const twitterResolver = new TwitterResolver();
    const redditResolver = new RedditResolver();
    const threadsResolver = new ThreadsResolver();
    const pinterestResolver = new PinterestResolver();

    it('successfully extracts direct URL from modern Cobalt tunnel status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'tunnel',
          url: 'https://cdn.cobalt.tools/tunnel/video-clean.mp4',
          filename: 'instagram_reel_123.mp4',
          audio: 'https://cdn.cobalt.tools/audio.mp3',
        }),
      } as unknown as Response);

      const result = await instagramResolver.resolve('https://www.instagram.com/reel/C3zYAbCdEfG/');
      expect(result.platform).toBe('instagram');
      expect(result.directUrl).toBe('https://cdn.cobalt.tools/tunnel/video-clean.mp4');
      expect(result.audioUrl).toBe('https://cdn.cobalt.tools/audio.mp3');
    });

    it('resolves Twitter video', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'redirect',
          url: 'https://video.twimg.com/clean.mp4',
        }),
      } as unknown as Response);

      const result = await twitterResolver.resolve('https://x.com/user/status/123456');
      expect(result.platform).toBe('twitter');
      expect(result.directUrl).toBe('https://video.twimg.com/clean.mp4');
    });

    it('resolves Reddit video', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'tunnel',
          url: 'https://v.redd.it/clean.mp4',
        }),
      } as unknown as Response);

      const result = await redditResolver.resolve('https://redd.it/abc123');
      expect(result.platform).toBe('reddit');
    });

    it('resolves Threads and Pinterest videos', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'redirect',
          url: 'https://cdn.example.com/media.mp4',
        }),
      } as unknown as Response);

      const resThreads = await threadsResolver.resolve('https://threads.net/@user/post/123');
      expect(resThreads.platform).toBe('threads');

      const resPin = await pinterestResolver.resolve('https://pin.it/12345');
      expect(resPin.platform).toBe('pinterest');
    });
  });

  describe('Resolver Registry', () => {
    it('finds appropriate resolver across all supported platforms', () => {
      expect(defaultRegistry.findResolver('https://www.tiktok.com/@user/video/123')?.platform).toBe('tiktok');
      expect(defaultRegistry.findResolver('https://www.instagram.com/reel/123')?.platform).toBe('instagram');
      expect(defaultRegistry.findResolver('https://www.youtube.com/shorts/123')?.platform).toBe('youtube');
      expect(defaultRegistry.findResolver('https://twitter.com/user/status/123')?.platform).toBe('twitter');
      expect(defaultRegistry.findResolver('https://x.com/user/status/123')?.platform).toBe('twitter');
      expect(defaultRegistry.findResolver('https://redd.it/123')?.platform).toBe('reddit');
      expect(defaultRegistry.findResolver('https://threads.net/@user/post/123')?.platform).toBe('threads');
      expect(defaultRegistry.findResolver('https://pin.it/123')?.platform).toBe('pinterest');
      expect(defaultRegistry.findResolver('https://unsupported.com/video.mp4')).toBeNull();
    });
  });
});

    it('parses TikTok photo slideshow images into albumItems', async () => {
      const resolver = new TikTokResolver();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          msg: 'success',
          data: {
            id: '7106594312292453678',
            title: 'TikTok Photo Slideshow',
            images: [
              'https://p16.tiktokcdn.com/img1.jpg',
              '/img2.jpg',
            ],
            music: 'https://v16.tiktokcdn.com/song.mp3',
          },
        }),
      } as unknown as Response);

      const result = await resolver.resolve('https://www.tiktok.com/@user/photo/7106594312292453678');
      expect(result.isAlbum).toBe(true);
      expect(result.albumItems).toHaveLength(2);
      expect(result.albumItems?.[0]?.url).toBe('https://p16.tiktokcdn.com/img1.jpg');
      expect(result.albumItems?.[1]?.url).toBe('https://www.tikwm.com/img2.jpg');
      expect(result.audioUrl).toBe('https://v16.tiktokcdn.com/song.mp3');
    });
