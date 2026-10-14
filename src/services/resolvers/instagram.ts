import { z } from "zod";
import { ResolverError, type ResolvedVideo, type MediaItem } from "../../types/resolver.js";
import { platformForUrl, publicMediaUrl } from "../../utils/urls.js";

const ORIGIN = "https://www.instagram.com";
const QUERY = "PolarisLoggedOutDesktopWWWPostRootContentQuery";
// Instagram's current logged-out query; see yt-dlp InstagramIE (2026.08.19).
const DOCUMENT_ID = "27130156389949648";
const MediaSchema = z.object({
  media_type: z.number().optional(),
  video_versions: z.array(z.object({ url: z.string() })).optional(),
  image_versions2: z.object({ candidates: z.array(z.object({ url: z.string() })) }).optional(),
  caption: z.object({ text: z.string().optional() }).nullish(),
  user: z.object({ username: z.string().optional() }).optional(),
  video_duration: z.number().optional(),
});
const ProductSchema = MediaSchema.extend({ carousel_media: z.array(MediaSchema).optional() });
const ResponseSchema = z.object({ data: z.object({ xig_polaris_media: z.object({
  code: z.string(),
  if_not_gated_logged_out: ProductSchema.nullable(),
  gating_ruling: z.object({ gating_type: z.number().optional(), title: z.string().optional() }).nullish(),
}).nullable() }) });

export function instagramMediaId(shortcode: string): string {
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(shortcode))
    throw new ResolverError("Invalid Instagram shortcode", "instagram", "UNSUPPORTED");
  let id = 0n;
  for (const char of shortcode)
    id = id * 64n + BigInt("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(char));
  return String(id);
}

export function parseInstagramResponse(raw: unknown, shortcode: string): ResolvedVideo {
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.data.xig_polaris_media)
    throw new ResolverError("Instagram returned no media", "instagram", "SCRAPER_DOWN");
  const media = parsed.data.data.xig_polaris_media;
  if (media.code !== shortcode)
    throw new ResolverError("Instagram returned a different post", "instagram", "SCRAPER_DOWN");
  if (!media.if_not_gated_logged_out) {
    if (media.gating_ruling?.gating_type === 3 || /age/i.test(media.gating_ruling?.title ?? ""))
      throw new ResolverError("Instagram requires age-verified login", "instagram", "AGE_RESTRICTED");
    throw new ResolverError("Instagram did not grant access", "instagram", "SCRAPER_DOWN");
  }
  const product = media.if_not_gated_logged_out;
  const items = product.carousel_media ?? [product];
  if (!items.length || items.length > 100)
    throw new ResolverError("Invalid Instagram album", "instagram", "SCRAPER_DOWN");
  const alternatives: string[][] = [];
  const albumItems: MediaItem[] = items.map((item) => {
    // Never silently replace a video with its thumbnail when streams are missing.
    const video = item.media_type === 2 || !!item.video_versions?.length;
    const sources = video ? item.video_versions : item.image_versions2?.candidates;
    const urls = [...new Set((sources ?? []).map((entry) => publicMediaUrl(entry.url)))];
    if (!urls.length) throw new ResolverError("Instagram media has no stream", "instagram", "SCRAPER_DOWN");
    alternatives.push(urls);
    return { type: video ? "video" : "photo", url: urls[0]! };
  });
  return {
    platform: "instagram",
    directUrl: albumItems[0]!.url,
    mediaType: albumItems[0]!.type,
    alternativeUrls: alternatives[0]!.slice(1),
    title: product.caption?.text,
    author: product.user?.username,
    durationSeconds: product.video_duration,
    ...(product.carousel_media ? { isAlbum: true, albumItems } : {}),
  };
}

/** Fresh anonymous session per extraction: no account cookies, proxy, or third-party parser. */
export async function resolveInstagramDirect(url: string): Promise<ResolvedVideo> {
  if (platformForUrl(url) !== "instagram")
    throw new ResolverError("Invalid Instagram URL", "instagram", "UNSUPPORTED");
  const match = new URL(url).pathname.match(/^\/(?:reels?|p)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) throw new ResolverError("Instagram share link requires Cobalt", "instagram", "UNSUPPORTED");
  const shortcode = match[1]!;
  const mediaId = instagramMediaId(shortcode);
  try {
    // Lazy native import allows Cobalt fallback if a deployment lacks the binding.
    const { Curl, CurlOpt } = await import("curl-cffi-node");
    const curl = new Curl();
    curl.impersonateStr("chrome136", true);
    curl.enableCookies();
    curl.setoptLong(CurlOpt.TimeoutMs, 10000);
    curl.setoptLong(CurlOpt.ConnectTimeoutMs, 5000);
    curl.setoptLong(CurlOpt.FollowLocation, 0);
    curl.setoptLong(CurlOpt.SslVerifyPeer, 1);
    curl.setoptLong(CurlOpt.SslVerifyHost, 2);
    curl.setoptStr(CurlOpt.Url, ORIGIN + "/");
    // Raw native API doesn't decode Content-Encoding. Request identity explicitly.
    curl.setoptList(CurlOpt.HttpHeader, ["Accept-Encoding: identity"]);
    const page = await curl.performAsync();
    if (page.body.length > 4 * 1024 * 1024 || page.statusCode !== 200)
      throw new Error("Instagram bootstrap failed");
    const lsd = page.body.toString("utf8").match(/\["LSD",\[\],\{"token":"([^"]+)"/)?.[1];
    if (!lsd) throw new Error("Instagram session token missing");
    curl.setoptStr(CurlOpt.Url, ORIGIN + "/api/graphql");
    curl.setoptLong(CurlOpt.Post, 1);
    curl.setoptList(CurlOpt.HttpHeader, [
      "Accept-Encoding: identity", "X-IG-App-ID: 936619743392459", "X-ASBD-ID: 359341",
      "X-IG-WWW-Claim: 0", `Origin: ${ORIGIN}`, "Accept: */*",
      `X-FB-Friendly-Name: ${QUERY}`, `X-FB-LSD: ${lsd}`,
      "X-Requested-With: XMLHttpRequest", `Referer: ${ORIGIN}/reel/${shortcode}/`,
      "Content-Type: application/x-www-form-urlencoded",
    ]);
    curl.setoptStr(CurlOpt.PostFields, new URLSearchParams({
      lsd, fb_api_caller_class: "RelayModern", fb_api_req_friendly_name: QUERY,
      server_timestamps: "true", variables: JSON.stringify({ media_id: mediaId }), doc_id: DOCUMENT_ID,
    }).toString());
    const result = await curl.performAsync();
    if (result.statusCode === 429)
      throw new ResolverError("Instagram rate limit", "instagram", "RATE_LIMITED");
    if (result.statusCode !== 200 || result.body.length > 4 * 1024 * 1024)
      throw new Error("Instagram query failed");
    return parseInstagramResponse(JSON.parse(result.body.toString("utf8")), shortcode);
  } catch (error) {
    if (error instanceof ResolverError) throw error;
    throw new ResolverError("Direct Instagram extraction failed", "instagram", "SCRAPER_DOWN");
  }
}
