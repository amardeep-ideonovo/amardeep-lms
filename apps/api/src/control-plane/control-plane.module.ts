import { Global, Module } from '@nestjs/common';
import { ControlPlaneNotifier } from './control-plane.notifier';

// @Global so any service (auth, admins, …) can emit a cross-plane signal by
// just injecting ControlPlaneNotifier — without importing the support module
// (which owns the ticket half of the same instance -> control-plane channel).
@Global()
@Module({
  providers: [ControlPlaneNotifier],
  exports: [ControlPlaneNotifier],
})
export class ControlPlaneModule {}
