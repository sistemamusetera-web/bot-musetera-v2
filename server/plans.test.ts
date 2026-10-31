import { describe, expect, it } from 'vitest';
import { PLANS, creditSuccess, pixSuccess, paymentAccessGranted, paymentActivatedExisting, paymentRenewed } from './bot/flow';

describe('financial plan pricing', () => {
  it('uses the approved prices for PIX and Mercado Pago checkout', () => {
    expect(PLANS['30d']).toMatchObject({ label: '30 Dias', price: 34.9, priceLabel: 'R$ 34,90' });
    expect(PLANS['6m']).toMatchObject({ label: '6 Meses', price: 200, priceLabel: 'R$ 200,00' });
    expect(PLANS['1y']).toMatchObject({ label: '12 Meses', price: 400, priceLabel: 'R$ 400,00' });
  });

  it('keeps the PIX code out of the info message (it is sent separately)', () => {
    const message = pixSuccess(PLANS['30d']);
    expect(message).toContain('R$ 34,90');
    expect(message).toContain('copia e cola');
    expect(message).not.toMatch(/000201|br\.gov\.bcb\.pix/i);
  });

  it('sends credentials and the validity limit after a first payment', () => {
    const message = paymentAccessGranted({
      planLabel: '30 Dias',
      amountLabel: 'R$ 34,90',
      expiresLabel: '30/11/2026',
      email: 'cliente@email.com',
      password: 'Ab3xY9kLmNp2',
    });
    expect(message).toContain('acesso liberado');
    expect(message).toContain('válido até 30/11/2026');
    expect(message).toContain('cliente@email.com');
    expect(message).toContain('Ab3xY9kLmNp2');
    expect(message).toContain('portal.musetera.com.br/login');
  });

  it('activates a portal-born account without touching its password', () => {
    const message = paymentActivatedExisting({
      planLabel: '6 Meses',
      amountLabel: 'R$ 200,00',
      expiresLabel: '30/04/2027',
      email: 'cliente@email.com',
    });
    expect(message).toContain('acesso liberado');
    expect(message).toContain('válido até 30/04/2027');
    expect(message).toContain('senha que você já usa');
    expect(message).not.toContain('Senha temporária');
  });

  it('renews without touching the password', () => {
    const message = paymentRenewed({
      planLabel: '12 Meses',
      amountLabel: 'R$ 400,00',
      expiresLabel: '31/10/2027',
      email: 'cliente@email.com',
    });
    expect(message).toContain('renovada');
    expect(message).toContain('até 31/10/2027');
    expect(message).not.toContain('Senha temporária');
  });

  it('renders the Mercado Pago checkout label instead of a legacy provider', () => {
    const message = creditSuccess(PLANS['1y'], 'https://www.mercadopago.com.br/checkout/v1/redirect');
    expect(message).toContain('Mercado Pago');
    expect(message).toContain('R$ 400,00');
    expect(message).not.toContain('InfinitePay');
  });
});
