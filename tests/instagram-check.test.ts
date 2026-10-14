import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import handler from "../api/instagram-check.js";
import { resolveInstagramDirect } from "../src/services/resolvers/instagram.js";
import { downloadMedia } from "../src/services/download.js";
import { resetConfigForTesting } from "../src/config.js";
import { ResolverError } from "../src/types/resolver.js";
vi.mock("../src/services/resolvers/instagram.js", () => ({ resolveInstagramDirect: vi.fn() }));
vi.mock("../src/services/download.js", () => ({ downloadMedia: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:test");
  vi.stubEnv("TELEGRAM_SECRET_TOKEN", "test-secret"); resetConfigForTesting();
});
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTesting(); });
function request(body: unknown, secret = "test-secret", method = "POST") {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req: { method, body, headers: { "x-telegram-bot-api-secret-token": secret } }, res };
}
it("requires secret before any extraction and blocks non-POST methods", async () => {
  const a = request({url: "https://www.instagram.com/reel/id/"}, "wrong");
  await handler(a.req as any, a.res as any); expect(a.res.status).toHaveBeenCalledWith(401);
  const b = request({}, "test-secret", "GET"); await handler(b.req as any, b.res as any);
  expect(b.res.status).toHaveBeenCalledWith(405); expect(resolveInstagramDirect).not.toHaveBeenCalled();
});
it("validates request body", async () => {
  const {req, res} = request({url: 123}); await handler(req as any, res as any);
  expect(res.status).toHaveBeenCalledWith(400); expect(resolveInstagramDirect).not.toHaveBeenCalled();
});
it("reports age restrictions without sending media or signed URLs", async () => {
  vi.mocked(resolveInstagramDirect).mockRejectedValue(new ResolverError("gated", "instagram", "AGE_RESTRICTED"));
  const {req,res} = request({url: "https://www.instagram.com/reel/id/"});
  await handler(req as any, res as any); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ok:false,code:"AGE_RESTRICTED"}));
  expect(downloadMedia).not.toHaveBeenCalled();
});
it("checks actual MP4 bytes and always cleans the downloaded file", async () => {
  const dir=await mkdtemp(join(tmpdir(),"instagram-check-test-")); const path=join(dir,"file");
  try {
    await writeFile(path,Buffer.from([0,0,0,12,102,116,121,112,105,115,111,109]));
    const cleanup=vi.fn();vi.mocked(resolveInstagramDirect).mockResolvedValue({platform:"instagram",directUrl:"https://cdn.example/private-signed-url"});
    vi.mocked(downloadMedia).mockResolvedValue({path,bytes:12,contentType:"video/mp4",cleanup});
    const {req,res}=request({url:"https://www.instagram.com/reel/id/"});await handler(req as any,res as any);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ok:true,mp4:true,bytes:12}));expect(cleanup).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("signed-url");
  } finally {await rm(dir,{recursive:true,force:true});}
});
