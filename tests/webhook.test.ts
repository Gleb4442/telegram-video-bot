import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { GET, POST } from '../api/webhook.js';

describe('Webhook Security & Handler', () => {
  beforeEach(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';
    process.env['TELEGRAM_SECRET_TOKEN'] = 'super_secret_webhook_token_123';
  });

  describe('Web Standard Request Mode', () => {
    it('returns healthy status on GET request', async () => {
      const req = new Request('https://vercel.app/api/webhook', {
        method: 'GET',
      });

      const res = await GET(req);
      expect(res.status).toBe(200);

      const data = (await res.json()) as { status: string; service: string };
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('telegram-video-bot-webhook');
    });

    it('returns 405 Method Not Allowed on PUT or DELETE', async () => {
      const req = new Request('https://vercel.app/api/webhook', {
        method: 'DELETE',
      });

      const res = (await handler(req)) as Response;
      expect(res.status).toBe(405);
    });

    it('rejects POST request with 401 when secret token header is missing', async () => {
      const req = new Request('https://vercel.app/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 100 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      const json = (await res.json()) as { error: string };
      expect(json.error).toContain('Unauthorized');
    });

    it('rejects POST request with 401 when secret token header is invalid', async () => {
      const req = new Request('https://vercel.app/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong_invalid_secret_token',
        },
        body: JSON.stringify({ update_id: 100 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Node.js (VercelRequest, VercelResponse) Mode', () => {
    it('rejects requests with missing secret token in Node handler mode', async () => {
      const mockReq = {
        method: 'POST',
        headers: {},
        body: { update_id: 100 },
      };

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await handler(mockReq as any, mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Unauthorized'),
        })
      );
    });

    it('provides health check on GET in Node handler mode', async () => {
      const mockReq = {
        method: 'GET',
        headers: {},
      };

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await handler(mockReq as any, mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
        })
      );
    });
  });
});
