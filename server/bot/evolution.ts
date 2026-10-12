// Evolution API client for sending WhatsApp messages.
// Server-side only — uses env secrets.

interface SendTextOptions {
  number: string; // phone in international format e.g. 5511999999999
  text: string;
  /** Override the Evolution instance name. Falls back to EVOLUTION_INSTANCE_NAME. */
  instance?: string;
  /** Override the Evolution API key. Falls back to EVOLUTION_API_KEY. */
  apiKey?: string;
}

export async function sendWhatsAppText({ number, text, instance, apiKey }: SendTextOptions): Promise<{ ok: boolean; id?: string; error?: string }> {
  const rawBaseUrl = process.env.EVOLUTION_API_URL;
  const resolvedApiKey = apiKey ?? process.env.EVOLUTION_API_KEY;
  const resolvedInstance = instance ?? process.env.EVOLUTION_INSTANCE_NAME;

  if (!rawBaseUrl || !resolvedApiKey || !resolvedInstance) {
    console.error("[evolution] Missing credentials", {
      hasBaseUrl: !!rawBaseUrl,
      hasApiKey: !!resolvedApiKey,
      hasInstance: !!resolvedInstance,
    });
    return { ok: false, error: "Evolution API credentials are not configured" };
  }

  // Sanity check: EVOLUTION_API_URL must be a real URL (http(s)://host[:port]),
  // NOT the API key. We saw misconfigurations where the apikey value was pasted here.
  if (!/^https?:\/\//i.test(rawBaseUrl)) {
    console.error("[evolution] EVOLUTION_API_URL is invalid — it must start with http:// or https://", {
      baseUrlPreview: rawBaseUrl.slice(0, 12) + "...",
      length: rawBaseUrl.length,
    });
    return {
      ok: false,
      error:
        "EVOLUTION_API_URL is misconfigured. It must be the server URL (e.g. http://167.114.201.124:8080), not the API key.",
    };
  }

  const normalized = normalizeEvolutionBaseUrl(rawBaseUrl);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }

  const cleanApiKey = resolvedApiKey.trim();
  const cleanInstance = normalizeInstanceName(resolvedInstance);
  const url = `${normalized.baseUrl}/message/sendText/${encodeURIComponent(cleanInstance)}`;
  const isHttp = url.startsWith("http://");
  // Avoid logging customer phone numbers, message content, or credential metadata.
  console.log("[evolution] sending WhatsApp text", {
    instance: cleanInstance,
    isHttp,
    normalizedFromDashboardUrl: normalized.normalizedFromDashboardUrl,
  });

  // Retry on 409 only (instance temporarily locked/busy after a recent inbound event).
  // 403 is now treated as final — repeated 403s usually mean an edge firewall (fail2ban,
  // Cloudflare, iptables) is blocking us, and retrying just makes the ban worse.
  const retryDelaysMs = [800];
  let lastErrorBody = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: cleanApiKey,
        },
        body: JSON.stringify({ number, text }),
      });

      const data = await res.json().catch(() => ({}));
      console.log("[evolution] sendText response", {
        status: res.status,
        attempt: attempt + 1,
      });

      if (res.ok) {
        return { ok: true, id: data?.key?.id ?? data?.messageId };
      }

      lastStatus = res.status;
      lastErrorBody = JSON.stringify(data);

      // Only retry on 409 (instance busy). 403 is treated as final — see comment above.
      const shouldRetry = res.status === 409 && attempt < retryDelaysMs.length;
      if (!shouldRetry) {
        console.error("[evolution] sendText request failed", { status: res.status });
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            error:
              `Evolution returned ${res.status}. Empty body usually means the request was blocked by a firewall (fail2ban / Cloudflare / iptables) on the Evolution server before reaching the API. Check the VPS firewall and allowlist the Lovable server IP, or expose Evolution behind HTTPS+domain.`,
          };
        }
        return { ok: false, error: `Evolution API error ${res.status}` };
      }

      const delay = retryDelaysMs[attempt];
      console.warn(`[evolution] HTTP ${res.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${retryDelaysMs.length})`);
      await sleep(delay);
    } catch (err) {
      console.error("[evolution] fetch failed", {
        attempt: attempt + 1,
        errorName: err instanceof Error ? err.name : typeof err,
      });
      // Network errors: retry too, with the same backoff.
      if (attempt >= retryDelaysMs.length) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      await sleep(retryDelaysMs[attempt]);
    }
  }

  return { ok: false, error: `Evolution API error ${lastStatus} after retries: ${lastErrorBody}` };
}

// ---------- Interactive messages (buttons / list) ----------

export interface ReplyButton {
  id: string; // returned in webhook when tapped
  title: string; // <= 20 chars
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

/**
 * Send a message with reply buttons (max 3). Falls back silently to plain
 * text if the Evolution instance does not support /message/sendButtons.
 */
export async function sendWhatsAppButtons(opts: {
  number: string;
  text: string;
  footer?: string;
  buttons: ReplyButton[];
}): Promise<{ ok: boolean; id?: string; error?: string; fallback?: boolean }> {
  const creds = readCreds();
  if (!creds.ok) return { ok: false, error: creds.error };

  const url = `${creds.baseUrl}/message/sendButtons/${encodeURIComponent(creds.instance)}`;
  const body = {
    number: opts.number,
    title: "",
    description: opts.text,
    footer: opts.footer ?? "",
    buttons: opts.buttons.slice(0, 3).map((b) => ({
      type: "reply",
      displayText: b.title.slice(0, 20),
      id: b.id,
    })),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: creds.apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    console.log("[evolution] sendButtons response", { status: res.status });
    if (res.ok) return { ok: true, id: (data as any)?.key?.id };
    // Fallback to plain text on any failure
    const fb = await sendWhatsAppText({ number: opts.number, text: opts.text });
    return { ok: fb.ok, id: fb.id, error: fb.error, fallback: true };
  } catch (err) {
    console.error("[evolution] sendButtons threw", err);
    const fb = await sendWhatsAppText({ number: opts.number, text: opts.text });
    return { ok: fb.ok, id: fb.id, error: fb.error, fallback: true };
  }
}

/**
 * Send an interactive list message. Falls back to plain text on failure.
 */
export async function sendWhatsAppList(opts: {
  number: string;
  text: string;
  buttonText: string; // e.g. "Menu de opções"
  title?: string;
  footer?: string;
  sections: ListSection[];
}): Promise<{ ok: boolean; id?: string; error?: string; fallback?: boolean }> {
  const creds = readCreds();
  if (!creds.ok) return { ok: false, error: creds.error };

  const url = `${creds.baseUrl}/message/sendList/${encodeURIComponent(creds.instance)}`;
  const body = {
    number: opts.number,
    title: opts.title ?? "",
    description: opts.text,
    buttonText: opts.buttonText,
    footerText: opts.footer ?? "",
    sections: opts.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        rowId: r.id,
        title: r.title.slice(0, 24),
        description: r.description?.slice(0, 72) ?? "",
      })),
    })),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: creds.apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    console.log("[evolution] sendList response", { status: res.status });
    if (res.ok) return { ok: true, id: (data as any)?.key?.id };
    const fb = await sendWhatsAppText({ number: opts.number, text: opts.text });
    return { ok: fb.ok, id: fb.id, error: fb.error, fallback: true };
  } catch (err) {
    console.error("[evolution] sendList threw", err);
    const fb = await sendWhatsAppText({ number: opts.number, text: opts.text });
    return { ok: fb.ok, id: fb.id, error: fb.error, fallback: true };
  }
}

function readCreds():
  | { ok: true; baseUrl: string; apiKey: string; instance: string }
  | { ok: false; error: string } {
  const rawBaseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME;
  if (!rawBaseUrl || !apiKey || !instance) {
    return { ok: false, error: "Evolution API credentials are not configured" };
  }
  if (!/^https?:\/\//i.test(rawBaseUrl)) {
    return { ok: false, error: "EVOLUTION_API_URL is misconfigured" };
  }
  const normalized = normalizeEvolutionBaseUrl(rawBaseUrl);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  return {
    ok: true,
    baseUrl: normalized.baseUrl,
    apiKey: apiKey.trim(),
    instance: normalizeInstanceName(instance),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEvolutionBaseUrl(rawBaseUrl: string):
  | { ok: true; baseUrl: string; normalizedFromDashboardUrl: boolean }
  | { ok: false; error: string } {
  try {
    const parsed = new URL(rawBaseUrl.trim());
    const normalizedFromDashboardUrl = /\/manager\/instance\//i.test(parsed.pathname);

    // Evolution's sendText endpoint is mounted from the API root. If the secret
    // receives a dashboard URL like /manager/instance/.../dashboard, strip it.
    return {
      ok: true,
      baseUrl: parsed.origin,
      normalizedFromDashboardUrl,
    };
  } catch (err) {
    console.error("[evolution] Failed to parse EVOLUTION_API_URL", {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "EVOLUTION_API_URL is not a valid URL" };
  }
}

function normalizeInstanceName(instance: string): string {
  return instance
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .at(-1) ?? instance.trim();
}

/** Normalize a JID like "5511999999999@s.whatsapp.net" -> "5511999999999" */
export function normalizePhone(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const cleaned = jid.split("@")[0];
  // Skip groups
  if (jid.includes("@g.us")) return null;
  return cleaned.replace(/\D/g, "") || null;
}