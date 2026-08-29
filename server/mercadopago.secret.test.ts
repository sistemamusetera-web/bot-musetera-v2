import { describe, expect, it } from 'vitest';

describe('Mercado Pago secret', () => {
  it('can authenticate against the lightweight user endpoint', async () => {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
    expect(token, 'MERCADOPAGO_ACCESS_TOKEN must be supplied').toBeTruthy();
    const response = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok).toBe(true);
  });
});
