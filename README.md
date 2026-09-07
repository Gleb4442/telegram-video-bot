# 🎬 Serverless Telegram Video Downloader Bot (Vercel + TypeScript)

A production-ready, serverless Telegram bot built with **TypeScript**, **grammY**, and **Zod** that downloads short-form videos without watermarks from **TikTok**, **Instagram Reels**, and **YouTube Shorts**. Designed specifically to run inside **Vercel Serverless Functions**.

---

## ⚡ Architectural Design & Zero-Buffering Model

### 1. The Vercel Limits Challenge
- Vercel Serverless Functions enforce a strict **4.5 MB request/response payload limit** and **10–15 second execution timeouts** on Hobby tiers.
- Downloading, transcoding, or buffering full 1080p video binaries (often 15–80 MB) inside serverless memory or `/tmp` causes immediate out-of-memory errors, payload truncation, or timeouts.

### 2. The Direct URL Resolver Solution
This bot operates strictly as a high-speed **URL Resolver**:
```
User Link  ──>  Telegram Webhook  ──>  Vercel Function (api/webhook.ts)
                                              │
                                              ▼
                                   Platform Resolvers
                                   (TikWM / Cobalt APIs)
                                              │
                                              ▼ (Direct CDN URL extracted)
Telegram User <──  Direct Video Stream  <──  bot.api.sendVideo(chatId, directUrl)
                   (Fetched directly by
                    Telegram's CDN servers)
```
- **Zero Local Buffering**: The function extracts the direct video file URL from scraper services in under 1–2 seconds.
- **Delegated Ingestion**: Passes the raw CDN URL string directly to Telegram Bot API (`sendVideo(chatId, directUrl)`). Telegram's own infrastructure fetches and streams the video directly to the user.
- **Fast Execution**: Average webhook execution time is **< 1.5 seconds**, well within Vercel's limits.
- **Strict Network Controls**: All external API calls use `fetchWithTimeout` equipped with `AbortController` and an 8-second cutoff.

### 3. Automated Fallback for Telegram's 20 MB URL Limit
- Telegram's Bot API limits `sendVideo` by URL to **20 MB**.
- If a video exceeds 20 MB or Telegram's servers encounter fetch restrictions, the bot catches the error automatically and sends an **Inline Keyboard** with a direct high-speed download link (`InlineKeyboardButton(url=directVideoUrl)`).
- Users can watch or download the uncompressed, watermark-free video with a single tap.

---

## 🛠️ Supported Platforms & Resolvers

| Platform | Resolver Engine | Capabilities |
| :--- | :--- | :--- |
| **TikTok** | **TikWM API** | Watermark-free clean video, sound extraction, creator credit, handles `tiktok.com/@user/video/...`, `vm.tiktok.com`, `vt.tiktok.com`. |
| **Instagram** | **Cobalt API** | Clean Reels & Posts scraper, full resolution, handles `instagram.com/reel/...`, `/reels/...`, `/p/...`, and share links. |
| **YouTube Shorts** | **Cobalt API** | Full quality H.264 video, handles `youtube.com/shorts/...` and `youtu.be/...`. |

> **Note on Cobalt**: Defaults to `https://api.cobalt.tools/`. You can specify your own self-hosted or authenticated Cobalt instance via `COBALT_API_URL` and `COBALT_API_KEY`.

---

## 📁 Project Structure

```
telegram-video-bot/
├── api/
│   └── webhook.ts              # Universal Vercel Serverless webhook handler
├── src/
│   ├── bot.ts                  # grammY bot setup, commands (/start, /help), link handlers
│   ├── config.ts               # Environment variable validation via Zod
│   ├── services/
│   │   └── resolvers/
│   │       ├── index.ts        # Resolver registry & URL pattern extractor
│   │       ├── tiktok.ts       # TikWM TikTok resolver adapter
│   │       └── cobalt.ts       # Cobalt Instagram Reels & YouTube Shorts adapter
│   ├── types/
│   │   └── resolver.ts         # VideoResolver, ResolvedVideo, and ResolverError types
│   └── utils/
│       └── http.ts             # Fetch wrapper with AbortController & 8s timeout
├── scripts/
│   ├── set-webhook.ts          # CLI helper to register webhook & secret token
│   ├── delete-webhook.ts       # CLI helper to delete webhook (re-enable polling)
│   └── dev-polling.ts          # Local development runner with long-polling
├── tests/
│   ├── bot.test.ts             # Bot handler & Telegram fallback flow unit tests
│   ├── regex.test.ts           # URL regex and extractor unit tests
│   ├── resolvers.test.ts       # Scraper API adapter & parser unit tests
│   └── webhook.test.ts         # Secret token validation & health check tests
├── vercel.json                 # Vercel function configuration
├── tsconfig.json               # Strict TypeScript configuration
└── package.json
```

---

## 🔒 Security: Telegram Webhook Secret Token

Telegram sends the header `X-Telegram-Bot-Api-Secret-Token` with every webhook request.
- The webhook endpoint (`api/webhook.ts`) verifies that this header strictly matches `TELEGRAM_SECRET_TOKEN`.
- Any request with a missing or invalid token is immediately rejected with `401 Unauthorized`, protecting your function from unauthorized invocations and DDoS attempts.

---

## 🚀 Step-by-Step Setup & Deployment Guide

### Prerequisites
- Node.js 20+ installed
- A Telegram account
- A free [Vercel](https://vercel.com) account

### Step 1: Create Your Bot on Telegram
1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts to choose a name and username (e.g. `MyVideoDownloaderBot`).
3. Copy the **HTTP API Token** provided (e.g. `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`).

### Step 2: Generate a Secret Webhook Token
Generate a random secret token (1–256 characters, containing `A-Z`, `a-z`, `0-9`, `_`, `-`):
```bash
# Example using openssl:
openssl rand -hex 24
```

### Step 3: Install Dependencies & Run Tests
```bash
cd telegram-video-bot
pnpm install
pnpm test
```
All unit tests should pass with 100% success.

### Step 4: Local Testing (Long Polling Mode)
You can test the bot locally without needing any tunnel or Vercel deployment:
1. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Fill in your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_SECRET_TOKEN`.
3. Start the dev runner:
   ```bash
   pnpm dev
   ```
4. Open your bot in Telegram and send a TikTok, Instagram Reel, or YouTube Shorts link!

---

### Step 5: Deploy to Vercel

#### Option A: Deploy via Vercel CLI
1. Install Vercel CLI (if not already installed):
   ```bash
   npm install -g vercel
   ```
2. Run deployment from project root:
   ```bash
   vercel
   ```
3. Follow prompts to link/create the project.
4. Set the environment variables in Vercel:
   ```bash
   vercel env add TELEGRAM_BOT_TOKEN
   vercel env add TELEGRAM_SECRET_TOKEN
   vercel env add COBALT_API_URL
   vercel env add COBALT_API_KEY
   ```
5. Deploy to production:
   ```bash
   vercel --prod
   ```

#### Option B: Deploy via GitHub / Vercel Dashboard
1. Push your code to a GitHub repository:
   ```bash
   git add .
   git commit -m "Initial commit of serverless telegram video bot"
   git remote add origin https://github.com/your-username/telegram-video-bot.git
   git push -u origin main
   ```
2. In the [Vercel Dashboard](https://vercel.com/new), import your repository.
3. Under **Environment Variables**, configure:
   - `TELEGRAM_BOT_TOKEN`: Your bot token from @BotFather.
   - `TELEGRAM_SECRET_TOKEN`: Your generated secret token.
   - `COBALT_API_URL`: (Optional) `https://api.cobalt.tools/` or self-hosted URL.
   - `COBALT_API_KEY`: (Optional) Your API key if using an authenticated instance.
4. Click **Deploy**. Note your production URL (e.g. `https://telegram-video-bot.vercel.app`).

---

### Step 6: Register the Webhook with Telegram
Once deployed, register your Vercel endpoint with Telegram using our automated helper script:

```bash
pnpm set-webhook https://your-deployment.vercel.app/api/webhook
```

The script will:
- Authenticate with Telegram Bot API
- Register the webhook URL with `secret_token` and `allowed_updates: ["message"]`
- Retrieve and verify the live webhook status:
```
📡 Setting Telegram Webhook...
- Webhook URL:   https://your-deployment.vercel.app/api/webhook
- Secret Token:  ************************
🤖 Connected to Bot: @MyVideoDownloaderBot (Video Downloader)
✅ Webhook successfully registered with Telegram!

📊 Current Webhook Status:
- URL:                     https://your-deployment.vercel.app/api/webhook
- Custom certificate:      false
- Pending update count:    0
- Max connections:         40
- Allowed updates:         message
- Last error:              None (healthy)

🎉 Bot is ready to receive updates on Vercel!
```

---

## 🧪 Testing & Health Checks

### Webhook Health Check
You can test that your Vercel serverless function is live and responding by opening:
```
GET https://your-deployment.vercel.app/api/webhook
```
Response:
```json
{
  "status": "healthy",
  "service": "telegram-video-bot-webhook",
  "timestamp": "2026-09-07T13:15:00.000Z"
}
```

### Run Vitest Test Suite
```bash
pnpm test
```
Tests cover:
- URL regex matching and entity parsing (TikTok, Instagram, YouTube Shorts)
- TikWM API payload parsing and relative URL normalization
- Cobalt API modern (v10) and legacy response parsing
- Secret token verification and 401 unauthorized rejections
- Telegram 20 MB sendVideo failure fallback to inline keyboard buttons
- Error status handling for private/deleted/rate-limited videos

---

## 📜 License
MIT License. Built for serverless environments.
