import { describe, expect, it } from 'vitest';
import { extractSupportedUrls } from '../src/services/resolvers/index.js';
import { TIKTOK_URL_REGEX } from '../src/services/resolvers/tiktok.js';
import {
  INSTAGRAM_URL_REGEX,
  YOUTUBE_SHORTS_REGEX,
  TWITTER_URL_REGEX,
  REDDIT_URL_REGEX,
  THREADS_URL_REGEX,
  PINTEREST_URL_REGEX,
} from '../src/services/resolvers/cobalt.js';

describe('Platform URL Regex Matching', () => {
  describe('TikTok Regex', () => {
    it('matches standard web TikTok video URLs', () => {
      expect(TIKTOK_URL_REGEX.test('https://www.tiktok.com/@creator/video/7106594312292453678')).toBe(true);
      expect(TIKTOK_URL_REGEX.test('https://tiktok.com/@creator.name/video/7106594312292453678')).toBe(true);
    });

    it('matches shortened TikTok URLs (vm.tiktok.com, vt.tiktok.com)', () => {
      expect(TIKTOK_URL_REGEX.test('https://vm.tiktok.com/ZM8xyZ123/')).toBe(true);
      expect(TIKTOK_URL_REGEX.test('https://vt.tiktok.com/ZSdf1234/')).toBe(true);
      expect(TIKTOK_URL_REGEX.test('https://m.tiktok.com/v/7106594312292453678.html')).toBe(true);
    });

    it('rejects non-TikTok URLs', () => {
      expect(TIKTOK_URL_REGEX.test('https://example.com/tiktok.com')).toBe(false);
      expect(TIKTOK_URL_REGEX.test('https://faketiktok.com/@user/video/123')).toBe(false);
    });
  });

  describe('Instagram Regex', () => {
    it('matches Instagram Reels and Post URLs', () => {
      expect(INSTAGRAM_URL_REGEX.test('https://www.instagram.com/reel/C3zYAbCdEfG/')).toBe(true);
      expect(INSTAGRAM_URL_REGEX.test('https://instagram.com/reels/C3zYAbCdEfG/?igsh=123')).toBe(true);
      expect(INSTAGRAM_URL_REGEX.test('https://www.instagram.com/p/C3zYAbCdEfG/')).toBe(true);
      expect(INSTAGRAM_URL_REGEX.test('https://www.instagram.com/share/reel/C3zYAbCdEfG/')).toBe(true);
    });

    it('rejects non-Instagram URLs', () => {
      expect(INSTAGRAM_URL_REGEX.test('https://fakeinstagram.com/reel/123')).toBe(false);
      expect(INSTAGRAM_URL_REGEX.test('https://example.com')).toBe(false);
    });
  });

  describe('YouTube Shorts Regex', () => {
    it('matches YouTube Shorts URLs', () => {
      expect(YOUTUBE_SHORTS_REGEX.test('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
      expect(YOUTUBE_SHORTS_REGEX.test('https://youtube.com/shorts/dQw4w9WgXcQ?feature=share')).toBe(true);
      expect(YOUTUBE_SHORTS_REGEX.test('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
      expect(YOUTUBE_SHORTS_REGEX.test('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('rejects non-YouTube URLs', () => {
      expect(YOUTUBE_SHORTS_REGEX.test('https://fakeyoutube.com/shorts/123')).toBe(false);
    });
  });

  describe('Twitter / X Regex', () => {
    it('matches Twitter and X status URLs', () => {
      expect(TWITTER_URL_REGEX.test('https://twitter.com/elonmusk/status/1788786504000')).toBe(true);
      expect(TWITTER_URL_REGEX.test('https://x.com/OpenAI/status/1788786504000?s=20')).toBe(true);
      expect(TWITTER_URL_REGEX.test('https://mobile.twitter.com/user/status/12345')).toBe(true);
    });
  });

  describe('Reddit Regex', () => {
    it('matches Reddit comment & share URLs', () => {
      expect(REDDIT_URL_REGEX.test('https://www.reddit.com/r/funny/comments/abc123/funny_video/')).toBe(true);
      expect(REDDIT_URL_REGEX.test('https://redd.it/abc123')).toBe(true);
      expect(REDDIT_URL_REGEX.test('https://v.reddit.com/r/videos/comments/xyz789/clip/')).toBe(true);
    });
  });

  describe('Threads & Pinterest Regex', () => {
    it('matches Threads post URLs', () => {
      expect(THREADS_URL_REGEX.test('https://www.threads.net/@zuck/post/C3zYAbCdEfG')).toBe(true);
      expect(THREADS_URL_REGEX.test('https://threads.com/@user/post/C3zYAbCdEfG')).toBe(true);
    });

    it('matches Pinterest pin URLs', () => {
      expect(PINTEREST_URL_REGEX.test('https://pin.it/1234567')).toBe(true);
      expect(PINTEREST_URL_REGEX.test('https://www.pinterest.com/pin/123456789012345678/')).toBe(true);
    });
  });

  describe('extractSupportedUrls', () => {
    it('extracts multiple valid URLs across platforms from message text', () => {
      const text = `
        TikTok: https://vm.tiktok.com/ZM8xyZ123/!
        Twitter: https://x.com/user/status/123456,
        Reddit: https://redd.it/abc123.
      `;

      const urls = extractSupportedUrls(text);
      expect(urls).toHaveLength(3);
      expect(urls[0]).toBe('https://vm.tiktok.com/ZM8xyZ123/');
      expect(urls[1]).toBe('https://x.com/user/status/123456');
      expect(urls[2]).toBe('https://redd.it/abc123');
    });
  });
});
