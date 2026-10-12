import { afterEach, describe, expect, it, vi } from "vitest";
import { getMercadoPagoPayment } from "./bot/mercadopago";

describe("Mercado Pago payment lookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
  });

  it("rejects an invalid payment id before making a request", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "token";
    const result = await getMercadoPagoPayment("preference:123");
    expect(result).toEqual({
      ok: false,
      code: "server",
      message: "payment_id inválido",
    });
  });

  it("normalizes the authoritative approved payment response", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 123,
            status: "approved",
            status_detail: "accredited",
            external_reference: "musetera-conversation-1-123",
            transaction_amount: 69.9,
            description: "MuseTera 30 Dias",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const result = await getMercadoPagoPayment("123");
    expect(result).toEqual({
      ok: true,
      payment: {
        id: "123",
        status: "approved",
        statusDetail: "accredited",
        externalReference: "musetera-conversation-1-123",
        transactionAmount: 69.9,
        description: "MuseTera 30 Dias",
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/payments/123",
      expect.objectContaining({
        headers: { Authorization: "Bearer token" },
      })
    );
  });
});
