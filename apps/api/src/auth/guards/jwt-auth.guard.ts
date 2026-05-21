import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Member (and admin) authentication: a valid JWT is required.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
