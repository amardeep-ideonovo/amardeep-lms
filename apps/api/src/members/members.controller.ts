import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/require-permission.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { MembersService } from "./members.service";
import { AccountDeletionService } from "../account/account-deletion.service";
import {
  AddMemberLevelDto,
  ListMembersQueryDto,
  SetMemberPasswordDto,
  UpdateMemberDto,
} from "./dto/member.dto";

@UseGuards(PermissionsGuard)
@Controller("members")
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly deletion: AccountDeletionService,
  ) {}

  // Declared BEFORE @Get(':id') — Nest matches in declaration order, so the
  // literal route would otherwise be swallowed and 404 as a member id.
  @Get("stats")
  @RequirePermission("members", "read")
  stats() {
    return this.members.stats();
  }

  @Get()
  @RequirePermission("members", "read")
  list(@Query() query: ListMembersQueryDto) {
    return this.members.list(query);
  }

  @Get(":id")
  @RequirePermission("members", "read")
  get(@Param("id") id: string) {
    return this.members.get(id);
  }

  @Patch(":id")
  @RequirePermission("members", "edit")
  update(@Param("id") id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(id, dto);
  }

  // Admin override: set a member's password without their current one.
  @Post(":id/password")
  @RequirePermission("members", "edit")
  setPassword(
    @Param("id") id: string,
    @Body() dto: SetMemberPasswordDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Ip() ip: string,
  ) {
    return this.members.setPassword(id, dto.newPassword, {
      adminId: principal.sub,
      ip,
    });
  }

  @Post(":id/levels")
  @RequirePermission("members", "edit")
  addLevel(
    @Param("id") id: string,
    @Body() dto: AddMemberLevelDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Ip() ip: string,
  ) {
    return this.members.addLevel(id, dto.levelId, {
      adminId: principal.sub,
      ip,
    });
  }

  @Delete(":id/levels/:levelId")
  @RequirePermission("members", "edit")
  removeLevel(@Param("id") id: string, @Param("levelId") levelId: string) {
    return this.members.removeLevel(id, levelId);
  }

  // Permanently delete a member and purge their data (GDPR / support). Same
  // ordered purge as member self-service — cancels subscriptions first, then
  // erases. Requires the members:delete permission (not just edit).
  @Delete(":id")
  @RequirePermission("members", "delete")
  remove(
    @Param("id") id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.deletion.deleteMember(id, {
      actor: { kind: "admin", adminId: principal.sub },
    });
  }
}
