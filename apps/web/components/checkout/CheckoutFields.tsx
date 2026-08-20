"use client";

import type { ReactNode } from "react";
import { STR } from "@lms/types";
import CountrySelect from "./CountrySelect";

// Shared presentational building blocks for the checkout pages (level
// subscription + one-off course). The money orchestration stays in each page —
// only the identical form scaffolding lives here, so a change to the checkout
// form's look/fields updates both flows at once.

export function SectionHead({ children }: { children: ReactNode }) {
  return (
    <div className="co-section-head">
      <span>{children}</span>
      <span className="co-rule" />
    </div>
  );
}

// "Logged in as … / Already have an account?" banner at the top of the form.
export function CheckoutAuthBanner({
  email,
  onLogout,
  onShowLogin,
}: {
  email: string | null;
  onLogout: () => void;
  onShowLogin: () => void;
}) {
  return email ? (
    <div className="co-auth-banner">
      <span>
        Logged in as <strong>{email}</strong>
      </span>
      <button type="button" className="co-linkbtn" onClick={onLogout}>
        Log out
      </button>
    </div>
  ) : (
    <div className="co-auth-banner co-auth-banner--ghost">
      <span>Already have an account?</span>
      <button type="button" className="co-linkbtn" onClick={onShowLogin}>
        Already a member?
      </button>
    </div>
  );
}

// Email + (for a guest) password and its confirmation. `showPassword` is false
// once signed in. The password/confirm match-check lives in the page's
// validate(), same as the reset-password / account forms.
export function IdentityFields({
  email,
  onEmail,
  showPassword,
  password,
  onPassword,
  confirmPassword,
  onConfirmPassword,
  minPassword,
}: {
  email: string;
  onEmail: (v: string) => void;
  showPassword: boolean;
  password: string;
  onPassword: (v: string) => void;
  confirmPassword: string;
  onConfirmPassword: (v: string) => void;
  minPassword: number;
}) {
  return (
    <>
      <input
        className="co-input"
        type="email"
        placeholder={STR.labels.email}
        autoComplete="email"
        value={email}
        onChange={(e) => onEmail(e.target.value)}
        aria-label={STR.labels.email}
      />
      {showPassword && (
        <>
          <input
            className="co-input"
            type="password"
            placeholder={`Password (${minPassword}+ characters)`}
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            aria-label={STR.labels.password}
          />
          <input
            className="co-input"
            type="password"
            placeholder={STR.labels.confirmPassword}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => onConfirmPassword(e.target.value)}
            aria-label={STR.labels.confirmPassword}
          />
        </>
      )}
    </>
  );
}

// The "BILLING INFORMATION" section: first/last name + country + address.
export function BillingFields({
  firstName,
  onFirstName,
  lastName,
  onLastName,
  country,
  onCountry,
  address,
  onAddress,
}: {
  firstName: string;
  onFirstName: (v: string) => void;
  lastName: string;
  onLastName: (v: string) => void;
  country: string;
  onCountry: (v: string) => void;
  address: string;
  onAddress: (v: string) => void;
}) {
  return (
    <>
      <SectionHead>BILLING INFORMATION</SectionHead>
      <div className="co-grid2">
        <input
          className="co-input"
          placeholder={STR.labels.firstName}
          autoComplete="given-name"
          value={firstName}
          onChange={(e) => onFirstName(e.target.value)}
          aria-label={STR.labels.firstName}
        />
        <input
          className="co-input"
          placeholder={STR.labels.lastName}
          autoComplete="family-name"
          value={lastName}
          onChange={(e) => onLastName(e.target.value)}
          aria-label={STR.labels.lastName}
        />
      </div>
      <CountrySelect value={country} onChange={onCountry} />
      <input
        className="co-input"
        placeholder="Address"
        autoComplete="street-address"
        value={address}
        onChange={(e) => onAddress(e.target.value)}
        aria-label="Address"
      />
    </>
  );
}
