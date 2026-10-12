import type { Request, Response } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { getMercadoPagoPayment } from "./mercadopago";
import { addMessage, getOrCreate, resolveInstance } from "./webhook-handler";
import { paymentApproved } from "./flow";
import { sendWhatsAppText } from "./evolution";

const PaymentNotification = z
  .object({
    action: z.string().optional(),
    type: z.string().optional(),
    topic: z.string().optional(),
    data: z
      .object({ id: z.union([z.string(), z.number()]).optional() })
      .optional(),
    id: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

type Charge = {
  id: string;
  phone: string;
  instance_name: string;
  plan_label: string;
  amount: number;
  status: string;
  external_reference?: string | null;
  payment_id?: string | null;
  confirmation_sent_at?: string | null;
};

function json(res: Response, body: unknown, status = 200) {
  return res.status(status).json(body);
}

function getPaymentId(
  req: Request,
  payload: z.infer<typeof PaymentNotification>
): string | null {
  const queryData =
    typeof req.query.data === "string"
      ? (() => {
          try {
            return JSON.parse(req.query.data);
          } catch {
            return undefined;
          }
        })()
      : req.query.data;
  const value =
    payload.data?.id ??
    payload.id ??
    (queryData && typeof queryData === "object"
      ? (queryData as { id?: unknown }).id
      : undefined) ??
    req.query.id;
  const id = String(value ?? "").trim();
  return /^\d+$/.test(id) ? id : null;
}

function isPaymentEvent(
  req: Request,
  payload: z.infer<typeof PaymentNotification>
): boolean {
  const event =
    `${payload.type ?? ""} ${payload.action ?? ""} ${payload.topic ?? ""} ${req.query.type ?? ""} ${req.query.action ?? ""} ${req.query.topic ?? ""}`.toLowerCase();
  return (
    event.includes("payment") ||
    event.includes("created") ||
    event.includes("updated")
  );
}

/** Recebe a notificação, consulta o pagamento no MP e só confirma após status=approved. */
export async function handleMercadoPagoWebhook(req: Request, res: Response) {
  const parsed = PaymentNotification.safeParse(req.body ?? {});
  if (!parsed.success)
    return json(
      res,
      { ok: false, error: "invalid payment webhook payload" },
      400
    );
  if (!isPaymentEvent(req, parsed.data))
    return json(res, { ok: true, ignored: "unsupported-event" });

  const paymentId = getPaymentId(req, parsed.data);
  if (!paymentId)
    return json(
      res,
      { ok: false, error: "payment_id missing or invalid" },
      400
    );

  const payment = await getMercadoPagoPayment(paymentId);
  if (!payment.ok) {
    console.error("[mercadopago] payment lookup failed", {
      paymentId,
      error: payment.message,
    });
    return json(
      res,
      { ok: false, error: payment.message },
      payment.code === "auth" ? 401 : 502
    );
  }
  if (payment.payment.status !== "approved") {
    console.info("[mercadopago] payment not approved", {
      paymentId,
      status: payment.payment.status,
      statusDetail: payment.payment.statusDetail,
    });
    return json(res, {
      ok: true,
      ignored: "payment-not-approved",
      status: payment.payment.status,
    });
  }

  let chargeResult = await supabaseAdmin
    .from("pix_charges")
    .select(
      "id,phone,instance_name,plan_label,amount,status,external_reference,payment_id,confirmation_sent_at"
    )
    .eq("payment_id", paymentId)
    .maybeSingle();
  if (!chargeResult.data && payment.payment.externalReference) {
    chargeResult = await supabaseAdmin
      .from("pix_charges")
      .select(
        "id,phone,instance_name,plan_label,amount,status,external_reference,payment_id,confirmation_sent_at"
      )
      .eq("external_reference", payment.payment.externalReference)
      .maybeSingle();
  }
  if (chargeResult.error) throw chargeResult.error;
  const charge = chargeResult.data as Charge | null;
  if (!charge) {
    console.warn("[mercadopago] approved payment without local charge", {
      paymentId,
      externalReference: payment.payment.externalReference ?? null,
    });
    return json(res, { ok: true, ignored: "charge-not-found" });
  }
  if (charge.status === "approved" || charge.confirmation_sent_at) {
    return json(res, { ok: true, duplicate: true, paymentId });
  }
  if (
    payment.payment.transactionAmount !== undefined &&
    Math.abs(Number(charge.amount) - payment.payment.transactionAmount) > 0.01
  ) {
    console.error("[mercadopago] approved payment amount mismatch", {
      paymentId,
      expected: charge.amount,
      received: payment.payment.transactionAmount,
    });
    return json(res, { ok: false, error: "payment amount mismatch" }, 422);
  }

  // Claim the pending row atomically so repeated Mercado Pago notifications cannot send twice.
  const claim = await supabaseAdmin
    .from("pix_charges")
    .update({ status: "processing", payment_id: paymentId })
    .eq("id", charge.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return json(res, { ok: true, duplicate: true, paymentId });

  const instance = await resolveInstance(charge.instance_name);
  if (!instance) {
    await supabaseAdmin
      .from("pix_charges")
      .update({ status: "pending" })
      .eq("id", charge.id);
    return json(
      res,
      { ok: false, error: "whatsapp instance not configured" },
      502
    );
  }
  const conversation = await getOrCreate(charge.phone);
  const text = paymentApproved(
    charge.plan_label,
    `R$ ${Number(charge.amount).toFixed(2).replace(".", ",")}`,
    paymentId
  );
  const sent = await sendWhatsAppText({
    number: charge.phone,
    text,
    instance: instance.instance,
    apiKey: instance.apiKey,
  });
  if (!sent.ok) {
    await supabaseAdmin
      .from("pix_charges")
      .update({ status: "pending" })
      .eq("id", charge.id);
    console.error("[mercadopago] confirmation send failed", {
      paymentId,
      phone: charge.phone,
      error: sent.error,
    });
    return json(res, { ok: false, error: sent.error }, 502);
  }

  const confirmedAt = new Date().toISOString();
  const finalized = await supabaseAdmin
    .from("pix_charges")
    .update({
      status: "approved",
      payment_id: paymentId,
      confirmation_sent_at: confirmedAt,
    })
    .eq("id", charge.id)
    .eq("status", "processing");
  if (finalized.error) throw finalized.error;
  await addMessage(conversation.id, "outbound", "bot", text, sent.id);
  console.info("[mercadopago] payment approved and customer notified", {
    paymentId,
    phone: charge.phone,
    instance: instance.instance,
  });
  return json(res, { ok: true, approved: true, paymentId });
}
