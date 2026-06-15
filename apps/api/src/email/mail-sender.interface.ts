// A single outbound message handed to a MailSender. The sender owns transport
// concerns (auth, TLS, the actual From header); the caller supplies content.
export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // Optional override of the sender's default From ("Name <email>").
  from?: string;
}

// Pluggable mail transport. The default implementation is SMTP via nodemailer,
// but the interface keeps EmailService provider-agnostic so a future API-based
// sender (SES, Postmark, …) can drop in without touching the queue/log logic.
export interface MailSender {
  // Deliver the message, returning the provider's message id for later
  // webhook correlation (bounce/complaint). Throws on a delivery failure —
  // EmailService is responsible for catching and recording it.
  send(msg: OutboundMail): Promise<{ providerId: string }>;
  // Whether the sender has the minimum config to attempt a send. EmailService
  // short-circuits to a FAILED log (never throws) when this is false.
  isConfigured(): Promise<boolean>;
}

// DI token for the active MailSender (so EmailService depends on the interface,
// not the concrete SMTP class).
export const MAIL_SENDER = Symbol('MAIL_SENDER');
