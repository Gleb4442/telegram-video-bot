# Extended reliability audit — approved 2026-10-14
User approved all prior fixes and expanded reliability/performance remediation.

Additional confirmed roots: URL ingestion caps20MB; media API timeout10sec; processing bound to webhook60sec; TikTok sole provider; stale30min URLs; identical concurrent resolves duplicate load; group settings can be toggled by other users; missing partial-send checkpoints on replay; Cobalt errors bypass fallback; provider URLs scheme/host lax; ignored response size and redirection.

Implement: safe streaming download to temporary file (DNS address pinning, redirect validation, byte/time caps, cleanup); multipart uploads and optional local Bot API2000MB; durable Redis queue/leases/checkpoints/settings/rate limits and bounded worker concurrency; retain legacy synchronous mode only with explicit deployment limitation; primary-only auth and no redirects; provider fallback, shorter TTL and singleflight; safe scripts; dependency update; regression+real local HTTP/Redis integration validation. No live bot/server switch or deployment during implementation. No new social platform/features.
