import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  isPublicAddress,
  platformForUrl,
  publicMediaUrl,
  validateMedia,
} from "../src/utils/urls.js";
import {
  canonicalUrl,
  ResolverRegistry,
  videoCache,
} from "../src/services/resolvers/index.js";
import { resolveWithCobalt } from "../src/services/resolvers/cobalt.js";
import { resetConfigForTesting } from "../src/config.js";
import { fetchJsonWithTimeout } from "../src/utils/http.js";

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test");
  vi.stubEnv("TELEGRAM_SECRET_TOKEN", "test");
  resetConfigForTesting();
  videoCache.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetConfigForTesting();
  videoCache.clear();
});
it.each([
  "https://evil.test/?next=https://vm.tiktok.com/test/",
  "https://pinterest.evil/pin/123/",
  "https://instagram.com@evil.test/reel/id/",
  "https://www.instagram.com:444/reel/id/",
])("rejects spoofed input %s", (url) => expect(platformForUrl(url)).toBeNull());
it.each([
  "http://127.0.0.1/video",
  "http://169.254.169.254/latest",
  "http://10.0.0.2/a",
  "http://[::1]/a",
  "file:///tmp/a",
  "https://user:pass@cdn.test/a",
  "https://localhost/video",
  "http://2130706433/a",
])("rejects unsafe media %s", (url) =>
  expect(() => publicMediaUrl(url)).toThrow(),
);
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "192.168.1.1",
  "100.64.0.1",
  "::1",
  "fc00::1",
  "::ffff:127.0.0.1",
  "fe80::1",
])("blocks nonpublic DNS address %s", (addr) =>
  expect(isPublicAddress(addr)).toBe(false),
);
it("accepts public CDN address and validates every album item", () => {
  expect(isPublicAddress("8.8.8.8")).toBe(true);
  expect(() =>
    validateMedia({
      platform: "instagram",
      directUrl: "https://cdn.test/a",
      albumItems: [{ type: "photo", url: "http://127.0.0.1/a" }],
    }),
  ).toThrow();
});
it("normalizes sharing parameters while retaining YouTube video identity", () => {
  expect(canonicalUrl("https://www.instagram.com/reel/id/?cplk=secret")).toBe(
    "https://www.instagram.com/reel/id/",
  );
  expect(canonicalUrl("https://youtube.com/watch?v=123")).toContain("v=123");
});
it("coalesces concurrent source lookups and caches result", async () => {
  const registry = new ResolverRegistry();
  const resolve = vi
    .fn()
    .mockResolvedValue({
      platform: "tiktok",
      directUrl: "https://cdn.test/v.mp4",
      durationSeconds: 1200,
    });
  registry.register({
    name: "fixture",
    platform: "tiktok",
    supports: (u) => u.includes("fixture.test"),
    resolve,
  });
  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      registry.resolve("https://fixture.test/unique"),
    ),
  );
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(results.every((r) => r.durationSeconds === 1200)).toBe(true);
});
it("sends authentication only to primary and rejects redirects", async () => {
  vi.stubEnv("COBALT_API_URL", "https://primary.test/");
  vi.stubEnv("COBALT_FALLBACK_URLS", "https://fallback.test/");
  vi.stubEnv("COBALT_API_KEY", "private-key");
  resetConfigForTesting();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "error",
          error: { code: "error.api.fetch.empty" },
        }),
        { status: 400 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "redirect", url: "https://cdn.test/v.mp4" }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await resolveWithCobalt("https://instagram.com/reel/id/", "instagram");
  expect(fetch.mock.calls[0]![1].headers.Authorization).toBe(
    "Api-Key private-key",
  );
  expect(fetch.mock.calls[1]![1].headers.Authorization).toBeUndefined();
  expect(fetch.mock.calls[0]![1].redirect).toBe("error");
});
it("bounds JSON response bodies even without Content-Length", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1))),
  );
  await expect(fetchJsonWithTimeout("https://api.test")).rejects.toThrow(
    "too large",
  );
});
it('does not expose credentials nested in transport error messages',async()=>{
 const {safeErrorCode}=await import('../src/utils/errors.js');
 expect(safeErrorCode(new Error('https://api.telegram.org/botPRIVATE_TOKEN/sendMessage failed'))).toBe('Error');
 expect(safeErrorCode({error_code:401,description:'PRIVATE_TOKEN'})).toBe('TELEGRAM_401');
});
