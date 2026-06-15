import { Global, Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsAdminService } from './contacts-admin.service';
import { ContactsImportService } from './contacts-import.service';
import { ContactsController } from './contacts.controller';

// Global so Auth, Members, Billing, Levels, Forms & Footer can write contacts
// directly (DB-backed, synchronous — no queue needed, unlike the Mailchimp path).
// ContactsAdminService powers the admin Contacts UI via ContactsController;
// ContactsImportService runs the one-time Mailchimp → in-house migration (it
// injects the global MailchimpService for the export side).
@Global()
@Module({
  providers: [ContactsService, ContactsAdminService, ContactsImportService],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {}
