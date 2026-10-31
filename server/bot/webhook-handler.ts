import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { sendWhatsAppText, normalizePhone } from "./evolution";
import { createCardCheckout, createPixPayment } from "./mercadopago";
import {
  MAIN_MENU,
  PLANS,
  PAYMENT_METHOD_PROMPT,
  RENEW_PROMPT,
  planChoicePrompt,
  pixSuccess,
  creditSuccess,
  PIX_ERROR,
  INVALID_OPTION,
  SUPPORT_ENTRY,
  HOW_IT_WORKS,
  BUG_PROMPT_TEXT,
  BUG_PROMPT_DATE,
  BUG_DONE,
  EMAIL_PROMPT,
  EMAIL_INVALID,
  ACCOUNT_FOUND_NOTICE,
  ACCOUNT_CREATED_NOTICE,
  PASSWORD_PROMPT,
  PASSWORD_INVALID,
  isReactivationWord,
  type PlanInfo,
} from "./flow";
import {
  isValidEmail,
  findPortalUserByEmail,
  createPortalAccount,
} from "./portal";

const Payload = z
  .object({ event: z.string().min(1), data: z.unknown().optional() })
  .passthrough();
const MUTE_MS = 60 * 60 * 1000;

type Instance = {
  instance_name: string;
  api_key_override: string | null;
  is_active: boolean;
};
type Conversation = {
  id: string;
  phone: string;
  contact_name: string | null;
  current_menu: string;
  status: string;
  muted_until?: string | null;
};

function json(res: Response, body: unknown, status = 200) {
  return res.status(status).json(body);
}
export function cleanInstance(value?: string) {
  return value
    ?.trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .at(-1);
}

export async function resolveInstance(
  incoming?: string
): Promise<{ instance: string; apiKey?: string } | null> {
  const wanted = cleanInstance(incoming);
  const query = supabaseAdmin
    .from("whatsapp_instances")
    .select("instance_name,api_key_override,is_active");
  if (wanted) {
    const result = await query.eq("instance_name", wanted).maybeSingle();
    if (result.error) throw result.error;
    if (result.data?.is_active)
      return {
        instance: result.data.instance_name,
        apiKey: result.data.api_key_override ?? undefined,
      };
    return null;
  }
  const result = await query.eq("is_active", true).limit(2);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as Instance[];
  if (rows.length === 1)
    return {
      instance: rows[0].instance_name,
      apiKey: rows[0].api_key_override ?? undefined,
    };
  const fallback = cleanInstance(process.env.EVOLUTION_INSTANCE_NAME);
  return fallback ? { instance: fallback } : null;
}

function safeEqual(supplied: string, expected: string) {
  if (!supplied || !expected || supplied.length !== expected.length)
    return false;
  try {
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function validWebhook(req: Request, raw: string) {
  const secret = process.env.WEBHOOK_SHARED_TOKEN?.trim();
  if (secret) {
    // Method 1 (preferred): HMAC signature over the exact raw request body.
    const signature = String(
      req.headers["x-webhook-signature"] ?? req.headers["x-signature"] ?? ""
    );
    if (signature) {
      const expected = createHmac("sha256", secret).update(raw).digest("hex");
      const supplied = signature.replace(/^sha256=/i, "").trim();
      return safeEqual(supplied, expected);
    }
    // Method 2: shared token via header or ?token= on the webhook URL.
    const supplied = String(
      req.headers["x-webhook-token"] ??
        req.headers["x-webhook-secret"] ??
        req.query.token ??
        ""
    );
    if (supplied && safeEqual(supplied, secret)) return true;
  }
  // Method 3: Evolution's native payload key. Evolution API includes the
  // instance/global `apikey` in every webhook body it posts. A webhook
  // configured in Evolution with only a URL (no custom headers, no query
  // token) sends exactly this — accept it when it matches the Evolution key
  // configured on this server. Without this, a default Evolution webhook
  // setup is rejected with 401 and the bot never replies.
  const body = (req as Request & { body?: Record<string, unknown> }).body;
  const payloadKey =
    typeof body?.apikey === "string" ? body.apikey.trim() : "";
  const evolutionKey = process.env.EVOLUTION_API_KEY?.trim() ?? "";
  if (payloadKey && evolutionKey && safeEqual(payloadKey, evolutionKey))
    return true;
  return false;
}

/** Which auth signals a webhook request carried (names only, never values). */
export function webhookAuthSignals(req: Request) {
  const body = (req as Request & { body?: Record<string, unknown> }).body;
  return {
    hasSignature: Boolean(
      req.headers["x-webhook-signature"] ?? req.headers["x-signature"]
    ),
    hasToken: Boolean(
      req.headers["x-webhook-token"] ??
        req.headers["x-webhook-secret"] ??
        req.query.token
    ),
    hasPayloadApiKey: typeof body?.apikey === "string" && body.apikey !== "",
    sharedTokenConfigured: Boolean(process.env.WEBHOOK_SHARED_TOKEN?.trim()),
    evolutionKeyConfigured: Boolean(process.env.EVOLUTION_API_KEY?.trim()),
  };
}

export async function getOrCreate(
  phone: string,
  contactName?: string
): Promise<Conversation> {
  const found = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data as Conversation;
  const created = await supabaseAdmin
    .from("conversations")
    .insert({ phone, contact_name: contactName ?? null })
    .select("*")
    .single();
  if (created.error) {
    const retry = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("phone", phone)
      .single();
    if (retry.error) throw created.error;
    return retry.data as Conversation;
  }
  return created.data as Conversation;
}

export async function addMessage(
  conversationId: string,
  direction: "inbound" | "outbound",
  sender: "user" | "bot" | "human",
  content: string,
  evolutionId?: string
) {
  const result = await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    direction,
    sender,
    content,
    message_type: "text",
    evolution_message_id: evolutionId ?? null,
  });
  if (result.error && result.error.code !== "23505") throw result.error;
}

export type PaymentCharge = {
  planId: string;
  planLabel: string;
  amount: number;
  paymentId: string;
  externalReference: string;
  paymentMethod: "pix" | "card";
  qrCode?: string;
  qrCodeBase64?: string;
  expiresAt?: string;
  customerEmail?: string;
  portalUserId?: string | null;
};

type Reply = {
  text: string;
  next: string;
  status: string;
  muted?: string;
  charge?: PaymentCharge;
  /** Extra messages sent right after the main one (e.g. the bare PIX code). */
  extraTexts?: string[];
  /** Replacement bot_state context (e.g. the pending purchase e-mail). */
  context?: Record<string, unknown>;
};

async function startCardCharge(
  conversation: Conversation,
  plan: PlanInfo,
  email: string,
  portalUserId: string | null,
  notice?: string
): Promise<Reply> {
  const externalReference = `musetera-${conversation.id}-${Date.now()}`;
  const checkout = await createCardCheckout({
    amount: plan.price,
    description: `MuseTera ${plan.label}`,
    externalReference,
  });
  if (!checkout.ok)
    return {
      text: "❌ Não foi possível gerar o checkout do Mercado Pago. Tente novamente ou digite *1* para falar com o suporte.",
      next: "main",
      status: "bot",
    };
  const base = creditSuccess(plan, checkout.checkoutUrl);
  return {
    text: notice ? `${notice}\n\n${base}` : base,
    next: "main",
    status: "bot",
    charge: {
      planId: plan.id,
      planLabel: plan.label,
      amount: plan.price,
      paymentId: `preference:${checkout.preferenceId}`,
      externalReference,
      paymentMethod: "card",
      customerEmail: email,
      portalUserId,
    },
  };
}

async function startPixCharge(
  conversation: Conversation,
  plan: PlanInfo,
  email: string,
  portalUserId: string | null,
  notice?: string
): Promise<Reply> {
  const externalReference = `musetera-${conversation.id}-${Date.now()}`;
  const pix = await createPixPayment({
    amount: plan.price,
    description: `MuseTera ${plan.label}`,
    externalReference,
  });
  if (!pix.ok) return { text: PIX_ERROR, next: "main", status: "bot" };
  const base = pixSuccess(plan);
  return {
    // The copia-e-cola code goes alone in a follow-up message so the
    // customer can long-press and copy ONLY the code, without the
    // surrounding instructions getting in the way.
    text: notice ? `${notice}\n\n${base}` : base,
    extraTexts: [pix.qrCode],
    next: "main",
    status: "bot",
    charge: {
      planId: plan.id,
      planLabel: plan.label,
      amount: plan.price,
      paymentId: String(pix.paymentId),
      externalReference,
      paymentMethod: "pix",
      qrCode: pix.qrCode,
      qrCodeBase64: pix.qrCodeBase64,
      expiresAt:
        pix.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      customerEmail: email,
      portalUserId,
    },
  };
}

async function replyFor(
  conversation: Conversation,
  text: string,
  context: Record<string, unknown> = {}
): Promise<Reply> {
  const step = isReactivationWord(text)
    ? "main"
    : conversation.current_menu || "main";
  const t = text.trim().toLowerCase();
  if (t === "0")
    return {
      text: "🔕 Atendimento pausado por 1 hora. Digite *menu* para reativar.",
      next: step,
      status: "bot",
      muted: new Date(Date.now() + MUTE_MS).toISOString(),
    };
  if (step === "main") {
    if (t === "1")
      return { text: SUPPORT_ENTRY, next: "support_waiting", status: "human" };
    if (t === "2")
      return {
        text: PAYMENT_METHOD_PROMPT,
        next: "plans_choose_method",
        status: "bot",
      };
    if (t === "3")
      return { text: BUG_PROMPT_TEXT, next: "bug_wait_text", status: "bot" };
    if (t === "4") return { text: HOW_IT_WORKS, next: "main", status: "bot" };
    if (t === "5")
      return {
        text: RENEW_PROMPT,
        next: "plans_choose_method",
        status: "bot",
      };
    return { text: MAIN_MENU, next: "main", status: "bot" };
  }
  if (step === "plans_choose_method") {
    if (t === "1")
      return {
        text: planChoicePrompt("pix"),
        next: "plans_choose_pix",
        status: "bot",
      };
    if (t === "2")
      return {
        text: planChoicePrompt("credit"),
        next: "plans_choose_credit",
        status: "bot",
      };
    return { text: PAYMENT_METHOD_PROMPT, next: step, status: "bot" };
  }
  if (step === "plans_choose_credit") {
    const plan = (
      { "1": PLANS["30d"], "2": PLANS["6m"], "3": PLANS["1y"] } as Record<
        string,
        (typeof PLANS)["30d"]
      >
    )[t];
    if (!plan)
      return { text: planChoicePrompt("credit"), next: step, status: "bot" };
    // Ask for the e-mail before creating the checkout: it becomes the
    // portal login when the payment is approved.
    return {
      text: EMAIL_PROMPT(plan),
      next: `email_card_${plan.id}`,
      status: "bot",
    };
  }
  if (step === "plans_choose_pix") {
    const plan = (
      { "1": PLANS["30d"], "2": PLANS["6m"], "3": PLANS["1y"] } as Record<
        string,
        (typeof PLANS)["30d"]
      >
    )[t];
    if (!plan)
      return { text: planChoicePrompt("pix"), next: step, status: "bot" };
    return {
      text: EMAIL_PROMPT(plan),
      next: `email_pix_${plan.id}`,
      status: "bot",
    };
  }
  const emailStep = /^email_(pix|card)_(30d|6m|1y)$/.exec(step);
  if (emailStep) {
    const plan = PLANS[emailStep[2] as PlanInfo["id"]];
    // `t` is the trimmed, lowercased message — fine for an e-mail login.
    if (!isValidEmail(t))
      return { text: EMAIL_INVALID, next: step, status: "bot" };
    // Recognize the portal account for this e-mail. A known account goes
    // straight to payment, already linked; an unknown e-mail first
    // collects the password the customer wants for the new account.
    // A lookup failure must not block the sale: treat it as unknown and
    // let the password step sort it out.
    let existing: Awaited<ReturnType<typeof findPortalUserByEmail>>;
    try {
      existing = await findPortalUserByEmail(t);
    } catch (error) {
      console.error("[portal] purchase-time e-mail lookup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      existing = undefined;
    }
    if (existing) {
      return emailStep[1] === "pix"
        ? startPixCharge(conversation, plan, t, existing.id, ACCOUNT_FOUND_NOTICE)
        : startCardCharge(conversation, plan, t, existing.id, ACCOUNT_FOUND_NOTICE);
    }
    return {
      text: PASSWORD_PROMPT,
      next: `senha_${emailStep[1]}_${plan.id}`,
      status: "bot",
      context: { pendingEmail: t },
    };
  }
  const senhaStep = /^senha_(pix|card)_(30d|6m|1y)$/.exec(step);
  if (senhaStep) {
    const plan = PLANS[senhaStep[2] as PlanInfo["id"]];
    const pendingEmail =
      typeof context.pendingEmail === "string" ? context.pendingEmail : null;
    if (!pendingEmail) {
      // Lost the e-mail (old conversation state): restart at the e-mail.
      return {
        text: EMAIL_PROMPT(plan),
        next: `email_${senhaStep[1]}_${plan.id}`,
        status: "bot",
        context: {},
      };
    }
    // The password is case-sensitive: use the raw message, only trimmed.
    const password = text.trim();
    if (
      password.length < 6 ||
      password.length > 72 ||
      isReactivationWord(password)
    ) {
      return { text: PASSWORD_INVALID, next: step, status: "bot" };
    }
    // Create the account with the customer's own password, then generate
    // the payment. If creation fails (a race, or the account appeared in
    // the meantime), fall back to linking whatever account exists; if
    // that fails too, approval-time provisioning retries the link, so
    // the sale is never blocked here.
    let portalUserId: string | null = null;
    let notice: string | undefined;
    try {
      const created = await createPortalAccount({
        email: pendingEmail,
        password,
        phone: conversation.phone,
        displayName: conversation.contact_name ?? "",
      });
      portalUserId = created.id;
      notice = ACCOUNT_CREATED_NOTICE;
    } catch (error) {
      console.error("[portal] purchase-time account creation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        const found = await findPortalUserByEmail(pendingEmail);
        if (found) {
          portalUserId = found.id;
          notice = ACCOUNT_FOUND_NOTICE;
        }
      } catch {
        // Approval-time provisioning will link the account later.
      }
    }
    const reply =
      senhaStep[1] === "pix"
        ? await startPixCharge(conversation, plan, pendingEmail, portalUserId, notice)
        : await startCardCharge(conversation, plan, pendingEmail, portalUserId, notice);
    return { ...reply, context: {} };
  }
  // Steps removed from the menu (schedule, register) fall through to
  // INVALID_OPTION + "main" below, so in-flight conversations land safely
  // back on the main menu.
  const prompts: Record<string, string> = {
    support_waiting: "👨‍💼 Você já está na fila. Um agente responderá em breve.",
    bug_wait_text: BUG_PROMPT_DATE,
    bug_wait_date: BUG_DONE,
  };
  const next: Record<string, string> = {
    bug_wait_text: "bug_wait_date",
    bug_wait_date: "main",
    support_waiting: "support_waiting",
  };
  return {
    text: prompts[step] ?? INVALID_OPTION,
    next: next[step] ?? "main",
    status: step === "support_waiting" ? "human" : "bot",
  };
}

export async function handleEvolutionWebhook(req: Request, res: Response) {
  // Prefer the exact bytes Evolution sent (captured by the body parser) so
  // HMAC validation is computed over the real payload, not a re-serialized
  // copy whose key order/escaping may differ.
  const raw =
    (req as Request & { rawBody?: string }).rawBody ??
    JSON.stringify(req.body ?? {});
  if (!validWebhook(req, raw)) {
    console.warn(
      JSON.stringify({
        event: "webhook_rejected",
        path: req.path,
        ip: req.ip,
        ...webhookAuthSignals(req),
      })
    );
    return json(
      res,
      { ok: false, error: "invalid webhook authentication" },
      401
    );
  }
  const parsed = Payload.safeParse(req.body);
  if (!parsed.success)
    return json(res, { ok: false, error: "invalid payload" }, 400);
  if (!/messages[._-]upsert/i.test(parsed.data.event)) {
    console.info(
      JSON.stringify({
        event: "webhook_ignored",
        evolutionEvent: parsed.data.event,
      })
    );
    return json(res, { ok: true, ignored: parsed.data.event });
  }
  const payload = parsed.data as any;
  const resolved = await resolveInstance(
    payload.instance ?? payload.instanceName ?? req.query.instance?.toString()
  );
  if (!resolved) {
    console.warn(
      JSON.stringify({
        event: "webhook_unknown_instance",
        incomingInstance: payload.instance ?? payload.instanceName ?? null,
      })
    );
    return json(res, { ok: true, ignored: "unknown-instance" });
  }
  const data = payload.data ?? {};
  const phone = normalizePhone(data?.key?.remoteJid);
  if (!phone || data?.key?.fromMe)
    return json(res, { ok: true, ignored: !phone ? "no-phone" : "from-me" });
  const text = String(
    data?.message?.conversation ??
      data?.message?.extendedTextMessage?.text ??
      data?.message?.buttonsResponseMessage?.selectedButtonId ??
      data?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ??
      ""
  ).trim();
  if (!text) return json(res, { ok: true, ignored: "no-text" });
  const conversation = await getOrCreate(phone, data?.pushName);
  // Never persist a password the customer typed: mask it in the history
  // (the panel would otherwise show it in plain text).
  const isPasswordAnswer = (conversation.current_menu ?? "").startsWith(
    "senha_"
  );
  await addMessage(
    conversation.id,
    "inbound",
    "user",
    isPasswordAnswer ? "🔐 (senha informada pelo cliente)" : text,
    data?.key?.id
  );
  if (conversation.status === "human" && !isReactivationWord(text))
    return json(res, { ok: true, handled: "human-mode" });
  const stateResult = await supabaseAdmin
    .from("bot_state")
    .select("context_data")
    .eq("conversation_id", conversation.id)
    .maybeSingle();
  const botContext = (stateResult.data?.context_data ?? {}) as Record<
    string,
    unknown
  >;
  const answer = await replyFor(conversation, text, botContext);
  const sent = await sendWhatsAppText({
    number: phone,
    text: answer.text,
    instance: resolved.instance,
    apiKey: resolved.apiKey,
  });
  if (!sent.ok) {
    console.error(
      JSON.stringify({
        event: "evolution_send_failed",
        instance: resolved.instance,
        phone,
        error: sent.error,
      })
    );
    return json(res, { ok: false, error: sent.error }, 502);
  }
  console.info(
    JSON.stringify({
      event: "message_processed",
      instance: resolved.instance,
      phone,
      nextStep: answer.next,
    })
  );
  for (const extraText of answer.extraTexts ?? []) {
    const extraSent = await sendWhatsAppText({
      number: phone,
      text: extraText,
      instance: resolved.instance,
      apiKey: resolved.apiKey,
    });
    if (!extraSent.ok) {
      console.error(
        JSON.stringify({
          event: "evolution_send_failed",
          part: "followup",
          instance: resolved.instance,
          phone,
          error: extraSent.error,
        })
      );
      continue;
    }
    await addMessage(conversation.id, "outbound", "bot", extraText, extraSent.id);
  }
  if (answer.charge) {
    const charge = await supabaseAdmin.from("pix_charges").insert({
      plan_id: answer.charge.planId,
      plan_label: answer.charge.planLabel,
      amount: answer.charge.amount,
      payment_id: answer.charge.paymentId,
      external_reference: answer.charge.externalReference,
      payment_method: answer.charge.paymentMethod,
      qr_code: answer.charge.qrCode ?? null,
      qr_code_base64: answer.charge.qrCodeBase64 ?? null,
      customer_email: answer.charge.customerEmail ?? null,
      portal_user_id: answer.charge.portalUserId ?? null,
      expires_at: answer.charge.expiresAt ?? null,
      phone,
      instance_name: resolved.instance,
      status: "pending",
    });
    if (charge.error)
      console.error("[pix] failed to persist charge", {
        error: charge.error.message,
      });
  }
  await addMessage(conversation.id, "outbound", "bot", answer.text, sent.id);
  await supabaseAdmin
    .from("conversations")
    .update({
      current_menu: answer.next,
      status: answer.status,
      muted_until: answer.muted ?? null,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);
  await supabaseAdmin.from("bot_state").upsert(
    {
      conversation_id: conversation.id,
      current_step: answer.next,
      context_data: answer.context ?? botContext,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" }
  );
  return json(res, { ok: true, instance: resolved.instance });
}
