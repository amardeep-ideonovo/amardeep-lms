Feature: Payment provider
  The admin chooses which processor NEW checkouts use (Stripe or PayPal) and
  manages PayPal credentials alongside the Stripe ones. The public billing
  config drives the member checkout UI, the switch refuses to point at an
  unconfigured processor, and secrets stay write-only (masked reads). Existing
  subscriptions always keep billing on the provider that created them.

  @paypal-settings
  Scenario: PayPal credentials round-trip with a masked secret
    When I PUT "/admin/settings/paypal" with an admin token and body:
      """
      { "clientId": "bdd-client-id", "clientSecret": "bdd-secret-1234", "webhookId": "WH-BDD-1", "mode": "sandbox" }
      """
    Then the response status should be 200
    And the response field "clientId" should be "bdd-client-id"
    And the response field "clientSecretLast4" should be "1234"
    And the response field "webhookId" should be "WH-BDD-1"
    And the response field "mode" should be "sandbox"
    When I PUT "/admin/settings/paypal" with an admin token and body:
      """
      {}
      """
    Then the response field "clientSecretLast4" should be "1234"
    When I DELETE "/admin/settings/paypal" with an admin token
    Then the response field "clientId" should be ""
    And the response field "clientSecretLast4" should be ""
    And the response field "webhookId" should be ""

  @paypal-settings
  Scenario: The provider switch is guarded and drives the public config
    When I DELETE "/admin/settings/paypal" with an admin token
    And I PUT "/admin/settings/payment-provider" with an admin token and body:
      """
      { "provider": "paypal" }
      """
    Then the response status should be 400
    When I PUT "/admin/settings/paypal" with an admin token and body:
      """
      { "clientId": "bdd-client-id", "clientSecret": "bdd-secret-1234", "webhookId": "WH-BDD-1", "mode": "sandbox" }
      """
    And I PUT "/admin/settings/payment-provider" with an admin token and body:
      """
      { "provider": "paypal" }
      """
    Then the response status should be 200
    And the response field "provider" should be "paypal"
    When I GET "/billing/config" without a token
    Then the response field "provider" should be "paypal"
    And the response field "paypalClientId" should be "bdd-client-id"
    And the response field "paypalMode" should be "sandbox"
    When I PUT "/admin/settings/payment-provider" with an admin token and body:
      """
      { "provider": "stripe" }
      """
    Then the response status should be 200
    When I GET "/billing/config" without a token
    Then the response field "provider" should be "stripe"

  Scenario: PayPal checkout endpoints require authentication
    When I POST "/billing/paypal/prepare" without a token and body:
      """
      { "priceId": "nope" }
      """
    Then the response status should be 401
    When I POST "/billing/paypal/activate" without a token and body:
      """
      { "subscriptionId": "I-NOPE" }
      """
    Then the response status should be 401

  Scenario: Preparing an unknown price fails cleanly
    Given I am logged in as the member
    When I POST "/billing/paypal/prepare" with body:
      """
      { "priceId": "does-not-exist" }
      """
    Then the response status should be 404

  Scenario: Unverifiable PayPal webhooks are rejected
    When I POST "/billing/paypal/webhook" without a token and body:
      """
      { "event_type": "BILLING.SUBSCRIPTION.ACTIVATED", "resource": { "id": "I-FAKE" } }
      """
    Then the response status should be 400

  Scenario: PayPal settings are admin-only
    Given I am logged in as the member
    When I GET "/admin/settings/paypal"
    Then the response status should be 403
