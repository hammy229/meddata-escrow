import { randomBytes } from "crypto";

export interface PayPalOrderResult {
  id: string;
  status: string;
  approve_url: string;
}

interface PayPalClient {
  createOrder(amount: string, referenceId: string, currency?: string): Promise<PayPalOrderResult>;
  captureOrder(orderId: string): Promise<{ id: string; status: string }>;
}

class MockPayPal implements PayPalClient {
  private orders = new Map<string, string>();

  async createOrder(amount: string, referenceId: string): Promise<PayPalOrderResult> {
    const id = `MOCK-${randomBytes(6).toString("hex").toUpperCase()}`;
    this.orders.set(id, "CREATED");
    void amount;
    void referenceId;
    return {
      id,
      status: "CREATED",
      approve_url: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
    };
  }

  async captureOrder(orderId: string) {
    this.orders.set(orderId, "COMPLETED");
    return { id: orderId, status: "COMPLETED" };
  }
}

class SandboxPayPal implements PayPalClient {
  constructor(
    private clientId: string,
    private secret: string,
    private base: string
  ) {}

  private async token(): Promise<string> {
    const auth = Buffer.from(`${this.clientId}:${this.secret}`).toString("base64");
    const r = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!r.ok) throw new Error(`token request failed: ${r.status}`);
    return (await r.json()).access_token;
  }

  async createOrder(amount: string, referenceId: string, currency = "USD"): Promise<PayPalOrderResult> {
    const token = await this.token();
    const r = await fetch(`${this.base}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          { reference_id: referenceId, amount: { currency_code: currency, value: amount } },
        ],
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const approve = data.links.find(
      (l: { rel: string; href: string }) => l.rel === "approve" || l.rel === "payer-action"
    )?.href;
    return { id: data.id, status: data.status, approve_url: approve };
  }

  async captureOrder(orderId: string) {
    const token = await this.token();
    const r = await fetch(`${this.base}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    return { id: data.id, status: data.status };
  }
}

export function getPayPal(): PayPalClient {
  if (process.env.PAYPAL_MODE === "sandbox") {
    return new SandboxPayPal(
      process.env.PAYPAL_CLIENT_ID!,
      process.env.PAYPAL_CLIENT_SECRET!,
      process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com"
    );
  }
  return new MockPayPal();
}
