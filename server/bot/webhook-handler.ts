import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { sendWhatsAppText, normalizePhone } from './evolution';
import { createCardCheckout, createPixPayment } from './mercadopago';
import {
  MAIN_MENU, PLANS, PAYMENT_METHOD_PROMPT, planChoicePrompt, pixSuccess,
  creditSuccess, PIX_ERROR, INVALID_OPTION, SUPPORT_ENTRY, HOW_IT_WORKS,
  SCHEDULE_PROMPT, BUG_PROMPT_TEXT, BUG_PROMPT_DATE, BUG_DONE,
  REGISTER_PROMPT_NAME, REGISTER_PROMPT_EMAIL, REGISTER_PROMPT_PASSWORD,
  REGISTER_PROMPT_PHONE, registerSuccess, isReactivationWord,
} from './flow';

const Payload = z.object({ event: z.string().min(1), data: z.unknown().optional() }).passthrough();
const MUTE_MS = 60 * 60 * 1000;

type Instance = { instance_name: string; api_key_override: string | null; is_active: boolean };
type Conversation = { id: string; phone: string; contact_name: string | null; current_menu: string; status: string; muted_until?: string | null };

function json(res: Response, body: unknown, status = 200) { return res.status(status).json(body); }
export function cleanInstance(value?: string) { return value?.trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).at(-1); }

async function resolveInstance(incoming?: string): Promise<{ instance: string; apiKey?: string } | null> {
  const wanted = cleanInstance(incoming);
  const query = supabaseAdmin.from('whatsapp_instances').select('instance_name,api_key_override,is_active');
  if (wanted) {
    const result = await query.eq('instance_name', wanted).maybeSingle();
    if (result.error) throw result.error;
    if (result.data?.is_active) return { instance: result.data.instance_name, apiKey: result.data.api_key_override ?? undefined };
    return null;
  }
  const result = await query.eq('is_active', true).limit(2);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as Instance[];
  if (rows.length === 1) return { instance: rows[0].instance_name, apiKey: rows[0].api_key_override ?? undefined };
  const fallback = cleanInstance(process.env.EVOLUTION_INSTANCE_NAME);
  return fallback ? { instance: fallback } : null;
}

export function validWebhook(req: Request, raw: string) {
  const secret = process.env.WEBHOOK_SHARED_TOKEN?.trim();
  if (!secret) return false;
  const signature = String(req.headers['x-webhook-signature'] ?? req.headers['x-signature'] ?? '');
  if (signature) {
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const supplied = signature.replace(/^sha256=/i, '').trim();
    try {
      return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    } catch {
      return false;
    }
  }
  const supplied = String(req.headers['x-webhook-token'] ?? req.headers['x-webhook-secret'] ?? req.query.token ?? '');
  return supplied.length === secret.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

async function getOrCreate(phone: string, contactName?: string): Promise<Conversation> {
  const found = await supabaseAdmin.from('conversations').select('*').eq('phone', phone).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data as Conversation;
  const created = await supabaseAdmin.from('conversations').insert({ phone, contact_name: contactName ?? null }).select('*').single();
  if (created.error) {
    const retry = await supabaseAdmin.from('conversations').select('*').eq('phone', phone).single();
    if (retry.error) throw created.error;
    return retry.data as Conversation;
  }
  return created.data as Conversation;
}

async function addMessage(conversationId: string, direction: 'inbound' | 'outbound', sender: 'user' | 'bot' | 'human', content: string, evolutionId?: string) {
  const result = await supabaseAdmin.from('messages').insert({ conversation_id: conversationId, direction, sender, content, message_type: 'text', evolution_message_id: evolutionId ?? null });
  if (result.error && result.error.code !== '23505') throw result.error;
}

type PixCharge = { planId: string; planLabel: string; amount: number; paymentId: string; qrCode: string; qrCodeBase64?: string; expiresAt: string; };

async function replyFor(conversation: Conversation, text: string): Promise<{ text: string; next: string; status: string; muted?: string; charge?: PixCharge }> {
  const step = isReactivationWord(text) ? 'main' : (conversation.current_menu || 'main');
  const t = text.trim().toLowerCase();
  if (t === '0') return { text: '🔕 Atendimento pausado por 1 hora. Digite *menu* para reativar.', next: step, status: 'bot', muted: new Date(Date.now() + MUTE_MS).toISOString() };
  if (step === 'main') {
    if (t === '1') return { text: SCHEDULE_PROMPT, next: 'schedule_wait_datetime', status: 'bot' };
    if (t === '2') return { text: SUPPORT_ENTRY, next: 'support_waiting', status: 'human' };
    if (t === '3') return { text: PAYMENT_METHOD_PROMPT, next: 'plans_choose_method', status: 'bot' };
    if (t === '4') return { text: BUG_PROMPT_TEXT, next: 'bug_wait_text', status: 'bot' };
    if (t === '5') return { text: HOW_IT_WORKS, next: 'main', status: 'bot' };
    if (t === '6') return { text: REGISTER_PROMPT_NAME, next: 'register_wait_name', status: 'bot' };
    return { text: MAIN_MENU, next: 'main', status: 'bot' };
  }
  if (step === 'plans_choose_method') {
    if (t === '1') return { text: planChoicePrompt('pix'), next: 'plans_choose_pix', status: 'bot' };
    if (t === '2') return { text: planChoicePrompt('credit'), next: 'plans_choose_credit', status: 'bot' };
    return { text: PAYMENT_METHOD_PROMPT, next: step, status: 'bot' };
  }
  if (step === 'plans_choose_credit') {
    const plan = ({ '1': PLANS['30d'], '2': PLANS['6m'], '3': PLANS['1y'] } as Record<string, typeof PLANS['30d']>)[t];
    if (!plan) return { text: planChoicePrompt('credit'), next: step, status: 'bot' };
    const checkout = await createCardCheckout({ amount: plan.price, description: `MuseTera ${plan.label}`, externalReference: `musetera-${conversation.id}-${Date.now()}` });
    if (!checkout.ok) return { text: '❌ Não foi possível gerar o checkout do Mercado Pago. Tente novamente ou digite *2* para falar com o suporte.', next: 'main', status: 'bot' };
    return { text: creditSuccess(plan, checkout.checkoutUrl), next: 'main', status: 'bot' };
  }
  if (step === 'plans_choose_pix') {
    const plan = ({ '1': PLANS['30d'], '2': PLANS['6m'], '3': PLANS['1y'] } as Record<string, typeof PLANS['30d']>)[t];
    if (!plan) return { text: planChoicePrompt('pix'), next: step, status: 'bot' };
    const pix = await createPixPayment({ amount: plan.price, description: `MuseTera ${plan.label}` });
    if (!pix.ok) return { text: PIX_ERROR, next: 'main', status: 'bot' };
    return { text: pixSuccess(plan, pix.qrCode), next: 'main', status: 'bot', charge: { planId: plan.id, planLabel: plan.label, amount: plan.price, paymentId: String(pix.paymentId), qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64, expiresAt: pix.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString() } };
  }
  const prompts: Record<string, string> = {
    schedule_wait_datetime: '✅ Solicitação recebida! Nossa equipe confirmará o horário em breve.\n\n_Digite *menu* para voltar._',
    support_waiting: '👨‍💼 Você já está na fila. Um agente responderá em breve.',
    bug_wait_text: BUG_PROMPT_DATE,
    bug_wait_date: BUG_DONE,
    register_wait_name: REGISTER_PROMPT_EMAIL,
    register_wait_email: REGISTER_PROMPT_PASSWORD,
    register_wait_password: REGISTER_PROMPT_PHONE,
    register_wait_phone: registerSuccess('seu e-mail'),
  };
  const next: Record<string, string> = { schedule_wait_datetime: 'main', bug_wait_text: 'bug_wait_date', bug_wait_date: 'main', register_wait_name: 'register_wait_email', register_wait_email: 'register_wait_password', register_wait_password: 'register_wait_phone', register_wait_phone: 'main', support_waiting: 'support_waiting' };
  return { text: prompts[step] ?? INVALID_OPTION, next: next[step] ?? 'main', status: step === 'support_waiting' ? 'human' : 'bot' };
}

export async function handleEvolutionWebhook(req: Request, res: Response) {
  const raw = JSON.stringify(req.body ?? {});
  if (!validWebhook(req, raw)) {
    console.warn(JSON.stringify({ event: 'webhook_rejected', path: req.path, ip: req.ip }));
    return json(res, { ok: false, error: 'invalid webhook authentication' }, 401);
  }
  const parsed = Payload.safeParse(req.body);
  if (!parsed.success) return json(res, { ok: false, error: 'invalid payload' }, 400);
  if (!/messages[._-]upsert/i.test(parsed.data.event)) {
    console.info(JSON.stringify({ event: 'webhook_ignored', evolutionEvent: parsed.data.event }));
    return json(res, { ok: true, ignored: parsed.data.event });
  }
  const payload = parsed.data as any;
  const resolved = await resolveInstance(payload.instance ?? payload.instanceName ?? req.query.instance?.toString());
  if (!resolved) {
    console.warn(JSON.stringify({ event: 'webhook_unknown_instance', incomingInstance: payload.instance ?? payload.instanceName ?? null }));
    return json(res, { ok: true, ignored: 'unknown-instance' });
  }
  const data = payload.data ?? {};
  const phone = normalizePhone(data?.key?.remoteJid);
  if (!phone || data?.key?.fromMe) return json(res, { ok: true, ignored: !phone ? 'no-phone' : 'from-me' });
  const text = String(data?.message?.conversation ?? data?.message?.extendedTextMessage?.text ?? data?.message?.buttonsResponseMessage?.selectedButtonId ?? data?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ?? '').trim();
  if (!text) return json(res, { ok: true, ignored: 'no-text' });
  const conversation = await getOrCreate(phone, data?.pushName);
  await addMessage(conversation.id, 'inbound', 'user', text, data?.key?.id);
  if (conversation.status === 'human' && !isReactivationWord(text)) return json(res, { ok: true, handled: 'human-mode' });
  const answer = await replyFor(conversation, text);
  const sent = await sendWhatsAppText({ number: phone, text: answer.text, instance: resolved.instance, apiKey: resolved.apiKey });
  if (!sent.ok) {
    console.error(JSON.stringify({ event: 'evolution_send_failed', instance: resolved.instance, phone, error: sent.error }));
    return json(res, { ok: false, error: sent.error }, 502);
  }
  console.info(JSON.stringify({ event: 'message_processed', instance: resolved.instance, phone, nextStep: answer.next }));
  if (answer.charge) {
    const charge = await supabaseAdmin.from('pix_charges').insert({ plan_id: answer.charge.planId, plan_label: answer.charge.planLabel, amount: answer.charge.amount, payment_id: answer.charge.paymentId, qr_code: answer.charge.qrCode, qr_code_base64: answer.charge.qrCodeBase64 ?? null, expires_at: answer.charge.expiresAt, phone, instance_name: resolved.instance, status: 'pending' });
    if (charge.error) console.error('[pix] failed to persist charge', { error: charge.error.message });
  }
  await addMessage(conversation.id, 'outbound', 'bot', answer.text, sent.id);
  await supabaseAdmin.from('conversations').update({ current_menu: answer.next, status: answer.status, muted_until: answer.muted ?? null, last_message_at: new Date().toISOString() }).eq('id', conversation.id);
  await supabaseAdmin.from('bot_state').upsert({ conversation_id: conversation.id, current_step: answer.next, context_data: {}, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id' });
  return json(res, { ok: true, instance: resolved.instance });
}
