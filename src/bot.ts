import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy';
import { getConfig } from './config.js';
import { extractSupportedUrls, resolveVideo } from './services/resolvers/index.js';
import { ResolvedVideo, ResolverError } from './types/resolver.js';

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
  const platformIcons: Record<ResolvedVideo['platform'], string> = {
    tiktok: '🎵 TikTok',
    instagram: '📸 Instagram',
    youtube: '▶️ YouTube Shorts',
  };

  const lines: string[] = [];
  lines.push(`<b>${platformIcons[video.platform]}</b>`);

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
      `👋 <b>Добро пожаловать в Video Downloader!</b>\n\n` +
      `Я скачиваю видео <b>в максимальном HD качестве без водяных знаков</b> из:\n` +
      `• <b>TikTok</b> (Full HD 1080p)\n` +
      `• <b>Instagram Reels & посты</b>\n` +
      `• <b>YouTube Shorts</b>\n\n` +
      `🚀 <b>Как пользоваться:</b>\n` +
      `Просто отправьте или перешлите мне любую ссылку на видео.`;

    await ctx.reply(welcomeText, { parse_mode: 'HTML' });
  });

  // /help command
  bot.command('help', async (ctx) => {
    const helpText =
      `📖 <b>Поддерживаемые платформы</b>\n\n` +
      `Отправьте ссылку одного из следующих форматов:\n\n` +
      `🎵 <b>TikTok:</b> tiktok.com / vm.tiktok.com / vt.tiktok.com\n` +
      `📸 <b>Instagram:</b> instagram.com/reel/... или /p/...\n` +
      `▶️ <b>YouTube Shorts:</b> youtube.com/shorts/... или youtu.be/...\n\n` +
      `⚡ Видео скачиваются без водяных знаков в наилучшем доступном разрешении.`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
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
          `🔍 Не найдено поддерживаемой ссылки на видео.\n\n` +
          `Отправьте ссылку из <b>TikTok</b>, <b>Instagram Reels</b> или <b>YouTube Shorts</b>.`,
          { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
        );
      }
      return;
    }

    // Process each supported link (limit to 3 per message)
    const targetUrls = urls.slice(0, 3);

    for (const url of targetUrls) {
      try {
        await ctx.replyWithChatAction('upload_video');
      } catch (e) {
        console.warn('[Bot] Failed to send chat action:', e);
      }

      try {
        const resolved = await resolveVideo(url);
        const caption = formatCaption(resolved);
        const keyboard = new InlineKeyboard().url('📥 Скачать в HD (без сжатия)', resolved.directUrl);

        try {
          // Send with supports_streaming to preserve high-bitrate streaming playback
          await ctx.replyWithVideo(resolved.directUrl, {
            caption,
            parse_mode: 'HTML',
            supports_streaming: true,
            reply_markup: keyboard,
            reply_to_message_id: ctx.message.message_id,
          });
        } catch (streamError: unknown) {
          // Automated fallback if Telegram sendVideo by URL fails (>20 MB limit or Telegram fetch issue)
          console.warn(
            `[Bot] sendVideo failed for ${resolved.platform} (${url}), sending inline button fallback:`,
            streamError instanceof Error ? streamError.message : streamError
          );

          const fallbackMessage =
            `🎬 <b>Видео готово!</b>\n\n` +
            `${caption}\n\n` +
            `⚠️ <i>Размер файла превышает лимит прямого стриминга Telegram (20 МБ) или сервер Telegram временно ограничен.</i>\n\n` +
            `Нажмите кнопку ниже, чтобы открыть или скачать видео в оригинальном качестве без сжатия:`;

          await ctx.reply(fallbackMessage, {
            reply_markup: keyboard,
            parse_mode: 'HTML',
            reply_to_message_id: ctx.message.message_id,
          });
        }
      } catch (error: unknown) {
        console.error(`[Bot] Error resolving video from ${url}:`, error);

        let userErrorMessage = '⚠️ Произошла ошибка при получении видео.';

        if (error instanceof ResolverError) {
          switch (error.code) {
            case 'NOT_FOUND':
              userErrorMessage = '❌ Не удалось найти видео. Проверьте правильность ссылки.';
              break;
            case 'PRIVATE_OR_DELETED':
              userErrorMessage = '🔒 Это видео приватное, заблокировано в регионе или удалено.';
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
              userErrorMessage = `⚠️ Не удалось обработать видео: ${escapeHtml(error.message)}`;
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
