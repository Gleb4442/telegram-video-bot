import { afterEach, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { BotInfo } from "../src/bot.js";
import { resetConfigForTesting } from "../src/config.js";

const state = vi.hoisted(() => ({ bot: null as Bot | null }));
vi.mock("../src/bot.js", () => ({ getBot: () => state.bot }));
import handler from "../api/webhook.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetConfigForTesting();
});

it.each(["web", "node"])(
  "does not acknowledge an unfinished update at 9 seconds (%s adapter)",
  async (mode) => {
    vi.useFakeTimers();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test-token");
    vi.stubEnv("TELEGRAM_SECRET_TOKEN", "audit-secret");
    resetConfigForTesting();
    const botInfo = {
      id: 123,
      is_bot: true,
      first_name: "Audit",
      username: "audit_bot",
    } as BotInfo;
    const bot = new Bot("1234567890:test-token", { botInfo });
    let delivered = false;
    bot.use(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      delivered = true;
    });
    state.bot = bot;
    let acknowledged = false;
    const headers = {
      "x-telegram-bot-api-secret-token": "audit-secret",
      "content-type": "application/json",
    };
    const update = { update_id: 1 };
    const response = {
      end: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    const promise =
      mode === "web"
        ? handler(
            new Request("https://example.com/api/webhook", {
              method: "POST",
              headers,
              body: JSON.stringify(update),
            }),
          )
        : handler(
            { method: "POST", headers, body: update } as any,
            response as any,
          );
    promise.then(() => {
      acknowledged = true;
    });
    await vi.advanceTimersByTimeAsync(9100);
    expect(acknowledged).toBe(false);
    expect(delivered).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(delivered).toBe(true);
    expect(acknowledged).toBe(true);
  },
);

it("rejects processing timeout instead of returning HTTP success", async () => {
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test-token");
  vi.stubEnv("TELEGRAM_SECRET_TOKEN", "audit-secret");
  resetConfigForTesting();
  const botInfo = {
    id: 123,
    is_bot: true,
    first_name: "Audit",
    username: "audit_bot",
  } as BotInfo;
  const bot = new Bot("1234567890:test-token", { botInfo });
  bot.use(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60000));
  });
  state.bot = bot;
  const pending = handler(
    new Request("https://example.com/api/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "audit-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ update_id: 1 }),
    }),
  );
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(55000);
  await rejected;
  await vi.advanceTimersByTimeAsync(5000);
});
