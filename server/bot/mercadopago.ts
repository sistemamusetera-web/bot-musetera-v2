import { createHmac, timingSafeEqual } from 'node:crypto';
// Mercado Pago PIX integration for the MuseTera WhatsApp bot.
// Generates a dynamic PIX QR Code (copia-e-cola) for a given amount.
//
// Required server env var:
// - MERCADOPAGO_ACCESS_TOKEN  Production access token (APP_USR-...)

export interface PixInput {
  amount: number; // BRL value, e.g. 34.90
  description: string;
  payerEmail?: string;
  externalReference?: string;
}

export type PixResult =
  | {
      ok: true;
      qrCode: string; // copia-e-cola string
      qrCodeBase64?: string; // PNG base64 (not used in WhatsApp text reply)
      ticketUrl?: string;
      paymentId: string | number;
      expiresAt?: string;
    }
  | { ok: false; code: "config" | "auth" | "network" | "server"; message: string };

const TIMEOUT_MS = 15_000;
const API_URL = "https://api.mercadopago.com/v1/payments";

export async function createPixPayment(input: PixInput): Promise<PixResult> {
  const rawToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const token = rawToken?.trim();
  if (!token) {
    console.error("[mercadopago] missing MERCADOPAGO_ACCESS_TOKEN");
    return { ok: false, code: "config", message: "Gateway PIX não configurado" };
  }
  // Never log access-token fragments or token metadata.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // 30-minute expiration
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const baseUrl = getPublicAppUrl();
  if (!baseUrl) return { ok: false, code: "config", message: "PUBLIC_APP_URL deve apontar para a URL HTTPS pública do servidor" };
  const notificationUrl = `${baseUrl}/api/public/mp-webhook`;

  const body = {
    transaction_amount: Number(input.amount.toFixed(2)),
    description: input.description,
    external_reference: input.externalReference,
    payment_method_id: "pix",
    payer: {
      email: input.payerEmail ?? "cliente@musetera.com.br",
    },
    date_of_expiration: formatMpDate(expiresAt),
    notification_url: notificationUrl,
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("[mercadopago] payment creation failed", { status: res.status });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, code: "auth", message: "Token Mercado Pago inválido" };
      }
      return {
        ok: false,
        code: "server",
        message: json?.message ?? `Erro ${res.status}`,
      };
    }

    const tx = json?.point_of_interaction?.transaction_data;
    const qrCode: string | undefined = tx?.qr_code;
    if (!qrCode) {
      console.error("[mercadopago] missing qr_code in response");
      return { ok: false, code: "server", message: "Resposta sem QR Code" };
    }

    return {
      ok: true,
      qrCode,
      qrCodeBase64: tx?.qr_code_base64,
      ticketUrl: tx?.ticket_url,
      paymentId: json.id,
      expiresAt,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error("[mercadopago] network error", {
      error: err instanceof Error ? err.message : String(err),
      isAbort,
    });
    return {
      ok: false,
      code: "network",
      message: isAbort ? "Tempo esgotado" : "Falha de conexão",
    };
  } finally {
    clearTimeout(timer);
  }
}

export type CardCheckoutResult =
  | { ok: true; preferenceId: string; checkoutUrl: string }
  | { ok: false; code: 'config' | 'auth' | 'network' | 'server'; message: string };

export async function createCardCheckout(input: { amount: number; description: string; externalReference: string }): Promise<CardCheckoutResult> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) return { ok: false, code: 'config', message: 'Gateway Mercado Pago não configurado' };
  const baseUrl = getPublicAppUrl();
  if (!baseUrl) return { ok: false, code: 'config', message: 'PUBLIC_APP_URL deve apontar para a URL HTTPS pública do servidor' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: input.description, quantity: 1, currency_id: 'BRL', unit_price: Number(input.amount.toFixed(2)) }],
        external_reference: input.externalReference,
        notification_url: `${baseUrl}/api/webhooks/mercadopago`,
        back_urls: { success: `${baseUrl}/`, failure: `${baseUrl}/`, pending: `${baseUrl}/` },
        auto_return: 'approved',
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', message: 'Token Mercado Pago inválido' };
      return { ok: false, code: 'server', message: body?.message ?? `Erro ${response.status}` };
    }
    if (!body?.id || !body?.init_point) return { ok: false, code: 'server', message: 'Checkout sem link de pagamento' };
    return { ok: true, preferenceId: String(body.id), checkoutUrl: String(body.init_point) };
  } catch (error) {
    return { ok: false, code: 'network', message: error instanceof Error && error.name === 'AbortError' ? 'Tempo esgotado' : 'Falha de conexão' };
  } finally {
    clearTimeout(timer);
  }
}

// Mercado Pago expects ISO date with offset "-03:00" (no "Z")
function formatMpDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.000-00:00`;
}

export interface MercadoPagoPayment {
  id: string | number;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount: number;
  currency_id?: string;
}

export function verifyMercadoPagoWebhookSignature(input: {
  dataId: string;
  requestId: string;
  signatureHeader: string;
  secret: string;
}) {
  const parts = Object.fromEntries(
    input.signatureHeader.split(',').map(part => {
      const [key, ...value] = part.trim().split('=');
      return [key, value.join('=')];
    }),
  );
  const timestamp = parts.ts;
  const received = parts.v1;
  if (!timestamp || !received || !input.requestId || !input.dataId || !input.secret) return false;
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${timestamp};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function fetchMercadoPagoPayment(paymentId: string): Promise<MercadoPagoPayment | null> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('Mercado Pago is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      // Do not log provider response bodies; they may contain sensitive data.
      throw new Error(`Mercado Pago payment lookup failed with status ${response.status}`);
    }
    return await response.json() as MercadoPagoPayment;
  } finally {
    clearTimeout(timer);
  }
}

function getPublicAppUrl(): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
