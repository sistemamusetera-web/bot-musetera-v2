import type { Request, Response } from 'express';
import { supabaseAdmin } from '../supabase';
import { sendWhatsAppText } from './evolution';
import { fetchMercadoPagoPayment, verifyMercadoPagoWebhookSignature } from './mercadopago';

function json(res: Response, body: unknown, status = 200) {
  return res.status(status).json(body);
}

export async function handleMercadoPagoWebhook(req: Request, res: Response) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[mercadopago-webhook] missing webhook signing secret');
    return json(res, { ok: false, error: 'webhook is not configured' }, 503);
  }

  const body = req.body as { type?: unknown; action?: unknown; data?: { id?: unknown } } | undefined;
  const topic = String(body?.type ?? req.query.type ?? req.query.topic ?? '');
  const paymentId = String(body?.data?.id ?? req.query['data.id'] ?? req.query.id ?? '').trim();
  if (topic && !/payment/i.test(topic) && !/payment/i.test(String(body?.action ?? ''))) {
    return json(res, { ok: true, ignored: 'unsupported-topic' });
  }
  if (!paymentId || !/^\d+$/.test(paymentId)) {
    return json(res, { ok: false, error: 'invalid payment id' }, 400);
  }

  const signatureHeader = String(req.headers['x-signature'] ?? '');
  const requestId = String(req.headers['x-request-id'] ?? '');
  const valid = verifyMercadoPagoWebhookSignature({
    dataId: paymentId,
    requestId,
    signatureHeader,
    secret,
  });
  if (!valid) {
    console.warn('[mercadopago-webhook] rejected invalid signature');
    return json(res, { ok: false, error: 'invalid signature' }, 401);
  }

  try {
    const payment = await fetchMercadoPagoPayment(paymentId);
    if (!payment || !payment.external_reference?.startsWith('musetera-')) {
      return json(res, { ok: true, ignored: 'unrelated-payment' });
    }

    const lookup = await supabaseAdmin
      .from('mp_orders')
      .select('id,external_reference,phone,instance_name,plan_id,plan_label,amount,status,notification_sent_at')
      .eq('external_reference', payment.external_reference)
      .maybeSingle();
    if (lookup.error) throw lookup.error;
    if (!lookup.data) {
      // A checkout must be persisted before the user receives its link.
      // Returning 503 lets the provider retry if notification delivery races with persistence.
      return json(res, { ok: false, error: 'payment order not found yet' }, 503);
    }

    const order = lookup.data;
    if (Math.abs(Number(payment.transaction_amount) - Number(order.amount)) > 0.009 ||
        (payment.currency_id && payment.currency_id !== 'BRL')) {
      console.error('[mercadopago-webhook] payment amount/currency mismatch', {
        paymentId,
        orderId: order.id,
      });
      return json(res, { ok: false, error: 'payment does not match order' }, 422);
    }

    const status = String(payment.status || 'unknown').toLowerCase();
    const update = await supabaseAdmin.from('mp_orders').update({
      payment_id: String(payment.id),
      status,
      paid_at: status === 'approved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);
    if (update.error) throw update.error;

    if (status === 'approved' && !order.notification_sent_at) {
      const amountLabel = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(order.amount));
      const message = [
        '✅ *Pagamento confirmado pelo Mercado Pago!*',
        '',
        `📦 Plano: *${order.plan_label}*`,
        `💰 Valor: *${amountLabel}*`,
        `🧾 Pedido: ${order.external_reference}`,
        '',
        '🔐 Para concluir seu cadastro com segurança, acesse https://portal.musetera.com.br/login.',
        'Não envie sua senha pelo WhatsApp.',
        '',
        'Se precisar de ajuda, responda *2* para falar com o suporte.',
      ].join('\n');
      const instanceConfig = await supabaseAdmin
        .from('whatsapp_instances')
        .select('api_key_override')
        .eq('instance_name', order.instance_name)
        .maybeSingle();
      if (instanceConfig.error) throw instanceConfig.error;
      const sent = await sendWhatsAppText({
        number: order.phone,
        text: message,
        instance: order.instance_name,
        apiKey: instanceConfig.data?.api_key_override ?? undefined,
      });
      if (!sent.ok) {
        console.error('[mercadopago-webhook] confirmation message failed', { orderId: order.id });
        return json(res, { ok: false, error: 'confirmation delivery failed' }, 503);
      }
      const notified = await supabaseAdmin.from('mp_orders').update({
        notification_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', order.id).is('notification_sent_at', null);
      if (notified.error) throw notified.error;
    }

    return json(res, { ok: true, status });
  } catch (error) {
    console.error('[mercadopago-webhook] processing failed', {
      message: error instanceof Error ? error.message : 'unknown error',
    });
    return json(res, { ok: false, error: 'webhook processing failed' }, 503);
  }
}
