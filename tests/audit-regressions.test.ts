import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBot, formatCaption, type BotInfo } from "../src/bot.js";
import * as resolvers from "../src/services/resolvers/index.js";
import {
  InstagramResolver,
  YouTubeResolver,
} from "../src/services/resolvers/cobalt.js";
import { TikTokResolver } from "../src/services/resolvers/tiktok.js";
import { resetConfigForTesting } from "../src/config.js";
import { MemoryCache } from "../src/utils/cache.js";
import { fetchJsonWithTimeout } from "../src/utils/http.js";

const botInfo: BotInfo = {
  id: 123,
  is_bot: true,
  first_name: "Audit bot",
  username: "audit_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
const user = { id: 999, is_bot: false, first_name: "Audit" };
const chat = { id: 999, type: "private" as const, first_name: "Audit" };
const cdn = "https://cdn.example.com/";

function setupBot(discoverIdentity = false) {
  const bot = createBot(
    "1234567890:test-token",
    discoverIdentity ? undefined : botInfo,
  );
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "getMe" ? botInfo : true } as any;
  });
  return { bot, calls };
}
function textUpdate(text: string) {
  return {
    update_id: 1,
    message: { message_id: 1, date: 1, chat, from: user, text },
  };
}
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetConfigForTesting();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test-token");
  vi.stubEnv("TELEGRAM_SECRET_TOKEN", "audit-secret");
  vi.stubEnv("COBALT_API_URL", "https://primary.example.com/");
  vi.stubEnv("COBALT_FALLBACK_URLS", "");
  vi.stubEnv("COBALT_API_KEY", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetConfigForTesting();
});

describe("Audit: media delivery", () => {
  it("sends a single photo with sendPhoto", async () => {
    vi.spyOn(resolvers, "resolveVideo").mockResolvedValue({
      platform: "instagram",
      directUrl: cdn + "1.jpg",
      mediaType: "photo",
    });
    const { bot, calls } = setupBot();
    await bot.handleUpdate(textUpdate("https://instagram.com/p/test/"));
    expect(calls.find((c) => c.method === "sendPhoto")?.payload.photo).toBe(
      cdn + "1.jpg",
    );
    expect(calls.some((c) => c.method === "sendVideo")).toBe(false);
  });

  it.each([11, 21])(
    "delivers every item in a %i-item album, including a single-item tail",
    async (count) => {
      vi.spyOn(resolvers, "resolveVideo").mockResolvedValue({
        platform: "instagram",
        directUrl: cdn + "0.jpg",
        isAlbum: true,
        albumItems: Array.from({ length: count }, (_, i) => ({
          type: "photo" as const,
          url: cdn + i + ".jpg",
        })),
      });
      const { bot, calls } = setupBot();
      await bot.handleUpdate(textUpdate("https://instagram.com/p/test/"));
      const groups = calls.filter((c) => c.method === "sendMediaGroup");
      expect(groups.every((c) => c.payload.media.length === 10)).toBe(true);
      const sent = groups.flatMap((c) =>
        c.payload.media.map((m: any) => m.media),
      );
      sent.push(
        ...calls
          .filter((c) => c.method === "sendPhoto")
          .map((c) => c.payload.photo),
      );
      expect(sent).toEqual(
        Array.from({ length: count }, (_, i) => cdn + i + ".jpg"),
      );
    },
  );

  it("offers every failed album item as a download link", async () => {
    vi.spyOn(resolvers, "resolveVideo").mockResolvedValue({
      platform: "instagram",
      directUrl: cdn + "1.jpg",
      isAlbum: true,
      albumItems: [
        { type: "photo", url: cdn + "1.jpg" },
        { type: "photo", url: cdn + "2.jpg" },
      ],
    });
    const { bot, calls } = setupBot();
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === "sendMediaGroup")
        throw new Error("Telegram rejected album");
      return prev(method, payload, signal);
    });
    await bot.handleUpdate(textUpdate("https://instagram.com/p/test/"));
    const links = calls
      .find((c) => c.method === "sendMessage")
      ?.payload.reply_markup.inline_keyboard.flat()
      .map((b: any) => b.url);
    expect(links).toEqual([cdn + "1.jpg", cdn + "2.jpg"]);
  });

  it("resolves links hidden in a forwarded media caption", async () => {
    const resolve = vi
      .spyOn(resolvers, "resolveVideo")
      .mockResolvedValue({ platform: "tiktok", directUrl: cdn + "video.mp4" });
    const { bot } = setupBot();
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        from: user,
        chat,
        caption: "Видео",
        caption_entities: [
          {
            type: "text_link",
            offset: 0,
            length: 5,
            url: "https://vm.tiktok.com/test/",
          },
        ],
        photo: [
          { file_id: "id", file_unique_id: "unique", width: 100, height: 100 },
        ],
      },
    });
    expect(resolve).toHaveBeenCalledWith("https://vm.tiktok.com/test/");
  });

  it("discovers actual bot identity so addressed commands work for a different bot", async () => {
    const { bot, calls } = setupBot(true);
    await bot.init();
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat,
        from: user,
        text: "/help@audit_bot",
        entities: [{ type: "bot_command", offset: 0, length: 15 }],
      },
    });
    expect(calls.some((c) => c.method === "getMe")).toBe(true);
    expect(
      calls.find((c) => c.method === "sendMessage")?.payload.text,
    ).toContain("Поддерживаемые платформы");
  });

  it("keeps captions within Telegram limits when the scraper returns an enormous author", () => {
    const caption = formatCaption({
      platform: "tiktok",
      directUrl: cdn + "v.mp4",
      author: "<".repeat(5000),
      title: "A".repeat(5000),
    });
    expect(
      caption.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").length,
    ).toBeLessThan(1024);
  });
});

describe("Audit: HTTP and parsing", () => {
  it("bounds a JSON body that stalls after response headers", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValue({ json: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetch);
    const pending = fetchJsonWithTimeout("https://example.com", {
      timeoutMs: 50,
    });
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation during JSON reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => new Promise(() => {}) }),
    );
    const controller = new AbortController();
    const pending = fetchJsonWithTimeout("https://example.com", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller cancelled"));
    await expect(pending).rejects.toThrow("caller cancelled");
  });

  it("does not return a video-only local-processing tunnel as a complete video", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          status: "local-processing",
          tunnel: [cdn + "video.mp4", cdn + "audio.m4a"],
          audio: { format: "aac" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      new YouTubeResolver().resolve("https://youtube.com/shorts/test"),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body).localProcessing).toBe(
      "disabled",
    );
  });

  it("retains a single Cobalt picker photo type", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({
            status: "picker",
            picker: [{ type: "photo", url: cdn + "photo.jpg" }],
          }),
        ),
    );
    expect(
      await new InstagramResolver().resolve("https://instagram.com/p/test"),
    ).toMatchObject({ mediaType: "photo" });
  });

  it.each([429, 503])("classifies TikWM HTTP %i correctly", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, status)));
    await expect(
      new TikTokResolver().resolve("https://vm.tiktok.com/test/"),
    ).rejects.toMatchObject({
      code: status === 429 ? "RATE_LIMITED" : "SCRAPER_DOWN",
    });
  });

  it.each([429, 503])(
    "classifies Cobalt HTTP %i even with a non-JSON body",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("temporarily unavailable", { status }),
          ),
      );
      await expect(
        new YouTubeResolver().resolve("https://youtube.com/shorts/test"),
      ).rejects.toMatchObject({
        code: status === 429 ? "RATE_LIMITED" : "SCRAPER_DOWN",
      });
    },
  );
});

describe("Audit: LRU", () => {
  it("updates an existing key at capacity without evicting an unrelated key", () => {
    const cache = new MemoryCache<string>(2, 1000);
    cache.set("a", "a");
    cache.set("b", "b");
    cache.set("b", "new");
    expect(cache.get("a")).toBe("a");
    expect(cache.get("b")).toBe("new");
  });
  it("expires at the exact TTL boundary", () => {
    vi.useFakeTimers();
    const cache = new MemoryCache<string>(2, 50);
    cache.set("a", "a");
    vi.advanceTimersByTime(50);
    expect(cache.get("a")).toBeUndefined();
  });
});
