import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { InputFile } from "grammy";
import { installDelivery } from "../src/services/delivery.js";
import { resetConfigForTesting } from "../src/config.js";
import { downloadMedia } from "../src/services/download.js";
vi.mock("../src/services/download.js", () => ({ downloadMedia: vi.fn() }));
let middleware: any;
let transformer: any;
beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test");
  vi.stubEnv("TELEGRAM_SECRET_TOKEN", "test");
  vi.stubEnv("MEDIA_UPLOAD_ENABLED", "true");
  resetConfigForTesting();
  installDelivery({
    use: (fn: any) => (middleware = fn),
    api: { config: { use: (fn: any) => (transformer = fn) } },
  } as any);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  resetConfigForTesting();
});
it("uploads large videos as a multipart file and cleans temporary data", async () => {
  const cleanup = vi.fn();
  vi.mocked(downloadMedia).mockResolvedValue({
    path: "/tmp/fixture",
    bytes: 30_000_000,
    contentType: "video/mp4",
    cleanup,
  });
  const prev = vi.fn().mockResolvedValue({ ok: true, result: true });
  await middleware({ update: { update_id: 901 } }, () =>
    transformer(prev, "sendVideo", {
      video: "https://cdn.test/ten-minute.mp4",
    }),
  );
  expect(prev.mock.calls[0]![1].video).toBeInstanceOf(InputFile);
  expect(downloadMedia).toHaveBeenCalledWith(
    "https://cdn.test/ten-minute.mp4",
    50_000_000,
    300000,
    expect.anything(),
  );
  expect(cleanup).toHaveBeenCalledTimes(1);
});
it("cleans all downloaded album files after upload rejection", async () => {
  const cleanup = vi.fn();
  vi.mocked(downloadMedia).mockResolvedValue({
    path: "/tmp/fixture",
    bytes: 100,
    contentType: "image/jpeg",
    cleanup,
  });
  const prev = vi.fn().mockRejectedValue(new Error("transport"));
  await expect(
    middleware({ update: { update_id: 902 } }, () =>
      transformer(prev, "sendMediaGroup", {
        media: [
          { type: "document", media: "https://cdn.test/1" },
          { type: "document", media: "https://cdn.test/2" },
        ],
      }),
    ),
  ).rejects.toThrow("transport");
  expect(cleanup).toHaveBeenCalledTimes(2);
});
it("does not repeatedly send an ambiguous network failure", async () => {
  vi.mocked(downloadMedia).mockResolvedValue({
    path: "/tmp/fixture",
    bytes: 100,
    contentType: "video/mp4",
    cleanup: vi.fn(),
  });
  const prev = vi.fn().mockRejectedValue(new Error("connection lost"));
  await expect(
    middleware({ update: { update_id: 903 } }, () =>
      transformer(prev, "sendVideo", { video: "https://cdn.test/a" }),
    ),
  ).rejects.toThrow();
  expect(prev).toHaveBeenCalledTimes(1);
});
it("reuses Telegram file_id without downloading or uploading the same video again", async () => {
  const cleanup = vi.fn();
  vi.mocked(downloadMedia).mockResolvedValue({
    path: "/tmp/fixture",
    bytes: 30_000_000,
    contentType: "video/mp4",
    cleanup,
  });
  const prev = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      result: { video: { file_id: "telegram-cached-id" } },
    });
  await middleware({ update: { update_id: 904 } }, () =>
    transformer(prev, "sendVideo", {
      video: "https://cdn.test/reuse-test.mp4",
    }),
  );
  await middleware({ update: { update_id: 905 } }, () =>
    transformer(prev, "sendVideo", {
      video: "https://cdn.test/reuse-test.mp4",
    }),
  );
  expect(downloadMedia).toHaveBeenCalledTimes(1);
  expect(prev.mock.calls[1]![1].video).toBe("telegram-cached-id");
});
it('retries explicit Telegram 429 API responses instead of treating them as network errors',async()=>{
 const prev=vi.fn().mockResolvedValueOnce({ok:false,error_code:429,description:'Too Many Requests',parameters:{retry_after:0}}).mockResolvedValueOnce({ok:true,result:true});
 await middleware({update:{update_id:906}},()=>transformer(prev,'sendMessage',{text:'test'}));expect(prev).toHaveBeenCalledTimes(2);
});
it('does not retry expired Telegram callbacks',async()=>{
 const prev=vi.fn().mockResolvedValue({ok:false,error_code:400,description:'Bad Request: query is too old and response timeout expired'});
 const result=await middleware({update:{update_id:907}},()=>transformer(prev,'answerCallbackQuery',{callback_query_id:'expired'}));expect(result.ok).toBe(true);expect(prev).toHaveBeenCalledTimes(1);
});
