Feature: Public blog
  Published posts are readable by anyone without logging in. Draft posts and
  all write operations are restricted to admins. This is the only public,
  unauthenticated surface in the API.

  @smoke
  Scenario: Anyone can list published posts without logging in
    When I GET "/blog/posts" without a token
    Then the response status should be 200
    And the response should include a post with slug "welcome-to-the-new-member-portal"
    And the response should not include a post with slug "the-2026-roadmap"

  Scenario: Anyone can read a published post by slug without logging in
    When I GET "/blog/posts/welcome-to-the-new-member-portal" without a token
    Then the response status should be 200

  Scenario: A draft post is not reachable from the public endpoint
    When I GET "/blog/posts/the-2026-roadmap" without a token
    Then the response status should be 404

  Scenario: Anonymous visitors cannot create posts
    When I POST "/admin/blog/posts" without a token and body:
      """
      { "title": "Hacked", "status": "PUBLISHED" }
      """
    Then the response status should be 403

  Scenario: An admin can create a post
    When I POST "/admin/blog/posts" with an admin token and body:
      """
      { "title": "BDD created post", "content": "<p>hello</p>", "status": "PUBLISHED" }
      """
    Then the response status should be 201
