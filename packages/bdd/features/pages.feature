Feature: Public CMS pages
  Published pages (built with the visual editor) are readable by anyone without
  logging in. Draft pages and all write operations are restricted to admins —
  the same public-surface rules as the blog.

  @smoke
  Scenario: Anyone can list published pages without logging in
    When I GET "/pages" without a token
    Then the response status should be 200
    And the response should include a page with slug "about"
    And the response should not include a page with slug "coming-soon"

  @smoke
  Scenario: Anyone can read a published page by slug without logging in
    When I GET "/pages/about" without a token
    Then the response status should be 200

  Scenario: A draft page is not reachable from the public endpoint
    When I GET "/pages/coming-soon" without a token
    Then the response status should be 404

  Scenario: Anonymous visitors cannot create pages
    When I POST "/admin/pages" without a token and body:
      """
      { "title": "Hacked page", "status": "PUBLISHED" }
      """
    Then the response status should be 403

  Scenario: An admin can create a page
    When I POST "/admin/pages" with an admin token and body:
      """
      { "title": "BDD created page", "status": "PUBLISHED" }
      """
    Then the response status should be 201
