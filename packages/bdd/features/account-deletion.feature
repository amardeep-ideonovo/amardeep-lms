@account-deletion
Feature: Member account deletion
  Members can permanently delete their own account (a hard purge required by
  both app stores), and admins can delete a member for support / erasure
  requests. Deletion cancels subscriptions first, cascades the member's
  owned rows, but tombstones their email Contact (kept UNSUBSCRIBED) so a
  re-import can't re-mail them. Every scenario uses a throwaway member, never
  the seed fixture; the @account-deletion hook purges anything left alive.

  # NOTE: cancellation of a member's pending ScheduledEmail rows on deletion is
  # covered by the unit spec (apps/api/src/account/account-deletion.service.spec.ts)
  # — those rows have no read-back API, so they can't be asserted black-box here.

  Scenario: A member permanently deletes their own account
    Given a member has signed up for deletion testing
    And that member has been granted the "seed-level-pro" level
    And that member has completed the "seed-lesson-pro-1" lesson
    And that member has claimed a certificate for the "seed-level-pro" level
    When that member deletes their account with their password
    Then the response status should be 200
    And that member's session should be rejected
    And that member should no longer be able to log in
    And an admin should not find that member
    And that member's certificate serial should no longer verify
    And that member's contact should be tombstoned as unsubscribed
    And that member's email should be free to register again

  Scenario: A wrong password leaves the account untouched
    Given a member has signed up for deletion testing
    When that member deletes their account with the wrong password
    Then the response status should be 400
    And that member should still be able to log in

  Scenario: The deletion summary reports what the member will lose
    Given a member has signed up for deletion testing
    And that member has been granted the "seed-level-pro" level
    And that member has completed the "seed-lesson-pro-1" lesson
    And that member has claimed a certificate for the "seed-level-pro" level
    When that member requests their account-deletion summary
    Then the response status should be 200
    And the deletion summary email should be that member's email
    And the deletion summary should report at least 1 completed lesson
    And the deletion summary should list at least 1 certificate

  Scenario: An admin can delete a member
    Given a member has signed up for deletion testing
    When an admin deletes that member
    Then the response status should be 200
    And that member should no longer be able to log in
    And an admin should not find that member

  Scenario: An admin without the delete permission is refused
    Given a member has signed up for deletion testing
    And a restricted admin without members-delete permission exists
    When the restricted admin tries to delete that member
    Then the response status should be 403
    And that member should still be able to log in
