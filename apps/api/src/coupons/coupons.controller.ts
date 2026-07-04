import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/coupon.dto';

@UseGuards(PermissionsGuard)
@Controller('admin/coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermission('coupons', 'read')
  list() {
    return this.coupons.list();
  }

  @Post()
  @RequirePermission('coupons', 'create')
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @Post(':id/deactivate')
  @RequirePermission('coupons', 'edit')
  deactivate(@Param('id') id: string) {
    return this.coupons.setActive(id, false);
  }

  @Post(':id/activate')
  @RequirePermission('coupons', 'edit')
  activate(@Param('id') id: string) {
    return this.coupons.setActive(id, true);
  }

  @Delete(':id')
  @RequirePermission('coupons', 'delete')
  remove(@Param('id') id: string) {
    return this.coupons.delete(id);
  }
}
