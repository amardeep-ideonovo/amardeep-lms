import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LmsService } from './lms.service';
import { LmsController } from './lms.controller';
import { AccessService } from './access.service';
import { CertificatesModule } from '../certificates/certificates.module';
import { jwtSecret } from '../common/env.util';

@Module({
  imports: [
    CertificatesModule, // lesson views surface certificate state
    // JwtService (same secret as auth) to mint short-lived note-download tokens.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecret(config.get<string>('JWT_SECRET')),
      }),
    }),
  ],
  providers: [LmsService, AccessService],
  controllers: [LmsController],
  exports: [AccessService],
})
export class LmsModule {}
