import type { IncomingMessage, ServerResponse } from "node:http";
/** Minimal Node request/response shape consumed by the webhook adapter. No Vercel build runtime dependency. */
export interface VercelRequest extends IncomingMessage {
  body: unknown;
}
export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  send(body: unknown): VercelResponse;
  json(body: unknown): VercelResponse;
}
