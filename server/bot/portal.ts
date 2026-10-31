import { randomInt } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabase";

// Portal access provisioning. The customer is identified by e-mail:
// - At purchase time the bot checks whether the e-mail already has a
//   portal account (created on the portal site or by the bot). Unknown
//   e-mails get the account created right there, before payment.
// - When the payment is approved, the subscription expiry is recorded
//   and the customer is notified. Credentials (a temporary password) are
//   only ever generated for accounts the bot itself created; accounts
//   born on the portal keep the password their owner chose.

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

export async function findPortalUserByEmail(
  email: string
): Promise<User | undefined> {
  // The customer base is small; scan the first page of users.
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw error;
  return data.users.find(
    (u) => u.email?.toLowerCase() === email.trim().toLowerCase()
  );
}

async function ensureProfileRow(userId: string, displayName: string) {
  // Insert only when absent: never overwrite the name a customer set on
  // the portal with their WhatsApp name.
  const profile = await supabaseAdmin.from("profiles").upsert(
    { id: userId, display_name: displayName },
    { onConflict: "id", ignoreDuplicates: true }
  );
  if (profile.error) {
    console.error("[portal] profile upsert failed", {
      userId,
      error: profile.error.message,
    });
  }
}

/**
 * Creates a portal account with the password the customer chose in the
 * chat. The account only gains access when a payment is approved and
 * records a subscription expiry; before that it is just a login.
 */
export async function createPortalAccount(params: {
  email: string;
  password: string;
  phone: string;
  displayName: string;
}): Promise<User> {
  const email = params.email.trim().toLowerCase();
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password: params.password,
    email_confirm: true,
    user_metadata: {
      phone: params.phone,
      origin: "whatsapp-bot",
      password_source: "customer",
    },
  });
  if (created.error) throw created.error;
  await ensureProfileRow(
    created.data.user.id,
    params.displayName || params.phone
  );
  return created.data.user;
}

export type PortalAccess = {
  userId: string;
  /**
   * credentials: bot-created account with a bot-generated password the
   *   customer still needs to receive.
   * customer: bot-created account whose password the customer chose in
   *   the chat — never reset, never resent.
   * existing: portal-created account, its password is never touched.
   * renewal: this account already received a confirmation before.
   */
  kind: "credentials" | "customer" | "existing" | "renewal";
  tempPassword?: string;
  expiresAt: Date;
};

export async function ensurePortalAccess(params: {
  email: string;
  phone: string;
  displayName: string;
  planId: string;
  currentChargeId: string;
  portalUserId?: string | null;
}): Promise<PortalAccess> {
  const email = params.email.trim().toLowerCase();
  let user: User | undefined;
  if (params.portalUserId) {
    const byId = await supabaseAdmin.auth.admin.getUserById(
      params.portalUserId
    );
    if (!byId.error) user = byId.data.user;
  }
  if (!user) user = await findPortalUserByEmail(email);

  let kind: PortalAccess["kind"];
  let tempPassword: string | undefined;

  if (!user) {
    // The account vanished between purchase and approval (or the
    // purchase-time creation failed): create it now, with credentials.
    tempPassword = generateTempPassword();
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        phone: params.phone,
        origin: "whatsapp-bot",
        password_source: "temp",
      },
    });
    if (created.error) throw created.error;
    user = created.data.user;
    kind = "credentials";
  } else {
    const prior = await supabaseAdmin
      .from("pix_charges")
      .select("id")
      .eq("portal_user_id", user.id)
      .not("confirmation_sent_at", "is", null)
      .neq("id", params.currentChargeId)
      .limit(1);
    if (prior.error) throw prior.error;
    const hasConfirmedBefore = !!prior.data && prior.data.length > 0;
    if (hasConfirmedBefore) {
      kind = "renewal";
    } else if (user.user_metadata?.origin !== "whatsapp-bot") {
      // Account created on the portal: never touch its password.
      kind = "existing";
    } else if (user.user_metadata?.password_source === "customer") {
      // The customer chose this password in the chat: keep it.
      kind = "customer";
    } else {
      // Bot-created account whose generated credentials were never
      // delivered: (re)set the password so the message carries a
      // working one.
      tempPassword = generateTempPassword();
      const updated = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: tempPassword,
      });
      if (updated.error) throw updated.error;
      kind = "credentials";
    }
  }

  await ensureProfileRow(user.id, params.displayName || params.phone);

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

  return { userId: user.id, kind, tempPassword, expiresAt };
}
