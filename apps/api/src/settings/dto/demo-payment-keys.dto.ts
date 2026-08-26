import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";

// Body of the control plane's demo-payment-keys push. Prefix checks live in the
// controller (they carry a human-readable message); this is shape + bounds.
export class PushDemoPaymentKeysDto {
  @IsString()
  @MaxLength(255)
  secretKey!: string;

  @IsString()
  @MaxLength(255)
  publishableKey!: string;

  // Optional: the demo checkout completes without it (the checkout page calls
  // POST /billing/sync to reconcile the grant inline). It only buys renewal /
  // cancellation / refund mirroring, which needs a webhook endpoint registered
  // for THIS instance's API URL in the shared Stripe account.
  // THREE-STATE, and the distinction is load-bearing: omitted means "leave any
  // stored signing secret alone" (the control plane's keys-only probe), explicit
  // null means "you have no webhook", a string sets it. ValidateIf lets null
  // through the string validator so the two stay distinguishable.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(255)
  webhookSecret?: string | null;

  // Identifies this instance on the shared account; stamped into the metadata
  // of every Stripe object we create there and used to filter the account-wide
  // admin reads back down to this tenant. Required — an armed instance without
  // a tag can create objects nothing can attribute, and its admin screens
  // fail closed to empty (see StripeService.tenantScope).
  //
  // Constrained to a slug so it can't be confused with another tenant's tag by
  // whitespace or case, and stays legible in the Stripe dashboard.
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message:
      "tenantTag must be a lowercase slug (a-z, 0-9, hyphen), 1-63 characters",
  })
  tenantTag!: string;
}
