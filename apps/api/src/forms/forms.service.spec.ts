import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvLine } from "./forms.service";

// The forms submission export is the ONE CSV producer in the app (everything
// else exports .xlsx, which is formula-safe by construction). Its cells carry
// fully attacker-controlled data — submission field values and the email — so
// csvCell must neutralize spreadsheet formula injection AND stay RFC-4180 valid.

test("plain, safe values pass through untouched", () => {
  assert.equal(csvCell("Ada Lovelace"), "Ada Lovelace");
  assert.equal(csvCell("ada@example.com"), "ada@example.com");
  // ISO timestamps and numbers start with a digit — never a formula lead.
  assert.equal(csvCell("2026-09-05T12:00:00.000Z"), "2026-09-05T12:00:00.000Z");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell("Subscribed"), "Subscribed");
});

test("null/undefined render as an empty cell", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("RFC-4180: quote and double-quote cells with comma/quote/newline", () => {
  assert.equal(csvCell("Doe, Jane"), '"Doe, Jane"');
  assert.equal(csvCell('she said "hi"'), '"she said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("cr\rhere"), '"cr\rhere"');
});

test("formula-leading cells are prefixed with a single quote (each trigger char)", () => {
  // = + - @ and the control chars TAB (0x09) and CR (0x0D).
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+1+1"), "'+1+1");
  assert.equal(csvCell("-1+1"), "'-1+1");
  assert.equal(csvCell("@SUM(A1:A9)"), "'@SUM(A1:A9)");
  // A leading TAB/CR is quoted by the RFC layer too (CR matches the quote set).
  assert.equal(csvCell("\t=danger"), "'\t=danger");
  assert.equal(csvCell("\r=danger"), '"\'\r=danger"');
});

test("real CSV-injection payloads are neutralized", () => {
  // DDE command execution. No comma/double-quote/newline, so it is prefixed
  // with ' but NOT RFC-wrapped (single quotes are not doubled — only " is).
  assert.equal(csvCell("=cmd|'/C calc'!A0"), "'=cmd|'/C calc'!A0");
  // Data exfiltration via HYPERLINK/WEBSERVICE.
  assert.equal(
    csvCell('=HYPERLINK("http://evil","click")'),
    '"\'=HYPERLINK(""http://evil"",""click"")"',
  );
  // An email that passes the submit-time regex but still starts with '='.
  assert.equal(csvCell("=x@y.com"), "'=x@y.com");
});

test("formula lead AND special chars: prefix first, then RFC-quote", () => {
  // Starts with '=', contains a comma -> prefixed then wrapped in quotes.
  assert.equal(csvCell("=1,2"), '"\'=1,2"');
});

test("a leading space is already inert in spreadsheets and is left alone", () => {
  // Excel/Sheets treat " =1+1" as text; no prefix needed, no false-positive.
  assert.equal(csvCell(" =1+1"), " =1+1");
  // Formula chars NOT at the start are harmless.
  assert.equal(csvCell("a=b"), "a=b");
  assert.equal(csvCell("3-2"), "3-2");
});

test("csvLine joins cells with commas and terminates with CRLF", () => {
  assert.equal(csvLine(["a", "b", "c"]), "a,b,c\r\n");
  // Each cell is individually escaped/neutralized.
  assert.equal(csvLine(["=evil", "ok, then", null]), '\'=evil,"ok, then",\r\n');
  // A header row of admin-authored labels flows through the same guard.
  assert.equal(
    csvLine(["Submitted at", "Email", "-Discount?"]),
    "Submitted at,Email,'-Discount?\r\n",
  );
});
