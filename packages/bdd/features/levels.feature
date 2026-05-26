Feature: Level Mailchimp audience
  Each membership level can name a Mailchimp audience (list). When a member is
  granted the level they are subscribed to that audience (and tagged within it),
  falling back to the global Settings audience when none is chosen. The audience
  id + cached name round-trip through the admin API. Level writes are admin-only.

  Scenario: An admin can create a level with a Mailchimp audience
    When I POST "/levels" with an admin token and body:
      """
      { "name": "BDD Audience Level", "type": "FREE", "mailchimpTag": "bdd", "mailchimpAudienceId": "aud_123", "mailchimpAudienceName": "BDD List" }
      """
    Then the response status should be 201
    And the response field "mailchimpAudienceId" should be "aud_123"
    And the response field "mailchimpAudienceName" should be "BDD List"
    And the response field "memberCount" should be 0

  Scenario: Anonymous visitors cannot create levels
    When I POST "/levels" without a token and body:
      """
      { "name": "Hacker Level", "type": "FREE" }
      """
    Then the response status should be 403
