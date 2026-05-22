import { Module } from '@nestjs/common';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';

// PrismaModule is global, so BlogService can inject PrismaService directly.
@Module({
  providers: [BlogService],
  controllers: [BlogController],
})
export class BlogModule {}
