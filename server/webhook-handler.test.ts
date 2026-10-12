import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cleanInstance, handleEvolutionWebhook, isConversationMuted, normalizeInteractiveReply, validWebhook } from './bot/webhook-handler';
import { normalizePhone } from './bot/evolution';
import { verifyMercadoPagoWebhookSignature } from './bot/mercadopago';

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


  it('keeps muted conversations paused until expiry unless the user reactivates the menu', () => {
    const now = Date.parse('2026-10-12T12:00:00.000Z');
    expect(isConversationMuted({ muted_until: '2026-10-12T12:30:00.000Z' }, 'oi', now)).toBe(true);
    expect(isConversationMuted({ muted_until: '2026-10-12T12:30:00.000Z' }, 'menu', now)).toBe(false);
    expect(isConversationMuted({ muted_until: '2026-10-12T11:30:00.000Z' }, 'oi', now)).toBe(false);
  });

  it('normalizes interactive menu row ids to the numeric choices expected by the flow', () => {
    expect(normalizeInteractiveReply('menu_1')).toBe('1');
    expect(normalizeInteractiveReply('menu_6')).toBe('6');
    expect(normalizeInteractiveReply('menu_0')).toBe('0');
    expect(normalizeInteractiveReply('2')).toBe('2');
    expect(normalizeInteractiveReply('support')).toBe('support');
  });
  it('verifies Mercado Pago webhook signatures using the documented manifest', () => {
    const secret = 'test-webhook-secret';
    const dataId = '123456789';
    const requestId = 'request-123';
    const timestamp = '1729000000';
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
    const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
    expect(verifyMercadoPagoWebhookSignature({
      dataId,
      requestId,
      signatureHeader: `ts=${timestamp},v1=${v1}`,
      secret,
    })).toBe(true);
    expect(verifyMercadoPagoWebhookSignature({
      dataId,
      requestId,
      signatureHeader: `ts=${timestamp},v1=${'0'.repeat(64)}`,
      secret,
    })).toBe(false);
  });

});
