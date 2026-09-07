import { describe, expect, it } from 'vitest';
import { extractSupportedUrls } from '../src/services/resolvers/index.js';
import { TIKTOK_URL_REGEX } from '../src/services/resolvers/tiktok.js';
import { INSTAGRAM_URL_REGEX, YOUTUBE_SHORTS_REGEX } from '../src/services/resolvers/cobalt.js';

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

  describe('extractSupportedUrls', () => {
    it('extracts multiple valid URLs from message text and strips punctuation', () => {
      const text = `
        Hey check out this cool video: https://vm.tiktok.com/ZM8xyZ123/!
        Also this reel: https://www.instagram.com/reel/C3zYAbCdEfG/?utm_source=ig_web_copy_link,
        and this short: https://www.youtube.com/shorts/dQw4w9WgXcQ.
      `;

      const urls = extractSupportedUrls(text);
      expect(urls).toHaveLength(3);
      expect(urls[0]).toBe('https://vm.tiktok.com/ZM8xyZ123/');
      expect(urls[1]).toBe('https://www.instagram.com/reel/C3zYAbCdEfG/?utm_source=ig_web_copy_link');
      expect(urls[2]).toBe('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    });

    it('deduplicates identical URLs', () => {
      const text = 'https://vm.tiktok.com/ZM8xyZ123/ and again https://vm.tiktok.com/ZM8xyZ123/';
      const urls = extractSupportedUrls(text);
      expect(urls).toHaveLength(1);
    });

    it('returns empty array when no supported URLs are present', () => {
      const text = 'Hello world! Visit https://google.com or https://twitter.com/test';
      const urls = extractSupportedUrls(text);
      expect(urls).toEqual([]);
    });
  });
});
