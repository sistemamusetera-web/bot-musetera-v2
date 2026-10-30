import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cleanInstance, handleEvolutionWebhook, validWebhook } from './bot/webhook-handler';
import { normalizePhone } from './bot/evolution';

describe('webhook safety and routing helpers', () => {
  it('normalizes Evolution instance URLs to the instance name', () => {
    expect(cleanInstance('/financeiro/')).toBe('financeiro');
    expect(cleanInstance('financeiro')).toBe('financeiro');
  });

  it('ignores WhatsApp groups and normalizes customer JIDs', () => {
    expect(normalizePhone('558185436981@s.whatsapp.net')).toBe('558185436981');
    expect(normalizePhone('12345-678@g.us')).toBeNull();
  });

  it('rejects an invalid shared webhook token before processing', async () => {
    const original = process.env.WEBHOOK_SHARED_TOKEN;
    process.env.WEBHOOK_SHARED_TOKEN = 'expected-token';
    const response = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
    await handleEvolutionWebhook({ headers: {}, query: {}, body: { event: 'messages.upsert' } } as never, response as never);
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ ok: false, error: 'invalid webhook authentication' });
    process.env.WEBHOOK_SHARED_TOKEN = original;
  });

  it('accepts a valid HMAC signature for the raw body', () => {
    const original = process.env.WEBHOOK_SHARED_TOKEN;
    process.env.WEBHOOK_SHARED_TOKEN = 'hmac-secret';
    const raw = '{"event":"messages.upsert"}';
    const signature = createHmac('sha256', 'hmac-secret').update(raw).digest('hex');
    const request = { headers: { 'x-webhook-signature': `sha256=${signature}` }, query: {} };
    expect(validWebhook(request as never, raw)).toBe(true);
    process.env.WEBHOOK_SHARED_TOKEN = original;

  });

  it('accepts the shared token supplied as a URL query parameter', () => {
    const original = process.env.WEBHOOK_SHARED_TOKEN;
    process.env.WEBHOOK_SHARED_TOKEN = 'expected-token';
    const request = { headers: {}, query: { token: 'expected-token' }, body: { event: 'messages.upsert' } };
    expect(validWebhook(request as never, '{"event":"messages.upsert"}')).toBe(true);
    process.env.WEBHOOK_SHARED_TOKEN = original;
  });

  it('accepts the apikey Evolution includes in the webhook body (default Evolution setup)', () => {
    const originalToken = process.env.WEBHOOK_SHARED_TOKEN;
    const originalKey = process.env.EVOLUTION_API_KEY;
    delete process.env.WEBHOOK_SHARED_TOKEN;
    process.env.EVOLUTION_API_KEY = 'evolution-key-123';
    const request = { headers: {}, query: {}, body: { event: 'messages.upsert', apikey: 'evolution-key-123' } };
    expect(validWebhook(request as never, '{"event":"messages.upsert"}')).toBe(true);
    process.env.WEBHOOK_SHARED_TOKEN = originalToken;
    process.env.EVOLUTION_API_KEY = originalKey;
  });

  it('rejects a webhook body whose apikey does not match the Evolution key', () => {
    const originalToken = process.env.WEBHOOK_SHARED_TOKEN;
    const originalKey = process.env.EVOLUTION_API_KEY;
    delete process.env.WEBHOOK_SHARED_TOKEN;
    process.env.EVOLUTION_API_KEY = 'evolution-key-123';
    const request = { headers: {}, query: {}, body: { event: 'messages.upsert', apikey: 'some-other-key-456' } };
    expect(validWebhook(request as never, '{"event":"messages.upsert"}')).toBe(false);
    process.env.WEBHOOK_SHARED_TOKEN = originalToken;
    process.env.EVOLUTION_API_KEY = originalKey;
  });
});
