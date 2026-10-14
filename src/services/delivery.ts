import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { InputFile, type Bot, GrammyError } from "grammy";
import { downloadMedia } from "./download.js";
import { getConfig } from "../config.js";
import { MemoryCache } from "../utils/cache.js";
import { checkpoint, redis, namespace } from "../storage/state.js";

const deliveryContext = new AsyncLocalStorage<{
  updateId: number;
  sequence: number;
  source?: string;
  signal: AbortSignal;
}>();
const fileIds = new MemoryCache<string>(1000, 7 * 24 * 3600 * 1000);
export function setMediaSource(source: string) {
  const state = deliveryContext.getStore();
  if (state) state.source = source;
}
export function installDelivery(bot: Bot) {
  bot.use(async (ctx, next) => {
    const config = getConfig();
    return deliveryContext.run(
      {
        updateId: ctx.update.update_id,
        sequence: 0,
        signal: AbortSignal.timeout(config.INNGEST_EVENT_KEY ? 280000 : 50000),
      },
      next,
    );
  });
  bot.api.config.use(async (prev, method, payload, signal) => {
    const state = deliveryContext.getStore();
    if (!state) return prev(method, payload, signal);
    const send = method.startsWith("send") && method !== "sendChatAction";
    const part =
      send ||
      method === "editMessageReplyMarkup" ||
      method === "answerCallbackQuery"
        ? `${method}:${state.sequence++}`
        : undefined;
    const perform = async () => {
      const cleanup: Array<() => Promise<void>> = [];
      const config = getConfig();
      const uploadEnabled =
        process.env["MEDIA_UPLOAD_ENABLED"] === "true" ||
        (process.env["MEDIA_UPLOAD_ENABLED"] !== "false" &&
          process.env["NODE_ENV"] !== "test");
      try {
        state.signal.throwIfAborted();
        const combined = signal
          ? AbortSignal.any([state.signal, signal as unknown as AbortSignal])
          : state.signal;
        let prepared: any = { ...payload };
        let fileKey: string | undefined;
        let cachedFile = false;
        const storage = uploadEnabled ? await redis() : null;
        async function prepare(value: unknown, type: string) {
          if (
            typeof value !== "string" ||
            !/^https?:\/\//i.test(value) ||
            !uploadEnabled
          )
            return value;
          const cap =
            type === "photo"
              ? Math.min(config.MAX_UPLOAD_MB, 10)
              : config.MAX_UPLOAD_MB;
          const downloaded = await downloadMedia(
            value,
            cap * 1000000,
            config.MEDIA_TIMEOUT_SECONDS * 1000,
            combined,
          );
          cleanup.push(downloaded.cleanup);
          const extensions: Record<string, string> = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "video/webm": ".webm",
            "video/mp4": ".mp4",
            "video/quicktime": ".mov",
          };
          const extension =
            extensions[downloaded.contentType] ??
            (type === "photo" ? ".jpg" : ".mp4");
          return new InputFile(
            downloaded.path,
            createHash("sha256").update(value).digest("hex").slice(0, 12) +
              extension,
          );
        }
        if (["sendVideo", "sendPhoto", "sendDocument"].includes(method)) {
          const field =
            method === "sendVideo"
              ? "video"
              : method === "sendPhoto"
                ? "photo"
                : "document";
          const identity = state.source ?? String(prepared[field]);
          fileKey =
            namespace() +
            "file:" +
            createHash("sha256")
              .update(identity + ":" + field)
              .digest("hex");
          const cached = uploadEnabled
            ? (fileIds.get(fileKey) ?? (await storage?.get(fileKey)))
            : undefined;
          cachedFile = !!cached;
          prepared[field] = cached ?? (await prepare(prepared[field], field));
        } else if (method === "sendMediaGroup") {
          prepared.media = [];
          for (const item of (payload as any).media)
            prepared.media.push({
              ...item,
              media: await prepare(item.media, item.type),
            });
        }
        // Retry only explicit Telegram throttling; ambiguous transport errors may have delivered already.
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await prev(
              method,
              prepared,
              combined as unknown as typeof signal,
            );
            if (!response.ok) throw new GrammyError(response.description, response, method, prepared);
            if (uploadEnabled && fileKey && response.ok) {
              const message = response.result as any;
              const id =
                message.video?.file_id ??
                message.document?.file_id ??
                message.photo?.at(-1)?.file_id;
              if (typeof id === "string") {
                fileIds.set(fileKey, id);
                // Cache failure cannot turn an already delivered file into a failed send.
                await storage
                  ?.set(fileKey, id, 604800)
                  .catch(() =>
                    console.warn("[Delivery] File cache unavailable"),
                  );
              }
            }
            return response;
          } catch (err) {
            if ((method === 'answerInlineQuery' || method === 'answerCallbackQuery') && err instanceof GrammyError && err.error_code === 400 && /query is too old|query_id_invalid|query ID is invalid/i.test(err.description)) {
              console.warn('[Delivery] Expired query skipped');
              return { ok: true, result: true } as any;
            }
            if (
              cachedFile &&
              err instanceof GrammyError &&
              err.error_code === 400 &&
              /file.*(invalid|wrong)|wrong.*file|wrong file identifier/i.test(
                err.description,
              )
            ) {
              const field =
                method === "sendVideo"
                  ? "video"
                  : method === "sendPhoto"
                    ? "photo"
                    : "document";
              prepared[field] = await prepare((payload as any)[field], field);
              cachedFile = false;
              continue;
            }
            if (
              err instanceof GrammyError &&
              err.error_code === 429 &&
              attempt < 2 &&
              (err.parameters.retry_after ?? 0) <= 30
            ) {
              await new Promise<void>((resolve, reject) => {
                const abort = () => {
                  clearTimeout(timer);
                  reject(combined.reason);
                };
                const timer = setTimeout(
                  () => {
                    combined.removeEventListener("abort", abort);
                    resolve();
                  },
                  (err.parameters.retry_after ?? 1) * 1000,
                );
                combined.addEventListener("abort", abort, { once: true });
                if (combined.aborted) abort();
              });
              continue;
            }
            if (
              method === "sendVideo" &&
              prepared.video instanceof InputFile &&
              err instanceof GrammyError &&
              err.error_code === 400 &&
              /video_content_type_invalid|wrong type of the web page content|video format|video.*invalid/i.test(
                err.description,
              )
            ) {
              const {
                video,
                supports_streaming: _streaming,
                ...document
              } = prepared;
              return prev(
                "sendDocument",
                { ...document, document: video },
                combined as unknown as typeof signal,
              );
            }
            throw err;
          }
        }
      } finally {
        await Promise.all(cleanup.map((fn) => fn()));
      }
    };
    if (!part) return perform();
    const result = await checkpoint(state.updateId, part, perform);
    // Checkpointed sends are already delivered. Their return value is not used by handlers.
    return result ?? ({ ok: true, result: true } as any);
  });
}
