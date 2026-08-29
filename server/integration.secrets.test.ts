import { describe, expect, it } from "vitest";

describe("configured external integrations", () => {
  it("can read the authorized financeiro instance from Supabase", async () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(url).toMatch(/^https:\/\//);
    expect(key).toBeTruthy();

    const response = await fetch(
      `${url}/rest/v1/whatsapp_instances?select=instance_name,phone,is_active&instance_name=eq.financeiro`,
      {
        headers: {
          apikey: key!,
          Authorization: `Bearer ${key}`,
        },
      },
    );

    expect(response.ok).toBe(true);
    const rows = (await response.json()) as Array<{
      instance_name: string;
      phone: string;
      is_active: boolean;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      instance_name: "financeiro",
      phone: "558185436981",
      is_active: true,
    });
  });

  it("can read the Evolution connection state", async () => {
    const base = process.env.EVOLUTION_API_URL;
    const key = process.env.EVOLUTION_API_KEY;
    expect(base).toMatch(/^https?:\/\//);
    expect(key).toBeTruthy();

    const response = await fetch(`${base}/instance/connectionState/financeiro`, {
      headers: { apikey: key! },
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { instance?: { state?: string } };
    expect(body.instance?.state).toBe("open");
  });
});
