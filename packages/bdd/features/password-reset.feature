Feature: Member password reset
  A member who forgot their password requests an emailed reset link and uses
  it to choose a new password. The public endpoints never reveal whether an
  email has an account, and a reset link only works once.

  @email-capture
  Scenario: Member resets a forgotten password via the emailed link
    Given a fresh member exists with password "original-pass-123"
    When I request a password reset for that member
    Then the response status should be 200
    And a password-reset email is captured for that member
    When I reset the password using the emailed token to "brand-new-pass-456"
    Then the response status should be 200
    And logging in as that member with "original-pass-123" fails with 401
    And logging in as that member with "brand-new-pass-456" succeeds
    And reusing the same reset token returns 400

  Scenario: Forgot-password answers 200 for an unknown email
    When I POST "/auth/forgot-password" without a token and body:
      """
      { "email": "no-such-account-bdd@example.com" }
      """
    Then the response status should be 200
    And the response should include ok true
