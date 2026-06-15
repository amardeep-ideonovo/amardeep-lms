import { Global, Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';

// Global so Auth, Members, Billing, Levels, Forms & Footer can write contacts
// directly (DB-backed, synchronous — no queue needed, unlike the Mailchimp path).
@Global()
@Module({
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
