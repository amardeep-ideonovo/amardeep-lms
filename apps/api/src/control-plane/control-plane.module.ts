import { Global, Module } from '@nestjs/common';
import { ControlPlaneNotifier } from './control-plane.notifier';
import { WhiteLabelStatusService } from './white-label-status.service';

// @Global so any service (auth, admins, …) can emit a cross-plane signal by
// just injecting ControlPlaneNotifier — without importing the support module
// (which owns the ticket half of the same instance -> control-plane channel).
// WhiteLabelStatusService rides the same channel in the pull direction.
@Global()
@Module({
  providers: [ControlPlaneNotifier, WhiteLabelStatusService],
  exports: [ControlPlaneNotifier, WhiteLabelStatusService],
})
export class ControlPlaneModule {}
