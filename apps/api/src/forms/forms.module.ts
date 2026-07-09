import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';

// PrismaModule and ContactsModule are global, so FormsService can inject
// PrismaService and ContactsService directly (form opt-ins write to the
// in-house Audience/Contact list). ThrottlerModule backs the per-IP rate limit
// on the unauthenticated public submit route.
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]),
  ],
  providers: [FormsService],
  controllers: [FormsController],
})
export class FormsModule {}
