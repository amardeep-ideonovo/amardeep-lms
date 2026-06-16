import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';

// PrismaModule and ContactsModule are global, so FormsService can inject
// PrismaService and ContactsService directly (form opt-ins write to the
// in-house Audience/Contact list — no Mailchimp).
@Module({
  providers: [FormsService],
  controllers: [FormsController],
})
export class FormsModule {}
