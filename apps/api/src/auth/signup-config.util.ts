// The member-signup invite-code gate is driven by ONE env var,
// SIGNUP_INVITE_CODE. Kept as a pure, dependency-free helper (not a method on
// AuthService) so that:
//   1. the enforcement (AuthService.signupMember) and the public flag
//      (GET /auth/signup-config, which drives whether the web/mobile signup
//      screens show the invite field) read the SAME source and can never
//      disagree, and
//   2. the branching logic is unit-testable without booting the whole service
//      graph (AuthService pulls in Prisma/email/contacts).
// The env is a parameter (defaulting to process.env) so tests can exercise every
// state without mutating global process.env.

// The required invite code when the closed-beta gate is ON — i.e. the env var
// is set to a non-empty value once trimmed. undefined = gate off (open signup).
export function requiredInviteCode(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.SIGNUP_INVITE_CODE?.trim() || undefined;
}

// Whether self-signup currently requires an invite code.
export function signupRequiresInvite(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return requiredInviteCode(env) !== undefined;
}
