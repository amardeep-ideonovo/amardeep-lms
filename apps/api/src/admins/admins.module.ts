import { Module } from "@nestjs/common";
import { AdminsController } from "./admins.controller";
import { AdminCredentialsController } from "./admin-credentials.controller";
import { AdminsService } from "./admins.service";

@Module({
  controllers: [AdminsController, AdminCredentialsController],
  providers: [AdminsService],
})
export class AdminsModule {}
