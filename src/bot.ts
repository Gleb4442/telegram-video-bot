import { Bot, GrammyError, HttpError, InlineKeyboard, InlineQueryResultBuilder, InputMediaBuilder } from 'grammy';
import { getConfig } from './config.js';
import { extractSupportedUrls, resolveVideo } from './services/resolvers/index.js';
import { ResolvedVideo, ResolverError, SupportedPlatform } from './types/resolver.js';

export interface UserPreferences {
  cleanMode: boolean; // if true, send video without title/author caption
}

// In-memory cache for user preferences
const userPrefsMap = new Map<number, UserPreferences>();

export function getUserPreferences(userId: number): UserPreferences {
  return userPrefsMap.get(userId) || { cleanMode: false };
}

export function setUserPreferences(userId: number, prefs: Partial<UserPreferences>): void {
  const current = getUserPreferences(userId);
  userPrefsMap.set(userId, { ...current, ...prefs });
}

/**
 * Escapes special HTML characters for Telegram HTML parse mode.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats a clean caption for the video message.
 */
export function formatCaption(video: ResolvedVideo): string {
  const platformIcons: Record<SupportedPlatform, string> = {
    tiktok: '🎵 TikTok',
    instagram: '📸 Instagram',
    youtube: '▶️ YouTube Shorts',
    twitter: '𝕏 Twitter / X',
    reddit: '🤖 Reddit',
    threads: '🧵 Threads',
    pinterest: '📌 Pinterest',
  };

  const lines: string[] = [];
  const icon = platformIcons[video.platform] || '🎬 Видео';
  const typeLabel = video.isAlbum ? ' (Альбом / Карусель)' : '';
  lines.push(`<b>${icon}${typeLabel}</b>`);

  if (video.title && !video.title.endsWith('.mp4')) {
    const cleanTitle = video.title.length > 200 ? `${video.title.slice(0, 197)}...` : video.title;
    lines.push(`📌 <i>${escapeHtml(cleanTitle)}</i>`);
  }

  if (video.author) {
    lines.push(`👤 <i>@${escapeHtml(video.author)}</i>`);
  }

  return lines.join('\n');
}

/**
 * Factory function to create and configure the grammY Bot instance.
 */
export function createBot(customToken?: string): Bot {
  const token = customToken || getConfig().TELEGRAM_BOT_TOKEN;
  const bot = new Bot(token);

  // Global error handler to prevent crashing
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[Bot Error] Error while handling update ${ctx.update.update_id}:`, err.error);

    const e = err.error;
    if (e instanceof GrammyError) {
      console.error('[Bot Error] Grammy error description:', e.description);
    } else if (e instanceof HttpError) {
      console.error('[Bot Error] Telegram network error:', e);
    } else {
      console.error('[Bot Error] Unexpected error:', e);
    }
  });

  // /start command
  bot.command('start', async (ctx) => {
    const welcomeText =
      `👋 <b>Добро пожаловать в Universal Media Downloader!</b>\n\n` +
      `Я скачиваю видео и фото-карусели <b>в максимальном HD-качестве без водяных знаков</b> из:\n` +
      `• 🎵 <b>TikTok</b> (видео, фото-слайдшоу, музыка)\n` +
      `• 📸 <b>Instagram</b> (Reels, посты, карусели фото)\n` +
      `• ▶️ <b>YouTube Shorts</b>\n` +
      `• 𝕏 <b>Twitter / X</b>\n` +
      `• 🤖 <b>Reddit</b>\n` +
      `• 🧵 <b>Threads</b>\n` +
      `• 📌 <b>Pinterest</b>\n\n` +
      `🚀 <b>Как пользоваться:</b>\n` +
      `Просто отправьте или перешлите мне ссылку на любое видео или альбом.\n\n` +
      `⚙️ Настроить режим отображения: /settings`;

    await ctx.reply(welcomeText, { parse_mode: 'HTML' });
  });

  // /help command
  bot.command('help', async (ctx) => {
    const helpText =
      `📖 <b>Поддерживаемые платформы</b>\n\n` +
      `Отправьте ссылку одного из следующих форматов:\n\n` +
      `• 🎵 <b>TikTok:</b> tiktok.com / vm.tiktok.com / vt.tiktok.com (видео и слайдшоу)\n` +
      `• 📸 <b>Instagram:</b> instagram.com/reel/... или /p/... (Reels и карусели)\n` +
      `• ▶️ <b>YouTube Shorts:</b> youtube.com/shorts/... или youtu.be/...\n` +
      `• 𝕏 <b>Twitter / X:</b> twitter.com/... или x.com/...\n` +
      `• 🤖 <b>Reddit:</b> reddit.com/r/... или redd.it/...\n` +
      `• 🧵 <b>Threads:</b> threads.net/@...\n` +
      `• 📌 <b>Pinterest:</b> pin.it/... или pinterest.com/...\n\n` +
      `⚡ Медиа отправляются в оригинальном качестве с кнопками скачивания HD и аудио (MP3).\n` +
      `⚙️ Настройки бота: /settings`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  // /settings command
  bot.command('settings', async (ctx) => {
    const userId = ctx.from?.id || 0;
    const prefs = getUserPreferences(userId);

    const keyboard = new InlineKeyboard()
      .text(prefs.cleanMode ? '✅ Только чистое видео (без текста)' : '⚪ Только чистое видео (без текста)', 'pref_clean')
      .row()
      .text(!prefs.cleanMode ? '✅ С описанием и автором' : '⚪ С описанием и автором', 'pref_caption');

    await ctx.reply(
      `⚙️ <b>Настройки скачивания:</b>\n\n` +
      `Выберите, как бот должен присылать медиа:\n\n` +
      `• <b>Только чистое видео:</b> ролик без лишних подписей — удобно сразу сохранять в галерею или пересылать.\n` +
      `• <b>С описанием:</b> добавляется платформа, название и автор.`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Settings toggle callback query
  bot.callbackQuery(['pref_clean', 'pref_caption'], async (ctx) => {
    const userId = ctx.from.id;
    const isClean = ctx.callbackQuery.data === 'pref_clean';
    setUserPreferences(userId, { cleanMode: isClean });

    const keyboard = new InlineKeyboard()
      .text(isClean ? '✅ Только чистое видео (без текста)' : '⚪ Только чистое видео (без текста)', 'pref_clean')
      .row()
      .text(!isClean ? '✅ С описанием и автором' : '⚪ С описанием и автором', 'pref_caption');

    await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery({
      text: isClean ? 'Режим: Только чистое видео' : 'Режим: С описанием и автором',
    });
  });

  // Inline Query Handler (@bot <url>)
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const urls = extractSupportedUrls(query);

    if (urls.length === 0) {
      await ctx.answerInlineQuery([], { cache_time: 10 });
      return;
    }

    const firstUrl = urls[0];
    if (!firstUrl) {
      await ctx.answerInlineQuery([], { cache_time: 10 });
      return;
    }

    try {
      const resolved = await resolveVideo(firstUrl);
      const caption = formatCaption(resolved);
      const thumb = resolved.thumbnailUrl || 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png';

      const result = InlineQueryResultBuilder.videoMp4(
        'inline_vid_1',
        resolved.title || `Видео из ${resolved.platform}`,
        resolved.directUrl,
        thumb,
        {
          caption,
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().url('📥 Скачать в HD', resolved.directUrl),
        }
      );

      await ctx.answerInlineQuery([result], { cache_time: 300 });
    } catch (e) {
      console.warn('[Bot] Inline query resolution failed:', e);
      await ctx.answerInlineQuery([], { cache_time: 10 });
    }
  });

  // Incoming text message handler
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;

    if (text.startsWith('/')) {
      return;
    }

    const urls = extractSupportedUrls(text);

    if (urls.length === 0) {
      if (ctx.chat.type === 'private') {
        await ctx.reply(
          `🔍 Не найдено поддерживаемой ссылки на медиа.\n\n` +
          `Поддерживаются: <b>TikTok, Instagram, YouTube Shorts, Twitter/X, Reddit, Threads, Pinterest</b>.`,
          { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
        );
      }
      return;
    }

    const userId = ctx.from?.id || 0;
    const prefs = getUserPreferences(userId);
    const targetUrls = urls.slice(0, 3);

    for (const url of targetUrls) {
      try {
        await ctx.replyWithChatAction('upload_video');
      } catch (e) {
        console.warn('[Bot] Failed to send chat action:', e);
      }

      try {
        const resolved = await resolveVideo(url);
        const caption = prefs.cleanMode ? undefined : formatCaption(resolved);

        // Case 1: Multi-item Album / Carousel (Instagram or TikTok photo slideshow)
        if (resolved.isAlbum && resolved.albumItems && resolved.albumItems.length > 1) {
          const items = resolved.albumItems.slice(0, 10);
          const mediaGroup = items.map((item, index) => {
            const itemCaption = index === 0 ? caption : undefined;
            if (item.type === 'video') {
              return InputMediaBuilder.video(item.url, {
                caption: itemCaption,
                parse_mode: 'HTML',
                supports_streaming: true,
              });
            }
            return InputMediaBuilder.photo(item.url, {
              caption: itemCaption,
              parse_mode: 'HTML',
            });
          });

          await ctx.replyWithMediaGroup(mediaGroup, {
            reply_to_message_id: ctx.message.message_id,
          });

          // If there's an attached audio track (e.g. TikTok slideshow music)
          if (resolved.audioUrl) {
            const audioKeyboard = new InlineKeyboard().url('🎧 Скачать аудио (MP3)', resolved.audioUrl);
            await ctx.reply('🎵 <i>К этому альбому прикреплена музыка:</i>', {
              parse_mode: 'HTML',
              reply_markup: audioKeyboard,
              reply_to_message_id: ctx.message.message_id,
            });
          }
          continue;
        }

        // Case 2: Single Video / Photo
        const keyboard = new InlineKeyboard().url('📥 Скачать в HD (без сжатия)', resolved.directUrl);
        if (resolved.audioUrl) {
          keyboard.row().url('🎧 Скачать аудио (MP3)', resolved.audioUrl);
        }

        try {
          await ctx.replyWithVideo(resolved.directUrl, {
            caption,
            parse_mode: 'HTML',
            supports_streaming: true,
            reply_markup: keyboard,
            reply_to_message_id: ctx.message.message_id,
          });
        } catch (streamError: unknown) {
          console.warn(
            `[Bot] sendVideo failed for ${resolved.platform} (${url}), sending inline button fallback:`,
            streamError instanceof Error ? streamError.message : streamError
          );

          const fallbackMessage =
            `🎬 <b>Видео готово!</b>\n\n` +
            `${caption ? `${caption}\n\n` : ''}` +
            `⚠️ <i>Размер файла превышает лимит прямого стриминга Telegram (20 МБ) или сервер Telegram временно ограничен.</i>\n\n` +
            `Нажмите кнопку ниже, чтобы открыть или скачать видео в оригинальном качестве:`;

          await ctx.reply(fallbackMessage, {
            reply_markup: keyboard,
            parse_mode: 'HTML',
            reply_to_message_id: ctx.message.message_id,
          });
        }
      } catch (error: unknown) {
        console.error(`[Bot] Error resolving media from ${url}:`, error);

        let userErrorMessage = '⚠️ Произошла ошибка при получении медиа.';

        if (error instanceof ResolverError) {
          switch (error.code) {
            case 'NOT_FOUND':
              userErrorMessage = '❌ Не удалось найти медиа. Проверьте правильность ссылки.';
              break;
            case 'PRIVATE_OR_DELETED':
              userErrorMessage = '🔒 Этот контент приватный, заблокирован в регионе или удален.';
              break;
            case 'RATE_LIMITED':
              userErrorMessage = '⏳ Сервис временно перегружен. Пожалуйста, повторите попытку через 1 минуту.';
              break;
            case 'TIMEOUT':
              userErrorMessage = '⏱️ Время ожидания ответа истекло. Пожалуйста, попробуйте еще раз.';
              break;
            case 'SCRAPER_DOWN':
              userErrorMessage = '🔧 Сервис парсинга временно недоступен. Попробуйте чуть позже.';
              break;
            case 'UNSUPPORTED':
              userErrorMessage = '❌ Этот формат ссылки пока не поддерживается.';
              break;
            default:
              userErrorMessage = `⚠️ Не удалось обработать медиа: ${escapeHtml(error.message)}`;
              break;
          }
        }

        await ctx.reply(userErrorMessage, {
          parse_mode: 'HTML',
          reply_to_message_id: ctx.message.message_id,
        });
      }
    }
  });

  return bot;
}

let botInstance: Bot | null = null;

export function getBot(): Bot {
  if (!botInstance) {
    botInstance = createBot();
  }
  return botInstance;
}
