import { Bot, GrammyError, HttpError, InlineKeyboard, InlineQueryResultBuilder, InputMediaBuilder } from 'grammy';
import { UserFromGetMe } from 'grammy/types';
import { getConfig } from './config.js';
import { extractSupportedUrls, resolveVideo } from './services/resolvers/index.js';
import { ResolvedVideo, ResolverError, SupportedPlatform } from './types/resolver.js';

export interface UserPreferences {
  cleanMode: boolean; // true = omit text caption
  asDocument: boolean; // true = send as raw document to bypass Telegram player compression
}

// In-memory cache for user preferences
const userPrefsMap = new Map<number, UserPreferences>();

export function getUserPreferences(userId: number): UserPreferences {
  return userPrefsMap.get(userId) || { cleanMode: false, asDocument: false };
}

export function setUserPreferences(userId: number, prefs: Partial<UserPreferences>): void {
  const current = getUserPreferences(userId);
  userPrefsMap.set(userId, { ...current, ...prefs });
}

/**
 * Static bot info to eliminate Telegram API getMe round-trip on Vercel cold starts.
 */
export const defaultBotInfo: UserFromGetMe = {
  id: 8894030664,
  is_bot: true,
  first_name: 'TRS bot',
  username: 'trsdownloadbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: true,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

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
export function createBot(customToken?: string, customBotInfo?: UserFromGetMe): Bot {
  const token = customToken || getConfig().TELEGRAM_BOT_TOKEN;
  const botInfo = customBotInfo || defaultBotInfo;

  // Initializing with static botInfo completely avoids the getMe cold-start delay
  const bot = new Bot(token, { botInfo });

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
      `• 🎵 <b>TikTok</b> (Full HD 1080p + аудио)\n` +
      `• 📸 <b>Instagram</b> (Reels, посты, карусели фото)\n` +
      `• ▶️ <b>YouTube Shorts</b>\n` +
      `• 𝕏 <b>Twitter / X</b>\n` +
      `• 🤖 <b>Reddit</b>\n` +
      `• 🧵 <b>Threads</b>\n` +
      `• 📌 <b>Pinterest</b>\n\n` +
      `🚀 <b>Как пользоваться:</b>\n` +
      `Просто отправьте или перешлите мне ссылку на любое видео или альбом.\n\n` +
      `⚙️ Настроить режим отправки (видео / файл без сжатия): /settings`;

    await ctx.reply(welcomeText, { parse_mode: 'HTML' });
  });

  // /help command
  bot.command('help', async (ctx) => {
    const helpText =
      `📖 <b>Поддерживаемые платформы</b>\n\n` +
      `Отправьте ссылку одного из следующих форматов:\n\n` +
      `• 🎵 <b>TikTok:</b> tiktok.com / vm.tiktok.com / vt.tiktok.com (Full HD)\n` +
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
      .text(
        prefs.asDocument ? '📁 Формат: Документ (без сжатия)' : '🎬 Формат: Видео (плеер)',
        'pref_toggle_doc'
      )
      .row()
      .text(
        prefs.cleanMode ? '✂️ Подпись: Выключена (чистое видео)' : '📝 Подпись: Включена (с автором)',
        'pref_toggle_caption'
      );

    await ctx.reply(
      `⚙️ <b>Настройки скачивания:</b>\n\n` +
      `<b>1. Формат отправки:</b>\n` +
      `• <i>Видео (плеер):</i> проигрывается сразу в чате Telegram.\n` +
      `• <i>Документ (файл):</i> файл без малейшего сжатия Telegram (100% оригинальный битрейт).\n\n` +
      `<b>2. Описание:</b>\n` +
      `• <i>Выключено:</i> только чистый файл без текста.\n` +
      `• <i>Включено:</i> добавляется название и автор.\n\n` +
      `<i>Нажмите на кнопку ниже для переключения:</i>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Settings toggle callback queries
  bot.callbackQuery(['pref_toggle_doc', 'pref_toggle_caption'], async (ctx) => {
    const userId = ctx.from.id;
    const current = getUserPreferences(userId);

    if (ctx.callbackQuery.data === 'pref_toggle_doc') {
      const newAsDoc = !current.asDocument;
      setUserPreferences(userId, { asDocument: newAsDoc });
    } else if (ctx.callbackQuery.data === 'pref_toggle_caption') {
      const newClean = !current.cleanMode;
      setUserPreferences(userId, { cleanMode: newClean });
    }

    const updated = getUserPreferences(userId);
    const keyboard = new InlineKeyboard()
      .text(
        updated.asDocument ? '📁 Формат: Документ (без сжатия)' : '🎬 Формат: Видео (плеер)',
        'pref_toggle_doc'
      )
      .row()
      .text(
        updated.cleanMode ? '✂️ Подпись: Выключена (чистое видео)' : '📝 Подпись: Включена (с автором)',
        'pref_toggle_caption'
      );

    await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery({
      text: 'Настройки обновлены!',
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
        // Optimized: Run typing action and link resolution IN PARALLEL
        const [_, resolved] = await Promise.all([
          ctx.replyWithChatAction('upload_video').catch(() => {}),
          resolveVideo(url),
        ]);

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
          // If user prefers raw uncompressed file format, send as document
          if (prefs.asDocument) {
            await ctx.replyWithDocument(resolved.directUrl, {
              caption,
              parse_mode: 'HTML',
              reply_markup: keyboard,
              reply_to_message_id: ctx.message.message_id,
            });
          } else {
            // Send as streaming video with native player
            await ctx.replyWithVideo(resolved.directUrl, {
              caption,
              parse_mode: 'HTML',
              supports_streaming: true,
              reply_markup: keyboard,
              reply_to_message_id: ctx.message.message_id,
            });
          }
        } catch (streamError: unknown) {
          console.warn(
            `[Bot] sendMedia failed for ${resolved.platform} (${url}), sending inline button fallback:`,
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
