import { Module } from '@nestjs/common';
import { MenusService } from './menus.service';
import { MenusController } from './menus.controller';
import { PublicMenusController } from './public-menus.controller';

// PrismaService is global; the optional-auth guard resolves the JWT strategy
// (registered globally by AuthModule), so no extra imports are needed.
@Module({
  controllers: [MenusController, PublicMenusController],
  providers: [MenusService],
})
export class MenusModule {}
