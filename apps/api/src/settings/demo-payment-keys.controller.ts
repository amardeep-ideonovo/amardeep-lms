import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ServiceTokenGuard } from "../auth/guards/service-token.guard";
import { SettingsService } from "./settings.service";
import { PushDemoPaymentKeysDto } from "./dto/demo-payment-keys.dto";

// Control-plane -> instance channel for the operator's DEMO payment keys, on
// the same per-instance service token as /instance-admin/reset-password and
// /support/* — no user JWT, and no admin-facing route: an instance admin can
// never write these, only the operator can.
//
// WHY A PUSH AND NOT ENV OR THE SEED:
//  * env — the instance compose interpolates the control plane's whole
//    process env, so one shared var would reach EVERY instance including
//    paying clients; env values are also readable via `docker inspect`, and an
//    InstanceRef carries no demo flag, so every upgrade/restart would drop it.
//  * the seed — Setting rows survive SEED_WIPE and purgeDemoDebris by design,
//    and the demo block runs only on an instance's FIRST boot. A key seeded
//    that way is both unreachable for already-live instances and effectively
//    unrevocable: an instance later sold to a real client would keep our test
//    key and take real checkouts that collect nothing.
// A push works on a running instance, survives restarts (it lands in the DB,
// encrypted under the instance's own SETTINGS_ENC_KEY), and DELETE is a real
// kill switch.
@UseGuards(ServiceTokenGuard)
@Controller("instance-admin/demo-payment-keys")
export class DemoPaymentKeysController {
  private readonly logger = new Logger(DemoPaymentKeysController.name);

  constructor(private readonly settings: SettingsService) {}

  @Post()
  @HttpCode(200)
  async push(@Body() dto: PushDemoPaymentKeysDto): Promise<{
    armed: boolean;
    active: boolean;
    tenantTag: string;
    hasWebhookSecret: boolean;
  }> {
    // TEST MODE IS A HARD GATE, not a convention. This channel exists to hand
    // an instance credentials it does not own; if a live key ever reached it,
    // a demo prospect's "fake" checkout would move real money on the
    // operator's account. Stripe key prefixes are unambiguous, so check them.
    if (!dto.secretKey.startsWith("sk_test_")) {
      throw new BadRequestException(
        "Demo payment keys must be Stripe TEST keys (sk_test_…)",
      );
    }
    if (!dto.publishableKey.startsWith("pk_test_")) {
      throw new BadRequestException(
        "Demo payment keys must be Stripe TEST keys (pk_test_…)",
      );
    }
    if (dto.webhookSecret && !dto.webhookSecret.startsWith("whsec_")) {
      throw new BadRequestException(
        "Webhook signing secret must start with whsec_",
      );
    }

    // Arming (or re-arming with a rotated pair) changes which Stripe account
    // this academy bills on, so any product/price ids minted on the previous one
    // have to go — they do not exist in the new account.
    await this.settings.withStripeCredentialChange(() =>
      this.settings.setDemoStripe({
        secretKey: dto.secretKey,
        publishableKey: dto.publishableKey,
        webhookSecret: dto.webhookSecret,
        tenantTag: dto.tenantTag,
      }),
    );

    // Dormant, not active, when the client already added their own key — their
    // credentials always win (see getEffectiveStripeKeys). Report both so the
    // control plane can show which instances are actually demoing on our
    // account rather than merely holding the keys.
    const active = await this.settings.isDemoStripeActive();
    this.logger.log(
      `demo payment keys stored (tenant=${dto.tenantTag}, active=${active}, ` +
        `webhookSecret=${dto.webhookSecret ? "yes" : "no"})`,
    );
    return {
      armed: true,
      active,
      tenantTag: dto.tenantTag,
      hasWebhookSecret: !!dto.webhookSecret,
    };
  }

  @Delete()
  @HttpCode(200)
  async revoke(): Promise<{ armed: false }> {
    await this.settings.withStripeCredentialChange(() =>
      this.settings.clearDemoStripe(),
    );
    this.logger.log("demo payment keys revoked");
    return { armed: false };
  }
}
