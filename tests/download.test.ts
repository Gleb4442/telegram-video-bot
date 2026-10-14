import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { readFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  downloadMedia,
  mediaAgent,
  MediaSizeError,
} from "../src/services/download.js";
import { lookup } from "node:dns/promises";
import { request } from "undici";
const captured = vi.hoisted(() => ({ options: null as any }));
vi.mock("undici", () => ({
  request: vi.fn(),
  Agent: class {
    constructor(options: any) {
      captured.options = options;
    }
    async close() {}
  },
}));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
function response(
  body: Readable,
  headers: Record<string, string> = {},
  statusCode = 200,
) {
  return { body, headers, statusCode } as any;
}
async function directories() {
  return (await readdir(tmpdir()))
    .filter((n) => n.startsWith("tvb-media-"))
    .sort();
}
it("streams a 30 MB file to disk and removes it after cleanup", async () => {
  vi.mocked(request).mockResolvedValue(
    response(
      Readable.from(
        (function* () {
          for (let i = 0; i < 30; i++) yield Buffer.alloc(1_000_000, 1);
        })(),
      ),
      { "content-type": "video/mp4" },
    ),
  );
  const result = await downloadMedia(
    "https://cdn.test/long.mp4",
    50_000_000,
    10000,
  );
  expect((await stat(result.path)).size).toBe(30_000_000);
  await result.cleanup();
  await expect(stat(result.path)).rejects.toThrow();
});
it("checks streaming size when Content-Length is missing", async () => {
  const before = await directories();
  vi.mocked(request).mockResolvedValue(
    response(Readable.from([Buffer.alloc(60)]), {
      "content-type": "video/mp4",
    }),
  );
  await expect(
    downloadMedia("https://cdn.test/a", 50, 1000),
  ).rejects.toBeInstanceOf(MediaSizeError);
  expect(await directories()).toEqual(before);
});
it("rejects declared oversized files before writing content", async () => {
  const before = await directories();
  vi.mocked(request).mockResolvedValue(
    response(Readable.from([Buffer.from("file")]), {
      "content-length": "1000",
    }),
  );
  await expect(
    downloadMedia("https://cdn.test/a", 50, 1000),
  ).rejects.toBeInstanceOf(MediaSizeError);
  expect(await directories()).toEqual(before);
});
it("rejects redirect to internal address without opening it", async () => {
  vi.mocked(request).mockResolvedValue(
    response(
      Readable.from([]),
      { location: "http://169.254.169.254/latest" },
      302,
    ),
  );
  await expect(downloadMedia("https://cdn.test/a", 50, 1000)).rejects.toThrow(
    "Unsafe",
  );
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects source error pages instead of uploading them", async () => {
  vi.mocked(request).mockResolvedValue(
    response(Readable.from([Buffer.from("<html>")]), {
      "content-type": "text/html",
    }),
  );
  await expect(downloadMedia("https://cdn.test/a", 50, 1000)).rejects.toThrow(
    "page",
  );
});
it("cancels a stalled body and removes its temporary directory", async () => {
  const before = await directories();
  vi.mocked(request).mockResolvedValue(
    response(new Readable({ read() {} }), { "content-type": "video/mp4" }),
  );
  await expect(downloadMedia("https://cdn.test/a", 50, 30)).rejects.toThrow();
  expect(await directories()).toEqual(before);
});
it("pins the actual socket lookup to validated addresses", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as any);
  mediaAgent();
  const callback = vi.fn();
  await new Promise<void>((resolve) =>
    captured.options.connect.lookup("cdn.test", {}, (...args: any[]) => {
      callback(...args);
      resolve();
    }),
  );
  expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
});
it("rejects mixed public/private DNS results against rebinding", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ] as any);
  mediaAgent();
  const callback = vi.fn();
  await new Promise<void>((resolve) =>
    captured.options.connect.lookup("cdn.test", {}, (...args: any[]) => {
      callback(...args);
      resolve();
    }),
  );
  expect(callback.mock.calls[0]![0]).toBeInstanceOf(Error);
});
it("keeps exact bytes rather than buffering or modifying the media", async () => {
  const bytes = Buffer.from([0, 1, 2, 254, 255]);
  vi.mocked(request).mockResolvedValue(
    response(Readable.from([bytes]), { "content-type": "video/mp4" }),
  );
  const result = await downloadMedia("https://cdn.test/a", 50, 1000);
  expect(await readFile(result.path)).toEqual(bytes);
  await result.cleanup();
});
