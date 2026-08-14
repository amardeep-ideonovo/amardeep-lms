import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ServiceTokenGuard } from "../auth/guards/service-token.guard";
import { AdminsService } from "./admins.service";
import { ResetInstanceAdminDto } from "./dto/reset-instance-admin.dto";

// Control-plane -> instance recovery channel. Authenticated with the per-instance
// service token (the SAME guard as /support/*), NOT a user JWT. It lets an
// operator — or the client from their own portal — reset the instance admin
// password after the admin changed and forgot it. That's the only way back in:
// the admin console has no self-serve "forgot password" flow, and the previously
// displayed provisioning password is stale once the admin changed it.
//
// This deliberately does NOT emit the "credentials changed" signal the self-
// service change does: the control plane is the caller here and clears its own
// adminPasswordChangedAt flag right after we return, so re-signalling would race.
@UseGuards(ServiceTokenGuard)
@Controller("instance-admin")
export class AdminCredentialsController {
  constructor(private readonly admins: AdminsService) {}

  @Post("reset-password")
  @HttpCode(200)
  reset(@Body() dto: ResetInstanceAdminDto): Promise<{ email: string }> {
    return this.admins.setOwnerPasswordFromControlPlane(
      dto.email ?? null,
      dto.password,
    );
  }
}
