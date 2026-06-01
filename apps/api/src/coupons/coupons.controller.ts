import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/coupon.dto';

@UseGuards(AdminGuard)
@Controller('admin/coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list() {
    return this.coupons.list();
  }

  @Post()
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.coupons.setActive(id, false);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.coupons.setActive(id, true);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coupons.delete(id);
  }
}
