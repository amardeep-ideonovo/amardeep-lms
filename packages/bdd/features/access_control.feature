Feature: Course access control
  A course unlocks only when the member holds an active level the course is
  assigned to. Open courses (no level) are available to any logged-in member.

  Scenario: An open course is accessible to any member
    Given I am logged in as the member
    When I GET "/courses/seed-course-open/lessons"
    Then the response status should be 200

  Scenario: A member without the Pro level cannot reach the Pro course
    Given the admin has revoked the "seed-level-pro" level from the member
    And I am logged in as the member
    When I GET "/dashboard"
    Then the course "Locked Pro Course" should be locked
    When I GET "/courses/seed-course-pro/lessons"
    Then the response status should be 403
    When I GET "/lessons/seed-lesson-pro-1"
    Then the response status should be 403

  Scenario: Granting the Pro level unlocks the Pro course
    Given the admin has granted the "seed-level-pro" level to the member
    And I am logged in as the member
    When I GET "/dashboard"
    Then the course "Locked Pro Course" should be unlocked
    When I GET "/courses/seed-course-pro/lessons"
    Then the response status should be 200

  Scenario: A member cannot create membership levels
    Given I am logged in as the member
    When I POST "/levels" with body:
      """
      { "name": "Sneaky", "type": "FREE" }
      """
    Then the response status should be 403
