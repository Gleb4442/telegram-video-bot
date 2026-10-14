import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../src/config.js";
const mock = vi.hoisted(() => ({ enqueue: vi.fn(), getBot: vi.fn() }));
vi.mock("../src/services/jobs.js", () => ({ enqueueUpdate: mock.enqueue }));
vi.mock("../src/bot.js", () => ({ getBot: mock.getBot }));
import handler from "../api/webhook.js";
beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test");
  vi.stubEnv("TELEGRAM_SECRET_TOKEN", "test");
  vi.stubEnv("INNGEST_EVENT_KEY", "fake");
  vi.stubEnv("INNGEST_SIGNING_KEY", "fake");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake");
  resetConfigForTesting();
  mock.enqueue.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  resetConfigForTesting();
});
function req(secret = "test", body: any = { update_id: 1 }) {
  return new Request("https://app.test/api/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
}
it("returns success only after the durable scheduler accepts the update", async () => {
  let resolve: any;
  mock.enqueue.mockReturnValue(new Promise((r) => (resolve = r)));
  let completed = false;
  const p = handler(req()).then((r) => {
    completed = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 5));
  expect(completed).toBe(false);
  resolve();
  expect(((await p) as Response).status).toBe(200);
});
it("returns retryable failure when scheduler is unavailable", async () => {
  mock.enqueue.mockRejectedValue(new Error("down"));
  expect(((await handler(req())) as Response).status).toBe(503);
});
it("never publishes unauthorized updates", async () => {
  expect(((await handler(req("wrong"))) as Response).status).toBe(401);
  expect(mock.enqueue).not.toHaveBeenCalled();
});
it("validates Telegram update identifiers", async () => {
  expect(
    ((await handler(req("test", { update_id: "oops" }))) as Response).status,
  ).toBe(400);
  expect(mock.enqueue).not.toHaveBeenCalled();
});
it("queues parsed Vercel Node request bodies without consuming request stream", async () => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(
    {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "test" },
      body: { update_id: 2 },
    } as any,
    res as any,
  );
  expect(mock.enqueue).toHaveBeenCalledWith({ update_id: 2 });
  expect(res.status).toHaveBeenCalledWith(200);
});
