import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import { SettingsService } from '../settings/settings.service';

// Thin wrapper around the Stripe SDK that lazily resolves the secret key from
// the (encrypted) Setting table, falling back to env. The client is rebuilt if
// the key changes so admin key rotation takes effect without a restart.
@Injectable()
export class StripeService {
  private cachedKey: string | null = null;
  private client: Stripe | null = null;

  constructor(private readonly settings: SettingsService) {}

  async getClient(): Promise<Stripe> {
    const key = await this.settings.getStripeSecretKey();
    if (!key) {
      throw new InternalServerErrorException('Stripe secret key not configured');
    }
    if (!this.client || this.cachedKey !== key) {
      this.client = new Stripe(key, { apiVersion: '2024-06-20' });
      this.cachedKey = key;
    }
    return this.client;
  }

  async getWebhookSecret(): Promise<string | null> {
    return this.settings.getStripeWebhookSecret();
  }

  // --- Product / Price provisioning for PAID levels ---

  async createProduct(name: string): Promise<Stripe.Product> {
    const stripe = await this.getClient();
    return stripe.products.create({ name });
  }

  async createPrice(input: {
    productId: string;
    interval: 'month' | 'year';
    amount: number; // minor units
    currency: string;
  }): Promise<Stripe.Price> {
    const stripe = await this.getClient();
    return stripe.prices.create({
      product: input.productId,
      unit_amount: input.amount,
      currency: input.currency,
      recurring: { interval: input.interval },
    });
  }

  // --- Customer / Checkout / Portal ---

  async ensureCustomer(input: {
    existingCustomerId?: string | null;
    email: string;
    userId: string;
  }): Promise<string> {
    const stripe = await this.getClient();
    if (input.existingCustomerId) return input.existingCustomerId;
    const customer = await stripe.customers.create({
      email: input.email,
      metadata: { userId: input.userId },
    });
    return customer.id;
  }

  async createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = await this.getClient();
    return stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<Stripe.BillingPortal.Session> {
    const stripe = await this.getClient();
    return stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
  }

  async retrieveSubscription(subId: string): Promise<Stripe.Subscription> {
    const stripe = await this.getClient();
    return stripe.subscriptions.retrieve(subId);
  }

  // Verify & construct a webhook event from the raw request body + signature.
  async constructEvent(
    rawBody: Buffer,
    signature: string,
    webhookSecret: string,
  ): Promise<Stripe.Event> {
    const stripe = await this.getClient();
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}
