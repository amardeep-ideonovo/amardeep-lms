import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { EmailModule } from '../email/email.module';
import { ContactsService } from './contacts.service';
import { ContactsAdminService } from './contacts-admin.service';
import { ContactsImportService } from './contacts-import.service';
import { ContactsController } from './contacts.controller';
import { ContactsConfirmController } from './contacts-confirm.controller';

// Global so Auth, Members, Billing, Levels, Forms & Footer can write contacts
// directly (DB-backed, synchronous — no queue needed, unlike the Mailchimp path).
// ContactsAdminService powers the admin Contacts UI via ContactsController;
// ContactsImportService runs the one-time Mailchimp → in-house migration (it
// injects the global MailchimpService for the export side).
//
// EmailModule (also @Global) is imported so ContactsService can inject
// EmailService to send the double-opt-in confirmation mail. EmailModule does NOT
// import ContactsModule, so there is no cycle (ContactsService still uses a
// forwardRef on the param purely defensively).
//
// ThrottlerModule.forRoot defines a 'default' throttler for the public
// /contacts/confirm endpoint (mirrors the lenient root in AuthModule; the tight
// per-route cap lives on @Throttle in ContactsConfirmController).
@Global()
@Module({
  imports: [
    EmailModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]),
  ],
  providers: [ContactsService, ContactsAdminService, ContactsImportService],
  controllers: [ContactsController, ContactsConfirmController],
  exports: [ContactsService],
})
export class ContactsModule {}
