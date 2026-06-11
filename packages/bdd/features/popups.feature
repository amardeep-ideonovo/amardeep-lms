Feature: Popups
  Admins build popups in the same visual editor as pages, then choose where they
  appear. Only ACTIVE popups are exposed by the public targeting endpoint, and
  visibility is enforced server-side per context (a member-area surface —
  dashboard, classes, courses, lessons — or a specific CMS page). All write
  operations are restricted to admins.

  Scenario: Anonymous visitors cannot create popups
    When I POST "/admin/popups" without a token and body:
      """
      { "name": "Hacked popup", "status": "ACTIVE", "showOnDashboard": true }
      """
    Then the response status should be 403

  Scenario: An admin can create a popup
    When I create a popup via admin with body:
      """
      { "name": "BDD popup" }
      """
    Then the response status should be 201

  Scenario: An active dashboard popup is visible on the public endpoint
    When I create a popup via admin with body:
      """
      { "name": "BDD dashboard popup", "status": "ACTIVE", "showOnDashboard": true }
      """
    And I GET active popups for the dashboard without a token
    Then the response status should be 200
    And the response should include the created popup

  Scenario: An inactive popup is hidden from the public endpoint
    When I create a popup via admin with body:
      """
      { "name": "BDD inactive popup", "status": "INACTIVE", "showOnDashboard": true }
      """
    And I GET active popups for the dashboard without a token
    Then the response should not include the created popup

  Scenario: A page-targeted popup shows only on the selected page
    When I create a popup via admin with body:
      """
      { "name": "BDD page popup", "status": "ACTIVE", "pageMode": "INCLUDE", "pageIds": ["seed-page-about"] }
      """
    And I GET active popups for page "seed-page-about" without a token
    Then the response should include the created popup
    When I GET active popups for the dashboard without a token
    Then the response should not include the created popup

  Scenario: A surface-targeted popup shows only in its member areas
    When I create a popup via admin with body:
      """
      { "name": "BDD surfaces popup", "status": "ACTIVE", "showOnClasses": true, "showOnLessons": true }
      """
    Then the response status should be 201
    And the response field "showOnClasses" should be "true"
    And the response field "showOnLessons" should be "true"
    When I GET active popups for context "lessons" without a token
    Then the response should include the created popup
    When I GET active popups for context "classes" without a token
    Then the response should include the created popup
    When I GET active popups for context "courses" without a token
    Then the response should not include the created popup
    When I GET active popups for the dashboard without a token
    Then the response should not include the created popup

  Scenario: Recording a view increments the popup's analytics
    When I create a popup via admin with body:
      """
      { "name": "BDD analytics popup" }
      """
    And I record a "view" event on the created popup without a token
    And I GET the created popup as admin
    Then the response status should be 200
    And the response field "views" should be 1

  Scenario: Popup behaviour settings round-trip (trigger + frequency + animation)
    When I create a popup via admin with body:
      """
      { "name": "BDD behaviour popup", "trigger": "DELAY", "triggerValue": 8, "frequency": "ONCE_PER_DAYS", "frequencyDays": 3, "closeOnOverlay": false, "animation": "SLIDE_UP" }
      """
    Then the response status should be 201
    When I GET the created popup as admin
    Then the response status should be 200
    And the response field "trigger" should be "DELAY"
    And the response field "triggerValue" should be 8
    And the response field "frequency" should be "ONCE_PER_DAYS"
    And the response field "frequencyDays" should be 3
    And the response field "closeOnOverlay" should be "false"
    And the response field "animation" should be "SLIDE_UP"

  Scenario: Behaviour validation rejects unknown trigger values
    When I create a popup via admin with body:
      """
      { "name": "BDD bad trigger", "trigger": "WHENEVER" }
      """
    Then the response status should be 400
