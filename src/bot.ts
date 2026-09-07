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
    instagram: '📸 Instagram Reel',
    youtube: '▶️ YouTube Short',
  };

  const lines: string[] = [];
  lines.push(`<b>${platformIcons[video.platform]}</b>`);

  if (video.title) {
    // Truncate title if excessively long for caption limits
    const cleanTitle = video.title.length > 250 ? `${video.title.slice(0, 247)}...` : video.title;
    lines.push(`📌 <i>${escapeHtml(cleanTitle)}</i>`);
  }

  if (video.author) {
    lines.push(`👤 <i>@${escapeHtml(video.author)}</i>`);
  }

  lines.push('✨ <i>Downloaded without watermark via @TeleVideoBot</i>');

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
      `👋 <b>Welcome to the Short-Form Video Downloader!</b>\n\n` +
      `I can download clean, high-quality videos <b>without watermarks</b> from:\n` +
      `• <b>TikTok</b> (videos & music)\n` +
      `• <b>Instagram Reels & Posts</b>\n` +
      `• <b>YouTube Shorts</b>\n\n` +
      `🚀 <b>How to use:</b>\n` +
      `Simply paste and send any video link directly to this chat.\n\n` +
      `ℹ️ <i>Note: Telegram limits direct video streaming via URL to 20 MB. If a video exceeds this limit, I will automatically provide a direct high-speed download link!</i>`;

    await ctx.reply(welcomeText, { parse_mode: 'HTML' });
  });

  // /help command
  bot.command('help', async (ctx) => {
    const helpText =
      `📖 <b>Help & Supported Platforms</b>\n\n` +
      `Send or forward a message containing one of these link formats:\n\n` +
      `🎵 <b>TikTok:</b>\n` +
      `• <code>https://www.tiktok.com/@user/video/...</code>\n` +
      `• <code>https://vm.tiktok.com/...</code> or <code>https://vt.tiktok.com/...</code>\n\n` +
      `📸 <b>Instagram:</b>\n` +
      `• <code>https://www.instagram.com/reel/...</code>\n` +
      `• <code>https://www.instagram.com/p/...</code>\n\n` +
      `▶️ <b>YouTube Shorts:</b>\n` +
      `• <code>https://www.youtube.com/shorts/...</code>\n` +
      `• <code>https://youtu.be/...</code>\n\n` +
      `⚡ All videos are resolved serverless and delivered directly to you.`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  // Incoming text message handler
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;

    // Ignore commands (already handled above)
    if (text.startsWith('/')) {
      return;
    }

    const urls = extractSupportedUrls(text);

    if (urls.length === 0) {
      // In private chats, give feedback if no supported URL was found
      if (ctx.chat.type === 'private') {
        await ctx.reply(
          `🔍 No supported video link found in your message.\n\n` +
          `Please send a valid link from <b>TikTok</b>, <b>Instagram Reels</b>, or <b>YouTube Shorts</b>.`,
          { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
        );
      }
      return;
    }

    // Process each supported link (limit to 3 per message to prevent timeouts)
    const targetUrls = urls.slice(0, 3);

    for (const url of targetUrls) {
      try {
        // Send typing / upload action immediately
        await ctx.replyWithChatAction('upload_video');
      } catch (e) {
        console.warn('[Bot] Failed to send chat action:', e);
      }

      try {
        // Resolve direct clean video CDN URL
        const resolved = await resolveVideo(url);
        const caption = formatCaption(resolved);

        try {
          // Attempt direct streaming to Telegram via URL
          await ctx.replyWithVideo(resolved.directUrl, {
            caption,
            parse_mode: 'HTML',
            reply_to_message_id: ctx.message.message_id,
          });
        } catch (streamError: unknown) {
          // Automated fallback: If Telegram rejects sendVideo by URL (e.g. > 20 MB limit or Telegram fetch issue)
          console.warn(
            `[Bot] sendVideo by URL failed for ${resolved.platform} (${url}), sending inline download button fallback:`,
            streamError instanceof Error ? streamError.message : streamError
          );

          const keyboard = new InlineKeyboard().url('⬇️ Download Clean Video', resolved.directUrl);

          const fallbackMessage =
            `🎬 <b>Video Ready!</b>\n\n` +
            `${resolved.title ? `📌 <i>${escapeHtml(resolved.title)}</i>\n\n` : ''}` +
            `⚠️ <i>Telegram could not stream this video directly (likely exceeds Telegram's 20 MB URL limit).</i>\n\n` +
            `Tap the button below to stream or download directly without watermark:`;

          await ctx.reply(fallbackMessage, {
            reply_markup: keyboard,
            parse_mode: 'HTML',
            reply_to_message_id: ctx.message.message_id,
          });
        }
      } catch (error: unknown) {
        console.error(`[Bot] Error resolving video from ${url}:`, error);

        let userErrorMessage = '⚠️ An unexpected error occurred while fetching the video.';

        if (error instanceof ResolverError) {
          switch (error.code) {
            case 'NOT_FOUND':
              userErrorMessage = '❌ Could not find the requested video. Please check if the link is correct.';
              break;
            case 'PRIVATE_OR_DELETED':
              userErrorMessage = '🔒 This video appears to be private, region-restricted, or deleted.';
              break;
            case 'RATE_LIMITED':
              userErrorMessage = '⏳ The downloader service is currently busy. Please try again in 1-2 minutes.';
              break;
            case 'TIMEOUT':
              userErrorMessage = '⏱️ The video service took too long to respond. Please try again shortly.';
              break;
            case 'SCRAPER_DOWN':
              userErrorMessage = '🔧 The scraper service is currently experiencing downtime or maintenance. Please try again later.';
              break;
            case 'UNSUPPORTED':
              userErrorMessage = '❌ This URL format is not supported.';
              break;
            default:
              userErrorMessage = `⚠️ Failed to process this video: ${escapeHtml(error.message)}`;
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
