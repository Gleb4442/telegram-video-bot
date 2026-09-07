import type { VercelRequest, VercelResponse } from '@vercel/node';
import { webhookCallback } from 'grammy';
import { getBot } from '../src/bot.js';
import { getConfig } from '../src/config.js';

// Vercel Serverless Function configuration
export const config = {
  maxDuration: 15, // Max duration for hobby plan serverless functions
};

/**
 * Validates the Telegram secret token against the configured secret.
 */
function validateSecretToken(secretHeader: string | null | undefined, expectedToken: string): boolean {
  if (!secretHeader || typeof secretHeader !== 'string') {
    return false;
  }
  return secretHeader.trim() === expectedToken.trim();
}

/**
 * Universal webhook handler supporting both Web Standard (Request/Response)
 * and Vercel Node.js (VercelRequest/VercelResponse) calling conventions.
 */
export default async function handler(
  req: Request | VercelRequest,
  res?: VercelResponse
): Promise<Response | void> {
  const appConfig = getConfig();
  const bot = getBot();

  // Mode 1: Vercel Node.js Serverless Function (req: VercelRequest, res: VercelResponse)
  if (res && typeof res.status === 'function') {
    const nodeReq = req as VercelRequest;

    // Health check endpoint for GET requests
    if (nodeReq.method === 'GET') {
      res.status(200).json({
        status: 'healthy',
        service: 'telegram-video-bot-webhook',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (nodeReq.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed. Only POST is accepted for Telegram webhooks.' });
      return;
    }

    // Validate secret token header
    const tokenHeader = nodeReq.headers['x-telegram-bot-api-secret-token'];
    const incomingToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;

    if (!validateSecretToken(incomingToken, appConfig.TELEGRAM_SECRET_TOKEN)) {
      console.warn('[Webhook] Unauthorized request: Missing or invalid secret token header.');
      res.status(401).json({ error: 'Unauthorized: Invalid or missing X-Telegram-Bot-Api-Secret-Token' });
      return;
    }

    // Process update through grammY with strict timeout protection
    const nodeCallback = webhookCallback(bot, 'http', {
      timeoutMilliseconds: 9000,
      onTimeout: 'return',
      secretToken: appConfig.TELEGRAM_SECRET_TOKEN,
    });

    return nodeCallback(nodeReq, res);
  }

  // Mode 2: Web Standard Request / Response (Vercel Edge / App Router / Web standard)
  const webReq = req as Request;

  if (webReq.method === 'GET') {
    return new Response(
      JSON.stringify({
        status: 'healthy',
        service: 'telegram-video-bot-webhook',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (webReq.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method Not Allowed. Only POST is accepted for Telegram webhooks.' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const secretHeader = webReq.headers.get('x-telegram-bot-api-secret-token');
  if (!validateSecretToken(secretHeader, appConfig.TELEGRAM_SECRET_TOKEN)) {
    console.warn('[Webhook] Unauthorized request: Missing or invalid secret token header.');
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid or missing X-Telegram-Bot-Api-Secret-Token' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const stdCallback = webhookCallback(bot, 'std/http', {
    timeoutMilliseconds: 9000,
    onTimeout: 'return',
    secretToken: appConfig.TELEGRAM_SECRET_TOKEN,
  });

  return stdCallback(webReq);
}

// Named export for Next.js App Router route compatibility
export async function POST(req: Request): Promise<Response> {
  const result = await handler(req);
  return result instanceof Response ? result : new Response(null, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  const result = await handler(req);
  return result instanceof Response ? result : new Response(null, { status: 200 });
}
