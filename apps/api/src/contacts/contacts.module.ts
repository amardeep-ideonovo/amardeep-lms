import { Global, Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsAdminService } from './contacts-admin.service';
import { ContactsController } from './contacts.controller';

// Global so Auth, Members, Billing, Levels, Forms & Footer can write contacts
// directly (DB-backed, synchronous — no queue needed, unlike the Mailchimp path).
// ContactsAdminService powers the admin Contacts UI via ContactsController.
@Global()
@Module({
  providers: [ContactsService, ContactsAdminService],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {}
