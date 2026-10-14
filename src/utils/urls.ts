import ipaddr from "ipaddr.js";
import type { SupportedPlatform, ResolvedVideo } from "../types/resolver.js";

export function isPublicAddress(address: string): boolean {
  try {
    return (
      ipaddr.process(address.replace(/^\[|\]$/g, "")).range() === "unicast"
    );
  } catch {
    return false;
  }
}

export function publicMediaUrl(raw: string): string {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    url.hostname === "localhost" ||
    !url.hostname.includes(".") ||
    (ipaddr.isValid(url.hostname.replace(/^\[|\]$/g, "")) &&
      !isPublicAddress(url.hostname))
  ) {
    throw new Error("Unsafe media URL");
  }
  return url.href;
}

export function validateMedia(video: ResolvedVideo): ResolvedVideo {
  video.directUrl = publicMediaUrl(video.directUrl);
  if (video.alternativeUrls)
    video.alternativeUrls = video.alternativeUrls.map(publicMediaUrl);
  if (video.audioUrl) video.audioUrl = publicMediaUrl(video.audioUrl);
  if (video.thumbnailUrl)
    video.thumbnailUrl = publicMediaUrl(video.thumbnailUrl);
  if (video.albumItems) {
    if (video.albumItems.length > 100)
      throw new Error("Album exceeds 100 items");
    video.albumItems = video.albumItems.map((item) => ({
      ...item,
      url: publicMediaUrl(item.url),
    }));
  }
  return video;
}

export function platformForUrl(raw: string): SupportedPlatform | null {
  try {
    const u = new URL(raw.trim());
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    const h = u.hostname.toLowerCase();
    const p = u.pathname;
    if (
      [
        "tiktok.com",
        "www.tiktok.com",
        "m.tiktok.com",
        "vm.tiktok.com",
        "vt.tiktok.com",
        "t.tiktok.com",
      ].includes(h) &&
      p.length > 1
    )
      return "tiktok";
    if (
      ["instagram.com", "www.instagram.com", "m.instagram.com"].includes(h) &&
      /^\/(reels?|p|share)\/[\w.-]+/.test(p)
    )
      return "instagram";
    if (
      (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(h) &&
        (/^\/shorts\/[\w-]+/.test(p) ||
          (p === "/watch" &&
            /^[\w-]+$/.test(u.searchParams.get("v") ?? "")))) ||
      (h === "youtu.be" && /^\/[\w-]+/.test(p))
    )
      return "youtube";
    if (
      [
        "twitter.com",
        "x.com",
        "www.twitter.com",
        "www.x.com",
        "mobile.twitter.com",
      ].includes(h) &&
      /^\/[\w]+\/status\/\d+/.test(p)
    )
      return "twitter";
    if (
      ([
        "reddit.com",
        "www.reddit.com",
        "old.reddit.com",
        "v.reddit.com",
      ].includes(h) &&
        /^\/r\/\w+\/comments\/\w+/.test(p)) ||
      (h === "redd.it" && /^\/\w+/.test(p))
    )
      return "reddit";
    if (
      [
        "threads.net",
        "threads.com",
        "www.threads.net",
        "www.threads.com",
      ].includes(h) &&
      /^\/(?:@[\w.-]+\/post|t)\/[\w-]+/.test(p)
    )
      return "threads";
    const pinterest = [
      "com",
      "co.uk",
      "de",
      "fr",
      "es",
      "it",
      "ca",
      "com.au",
      "jp",
      "co.kr",
      "com.mx",
      "pt",
      "ch",
      "at",
      "nl",
      "se",
      "dk",
      "ru",
      "com.br",
      "cl",
      "nz",
      "ie",
      "be",
      "ph",
      "co.in",
      "com.vn",
      "com.tr",
      "com.tw",
      "com.pe",
      "com.co",
      "com.ar",
      "com.sg",
      "co.za",
      "id",
    ];
    if (
      (h === "pin.it" ||
        pinterest.some(
          (tld) => h === `pinterest.${tld}` || h === `www.pinterest.${tld}`,
        )) &&
      p.length > 1
    )
      return "pinterest";
    return null;
  } catch {
    return null;
  }
}
