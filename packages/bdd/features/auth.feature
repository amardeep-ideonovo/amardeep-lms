Feature: Authentication
  Members and admins authenticate before accessing protected resources.

  Scenario: Member signs in with valid credentials
    When I log in as "member@example.com" with password "member123"
    Then the response status should be 200
    And the response should include a token

  Scenario: Login is rejected with a wrong password
    When I log in as "member@example.com" with password "wrong-password"
    Then the response status should be 401

  Scenario: The dashboard requires authentication
    When I GET "/dashboard" without a token
    Then the response status should be 401
