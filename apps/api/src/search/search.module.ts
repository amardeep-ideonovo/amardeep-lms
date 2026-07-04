import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

// PrismaService is global; CouponsModule is imported for coupon search (Stripe).
@Module({
  imports: [CouponsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
