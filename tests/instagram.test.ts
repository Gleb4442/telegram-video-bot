import { expect, it, vi, afterEach, beforeEach } from "vitest";
import { instagramMediaId, parseInstagramResponse, resolveInstagramDirect } from "../src/services/resolvers/instagram.js";
import { InstagramResolver } from "../src/services/resolvers/cobalt.js";
import { resetConfigForTesting } from "../src/config.js";

const native = vi.hoisted(() => ({ performAsync: vi.fn(), setoptStr: vi.fn(), setoptLong: vi.fn(), setoptList: vi.fn() }));
vi.mock("curl-cffi-node", () => ({
  Curl: class { performAsync = native.performAsync; setoptStr = native.setoptStr;
    setoptLong = native.setoptLong; setoptList = native.setoptList;
    impersonateStr() {} enableCookies() {} },
  CurlOpt: new Proxy({}, { get: (_target, key) => key }),
}));

const response = (product: unknown, extra = {}) => ({ data: { xig_polaris_media: {
  code: "DeXA5froeiC", if_not_gated_logged_out: product, ...extra,
} } });
const video = { media_type: 2, video_versions: [{ url: "https://cdn.example/a.mp4" }, { url: "https://cdn.example/b.mp4" }] };
beforeEach(() => { vi.resetAllMocks(); resetConfigForTesting();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test"); vi.stubEnv("TELEGRAM_SECRET_TOKEN", "test");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetConfigForTesting(); });
it("converts shortcode without rounding 64-bit media ID", () => {
  expect(instagramMediaId("DeXA5froeiC")).toBe("4005674344597547138");
  expect(() => instagramMediaId("../bad")).toThrow();
});
it("extracts progressive video sources with captions", () => {
  expect(parseInstagramResponse(response({ ...video, caption: { text: "caption" }, user: { username: "author" } }), "DeXA5froeiC")).toMatchObject({
    platform: "instagram", mediaType: "video", directUrl: "https://cdn.example/a.mp4",
    alternativeUrls: ["https://cdn.example/b.mp4"], title: "caption", author: "author",
  });
});
it("recognizes age gating separately from scraper outage", () => {
  expect(() => parseInstagramResponse(response(null, { gating_ruling: { gating_type: 3, title: "Age-restricted content" } }), "DeXA5froeiC")).toThrow(expect.objectContaining({ code: "AGE_RESTRICTED" }));
});
it("rejects wrong post and missing video instead of returning thumbnail", () => {
  expect(() => parseInstagramResponse(response(video), "other")).toThrow();
  expect(() => parseInstagramResponse(response({ media_type: 2, image_versions2: { candidates: [{ url: "https://cdn.example/thumb.jpg" }] } }), "DeXA5froeiC")).toThrow();
});
it("preserves mixed albums and rejects unsafe media URLs", () => {
  const photo = { media_type: 1, image_versions2: { candidates: [{ url: "https://cdn.example/photo.jpg" }] } };
  expect(parseInstagramResponse(response({ carousel_media: [video, photo] }), "DeXA5froeiC").albumItems?.map(i => i.type)).toEqual(["video", "photo"]);
  expect(() => parseInstagramResponse(response({ ...video, video_versions: [{ url: "http://127.0.0.1/file" }] }), "DeXA5froeiC")).toThrow();
});
it("keeps support for existing Instagram URLs", () => {
  expect(new InstagramResolver().supports("https://www.instagram.com/reel/DeXA5froeiC/?cplk=tracking")).toBe(true);
});
function directResponses(product: unknown, extra = {}) {
  native.performAsync.mockResolvedValueOnce({ statusCode: 200, body: Buffer.from('["LSD",[],{"token":"anonymous-token"}') })
    .mockResolvedValueOnce({ statusCode: 200, body: Buffer.from(JSON.stringify(response(product, extra))) });
}
it("uses current media_id query and anonymous asynchronous browser transport", async () => {
  directResponses(video);
  await expect(resolveInstagramDirect("https://www.instagram.com/reel/DeXA5froeiC/?cplk=tracking")).resolves.toMatchObject({ mediaType: "video" });
  const body = native.setoptStr.mock.calls.find(([key]) => key === "PostFields")![1];
  const fields = new URLSearchParams(body);
  expect(fields.get("doc_id")).toBe("27130156389949648");
  expect(JSON.parse(fields.get("variables")!)).toEqual({ media_id: "4005674344597547138" });
  expect(body).not.toContain("tracking");
  expect(native.setoptLong).toHaveBeenCalledWith("FollowLocation", 0);
  expect(native.setoptLong).toHaveBeenCalledWith("SslVerifyPeer", 1);
});
it("does not send gated videos through another parser or label them unavailable", async () => {
  directResponses(null, { gating_ruling: { gating_type: 3 } });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(new InstagramResolver().resolve("https://www.instagram.com/reel/DeXA5froeiC/")).rejects.toMatchObject({ code: "AGE_RESTRICTED" });
  expect(fetch).not.toHaveBeenCalled();
});
it("falls back to Cobalt if native transport cannot extract media", async () => {
  native.performAsync.mockRejectedValueOnce(new Error("transport failure"));
  vi.stubEnv("COBALT_API_URL", "https://primary.example/"); vi.stubEnv("COBALT_FALLBACK_URLS", "");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "redirect", url: "https://cdn.example/fallback.mp4" }))));
  await expect(new InstagramResolver().resolve("https://www.instagram.com/reel/DeXA5froeiC/")).resolves.toMatchObject({ directUrl: "https://cdn.example/fallback.mp4" });
});
