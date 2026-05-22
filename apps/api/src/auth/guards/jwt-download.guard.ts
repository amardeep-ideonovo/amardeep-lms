import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Auth for the lesson-note download route only: token via the Authorization
// header OR a `?token=` query param (see JwtDownloadStrategy).
@Injectable()
export class JwtDownloadGuard extends AuthGuard('jwt-download') {}
