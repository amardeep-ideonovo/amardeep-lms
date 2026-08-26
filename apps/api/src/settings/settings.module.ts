import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { SettingsController } from "./settings.controller";
import { DemoPaymentKeysController } from "./demo-payment-keys.controller";

// Global so StripeService / PayPalService can inject SettingsService.
@Global()
@Module({
  providers: [SettingsService],
  controllers: [SettingsController, DemoPaymentKeysController],
  exports: [SettingsService],
})
export class SettingsModule {}
