Feature: Level in-house audience
  Each membership level captures granted members into an in-house Audience (and
  tags them within it). When no audience is chosen the level falls back to the
  default "Members" audience, so granting ALWAYS lands the member in-house. The
  audience id + tags round-trip through the admin API. Level writes are admin-only.

  Scenario: An admin can create a level with in-house audience tags
    When I POST "/levels" with an admin token and body:
      """
      { "name": "BDD Audience Level", "type": "FREE", "audienceTags": ["bdd", "vip"] }
      """
    Then the response status should be 201
    And the response field "audienceTags" should match "bdd,vip"
    And the response field "memberCount" should be 0

  Scenario: Anonymous visitors cannot create levels
    When I POST "/levels" without a token and body:
      """
      { "name": "Hacker Level", "type": "FREE" }
      """
    Then the response status should be 403
