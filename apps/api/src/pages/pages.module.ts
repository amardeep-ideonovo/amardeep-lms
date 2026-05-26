import { Module } from '@nestjs/common';
import { PagesService } from './pages.service';
import { PagesController } from './pages.controller';

// PrismaModule is global, so PagesService can inject PrismaService directly.
@Module({
  providers: [PagesService],
  controllers: [PagesController],
})
export class PagesModule {}
