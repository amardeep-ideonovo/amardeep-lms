import { Module } from "@nestjs/common";
import { ContentPackController } from "./content-pack.controller";
import { ContentPackService } from "./content-pack.service";

// Export/import of a portable "demo content pack" over the per-instance service
// token. PrismaService comes from the global PrismaModule (no import needed).
@Module({
  controllers: [ContentPackController],
  providers: [ContentPackService],
})
export class ContentPackModule {}
