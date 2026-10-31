import { randomInt } from "node:crypto";
import { supabaseAdmin } from "../supabase";

// Portal access provisioning: when a payment is approved, the customer gets
// a Supabase Auth account for the MuseTera portal, a subscription expiry
// derived from the purchased plan, and (on first access) a temporary
// password delivered over WhatsApp.

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim().toLowerCase());
}

const PASSWORD_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generateTempPassword(length = 12): string {
  for (;;) {
    let password = "";
    for (let i = 0; i < length; i++) {
      password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) {
      return password;
    }
  }
}

export function addPlanDuration(base: Date, planId: string): Date {
  // UTC calendar math: the stored expiry must not drift with the server
  // timezone or DST changes.
  const result = new Date(base);
  if (planId === "30d") {
    result.setUTCDate(result.getUTCDate() + 30);
  } else if (planId === "6m") {
    result.setUTCMonth(result.getUTCMonth() + 6);
  } else if (planId === "1y") {
    result.setUTCMonth(result.getUTCMonth() + 12);
  } else {
    throw new Error(`unknown plan id: ${planId}`);
  }
  return result;
}

export function planIdFromLabel(planLabel: string): string {
  const map: Record<string, string> = {
    "30 Dias": "30d",
    "6 Meses": "6m",
    "12 Meses": "1y",
  };
  const id = map[planLabel];
  if (!id) throw new Error(`unknown plan label: ${planLabel}`);
  return id;
}

export function formatDateBR(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export type PortalAccess = {
  userId: string;
  /** True when the customer still needs credentials (new account, or a
   *  previous activation whose confirmation message never landed). */
  isFirstAccess: boolean;
  tempPassword?: string;
  expiresAt: Date;
};

async function findAuthUserByEmail(email: string) {
  // The customer base is small; scan the first page of users.
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw error;
  return data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
}

export async function ensurePortalAccess(params: {
  email: string;
  phone: string;
  displayName: string;
  planId: string;
  currentChargeId: string;
}): Promise<PortalAccess> {
  const email = params.email.trim().toLowerCase();
  let user = await findAuthUserByEmail(email);
  let tempPassword: string | undefined;
  let isFirstAccess = false;

  if (!user) {
    tempPassword = generateTempPassword();
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { phone: params.phone, origin: "whatsapp-bot" },
    });
    if (created.error) throw created.error;
    user = created.data.user;
    isFirstAccess = true;
  } else {
    // If no earlier charge for this account ever got its confirmation
    // delivered, the customer never received a password: reset it and
    // deliver credentials with this charge instead of a renewal note.
    const prior = await supabaseAdmin
      .from("pix_charges")
      .select("id")
      .eq("portal_user_id", user.id)
      .not("confirmation_sent_at", "is", null)
      .neq("id", params.currentChargeId)
      .limit(1);
    if (prior.error) throw prior.error;
    if (!prior.data || prior.data.length === 0) {
      tempPassword = generateTempPassword();
      const updated = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: tempPassword,
      });
      if (updated.error) throw updated.error;
      isFirstAccess = true;
    }
  }

  const profile = await supabaseAdmin.from("profiles").upsert(
    {
      id: user.id,
      display_name: params.displayName || params.phone,
    },
    { onConflict: "id" }
  );
  if (profile.error) {
    console.error("[portal] profile upsert failed", {
      userId: user.id,
      error: profile.error.message,
    });
  }

  // Renewals stack on top of a still-active subscription instead of
  // restarting from today.
  const previous = await supabaseAdmin
    .from("pix_charges")
    .select("subscription_expires_at")
    .eq("portal_user_id", user.id)
    .not("subscription_expires_at", "is", null)
    .order("subscription_expires_at", { ascending: false })
    .limit(1);
  if (previous.error) throw previous.error;
  const now = new Date();
  const previousExpiry = previous.data?.[0]?.subscription_expires_at
    ? new Date(previous.data[0].subscription_expires_at as string)
    : null;
  const base =
    previousExpiry && previousExpiry > now ? previousExpiry : now;
  const expiresAt = addPlanDuration(base, params.planId);

  return { userId: user.id, isFirstAccess, tempPassword, expiresAt };
}
