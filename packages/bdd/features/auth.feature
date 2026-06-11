Feature: Authentication
  Members and admins authenticate before accessing protected resources.

  @smoke
  Scenario: Member signs in with valid credentials
    When I log in as "member@example.com" with password "member123"
    Then the response status should be 200
    And the response should include a token

  Scenario: Login is rejected with a wrong password
    When I log in as "member@example.com" with password "wrong-password"
    Then the response status should be 401

  @smoke
  Scenario: The dashboard requires authentication
    When I GET "/dashboard" without a token
    Then the response status should be 401

  Scenario: Anyone can sign up for a new account
    When I sign up with a fresh unique email
    Then the response status should be 200
    And the response should include a token

  Scenario: Signup is rejected when the email is already in use
    When I POST "/auth/signup" without a token and body:
      """
      { "email": "member@example.com", "password": "strongpass123", "firstName": "Dup", "lastName": "User" }
      """
    Then the response status should be 409

  Scenario: Signup rejects passwords shorter than 10 characters
    When I POST "/auth/signup" without a token and body:
      """
      { "email": "weak-signup@example.com", "password": "short", "firstName": "Weak", "lastName": "Pass" }
      """
    Then the response status should be 400
