"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import AvatarCropper from "@/components/AvatarCropper";

function initials(name: string | null, email: string): string {
  const src = (name && name.trim()) || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "A") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function ProfilePage() {
  const { me, loading, applyAdmin } = useAdminAuth();

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  // Seed the name field once the admin loads (and when switching accounts), but
  // not on every `me` change — so an avatar upload doesn't wipe an in-progress edit.
  useEffect(() => {
    if (me) setName(me.name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!me) return null; // AuthGuard handles the unauthenticated redirect

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setProfileErr(null);
    setProfileMsg(null);
    try {
      const updated = await api.updateProfile({ name: name.trim() });
      applyAdmin(updated);
      setProfileMsg("Profile updated.");
    } catch (err) {
      setProfileErr(
        err instanceof ApiError ? err.message : "Couldn't save your profile.",
      );
    } finally {
      setSavingName(false);
    }
  }

  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileErr("Please choose an image file.");
      return;
    }
    // Open the cropper; the actual upload happens once the admin frames the crop.
    setProfileErr(null);
    setProfileMsg(null);
    setCropFile(file);
  }

  async function uploadCropped(blob: Blob) {
    setUploading(true);
    setProfileErr(null);
    setProfileMsg(null);
    try {
      const cropped = new File([blob], "avatar.jpg", { type: "image/jpeg" });
      const updated = await api.uploadAvatar(cropped);
      applyAdmin(updated);
      setProfileMsg("Photo updated.");
      setCropFile(null);
    } catch (err) {
      setProfileErr(
        err instanceof ApiError ? err.message : "Couldn't upload the photo.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    if (
      !(await dialog.confirm({
        message: "Remove your profile photo?",
        danger: true,
      }))
    )
      return;
    setUploading(true);
    setProfileErr(null);
    setProfileMsg(null);
    try {
      const updated = await api.updateProfile({ removeAvatar: true });
      applyAdmin(updated);
      setProfileMsg("Photo removed.");
    } catch (err) {
      setProfileErr(
        err instanceof ApiError ? err.message : "Couldn't remove the photo.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    if (newPw.length < 10) {
      setPwErr("New password must be at least 10 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwErr("New password and confirmation don't match.");
      return;
    }
    setSavingPw(true);
    try {
      await api.changeOwnPassword(curPw, newPw);
      setPwMsg("Password changed.");
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwErr(
        err instanceof ApiError ? err.message : "Couldn't change your password.",
      );
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Your profile</h1>
        <p className="subtitle">Manage your name, photo and password.</p>
      </div>

      <div className="card">
        <h2>Profile</h2>
        {profileErr && <p className="error">{profileErr}</p>}
        {profileMsg && <p className="alert-success">{profileMsg}</p>}

        <div className="profile-avatar-row">
          <div className="profile-avatar">
            {me.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.avatarUrl} alt="" className="profile-avatar-img" />
            ) : (
              <span className="profile-avatar-initials">
                {initials(me.name, me.email)}
              </span>
            )}
          </div>
          <div className="profile-avatar-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onPickAvatar}
            />
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading
                  ? "Uploading…"
                  : me.avatarUrl
                    ? "Change photo"
                    : "Upload photo"}
              </button>
              {me.avatarUrl && (
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={uploading}
                  onClick={removeAvatar}
                >
                  Remove
                </button>
              )}
            </div>
            <p className="muted profile-hint">
              JPG, PNG, WebP or GIF, up to 8 MB.
            </p>
          </div>
        </div>

        <form onSubmit={saveName}>
          <div className="field">
            <label htmlFor="pf-name">Name</label>
            <input
              id="pf-name"
              value={name}
              placeholder="Your name"
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-email">Email</label>
            <input id="pf-email" value={me.email} disabled />
            <span className="muted profile-hint">
              Email is your login and can&apos;t be changed here.
            </span>
          </div>
          <div className="field">
            <label>Role</label>
            <div>
              <span
                className={
                  "badge " +
                  (me.role === "SUPER_ADMIN" ? "badge--info" : "badge--neutral")
                }
              >
                {me.role === "SUPER_ADMIN" ? "Super admin" : "Admin"}
              </span>
            </div>
          </div>
          <button className="btn" type="submit" disabled={savingName}>
            {savingName ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Change password</h2>
        {pwErr && <p className="error">{pwErr}</p>}
        {pwMsg && <p className="alert-success">{pwMsg}</p>}
        <form onSubmit={changePassword}>
          <div className="field">
            <label htmlFor="pf-cur">Current password</label>
            <input
              id="pf-cur"
              type="password"
              autoComplete="current-password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pf-new">New password</label>
            <input
              id="pf-new"
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pf-confirm">Confirm new password</label>
            <input
              id="pf-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={savingPw}>
            {savingPw ? "Saving…" : "Change password"}
          </button>
        </form>
      </div>

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          busy={uploading}
          error={profileErr}
          onCancel={() => {
            if (!uploading) setCropFile(null);
          }}
          onApply={uploadCropped}
        />
      )}
    </div>
  );
}
