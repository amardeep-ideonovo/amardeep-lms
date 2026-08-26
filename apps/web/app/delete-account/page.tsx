import Link from "next/link";

// Public, no-auth account-deletion information page. Its URL is submitted to the
// Google Play Data safety form (and the equivalent app-store fields), so it must
// explain, in plain language: how a member deletes their own account, what is
// permanently removed, what is retained (and why), and the fallback for members
// who can no longer sign in.
export default function DeleteAccountPage() {
  return (
    <div className="dark-page">
      <div className="dp-wrap">
        <div className="form-card">
          <h1>Delete your account</h1>
          <p className="sub">
            You can permanently delete your account and its data at any time.
            Deletion is immediate and can’t be undone.
          </p>

          <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>
            If you can sign in
          </h2>
          <p style={{ fontSize: 14, margin: "0 0 8px" }}>
            Go to your{" "}
            <Link href="/account" className="link">
              Account
            </Link>{" "}
            page, scroll to <strong>Delete account</strong>, and choose{" "}
            <strong>Delete my account</strong>. You’ll see exactly what will be
            removed, then confirm with your password. Any active subscription is
            canceled at the same time.
          </p>

          <h2 style={{ fontSize: 16, margin: "16px 0 6px" }}>
            What is permanently removed
          </h2>
          <ul style={{ fontSize: 14, margin: "0 0 8px", paddingLeft: 18 }}>
            <li>Your profile and login.</li>
            <li>
              Any certificates you earned — including their public verification
              links, which stop working permanently. Download any you want to
              keep before deleting.
            </li>
            <li>
              Active subscriptions, which are canceled immediately with no
              refund of the remaining paid period.
            </li>
            <li>
              Lifetime course and class purchases, which are destroyed and would
              have to be bought again.
            </li>
            <li>All of your learning progress and completed lessons.</li>
            <li>Any support conversations you had with your academy.</li>
          </ul>

          <h2 style={{ fontSize: 16, margin: "16px 0 6px" }}>
            What is retained
          </h2>
          <p style={{ fontSize: 14, margin: "0 0 8px" }}>
            For legal and accounting reasons, anonymized financial and
            compliance records are retained by our payment processor, and only
            for as long as the law requires (financial records are typically
            kept for up to seven years) — after which they are deleted. We also
            keep your email address only on a do-not-contact suppression list,
            so we don’t email you again by mistake. Neither is used to
            re-identify you or restore your account.
          </p>

          <h2 style={{ fontSize: 16, margin: "16px 0 6px" }}>
            If you can’t sign in
          </h2>
          <p style={{ fontSize: 14, margin: "0 0 8px" }}>
            You don’t need to stay locked out to delete your account:
          </p>
          <ol style={{ fontSize: 14, margin: "0 0 8px", paddingLeft: 20 }}>
            <li style={{ marginBottom: 6 }}>
              Reset your password using{" "}
              <Link href="/forgot-password" className="link">
                Forgot your password?
              </Link>
              , sign in, then open your Account page and choose “Delete my
              account.” This is the fastest way and works for almost everyone.
            </li>
            <li>
              If you still can’t get in, reply to any email you’ve received from
              us (a welcome email, receipt, or notification) and ask us to
              delete your account, or use the contact details in the site
              footer. We will verify it’s you and remove your account and data
              on your behalf — you don’t need an account to make the request.
            </li>
          </ol>

          <p className="sub" style={{ marginTop: 16 }}>
            <Link href="/login" className="link">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
