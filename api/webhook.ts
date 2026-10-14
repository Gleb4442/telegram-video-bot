import { timingSafeEqual } from "node:crypto";
import type { Update } from "@grammyjs/types";
import { enqueueUpdate } from "../src/services/jobs.js";
import type { VercelRequest, VercelResponse } from "../src/types/vercel.js";
import { webhookCallback } from "grammy";
import { getBot } from "../src/bot.js";
import { getConfig } from "../src/config.js";

// Vercel Serverless Function configuration
export const config = {
  maxDuration: 60, // Includes scraper failover and Telegram media ingestion
};

/**
 * Validates the Telegram secret token against the configured secret.
 */
function validateSecretToken(
  secretHeader: string | null | undefined,
  expectedToken: string,
): boolean {
  if (!secretHeader || typeof secretHeader !== "string") {
    return false;
  }
  const incoming = Buffer.from(secretHeader);
  const expected = Buffer.from(expectedToken);
  return (
    incoming.length === expected.length && timingSafeEqual(incoming, expected)
  );
}

/**
 * Universal webhook handler supporting both Web Standard (Request/Response)
 * and Vercel Node.js (VercelRequest/VercelResponse) calling conventions.
 */
export default async function handler(
  req: Request | VercelRequest,
  res?: VercelResponse,
): Promise<Response | void> {
  const appConfig = getConfig();
  const bot = getBot();

  // Mode 1: Vercel Node.js Serverless Function (req: VercelRequest, res: VercelResponse)
  if (res && typeof res.status === "function") {
    const nodeReq = req as VercelRequest;

    // Health check endpoint for GET requests
    if (nodeReq.method === "GET") {
      res.status(200).json({
        status: "healthy",
        service: "telegram-video-bot-webhook",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (nodeReq.method !== "POST") {
      res
        .status(405)
        .json({
          error:
            "Method Not Allowed. Only POST is accepted for Telegram webhooks.",
        });
      return;
    }

    // Validate secret token header
    const tokenHeader = nodeReq.headers["x-telegram-bot-api-secret-token"];
    const incomingToken = Array.isArray(tokenHeader)
      ? tokenHeader[0]
      : tokenHeader;

    if (!validateSecretToken(incomingToken, appConfig.TELEGRAM_SECRET_TOKEN)) {
      console.warn(
        "[Webhook] Unauthorized request: Missing or invalid secret token header.",
      );
      res
        .status(401)
        .json({
          error:
            "Unauthorized: Invalid or missing X-Telegram-Bot-Api-Secret-Token",
        });
      return;
    }

    if (appConfig.INNGEST_EVENT_KEY) {
      const update = nodeReq.body;
      if (!validUpdate(update)) {
        res.status(400).json({ error: "Invalid update" });
        return;
      }
      try {
        await enqueueUpdate(update);
        const outcome = "queued";
        res.status(200).json({ status: outcome });
      } catch {
        res.status(503).json({ error: "Queue unavailable" });
      }
      return;
    }

    // Vercel already parses JSON into req.body; the native http adapter
    // would wait for an already-consumed stream.
    // Never acknowledge unfinished processing as successful.
    const nodeCallback = webhookCallback(bot, "next-js", {
      timeoutMilliseconds: 55000,
      onTimeout: "throw",
      secretToken: appConfig.TELEGRAM_SECRET_TOKEN,
    });

    return nodeCallback(
      { body: nodeReq.body as Update, headers: nodeReq.headers },
      res,
    );
  }

  // Mode 2: Web Standard Request / Response (Vercel Edge / App Router / Web standard)
  const webReq = req as Request;

  if (webReq.method === "GET") {
    return new Response(
      JSON.stringify({
        status: "healthy",
        service: "telegram-video-bot-webhook",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (webReq.method !== "POST") {
    return new Response(
      JSON.stringify({
        error:
          "Method Not Allowed. Only POST is accepted for Telegram webhooks.",
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const secretHeader = webReq.headers.get("x-telegram-bot-api-secret-token");
  if (!validateSecretToken(secretHeader, appConfig.TELEGRAM_SECRET_TOKEN)) {
    console.warn(
      "[Webhook] Unauthorized request: Missing or invalid secret token header.",
    );
    return new Response(
      JSON.stringify({
        error:
          "Unauthorized: Invalid or missing X-Telegram-Bot-Api-Secret-Token",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (appConfig.INNGEST_EVENT_KEY) {
    try {
      const text = await webReq.text();
      if (text.length > 200 * 1024)
        return new Response("Update too large", { status: 413 });
      const update: unknown = JSON.parse(text);
      if (!validUpdate(update))
        return new Response("Invalid update", { status: 400 });
      await enqueueUpdate(update);
      const outcome = "queued";
      return Response.json({ status: outcome }, { status: 200 });
    } catch (err) {
      return new Response(
        err instanceof SyntaxError ? "Invalid JSON" : "Queue unavailable",
        { status: err instanceof SyntaxError ? 400 : 503 },
      );
    }
  }

  const stdCallback = webhookCallback(bot, "std/http", {
    timeoutMilliseconds: 55000,
    onTimeout: "throw",
    secretToken: appConfig.TELEGRAM_SECRET_TOKEN,
  });

  return stdCallback(webReq);
}

// Named export for Next.js App Router route compatibility
export async function POST(req: Request): Promise<Response> {
  const result = await handler(req);
  return result instanceof Response
    ? result
    : new Response(null, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  const result = await handler(req);
  return result instanceof Response
    ? result
    : new Response(null, { status: 200 });
}

function validUpdate(value: unknown): value is Update {
  if (!value || typeof value !== "object" || !("update_id" in value))
    return false;
  return (
    Number.isSafeInteger(value.update_id) &&
    Number(value.update_id) >= 0 &&
    JSON.stringify(value).length <= 200 * 1024
  );
}
