// Native renderer for the Puck "Form" block (admin-authored, audience-linked).
// Mirrors the web <FormEmbed>: fetches the public definition by id, renders the
// configured fields, validates required ones client-side, submits to the public
// endpoint, then shows the success message / opens the redirect URL. Renders
// nothing if the form is missing or inactive (web parity).
import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { FormFieldDef, FormPublicDTO } from "@lms/types";

import { api, ApiError } from "../api";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { Press } from "./Press";
import {
  openHref,
  useInteraction,
  useScopedStyles,
  useScopedTheme,
} from "./PageScope";

type Values = Record<string, string | boolean>;

export function FormEmbed({ formId }: { formId: string }) {
  const styles = useScopedStyles(makeStyles);
  const onInteract = useInteraction();
  const [def, setDef] = useState<FormPublicDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const f = await api.publicForm(formId);
        if (!alive) return;
        setDef(f);
        const init: Values = {};
        for (const fld of f.fields) {
          init[fld.name] = fld.type === "checkbox" ? false : "";
        }
        setValues(init);
      } catch {
        // 404 (inactive/deleted) or network failure — embed renders nothing.
        if (alive) setMissing(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [formId]);

  const setVal = (name: string, v: string | boolean) =>
    setValues((s) => ({ ...s, [name]: v }));

  async function onSubmit() {
    if (!def || submitting) return;
    // Popup engagement: a submit press counts as a click (web records any
    // button press inside the popup body, valid or not).
    onInteract?.();
    for (const f of def.fields) {
      const v = values[f.name];
      const empty =
        v === undefined || v === "" || (f.type === "checkbox" && v !== true);
      if (f.required && empty) {
        setSubmitError(`"${f.label}" is required`);
        return;
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.submitForm(def.id, values);
      // Web redirects the whole page; natively we open the URL but still show
      // the success state so a returning user can't double-submit.
      if (res.redirectUrl) openHref(res.redirectUrl);
      setDone(res.message || "Thanks! You're subscribed.");
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Text style={styles.note}>Loading…</Text>;
  if (missing || !def) return null;
  if (done) {
    return (
      <View style={styles.success}>
        <Text style={styles.successText}>{done}</Text>
      </View>
    );
  }

  return (
    <View style={styles.form}>
      {def.fields.map((f) => (
        <View key={f.id} style={styles.field}>
          {f.type !== "checkbox" ? (
            <Text style={styles.label}>
              {f.label}
              {f.required ? " *" : ""}
            </Text>
          ) : null}
          <FieldInput field={f} value={values[f.name]} onChange={setVal} />
        </View>
      ))}
      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
      <Press
        style={[styles.submit, submitting && styles.submitDisabled]}
        onPress={onSubmit}
        disabled={submitting}
      >
        <Text style={styles.submitText}>
          {submitting ? "Submitting…" : "Submit"}
        </Text>
      </Press>
    </View>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
}: {
  field: FormFieldDef;
  value: string | boolean | undefined;
  onChange: (name: string, v: string | boolean) => void;
}) {
  const styles = useScopedStyles(makeStyles);
  const { colors } = useScopedTheme();
  const [open, setOpen] = useState(false);

  if (f.type === "checkbox") {
    const checked = value === true;
    return (
      <TouchableOpacity
        style={styles.checkboxRow}
        activeOpacity={0.7}
        onPress={() => onChange(f.name, !checked)}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={styles.checkboxLabel}>
          {f.label}
          {f.required ? " *" : ""}
        </Text>
      </TouchableOpacity>
    );
  }

  if (f.type === "select") {
    // No native <select>; an input-shaped row toggles the options inline.
    const current = String(value ?? "");
    return (
      <View>
        <TouchableOpacity
          style={[styles.input, styles.selectRow]}
          activeOpacity={0.7}
          onPress={() => setOpen((o) => !o)}
        >
          <Text style={current ? styles.selectValue : styles.selectPlaceholder}>
            {current || f.placeholder || "Select…"}
          </Text>
          <Text style={styles.selectCaret}>{open ? "▴" : "▾"}</Text>
        </TouchableOpacity>
        {open ? (
          <View style={styles.options}>
            {(f.options ?? []).map((o) => (
              <TouchableOpacity
                key={o}
                style={styles.option}
                activeOpacity={0.7}
                onPress={() => {
                  onChange(f.name, o);
                  setOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.optionText,
                    o === current && styles.optionTextActive,
                  ]}
                >
                  {o}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  const multiline = f.type === "textarea";
  return (
    <TextInput
      style={[styles.input, multiline && styles.textarea]}
      value={String(value ?? "")}
      placeholder={f.placeholder}
      placeholderTextColor={colors.textMuted}
      multiline={multiline}
      keyboardType={
        f.type === "email"
          ? "email-address"
          : f.type === "phone"
          ? "phone-pad"
          : f.type === "number"
          ? "numeric"
          : "default"
      }
      autoCapitalize={f.type === "email" ? "none" : "sentences"}
      autoCorrect={f.type !== "email"}
      onChangeText={(t) => onChange(f.name, t)}
    />
  );
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  form: { gap: spacing.md },
  field: { gap: 6 },
  note: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
  label: { color: colors.text, fontSize: 14, fontWeight: "600", fontFamily: fonts.semibold },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.regular,
  },
  textarea: { minHeight: 90, textAlignVertical: "top" },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectValue: { color: colors.text, fontSize: 15, fontFamily: fonts.regular },
  selectPlaceholder: { color: colors.textMuted, fontSize: 15, fontFamily: fonts.regular },
  selectCaret: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular },
  options: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  option: { paddingHorizontal: 12, paddingVertical: 10 },
  optionText: { color: colors.text, fontSize: 15, fontFamily: fonts.regular },
  optionTextActive: { color: colors.primary, fontWeight: "700", fontFamily: fonts.bold },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: fonts.bold,
    lineHeight: 16,
  },
  checkboxLabel: { color: colors.text, fontSize: 14, flex: 1, fontFamily: fonts.regular },
  submit: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: "center",
    alignSelf: "flex-start",
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700", fontFamily: fonts.bold },
  error: { color: colors.danger, fontSize: 14, fontFamily: fonts.regular },
  success: {
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: "rgba(34,197,94,0.14)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.4)",
  },
  successText: { color: colors.text, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
});
