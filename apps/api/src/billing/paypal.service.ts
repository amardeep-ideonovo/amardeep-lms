import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

// Thin fetch-based client for the PayPal REST APIs we use (Catalog Products v1,
// Subscriptions v1, webhook signature verification). Deliberately not the
// official server SDK: its surface doesn't cover verify-webhook-signature, and
// verification requires splicing the byte-exact raw webhook body into the
// request (re-serializing parsed JSON can change byte order and fail). The
// OAuth client-credentials token is cached per mode+clientId so admin key
// rotation or a sandbox↔live switch takes effect without a restart — same
// pattern as StripeService's key-rotation-aware client.

// Narrow response shapes (only the fields we consume).
export interface PayPalCycleExecution {
  tenure_type: 'REGULAR' | 'TRIAL';
  cycles_completed: number;
  total_cycles: number;
}
export interface PayPalSubscription {
  id: string; // I-…
  status:
    | 'APPROVAL_PENDING'
    | 'APPROVED'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'CANCELLED'
    | 'EXPIRED';
  plan_id: string;
  custom_id?: string; // our userId, stamped at Buttons createSubscription
  start_time?: string;
  status_update_time?: string;
  subscriber?: { payer_id?: string; email_address?: string };
  billing_info?: {
    next_billing_time?: string;
    last_payment?: {
      time?: string;
      amount?: { value: string; currency_code: string };
    };
    cycle_executions?: PayPalCycleExecution[];
  };
}
export interface PayPalTransaction {
  id: string;
  status: string; // COMPLETED | PARTIALLY_REFUNDED | REFUNDED | …
  time: string;
  amount_with_breakdown?: {
    gross_amount?: { value: string; currency_code: string };
  };
}

// Currencies PayPal treats as zero-decimal — our cents→"x.xx" conversion would
// be wrong for them, so plan creation refuses (the site bills in USD today).
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

type HeaderBag = Record<string, string | string[] | undefined>;
const header = (h: HeaderBag, name: string): string => {
  const v = h[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};

@Injectable()
export class PayPalService {
  private readonly logger = new Logger(PayPalService.name);
  private token: {
    value: string;
    expiresAt: number; // epoch ms, with safety skew
    cacheKey: string; // mode:clientId — rotation invalidates
  } | null = null;

  constructor(private readonly settings: SettingsService) {}

  private baseUrl(mode: 'sandbox' | 'live'): string {
    return mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  /** True when a client id + secret are configured (Setting table or env). */
  async isConfigured(): Promise<boolean> {
    const [clientId, secret] = await Promise.all([
      this.settings.getPayPalClientId(),
      this.settings.getPayPalClientSecret(),
    ]);
    return !!clientId && !!secret;
  }

  // Public config for /billing/config — the browser needs the client id to load
  // the PayPal JS SDK. Null unless the secret is ALSO set (a client id alone
  // can't complete a subscription), mirroring getElementsPublishableKey.
  async getClientConfig(): Promise<{
    clientId: string;
    mode: 'sandbox' | 'live';
  } | null> {
    const [clientId, secret, mode] = await Promise.all([
      this.settings.getPayPalClientId(),
      this.settings.getPayPalClientSecret(),
      this.settings.getPayPalMode(),
    ]);
    return clientId && secret ? { clientId, mode } : null;
  }

  private async creds(): Promise<{
    clientId: string;
    secret: string;
    mode: 'sandbox' | 'live';
  }> {
    const [clientId, secret, mode] = await Promise.all([
      this.settings.getPayPalClientId(),
      this.settings.getPayPalClientSecret(),
      this.settings.getPayPalMode(),
    ]);
    if (!clientId || !secret) {
      throw new InternalServerErrorException('PayPal is not configured');
    }
    return { clientId, secret, mode };
  }

  private async getAccessToken(): Promise<{ token: string; base: string }> {
    const { clientId, secret, mode } = await this.creds();
    const cacheKey = `${mode}:${clientId}`;
    const base = this.baseUrl(mode);
    if (
      this.token &&
      this.token.cacheKey === cacheKey &&
      Date.now() < this.token.expiresAt
    ) {
      return { token: this.token.value, base };
    }
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw await this.asError('oauth token', res);
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: data.access_token,
      // 60s skew so we never present a token that dies mid-request.
      expiresAt: Date.now() + Math.max(0, data.expires_in - 60) * 1000,
      cacheKey,
    };
    return { token: data.access_token, base };
  }

  // Log the full provider response server-side; surface a terse 500 to clients
  // (PayPal error bodies can include account details we don't want to leak).
  private async asError(
    what: string,
    res: Response,
  ): Promise<InternalServerErrorException> {
    const body = await res.text().catch(() => '');
    this.logger.error(`PayPal ${what} failed (${res.status}): ${body}`);
    return new InternalServerErrorException(
      `PayPal request failed (${res.status})`,
    );
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { token, base } = await this.getAccessToken();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await this.asError(`${method} ${path}`, res);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // --- Catalog product + billing plan provisioning (lazy, per price) ---

  async ensureProduct(name: string): Promise<string> {
    const product = await this.request<{ id: string }>(
      'POST',
      '/v1/catalogs/products',
      { name, type: 'SERVICE' },
    );
    return product.id;
  }

  // Keep the catalog product name in step with a level rename (best-effort at
  // the call site — a failed rename must not block the level save).
  async updateProduct(productId: string, name: string): Promise<void> {
    await this.request('PATCH', `/v1/catalogs/products/${productId}`, [
      { op: 'replace', path: '/name', value: name },
    ]);
  }

  // One plan per local Price. `installments` maps to total_cycles (PayPal stops
  // billing by itself after N cycles — the EXPIRED webhook then converts the
  // grant to lifetime); 0 = bill until canceled.
  async createPlan(input: {
    productId: string;
    name: string;
    interval: 'month' | 'year';
    amount: number; // minor units
    currency: string;
    installments: number | null;
  }): Promise<string> {
    const currency = input.currency.toUpperCase();
    if (ZERO_DECIMAL.has(currency)) {
      throw new BadRequestException(
        `Currency ${currency} is not supported for PayPal plans`,
      );
    }
    const plan = await this.request<{ id: string }>('POST', '/v1/billing/plans', {
      product_id: input.productId,
      name: input.name,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: {
            interval_unit: input.interval === 'year' ? 'YEAR' : 'MONTH',
            interval_count: 1,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: input.installments ?? 0,
          pricing_scheme: {
            fixed_price: {
              value: (input.amount / 100).toFixed(2),
              currency_code: currency,
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    });
    return plan.id;
  }

  // Parity with Stripe's archivePrice: existing subscriptions keep billing, but
  // the plan can't back a new checkout.
  async deactivatePlan(planId: string): Promise<void> {
    await this.request('POST', `/v1/billing/plans/${planId}/deactivate`);
  }

  // --- Subscriptions ---

  async getSubscription(subId: string): Promise<PayPalSubscription> {
    return this.request<PayPalSubscription>(
      'GET',
      `/v1/billing/subscriptions/${encodeURIComponent(subId)}`,
    );
  }

  async suspendSubscription(subId: string, reason: string): Promise<void> {
    await this.request(
      'POST',
      `/v1/billing/subscriptions/${encodeURIComponent(subId)}/suspend`,
      { reason },
    );
  }

  async activateSubscription(subId: string, reason: string): Promise<void> {
    await this.request(
      'POST',
      `/v1/billing/subscriptions/${encodeURIComponent(subId)}/activate`,
      { reason },
    );
  }

  // Always immediate at PayPal — "cancel at period end" is OUR construct (the
  // mirror's cancelAtPeriodEnd + UserLevel.expiresAt keep access until then).
  async cancelSubscription(subId: string, reason: string): Promise<void> {
    await this.request(
      'POST',
      `/v1/billing/subscriptions/${encodeURIComponent(subId)}/cancel`,
      { reason },
    );
  }

  // Payment history for one subscription (PayPal has no hosted receipts).
  async listTransactions(
    subId: string,
    startIso: string,
    endIso: string,
  ): Promise<PayPalTransaction[]> {
    const qs = `start_time=${encodeURIComponent(startIso)}&end_time=${encodeURIComponent(endIso)}`;
    const res = await this.request<{ transactions?: PayPalTransaction[] }>(
      'GET',
      `/v1/billing/subscriptions/${encodeURIComponent(subId)}/transactions?${qs}`,
    );
    return res.transactions ?? [];
  }

  // --- Webhook verification ---

  // POST /v1/notifications/verify-webhook-signature with the ORIGINAL raw bytes
  // spliced in as `webhook_event`. Returns false when unconfigured, on FAILURE,
  // or when PayPal itself errors (a webhook must never 500 the API).
  async verifyWebhookSignature(
    rawBody: Buffer,
    headers: HeaderBag,
  ): Promise<boolean> {
    const webhookId = await this.settings.getPayPalWebhookId();
    if (!webhookId) {
      this.logger.warn(
        'PayPal webhook received but no webhook id is configured — rejecting',
      );
      return false;
    }
    const payload =
      '{' +
      `"auth_algo":${JSON.stringify(header(headers, 'paypal-auth-algo'))},` +
      `"cert_url":${JSON.stringify(header(headers, 'paypal-cert-url'))},` +
      `"transmission_id":${JSON.stringify(header(headers, 'paypal-transmission-id'))},` +
      `"transmission_sig":${JSON.stringify(header(headers, 'paypal-transmission-sig'))},` +
      `"transmission_time":${JSON.stringify(header(headers, 'paypal-transmission-time'))},` +
      `"webhook_id":${JSON.stringify(webhookId)},` +
      `"webhook_event":${rawBody.toString('utf8')}` +
      '}';
    try {
      const { token, base } = await this.getAccessToken();
      const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
      if (!res.ok) {
        this.logger.error(
          `PayPal verify-webhook-signature HTTP ${res.status}: ${await res
            .text()
            .catch(() => '')}`,
        );
        return false;
      }
      const data = (await res.json()) as { verification_status?: string };
      return data.verification_status === 'SUCCESS';
    } catch (err) {
      this.logger.error(`PayPal webhook verification errored: ${String(err)}`);
      return false;
    }
  }
}
