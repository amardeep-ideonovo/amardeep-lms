import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';

// PrismaModule and MailchimpModule are global, so FormsService can inject
// PrismaService and MailchimpService directly.
@Module({
  providers: [FormsService],
  controllers: [FormsController],
})
export class FormsModule {}
