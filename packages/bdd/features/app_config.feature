@appconfig
Feature: Mobile app customization config
  The native mobile app reads its branding (title, logo, theme colors, light/dark)
  from a single global config. The config is public so the app can theme its
  logged-out screens; writing it is admin-only (RBAC `appCustomization`). An
  unconfigured install is default-merged, so the endpoint always returns a usable
  config even before an admin saves anything.

  @smoke
  Scenario: Anyone can read the app config without logging in
    When I GET "/app/config" without a token
    Then the response status should be 200
    And the response field "colorScheme" should be "system"

  Scenario: Anonymous visitors cannot update the app config
    When I PUT "/admin/app/config" without a token and body:
      """
      { "appConfig": { "title": "Hacked" } }
      """
    Then the response status should be 403

  Scenario: An admin can update and read back the app config
    When I PUT "/admin/app/config" with an admin token and body:
      """
      {
        "appConfig": {
          "title": "BDD App",
          "tagline": "Round-trip",
          "description": "Set by BDD",
          "logoUrl": null,
          "iconUrl": null,
          "splashUrl": null,
          "colorScheme": "system",
          "light": {
            "bg": "#ffffff", "surface": "#f1f5f9", "surfaceMuted": "#e2e8f0",
            "border": "#cbd5e1", "text": "#0f172a", "textMuted": "#475569",
            "primary": "#abcdef", "danger": "#ef4444"
          },
          "dark": {
            "bg": "#0f172a", "surface": "#1e293b", "surfaceMuted": "#334155",
            "border": "#334155", "text": "#f8fafc", "textMuted": "#94a3b8",
            "primary": "#6366f1", "danger": "#ef4444"
          }
        }
      }
      """
    Then the response status should be 200
    And the response field "title" should be "BDD App"
    When I GET "/app/config" without a token
    Then the response status should be 200
    And the response field "light.primary" should equal "#abcdef"
