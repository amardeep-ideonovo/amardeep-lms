Feature: Member profile fields
  Members carry admin-editable profile fields (first name, last name, phone)
  on top of their username + email. Editing is restricted to admins via the
  Members tab; the update returns the refreshed member row.

  Scenario: An admin can update a member's profile
    When I update the member's profile via admin with body:
      """
      { "firstName": "Jane", "lastName": "Doe", "phone": "+1 555 9999" }
      """
    Then the response status should be 200
    And the response field "firstName" should be "Jane"
    And the response field "lastName" should be "Doe"
    And the response field "phone" should be "+1 555 9999"

  Scenario: A blank field clears it
    When I update the member's profile via admin with body:
      """
      { "phone": "" }
      """
    Then the response status should be 200
    And the response field "phone" should be ""

  Scenario: Anonymous visitors cannot update a member
    When I try to update the member's profile without a token with body:
      """
      { "firstName": "Hacker" }
      """
    Then the response status should be 403
