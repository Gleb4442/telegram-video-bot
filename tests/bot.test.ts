import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBot, escapeHtml, formatCaption } from '../src/bot.js';
import { ResolvedVideo, ResolverError } from '../src/types/resolver.js';
import * as resolverModule from '../src/services/resolvers/index.js';
import { resetConfigForTesting } from '../src/config.js';

describe('Bot Handlers and Utilities', () => {
  beforeEach(() => {
    resetConfigForTesting();
    process.env['TELEGRAM_BOT_TOKEN'] = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';
    process.env['TELEGRAM_SECRET_TOKEN'] = 'valid_secret_token_123';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('escapeHtml', () => {
    it('escapes &, <, > properly', () => {
      const input = 'Tom & Jerry <cartoon> > Anime';
      expect(escapeHtml(input)).toBe('Tom &amp; Jerry &lt;cartoon&gt; &gt; Anime');
    });
  });

  describe('formatCaption', () => {
    it('formats TikTok caption with author and title', () => {
      const video: ResolvedVideo = {
        platform: 'tiktok',
        directUrl: 'https://cdn.example.com/video.mp4',
        title: 'Hilarious Cat Jump <Fail>',
        author: 'cat_lover',
      };

      const caption = formatCaption(video);
      expect(caption).toContain('🎵 TikTok');
      expect(caption).toContain('Hilarious Cat Jump &lt;Fail&gt;');
      expect(caption).toContain('@cat_lover');
      expect(caption).toContain('without watermark');
    });

    it('formats Instagram Reel caption', () => {
      const video: ResolvedVideo = {
        platform: 'instagram',
        directUrl: 'https://cdn.example.com/video.mp4',
        title: 'Sunset in Bali',
      };

      const caption = formatCaption(video);
      expect(caption).toContain('📸 Instagram Reel');
      expect(caption).toContain('Sunset in Bali');
    });

    it('truncates excessively long titles gracefully', () => {
      const longTitle = 'a'.repeat(300);
      const video: ResolvedVideo = {
        platform: 'youtube',
        directUrl: 'https://cdn.example.com/video.mp4',
        title: longTitle,
      };

      const caption = formatCaption(video);
      expect(caption).toContain('▶️ YouTube Short');
      expect(caption).toContain('...');
      expect(caption.length).toBeLessThan(400);
    });
  });

  describe('Bot Update Processing & Fallback Flow', () => {
    it('handles /start command with informative greeting', async () => {
      const bot = createBot('1234567890:ABCdefGHIjklMNOpqrsTUVwxyz');
      bot.botInfo = {
        id: 1234567890,
        is_bot: true,
        first_name: 'VideoDownloaderBot',
        username: 'VideoDownloaderBot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      let sentMessage = '';
      bot.api.config.use((_prev, method, payload: any) => {
        if (method === 'sendMessage') {
          sentMessage = payload.text;
          return { ok: true, result: { message_id: 101, date: 1, chat: { id: 42, type: 'private' }, text: payload.text } } as any;
        }
        return { ok: true, result: true } as any;
      });

      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 42, type: 'private' },
          text: '/start',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }],
        },
      });

      expect(sentMessage).toContain('Welcome to the Short-Form Video Downloader');
      expect(sentMessage).toContain('TikTok');
      expect(sentMessage).toContain('Instagram');
      expect(sentMessage).toContain('YouTube Shorts');
    });

    it('handles /help command with instructions', async () => {
      const bot = createBot('1234567890:ABCdefGHIjklMNOpqrsTUVwxyz');
      bot.botInfo = {
        id: 1234567890,
        is_bot: true,
        first_name: 'VideoDownloaderBot',
        username: 'VideoDownloaderBot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      let sentMessage = '';
      bot.api.config.use((_prev, method, payload: any) => {
        if (method === 'sendMessage') {
          sentMessage = payload.text;
          return { ok: true, result: { message_id: 101, date: 1, chat: { id: 42, type: 'private' }, text: payload.text } } as any;
        }
        return { ok: true, result: true } as any;
      });

      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 42, type: 'private' },
          text: '/help',
          entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        },
      });

      expect(sentMessage).toContain('Help & Supported Platforms');
      expect(sentMessage).toContain('TikTok');
      expect(sentMessage).toContain('Instagram');
      expect(sentMessage).toContain('YouTube Shorts');
    });

    it('sends direct video when resolution succeeds and Telegram accepts video', async () => {
      const bot = createBot('1234567890:ABCdefGHIjklMNOpqrsTUVwxyz');
      bot.botInfo = {
        id: 1234567890,
        is_bot: true,
        first_name: 'VideoDownloaderBot',
        username: 'VideoDownloaderBot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      vi.spyOn(resolverModule, 'resolveVideo').mockResolvedValue({
        platform: 'tiktok',
        directUrl: 'https://v16.tiktokcdn.com/clean-video.mp4',
        title: 'Awesome Dance Move',
        author: 'dancer123',
      });

      let sentVideoUrl = '';
      let chatActionSent = '';

      bot.api.config.use((_prev, method, payload: any) => {
        if (method === 'sendChatAction') {
          chatActionSent = payload.action;
          return { ok: true, result: true } as any;
        }
        if (method === 'sendVideo') {
          sentVideoUrl = payload.video;
          return { ok: true, result: { message_id: 102, date: 1, chat: { id: 42, type: 'private' } } } as any;
        }
        return { ok: true, result: true } as any;
      });

      await bot.handleUpdate({
        update_id: 2,
        message: {
          message_id: 2,
          date: 1,
          chat: { id: 42, type: 'private' },
          text: 'Check this: https://vm.tiktok.com/ZM8xyZ123/',
        },
      });

      expect(chatActionSent).toBe('upload_video');
      expect(sentVideoUrl).toBe('https://v16.tiktokcdn.com/clean-video.mp4');
    });

    it('falls back to inline download button when Telegram sendVideo fails (>20MB limit)', async () => {
      const bot = createBot('1234567890:ABCdefGHIjklMNOpqrsTUVwxyz');
      bot.botInfo = {
        id: 1234567890,
        is_bot: true,
        first_name: 'VideoDownloaderBot',
        username: 'VideoDownloaderBot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      vi.spyOn(resolverModule, 'resolveVideo').mockResolvedValue({
        platform: 'youtube',
        directUrl: 'https://rr1---sn.googlevideo.com/large-video.mp4',
        title: 'High Resolution YouTube Short',
      });

      let fallbackText = '';
      let inlineKeyboardButtons: any = null;

      bot.api.config.use((_prev, method, payload: any) => {
        if (method === 'sendVideo') {
          // Simulate Telegram rejecting video > 20 MB or failing to fetch
          const error = new Error('400 Bad Request: failed to get HTTP URL content');
          (error as any).error_code = 400;
          (error as any).description = 'failed to get HTTP URL content';
          throw error;
        }
        if (method === 'sendMessage') {
          fallbackText = payload.text;
          inlineKeyboardButtons = payload.reply_markup;
          return { ok: true, result: { message_id: 103, date: 1, chat: { id: 42, type: 'private' }, text: payload.text } } as any;
        }
        return { ok: true, result: true } as any;
      });

      await bot.handleUpdate({
        update_id: 3,
        message: {
          message_id: 3,
          date: 1,
          chat: { id: 42, type: 'private' },
          text: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        },
      });

      expect(fallbackText).toContain('Telegram could not stream this video directly');
      expect(fallbackText).toContain('20 MB URL limit');
      expect(inlineKeyboardButtons).toBeDefined();
      expect(inlineKeyboardButtons.inline_keyboard[0][0].url).toBe('https://rr1---sn.googlevideo.com/large-video.mp4');
      expect(inlineKeyboardButtons.inline_keyboard[0][0].text).toContain('Download Clean Video');
    });

    it('sends polite error message when video is private or deleted', async () => {
      const bot = createBot('1234567890:ABCdefGHIjklMNOpqrsTUVwxyz');
      bot.botInfo = {
        id: 1234567890,
        is_bot: true,
        first_name: 'VideoDownloaderBot',
        username: 'VideoDownloaderBot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      vi.spyOn(resolverModule, 'resolveVideo').mockRejectedValue(
        new ResolverError('Video is private', 'instagram', 'PRIVATE_OR_DELETED')
      );

      let errorMessage = '';
      bot.api.config.use((_prev, method, payload: any) => {
        if (method === 'sendMessage') {
          errorMessage = payload.text;
          return { ok: true, result: { message_id: 104, date: 1, chat: { id: 42, type: 'private' }, text: payload.text } } as any;
        }
        return { ok: true, result: true } as any;
      });

      await bot.handleUpdate({
        update_id: 4,
        message: {
          message_id: 4,
          date: 1,
          chat: { id: 42, type: 'private' },
          text: 'https://www.instagram.com/reel/PrivateVideo/',
        },
      });

      expect(errorMessage).toContain('This video appears to be private, region-restricted, or deleted');
    });
  });
});
