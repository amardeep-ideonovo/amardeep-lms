// Redact anything that looks like a payment card number from member-authored
// text BEFORE it is persisted or shown to an admin. An admin-visible transcript
// store is the first place a PAN could land in this product (checkout keeps
// card numbers out of our systems entirely), so this is the cheapest control in
// the feature. Conservative by design: only a Luhn-valid run of 13-19 digits
// (optionally split by spaces or hyphens) is touched, so order numbers, phone
// numbers and record ids are left alone.
export function redactSensitive(input: string): string {
  return input.replace(/\d(?:[ -]?\d){12,18}/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    return `[card ending ${digits.slice(-4)}]`;
  });
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0' = 48
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
