import { supabaseAdmin, supabasePortal } from "../supabase";
import { sendWhatsAppText } from "./evolution";
import { renewalReminder } from "./flow";
import { formatDateBR } from "./portal";
import { addMessage, getOrCreate, resolveInstance } from "./webhook-handler";

// Renewal reminders: customers whose portal plan expires in exactly 7, 3
// or 1 days get a WhatsApp nudge. Delivery is recorded in
// portal_renewal_reminders (one row per customer + threshold + expiry),
// so sweeps are idempotent across restarts. The sweep runs inside the
// bot server: first run shortly after boot, then every 6 hours.

export const REMINDER_THRESHOLDS_DAYS = [7, 3, 1];
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;

let schedulerStarted = false;
let sweepRunning = false;

export function startRenewalReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const first = setTimeout(() => void runRenewalSweep(), FIRST_SWEEP_DELAY_MS);
  first.unref?.();
  const timer = setInterval(() => void runRenewalSweep(), SWEEP_INTERVAL_MS);
  timer.unref?.();
  console.info("[reminders] scheduler started", {
    thresholds: REMINDER_THRESHOLDS_DAYS,
    intervalHours: SWEEP_INTERVAL_MS / 3_600_000,
  });
}

/** Same day math the portal uses for its "days remaining" display. */
export function daysRemainingUntil(expiresAt: Date, now = new Date()): number {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
}

export function normalizeCustomerPhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 13) return null;
  if (!digits.startsWith("55")) return null;
  return digits;
}

async function resolveCustomerPhone(portalUserId: string): Promise<string | null> {
  // 1. The bot's own charges carry the WhatsApp number used at purchase.
  const charge = await supabaseAdmin
    .from("pix_charges")
    .select("phone")
    .eq("portal_user_id", portalUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  const fromCharge = normalizeCustomerPhone(charge.data?.[0]?.phone);
  if (fromCharge) return fromCharge;

  // 2. The portal's professional record usually has the phone.
  const professional = await supabasePortal
    .from("professionals")
    .select("phone")
    .eq("user_id", portalUserId)
    .maybeSingle();
  const fromProfessional = normalizeCustomerPhone(professional.data?.phone);
  if (fromProfessional) return fromProfessional;

  // 3. Legacy registrations kept the phone in the auth metadata.
  const user = await supabasePortal.auth.admin.getUserById(portalUserId);
  const metadataPhone = (user.data?.user?.user_metadata as { phone?: string } | undefined)?.phone;
  return normalizeCustomerPhone(metadataPhone);
}

async function lastChargeInfo(portalUserId: string) {
  const charge = await supabaseAdmin
    .from("pix_charges")
    .select("plan_id,plan_label,amount")
    .eq("portal_user_id", portalUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  return charge.data?.[0] ?? null;
}

export async function runRenewalSweep(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + 8 * 86_400_000);
    const profiles = await supabasePortal
      .from("profiles")
      .select("id,expires_at")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", horizon.toISOString());
    if (profiles.error) throw profiles.error;

    const instance = await resolveInstance(undefined);
    if (!instance) {
      console.error("[reminders] no active WhatsApp instance; sweep aborted");
      return;
    }

    let sent = 0;
    let skipped = 0;
    for (const profile of profiles.data ?? []) {
      const expiresAt = new Date(profile.expires_at as string);
      const days = daysRemainingUntil(expiresAt, now);
      if (!REMINDER_THRESHOLDS_DAYS.includes(days)) continue;

      const existing = await supabaseAdmin
        .from("portal_renewal_reminders")
        .select("id,status,attempts")
        .eq("portal_user_id", profile.id)
        .eq("reminder_days", days)
        .eq("subscription_expires_at", expiresAt.toISOString())
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data?.status === "sent") {
        skipped++;
        continue;
      }
      if (existing.data && (existing.data.attempts ?? 0) >= MAX_ATTEMPTS) {
        skipped++;
        continue;
      }

      const phone = await resolveCustomerPhone(profile.id);
      const plan = await lastChargeInfo(profile.id);

      let reminderId = existing.data?.id as string | undefined;
      if (!reminderId) {
        const inserted = await supabaseAdmin
          .from("portal_renewal_reminders")
          .insert({
            portal_user_id: profile.id,
            reminder_days: days,
            subscription_expires_at: expiresAt.toISOString(),
            plan_id: plan?.plan_id ?? null,
            plan_label: plan?.plan_label ?? null,
            amount: plan?.amount ?? null,
            phone: phone ?? "",
            status: "pending",
            attempts: 0,
          })
          .select("id")
          .single();
        if (inserted.error) {
          console.error("[reminders] failed to record reminder", {
            portalUserId: profile.id,
            error: inserted.error.message,
          });
          continue;
        }
        reminderId = inserted.data.id as string;
      }

      const attempts = (existing.data?.attempts ?? 0) + 1;
      if (!phone) {
        await supabaseAdmin
          .from("portal_renewal_reminders")
          .update({
            status: "failed",
            attempts,
            last_error: "phone-not-found",
          })
          .eq("id", reminderId);
        console.warn("[reminders] customer without a reachable phone", {
          portalUserId: profile.id,
          days,
        });
        continue;
      }

      const text = renewalReminder(days, formatDateBR(expiresAt));
      const result = await sendWhatsAppText({ number: phone, text, ...instance });
      if (!result.ok) {
        await supabaseAdmin
          .from("portal_renewal_reminders")
          .update({
            status: "failed",
            attempts,
            last_error: result.error ?? "send-failed",
          })
          .eq("id", reminderId);
        console.error("[reminders] send failed", {
          portalUserId: profile.id,
          days,
          error: result.error,
        });
        continue;
      }

      await supabaseAdmin
        .from("portal_renewal_reminders")
        .update({
          status: "sent",
          attempts,
          sent_at: new Date().toISOString(),
          evolution_message_id: result.id ?? null,
          phone,
        })
        .eq("id", reminderId);
      const conversation = await getOrCreate(phone);
      await addMessage(conversation.id, "outbound", "bot", text, result.id);
      sent++;
      console.info("[reminders] renewal reminder sent", {
        portalUserId: profile.id,
        days,
        expiresAt: expiresAt.toISOString(),
      });
    }
    console.info("[reminders] sweep finished", { sent, skipped });
  } catch (error) {
    console.error("[reminders] sweep failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    sweepRunning = false;
  }
}
