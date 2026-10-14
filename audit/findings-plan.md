# Audit inventory and remediation plan — 2026-10-14

Inspected all tracked source, tests, scripts, configuration and public page; clean starting Git state.
Stack: TypeScript/grammY/Zod, Vercel Node functions, TikWM/Cobalt HTTP, process-local maps; no database.
Inputs: Telegram messages/text entities/captions, callbacks, inline queries, operator environment/CLI.
Outputs: Telegram media/messages/keyboards; external scraper POSTs; logs; volatile caches.
Trust boundaries: webhook header, Telegram users, operator config, third-party scraper responses.

Completed review of journeys, backend, security, performance, maintainability and deployment before remediation.
Feature trees to verify: start/help -> instructions; settings -> toggles -> download; text/entity/caption link -> resolver -> single video/photo/album -> Telegram send -> direct link fallback; inline query -> result/empty; webhook -> health/auth/dispatch; operator -> polling/webhook installation/removal.

Confirmed findings and planned changes:
- H01 Early successful webhook ACK after 9s loses unfinished work; await processing, raise Node duration to 60s, throw on timeout. Test processing past 9s with fake timers. Residual retries/idempotence is S04.
- H02 Cobalt key attached to every fallback, including default third-party host. Security gate: restrict primary credentials to explicitly trusted instances. Current .env has no COBALT_API_KEY; exposure is conditional.
- H03 sendDocument by URL cannot reliably send MP4/JPG under Telegram contract. Security gate: implement bounded streaming upload with safe destination validation or explicitly remove the document promise. Shared scope with album document preference.
- H04 Preferences lost across cold starts/instances. Schema gate: durable preference store with atomic updates; choose storage first.
- H05 Albums silently truncated to ten; single photo sent as video; album failures have no links. Preserve all items in groups up to ten with single-item tail, photo routing, per-batch link fallback; regression tests.
- M01 HTTP timeout clears before JSON body, caller signal overwritten. Add JSON fetch helper that covers body and respects caller cancellation; test stalled body.
- M02 Local-processing tunnels incorrectly treated as finished media. Request disabled local processing and reject unexpected status explicitly; test.
- M03 Captions/hidden text_link ignored despite forwarding promise. Handle caption and Telegram entities; test.
- M04 Hardcoded BotInfo causes addressed commands for another configured bot to be ignored. Fetch actual BotInfo unless test injection supplied; test.
- M05 HTTP 429/5xx error classification inaccurate. Map statuses and exercise fallback; test.
- L01 LRU overwrites evict unrelated entries; exact TTL boundary wrong. Regression tests and fix.
- L02 Author field unbounded may exceed media caption limit. Bound author; test.
- L03 UI/static README claims active webhook, guaranteed HD/audio and obsolete defaults/latency. Correct claims and contract docs; manual review.
- S01 URL matching accepts supported URL embedded in arbitrary URL, Pinterest arbitrary TLD. Security gate: parsed allowlist and full URL matching; adversarial tests.
- S02 Scraper output URLs accept non-HTTP protocols; TikWM lacks URL validation. Security gate: constrain media URL scheme/destination before adding any uploads.
- S03 No user rate/concurrency limits, unbounded preference map. Security gate: durable throttling plus bounded local storage.
- S04 No webhook replay deduplication. Security/data integrity gate: durable idempotency records + recovery policy.
- S05 Known vulnerable dev dependencies: audit reports 30 advisories/path records (2 critical); production-only audit zero. Security gate: update toolchain and lockfile, verify compatibility; no confirmed remotely exploitable runtime RCE.
- S06 polling/delete-webhook unconditionally drop pending updates. Destructive behavior gate: retain pending by default, explicit --drop-pending opt-in.
- C01 Live inline mode disabled (getMe supports_inline_queries=false). Requires BotFather configuration, outside code edits.

Product decisions (not auto-fixed): whether inline should return photos/carousels or only video; lifetime of temporary scraper URLs and whether repeat downloads need stable Telegram file_id.

- H06 Discovered during integration reproduction: native http adapter re-reads Vercel already-parsed body; replace with next-js adapter using req.body. Same completion test verifies dispatch in both conventions.
