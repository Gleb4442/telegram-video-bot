import { MediaSizeError } from "./services/download.js";
import { resolveWithCobalt } from "./services/resolvers/cobalt.js";
import { installDelivery, setMediaSource } from "./services/delivery.js";
import { preferences, togglePreference, quota } from "./storage/state.js";
import {
  Bot,
  GrammyError,
  InlineKeyboard,
  InlineQueryResultBuilder,
  InputMediaBuilder,
} from "grammy";
import { getConfig } from "./config.js";
import {
  extractSupportedUrls,
  resolveVideo,
  resolveReliably,
  canonicalUrl,
} from "./services/resolvers/index.js";
import {
  ResolvedVideo,
  ResolverError,
  SupportedPlatform,
} from "./types/resolver.js";

export type BotInfo = NonNullable<
  ConstructorParameters<typeof Bot>[1]
>["botInfo"];

/**
 * Escapes special HTML characters for Telegram HTML parse mode.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Formats a clean caption for the video message.
 */
export function formatCaption(video: ResolvedVideo): string {
  const platformIcons: Record<SupportedPlatform, string> = {
    tiktok: "🎵 TikTok",
    instagram: "📸 Instagram",
    youtube: "▶️ YouTube Shorts",
    twitter: "𝕏 Twitter / X",
    reddit: "🤖 Reddit",
    threads: "🧵 Threads",
    pinterest: "📌 Pinterest",
  };

  const lines: string[] = [];
  const icon = platformIcons[video.platform] || "🎬 Видео";
  const typeLabel = video.isAlbum ? " (Альбом / Карусель)" : "";
  lines.push(`<b>${icon}${typeLabel}</b>`);

  if (video.title && !video.title.endsWith(".mp4")) {
    const cleanTitle =
      video.title.length > 200
        ? `${video.title.slice(0, 197)}...`
        : video.title;
    lines.push(`📌 <i>${escapeHtml(cleanTitle)}</i>`);
  }

  if (video.author) {
    lines.push(`👤 <i>@${escapeHtml(video.author.slice(0, 200))}</i>`);
  }

  return lines.join("\n");
}

/**
 * Factory function to create and configure the grammY Bot instance.
 */
export function createBot(customToken?: string, customBotInfo?: BotInfo): Bot {
  const token = customToken || getConfig().TELEGRAM_BOT_TOKEN;
  // grammY discovers the configured bot identity once and caches it per instance.
  const config = getConfig();
  const bot = new Bot(token, {
    botInfo: customBotInfo,
    client: { timeoutSeconds: config.INNGEST_EVENT_KEY ? 270 : 50 },
  });
  installDelivery(bot);

  bot.catch((err) =>
    console.error(
      JSON.stringify({
        event: "update_failed",
        update_id: err.ctx.update.update_id,
        code:
          err.error instanceof GrammyError
            ? err.error.error_code
            : "UNEXPECTED",
      }),
    ),
  );

  // /start command
  bot.command("start", async (ctx) => {
    const welcomeText =
      `👋 <b>Добро пожаловать в Universal Media Downloader!</b>\n\n` +
      `Я получаю видео и фото-карусели <b>в доступном у источника качестве</b> из:\n` +
      `• 🎵 <b>TikTok</b> (HD и аудио, если доступны)\n` +
      `• 📸 <b>Instagram</b> (Reels, посты, карусели фото)\n` +
      `• ▶️ <b>YouTube Shorts</b>\n` +
      `• 𝕏 <b>Twitter / X</b>\n` +
      `• 🤖 <b>Reddit</b>\n` +
      `• 🧵 <b>Threads</b>\n` +
      `• 📌 <b>Pinterest</b>\n\n` +
      `🚀 <b>Как пользоваться:</b>\n` +
      `Просто отправьте или перешлите мне ссылку на любое видео или альбом.\n\n` +
      `⚙️ Настроить режим отправки (видео / файл без сжатия): /settings`;

    await ctx.reply(welcomeText, { parse_mode: "HTML" });
  });

  // /help command
  bot.command("help", async (ctx) => {
    const helpText =
      `📖 <b>Поддерживаемые платформы</b>\n\n` +
      `Отправьте ссылку одного из следующих форматов:\n\n` +
      `• 🎵 <b>TikTok:</b> tiktok.com / vm.tiktok.com / vt.tiktok.com (качество источника)\n` +
      `• 📸 <b>Instagram:</b> instagram.com/reel/... или /p/... (Reels и карусели)\n` +
      `• ▶️ <b>YouTube Shorts:</b> youtube.com/shorts/... или youtu.be/...\n` +
      `• 𝕏 <b>Twitter / X:</b> twitter.com/... или x.com/...\n` +
      `• 🤖 <b>Reddit:</b> reddit.com/r/... или redd.it/...\n` +
      `• 🧵 <b>Threads:</b> threads.net/@...\n` +
      `• 📌 <b>Pinterest:</b> pin.it/... или pinterest.com/...\n\n` +
      `⚡ Качество зависит от источника. Ссылки на скачивание и аудио доступны, если их вернул сервис.\n` +
      `⚙️ Настройки бота: /settings`;

    await ctx.reply(helpText, { parse_mode: "HTML" });
  });

  // /settings command
  bot.command("settings", async (ctx) => {
    const userId = ctx.from?.id || 0;
    const prefs = await preferences(userId);

    const keyboard = new InlineKeyboard()
      .text(
        prefs.asDocument
          ? "📁 Формат: Документ (как файл)"
          : "🎬 Формат: Видео (плеер)",
        `pref_toggle_doc:${userId}`,
      )
      .row()
      .text(
        prefs.cleanMode
          ? "✂️ Подпись: Выключена (чистое видео)"
          : "📝 Подпись: Включена (с автором)",
        `pref_toggle_caption:${userId}`,
      );

    await ctx.reply(
      `⚙️ <b>Настройки скачивания:</b>\n\n` +
        `<b>1. Формат отправки:</b>\n` +
        `• <i>Видео (плеер):</i> проигрывается сразу в чате Telegram.\n` +
        `• <i>Документ (файл):</i> оригинальный файл загружается в Telegram без перекодирования.\n\n` +
        `<b>2. Описание:</b>\n` +
        `• <i>Выключено:</i> только чистый файл без текста.\n` +
        `• <i>Включено:</i> добавляется название и автор.\n\n` +
        `<i>${config.UPSTASH_REDIS_REST_URL ? "Настройки сохраняются между перезапусками." : "Без Redis настройки временные."} Нажмите кнопку для переключения:</i>`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // Settings toggle callback queries
  bot.callbackQuery(/^pref_toggle_(doc|caption)(?::(\d+))?$/, async (ctx) => {
    const userId = ctx.from.id;
    const owner = ctx.match[2] ? Number(ctx.match[2]) : undefined;
    if (
      (owner !== undefined && owner !== userId) ||
      (owner === undefined && ctx.chat?.type !== "private")
    ) {
      await ctx.answerCallbackQuery({
        text: "Это настройки другого пользователя. Откройте /settings для себя.",
      });
      return;
    }
    const updated = await togglePreference(
      userId,
      ctx.match[1] === "doc" ? "asDocument" : "cleanMode",
      ctx.update.update_id,
    );
    const keyboard = new InlineKeyboard()
      .text(
        updated.asDocument
          ? "📁 Формат: Документ (как файл)"
          : "🎬 Формат: Видео (плеер)",
        `pref_toggle_doc:${userId}`,
      )
      .row()
      .text(
        updated.cleanMode
          ? "✂️ Подпись: Выключена (чистое видео)"
          : "📝 Подпись: Включена (с автором)",
        `pref_toggle_caption:${userId}`,
      );

    await ctx
      .editMessageReplyMarkup({ reply_markup: keyboard })
      .catch((err) => {
        if (
          !(
            err instanceof GrammyError &&
            /message is not modified|message to edit not found/i.test(
              err.description,
            )
          )
        )
          throw err;
      });
    await ctx.answerCallbackQuery({
      text: "Настройки обновлены!",
    });
  });

  // Inline Query Handler (@bot <url>)
  bot.on("inline_query", async (ctx) => {
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
      const thumb =
        resolved.thumbnailUrl ||
        "https://cdn-icons-png.flaticon.com/512/1384/1384060.png";

      if (resolved.isAlbum || resolved.mediaType === "photo") {
        await ctx.answerInlineQuery([], {
          cache_time: 0,
          button: {
            text: "Открыть бот для фото и альбомов",
            start_parameter: "download",
          },
        });
        return;
      }
      const result = InlineQueryResultBuilder.videoMp4(
        "inline_vid_1",
        resolved.title || `Видео из ${resolved.platform}`,
        resolved.directUrl,
        thumb,
        {
          caption,
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().url(
            "📥 Скачать оригинал",
            resolved.directUrl,
          ),
        },
      );

      await ctx.answerInlineQuery([result], { cache_time: 0 });
    } catch (e) {
      console.warn(
        "[Bot] Inline query resolution failed:",
        e instanceof ResolverError ? e.code : "UNKNOWN",
      );
      await ctx.answerInlineQuery([], { cache_time: 10 });
    }
  });

  // Incoming text message handler
  bot.on(["message:text", "message:caption"], async (ctx) => {
    const text = ctx.message.text ?? ctx.message.caption ?? "";
    const entities = ctx.message.entities ?? ctx.message.caption_entities ?? [];
    const hiddenLinks = entities.flatMap((entity) =>
      entity.type === "text_link" ? [entity.url] : [],
    );

    if (ctx.from?.is_bot) return;
    if (text.startsWith("/")) {
      if (ctx.chat.type === "private") await ctx.reply("Неизвестная команда. Список команд: /help");
      return;
    }

    const urls = extractSupportedUrls([text, ...hiddenLinks].join(" "));

    if (urls.length === 0) {
      if (ctx.chat.type === "private") {
        await ctx.reply(
          `🔍 Не найдено поддерживаемой ссылки на медиа.\n\n` +
            `Поддерживаются: <b>TikTok, Instagram, YouTube Shorts, Twitter/X, Reddit, Threads, Pinterest</b>.`,
          { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id },
        );
      }
      return;
    }

    const userId = ctx.from?.id || ctx.chat.id;
    if (!(await quota(userId, ctx.update.update_id))) {
      await ctx.reply(
        "⏳ Слишком много запросов. Подождите минуту и отправьте ссылку снова.",
      );
      return;
    }
    const prefs = await preferences(userId);
    const targetUrls = urls.slice(0, 3);
    if (urls.length > targetUrls.length) {
      await ctx.reply(
        "За одно сообщение обрабатываю до 3 ссылок. Остальные отправьте отдельно.",
      );
    }

    for (const url of targetUrls) {
      setMediaSource(canonicalUrl(url));
      try {
        // Optimized: Run typing action and link resolution IN PARALLEL
        const [_, resolved] = await Promise.all([
          ctx.replyWithChatAction("upload_video").catch(() => {}),
          config.INNGEST_EVENT_KEY ? resolveReliably(url) : resolveVideo(url),
        ]);

        const caption = prefs.cleanMode ? undefined : formatCaption(resolved);

        // Case 1: Multi-item Album / Carousel (Instagram or TikTok photo slideshow)
        if (
          resolved.isAlbum &&
          resolved.albumItems &&
          resolved.albumItems.length > 1
        ) {
          const batchSize =
            prefs.asDocument ||
            resolved.albumItems.some((item) => item.type === "video")
              ? 2
              : 10;
          for (
            let offset = 0;
            offset < resolved.albumItems.length;
            offset += batchSize
          ) {
            const items = resolved.albumItems.slice(offset, offset + batchSize);
            const batchCaption = offset === 0 ? caption : undefined;
            try {
              if (items.length === 1) {
                const item = items[0]!;
                if (prefs.asDocument) {
                  await ctx.replyWithDocument(item.url, {
                    caption: batchCaption,
                    parse_mode: "HTML",
                  });
                } else if (item.type === "photo") {
                  await ctx.replyWithPhoto(item.url, {
                    caption: batchCaption,
                    parse_mode: "HTML",
                  });
                } else {
                  await ctx.replyWithVideo(item.url, {
                    caption: batchCaption,
                    parse_mode: "HTML",
                    supports_streaming: true,
                  });
                }
              } else {
                const mediaGroup = items.map((item, index) => {
                  const options = {
                    caption: index === 0 ? batchCaption : undefined,
                    parse_mode: "HTML" as const,
                  };
                  if (prefs.asDocument)
                    return InputMediaBuilder.document(item.url, options);
                  return item.type === "video"
                    ? InputMediaBuilder.video(item.url, {
                        ...options,
                        supports_streaming: true,
                      })
                    : InputMediaBuilder.photo(item.url, options);
                });
                await ctx.replyWithMediaGroup(
                  mediaGroup as Parameters<typeof ctx.replyWithMediaGroup>[0],
                  { reply_to_message_id: ctx.message.message_id },
                );
              }
            } catch {
              const links = new InlineKeyboard();
              items.forEach((item, index) =>
                links.url(`📥 Медиа ${offset + index + 1}`, item.url).row(),
              );
              await ctx.reply(
                "Не удалось отправить часть альбома в Telegram. Скачайте эти файлы по ссылкам:",
                { reply_markup: links },
              );
            }
          }

          // If there's an attached audio track (e.g. TikTok slideshow music)
          if (resolved.audioUrl) {
            const audioKeyboard = new InlineKeyboard().url(
              "🎧 Скачать аудио",
              resolved.audioUrl,
            );
            await ctx.reply("🎵 <i>К этому альбому прикреплена музыка:</i>", {
              parse_mode: "HTML",
              reply_markup: audioKeyboard,
              reply_to_message_id: ctx.message.message_id,
            });
          }
          continue;
        }

        // Case 2: Single Video / Photo
        const keyboard = new InlineKeyboard().url(
          "📥 Скачать оригинал",
          resolved.directUrl,
        );
        if (resolved.audioUrl) {
          keyboard.row().url("🎧 Скачать аудио", resolved.audioUrl);
        }

        try {
          // If user prefers raw uncompressed file format, send as document
          if (prefs.asDocument) {
            await ctx.replyWithDocument(resolved.directUrl, {
              caption,
              parse_mode: "HTML",
              reply_markup: keyboard,
              reply_to_message_id: ctx.message.message_id,
            });
          } else if (
            resolved.mediaType === "photo" ||
            resolved.albumItems?.[0]?.type === "photo"
          ) {
            await ctx.replyWithPhoto(resolved.directUrl, {
              caption,
              parse_mode: "HTML",
              reply_markup: keyboard,
              reply_to_message_id: ctx.message.message_id,
            });
          } else {
            // Send as streaming video with native player
            await ctx.replyWithVideo(resolved.directUrl, {
              caption,
              parse_mode: "HTML",
              supports_streaming: true,
              reply_markup: keyboard,
              reply_to_message_id: ctx.message.message_id,
            });
          }
        } catch (streamError: unknown) {
          if (
            streamError instanceof MediaSizeError &&
            resolved.mediaType !== "photo" &&
            !resolved.isAlbum
          ) {
            try {
              const smallerUrl =
                resolved.alternativeUrls?.[0] ??
                (await resolveWithCobalt(url, resolved.platform, "480"))
                  .directUrl;
              const options = {
                caption,
                parse_mode: "HTML" as const,
                reply_markup: keyboard,
                reply_to_message_id: ctx.message.message_id,
              };
              if (prefs.asDocument)
                await ctx.replyWithDocument(smallerUrl, options);
              else
                await ctx.replyWithVideo(smallerUrl, {
                  ...options,
                  supports_streaming: true,
                });
              continue;
            } catch {
              /* Original remains available through the download button. */
            }
          }
          console.warn(
            `[Bot] sendMedia failed for ${resolved.platform}; sending download link:`,
            streamError instanceof GrammyError
              ? streamError.error_code
              : "UPLOAD_FAILED",
          );

          const fallbackMessage =
            `📥 <b>Медиа готово!</b>\n\n` +
            `${caption ? `${caption}\n\n` : ""}` +
            `⚠️ <i>Telegram не смог отправить файл. Возможные причины: размер превышает лимит 50 МБ, неподдерживаемый формат или ошибка загрузки.</i>\n\n` +
            `Нажмите кнопку ниже, чтобы открыть или скачать видео в оригинальном качестве:`;

          await ctx.reply(fallbackMessage, {
            reply_markup: keyboard,
            parse_mode: "HTML",
            reply_to_message_id: ctx.message.message_id,
          });
        }
      } catch (error: unknown) {
        console.error(
          JSON.stringify({
            event: "resolve_failed",
            update_id: ctx.update.update_id,
            code: error instanceof ResolverError ? error.code : "UNKNOWN",
          }),
        );

        let userErrorMessage = "⚠️ Произошла ошибка при получении медиа.";

        if (error instanceof ResolverError) {
          switch (error.code) {
            case "NOT_FOUND":
              userErrorMessage =
                "❌ Не удалось найти медиа. Проверьте правильность ссылки.";
              break;
            case "PRIVATE_OR_DELETED":
              userErrorMessage =
                "🔒 Этот контент приватный, заблокирован в регионе или удален.";
              break;
            case "AGE_RESTRICTED":
              userErrorMessage =
                "🔞 Instagram ограничил этот ролик по возрасту и требует входа в аккаунт. Бот сейчас скачивает только контент, доступный без авторизации.";
              break;
            case "RATE_LIMITED":
              userErrorMessage =
                "⏳ Сервис временно перегружен. Пожалуйста, повторите попытку через 1 минуту.";
              break;
            case "TIMEOUT":
              userErrorMessage =
                "⏱️ Время ожидания ответа истекло. Пожалуйста, попробуйте еще раз.";
              break;
            case "SCRAPER_DOWN":
              userErrorMessage =
                "🔧 Сервис парсинга временно недоступен. Попробуйте чуть позже.";
              break;
            case "UNSUPPORTED":
              userErrorMessage =
                "❌ Этот формат ссылки пока не поддерживается.";
              break;
            default:
              userErrorMessage =
                "⚠️ Сервис не смог обработать медиа. Попробуйте повторить запрос позже.";
              break;
          }
        }

        await ctx.reply(userErrorMessage, {
          parse_mode: "HTML",
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
