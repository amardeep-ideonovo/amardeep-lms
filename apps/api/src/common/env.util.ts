// ENV_NAME ?? 'production' mirrors health/instrument: unset = production, so
// every safety default fails CLOSED on a box where someone forgot the env.
export function isProduction(): boolean {
  return (process.env.ENV_NAME ?? 'production') === 'production';
}

/**
 * The JWT signing secret. In production a missing JWT_SECRET aborts boot —
 * shipping with the known dev fallback would let anyone mint valid tokens.
 */
export function jwtSecret(configured: string | undefined): string {
  if (configured) return configured;
  if (isProduction()) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start with the insecure dev fallback ' +
        '(set JWT_SECRET, or ENV_NAME=development for local work).',
    );
  }
  return 'dev-insecure-secret';
}
