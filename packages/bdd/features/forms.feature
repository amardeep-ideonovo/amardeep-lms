Feature: Audience-linked forms
  Forms are admin-managed. Anyone can fetch an ACTIVE form and submit it without
  logging in; submissions are stored locally and the submitter is always captured
  into the in-house Audience/Contact list (the form's configured audience, or the
  default "Members" audience when none is set). Creating and managing forms is admin-only.

  Scenario: Anonymous visitors cannot create forms
    When I POST "/admin/forms" without a token and body:
      """
      { "name": "Hacked form" }
      """
    Then the response status should be 403

  Scenario: An admin can create a form, and anyone can fetch and submit it
    When I create a form via admin with body:
      """
      { "name": "BDD signup", "fields": [ { "id": "f1", "type": "email", "label": "Email", "name": "email", "required": true, "mergeTag": "EMAIL" } ] }
      """
    Then the response status should be 201
    When I GET the created form without a token
    Then the response status should be 200
    When I submit the created form without a token and body:
      """
      { "values": { "email": "bdd-tester@example.com" } }
      """
    Then the response status should be 201
    And the response "subscribeStatus" should be "subscribed"

  Scenario: Submitting without a required field is rejected
    When I create a form via admin with body:
      """
      { "name": "BDD required", "fields": [ { "id": "f1", "type": "email", "label": "Email", "name": "email", "required": true, "mergeTag": "EMAIL" } ] }
      """
    When I submit the created form without a token and body:
      """
      { "values": {} }
      """
    Then the response status should be 400

  Scenario: An admin can read a form's stored submissions
    When I create a form via admin with body:
      """
      { "name": "BDD entries", "fields": [ { "id": "f1", "type": "email", "label": "Email", "name": "email", "required": true, "mergeTag": "EMAIL" } ] }
      """
    And I submit the created form without a token and body:
      """
      { "values": { "email": "entry-lead@example.com" } }
      """
    And I GET the created form submissions as admin
    Then the response status should be 200
    And the response should include a submission with email "entry-lead@example.com"
