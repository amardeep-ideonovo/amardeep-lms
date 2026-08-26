import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSensitive } from "./redact";

test("redacts a Luhn-valid card number, keeping the last four", () => {
  const out = redactSensitive("my card is 4242 4242 4242 4242 ok");
  assert.equal(out, "my card is [card ending 4242] ok");
});

test("redacts a card number written without separators", () => {
  assert.equal(
    redactSensitive("charge 4242424242424242 please"),
    "charge [card ending 4242] please",
  );
});

test("leaves short numbers (order ids, phone numbers) untouched", () => {
  assert.equal(redactSensitive("order 12345"), "order 12345");
  assert.equal(redactSensitive("call 555 123 4567"), "call 555 123 4567");
});

test("leaves a digit run that fails the Luhn check untouched", () => {
  // 16 digits but not Luhn-valid — must NOT be treated as a card.
  assert.equal(
    redactSensitive("ref 1234 5678 9012 3457"),
    "ref 1234 5678 9012 3457",
  );
});
