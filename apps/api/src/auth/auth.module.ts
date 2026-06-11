import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtDownloadStrategy } from './jwt-download.strategy';
import { MediaModule } from '../media/media.module';
import { jwtSecret } from '../common/env.util';

@Module({
  imports: [
    // Defines a named throttler. The default is intentionally lenient —
    // tight per-route limits live on @Throttle decorators in
    // auth.controller.ts so non-sensitive routes are untouched.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 1000 },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecret(config.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: config.get<string>('JWT_TTL') || '7d' },
      }),
    }),
    MediaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtDownloadStrategy],
  exports: [AuthService, JwtStrategy, PassportModule, JwtModule],
})
export class AuthModule {}
