"""Private, anonymous Instagram extraction in the same Vercel project. No media bytes or account cookies are stored."""
import hmac
import json
import os
import re
from http.server import BaseHTTPRequestHandler

from curl_cffi import requests

ORIGIN = "https://www.instagram.com"
QUERY = "PolarisLoggedOutDesktopWWWPostRootContentQuery"
DOCUMENT_ID = "27130156389949648"
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def read_bounded(response, limit=2 * 1024 * 1024):
    data = bytearray()
    try:
        for chunk in response.iter_content(chunk_size=16384):
            data.extend(chunk)
            if len(data) > limit:
                raise ValueError("Instagram response too large")
        return bytes(data).decode("utf-8")
    finally:
        response.close()


def slim_product(product):
    if not isinstance(product, dict):
        return None
    keys = ("media_type", "video_versions", "image_versions2", "caption", "user", "video_duration")
    result = {key: product[key] for key in keys if key in product}
    if "carousel_media" in product:
        if len(product["carousel_media"]) > 100:
            raise ValueError("Album too large")
        result["carousel_media"] = [slim_product(item) for item in product["carousel_media"]]
    return result


def extract(shortcode):
    if not isinstance(shortcode, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,20}", shortcode):
        raise ValueError("Invalid shortcode")
    media_id = 0
    for char in shortcode:
        media_id = media_id * 64 + ALPHABET.index(char)
    # curl_cffi's manylinux wheel supports Vercel's Linux runtime; it also supplies CA trust.
    with requests.Session(impersonate="chrome136", timeout=10, allow_redirects=False) as session:
        page = session.get(ORIGIN + "/", stream=True)
        if page.status_code != 200:
            page.close()
            raise ValueError("Bootstrap failed")
        html = read_bounded(page)
        match = re.search(r'\["LSD",\[\],\{"token":"([^"]+)"', html)
        if not match:
            raise ValueError("Anonymous session unavailable")
        lsd = match.group(1)
        response = session.post(ORIGIN + "/api/graphql", stream=True, headers={
            "X-IG-App-ID": "936619743392459", "X-ASBD-ID": "359341",
            "X-IG-WWW-Claim": "0", "Origin": ORIGIN, "Accept": "*/*",
            "X-FB-Friendly-Name": QUERY, "X-FB-LSD": lsd,
            "X-Requested-With": "XMLHttpRequest", "Referer": f"{ORIGIN}/reel/{shortcode}/",
        }, data={
            "lsd": lsd, "fb_api_caller_class": "RelayModern",
            "fb_api_req_friendly_name": QUERY, "server_timestamps": "true",
            "variables": json.dumps({"media_id": str(media_id)}), "doc_id": DOCUMENT_ID,
        })
        if response.status_code != 200:
            response.close()
            raise ValueError("Instagram query failed")
        payload = json.loads(read_bounded(response))
    media = (payload.get("data") or {}).get("xig_polaris_media")
    if not isinstance(media, dict) or media.get("code") != shortcode:
        raise ValueError("Instagram returned no matching post")
    return {"data": {"xig_polaris_media": {
        "code": shortcode,
        "if_not_gated_logged_out": slim_product(media.get("if_not_gated_logged_out")),
        "gating_ruling": media.get("gating_ruling"),
    }}}


class handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        expected = os.environ.get("TELEGRAM_SECRET_TOKEN", "")
        incoming = self.headers.get("x-telegram-bot-api-secret-token", "")
        if not expected or not hmac.compare_digest(incoming.encode(), expected.encode()):
            return self.reply(401, {"error": "Unauthorized"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 1024:
                return self.reply(400, {"error": "Invalid request"})
            body = json.loads(self.rfile.read(size))
            shortcode = body.get("shortcode")
            if not isinstance(shortcode, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,20}", shortcode):
                return self.reply(400, {"error": "Invalid shortcode"})
            return self.reply(200, extract(shortcode))
        except Exception as error:
            # Never log bodies, headers, session cookies, signed media URLs or exception messages.
            print(json.dumps({"event": "instagram_extract_failed", "kind": type(error).__name__}))
            return self.reply(502, {"error": "EXTRACTION_FAILED"})

    def do_GET(self):
        return self.reply(405, {"error": "Method Not Allowed"})

    def log_message(self, *_args):
        pass
