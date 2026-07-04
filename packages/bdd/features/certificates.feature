Feature: Class-completion certificates
  A member who completes every lesson of every course in a class can claim a
  PDF certificate. Admins manage templates (artwork + field layout); one is
  the default, classes may override. Uses the QA fixture class seed-level-pro
  (one course, one lesson) — the grant it leaves behind is cleared by the
  seed, like access_control.feature.

  Scenario: Admin creates a certificate template from uploaded artwork
    Given the admin has uploaded a test artwork image
    When I POST "/admin/certificate-templates" with an admin token and body:
      """
      { "name": "BDD Template", "artworkUrl": "__ARTWORK_URL__", "fields": [] }
      """
    Then the response status should be 201
    And the response field "name" should match "^BDD Template$"
    And the response field "artworkUrl" should match "^/media/"

  @cert-default
  Scenario: Promoting a new default demotes the previous one
    Given the admin has uploaded a test artwork image
    When I POST "/admin/certificate-templates" with an admin token and body:
      """
      { "name": "BDD Default", "artworkUrl": "__ARTWORK_URL__", "fields": [], "isDefault": true }
      """
    Then the response status should be 201
    And the response field "isDefault" should match "^true$"
    And exactly one certificate template should be the default

  Scenario: Claiming before completing the class is rejected
    Given the admin has granted the "seed-level-pro" level to the member
    And I am logged in as the member
    And the member has not completed the "seed-lesson-pro-1" lesson
    When I POST "/certificates/claim" with body:
      """
      { "levelId": "seed-level-pro" }
      """
    Then the response status should be 409

  Scenario: Completing the final lesson surfaces the certificate offer
    Given the admin has granted the "seed-level-pro" level to the member
    And I am logged in as the member
    When I POST "/lessons/seed-lesson-pro-1/complete" with body:
      """
      {}
      """
    Then the response status should be 201
    And the response should offer a certificate for "seed-level-pro"

  Scenario: A member claims a certificate and re-claims idempotently
    Given the admin has granted the "seed-level-pro" level to the member
    And I am logged in as the member
    When I POST "/lessons/seed-lesson-pro-1/complete" with body:
      """
      {}
      """
    And I POST "/certificates/claim" with body:
      """
      { "levelId": "seed-level-pro" }
      """
    Then the response status should be 201
    And the response field "serial" should match "^CERT-\d{4}-[A-Z0-9]{6}$"
    And the response field "memberName" should match "^.+$"
    When I POST "/certificates/claim" with body:
      """
      { "levelId": "seed-level-pro" }
      """
    Then the response serial should equal the previously claimed serial

  Scenario: The owner downloads the certificate PDF
    Given the admin has granted the "seed-level-pro" level to the member
    And I am logged in as the member
    When I POST "/lessons/seed-lesson-pro-1/complete" with body:
      """
      {}
      """
    And I POST "/certificates/claim" with body:
      """
      { "levelId": "seed-level-pro" }
      """
    And I download the claimed certificate
    Then the response status should be 200
    And the response body should start with "%PDF"

  Scenario: Downloading without a token is rejected
    Given the admin has granted the "seed-level-pro" level to the member
    And I am logged in as the member
    When I POST "/lessons/seed-lesson-pro-1/complete" with body:
      """
      {}
      """
    And I POST "/certificates/claim" with body:
      """
      { "levelId": "seed-level-pro" }
      """
    And I download the claimed certificate without a token
    Then the response status should be 401

  Scenario: Anyone can verify a valid serial
    Given the admin has granted the "seed-level-pro" level to the member
    And I am logged in as the member
    When I POST "/lessons/seed-lesson-pro-1/complete" with body:
      """
      {}
      """
    And I POST "/certificates/claim" with body:
      """
      { "levelId": "seed-level-pro" }
      """
    And I verify the claimed certificate serial
    Then the response status should be 200
    And the response field "valid" should match "^true$"
    And the response field "memberName" should match "^.+$"

  Scenario: Unknown serials verify as invalid
    When I GET "/certificates/verify/CERT-2026-NOSUCH" without a token
    Then the response status should be 200
    And the response field "valid" should match "^false$"
