import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ContactsAdminService } from './contacts-admin.service';
import {
  CreateAudienceDto,
  CreateContactDto,
  CreateSegmentDto,
  ListContactsQueryDto,
  UpdateAudienceDto,
  UpdateContactDto,
  UpdateSegmentDto,
  UpsertAudienceFieldDto,
} from './dto/contacts.dto';

// Admin CRUD for the in-house list system (Audiences / Fields / Contacts /
// Segments). All routes sit under /admin/* behind the `contacts` permission —
// same guard/decorator pattern as FormsController.
@Controller()
export class ContactsController {
  constructor(private readonly contacts: ContactsAdminService) {}

  // ----- Audiences -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'read')
  @Get('admin/audiences')
  listAudiences() {
    return this.contacts.listAudiences();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'create')
  @Post('admin/audiences')
  createAudience(@Body() dto: CreateAudienceDto) {
    return this.contacts.createAudience(dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'read')
  @Get('admin/audiences/:id')
  getAudience(@Param('id') id: string) {
    return this.contacts.getAudience(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'edit')
  @Patch('admin/audiences/:id')
  updateAudience(@Param('id') id: string, @Body() dto: UpdateAudienceDto) {
    return this.contacts.updateAudience(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'delete')
  @Delete('admin/audiences/:id')
  deleteAudience(@Param('id') id: string) {
    return this.contacts.deleteAudience(id);
  }

  // ----- Audience fields (merge tags) -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'read')
  @Get('admin/audiences/:id/fields')
  listFields(@Param('id') id: string) {
    return this.contacts.listFields(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'edit')
  @Post('admin/audiences/:id/fields')
  upsertField(@Param('id') id: string, @Body() dto: UpsertAudienceFieldDto) {
    return this.contacts.upsertField(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'edit')
  @Delete('admin/audiences/:id/fields/:tag')
  deleteField(@Param('id') id: string, @Param('tag') tag: string) {
    return this.contacts.deleteField(id, tag);
  }

  // ----- Contacts -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'read')
  @Get('admin/audiences/:id/contacts')
  listContacts(
    @Param('id') id: string,
    @Query() query: ListContactsQueryDto,
  ) {
    return this.contacts.listContacts(id, {
      status: query.status,
      tag: query.tag,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'create')
  @Post('admin/audiences/:id/contacts')
  createContact(@Param('id') id: string, @Body() dto: CreateContactDto) {
    return this.contacts.createContact(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'edit')
  @Patch('admin/contacts/:id')
  updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.updateContact(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'delete')
  @Delete('admin/contacts/:id')
  deleteContact(@Param('id') id: string) {
    return this.contacts.deleteContact(id);
  }

  // ----- Segments -----

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'read')
  @Get('admin/audiences/:id/segments')
  listSegments(@Param('id') id: string) {
    return this.contacts.listSegments(id);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'create')
  @Post('admin/audiences/:id/segments')
  createSegment(@Param('id') id: string, @Body() dto: CreateSegmentDto) {
    return this.contacts.createSegment(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'edit')
  @Patch('admin/segments/:id')
  updateSegment(@Param('id') id: string, @Body() dto: UpdateSegmentDto) {
    return this.contacts.updateSegment(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('contacts', 'delete')
  @Delete('admin/segments/:id')
  deleteSegment(@Param('id') id: string) {
    return this.contacts.deleteSegment(id);
  }
}
