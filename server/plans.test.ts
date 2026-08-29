import { describe, expect, it } from 'vitest';
import { PLANS, creditSuccess } from './bot/flow';

describe('financial plan pricing', () => {
  it('uses the approved prices for PIX and Mercado Pago checkout', () => {
    expect(PLANS['30d']).toMatchObject({ label: '30 Dias', price: 69.9, priceLabel: 'R$ 69,90' });
    expect(PLANS['6m']).toMatchObject({ label: '6 Meses', price: 399, priceLabel: 'R$ 399,00' });
    expect(PLANS['1y']).toMatchObject({ label: '12 Meses', price: 699, priceLabel: 'R$ 699,00' });
  });

  it('renders the Mercado Pago checkout label instead of a legacy provider', () => {
    const message = creditSuccess(PLANS['1y'], 'https://www.mercadopago.com.br/checkout/v1/redirect');
    expect(message).toContain('Mercado Pago');
    expect(message).toContain('R$ 699,00');
    expect(message).not.toContain('InfinitePay');
  });
});
