# Instagram production verification — 2026-10-15

Deployment: 1df33497e8fa1bc29c487ce29ba7d5f52042bad8
https://vercel.com/glebw2008-7382s-projects/telegram-video-bot/sApzHvg4hM1Lqyn1juVtkxCd3Pim

- Existing production alias: https://telegram-video-bot-peach.vercel.app
- Public reel DeXA5froeiC: authenticated diagnostic HTTP 200; 10,404,586 bytes downloaded; MP4 signature; 1,408 ms measured inside Vercel.
- Local ffprobe of the same reel: H.264, 720x1280; AAC; duration 106.135556 seconds.
- Reel Dd-4gKENRms: AGE_RESTRICTED, 770 ms. Independently confirmed by Instagram's age gate in logged-out Chrome.
- `/api/webhook` GET: 200.
- `/api/instagram-check` without secret: 401.
- `/api/instagram` POST without secret: 401.
- Telegram getWebhookInfo: correct existing production alias; pending updates 0; last_error absent.
- TypeScript: 125 tests passed; typecheck/build passed. Python: 5 tests passed. Earlier Redis integration: 4 passed, not rerun for this extractor change.
- No messages sent to Telegram by these probes; no bot webhook replacement, pending-update deletion, paid service, or Instagram account cookies used.
- Actual delivery to the user's Telegram chat: confirmed by the user on 2026-10-15 (response: «Видео пришло»). End-to-end extraction, download and Telegram delivery of DeXA5froeiC passed.

The initial Node native-addon deployment failed its cloud probe (see instagram-production-initial.jsonl). It was replaced by the Python 3.12 function with curl_cffi 0.16.3; no Node curl addon remains.
