export const MAILCHIMP_QUEUE = 'mailchimp';

// Tag add/remove on a member (the original job). `kind` discriminates the union
// below; the BullMQ job name for these is 'tag'.
export interface MailchimpTagJob {
  kind: 'tag';
  type: 'add' | 'remove';
  email: string;
  tags: string[]; // may be empty for audience-only levels
  audienceId?: string; // target list; falls back to the global Settings audience
}

// Re-key a contact's email across audiences (admin email change). `audienceIds`
// are the member's per-level audiences; the worker also covers the global
// Settings audience. BullMQ job name for these is 'email-change'.
export interface MailchimpEmailChangeJob {
  kind: 'email-change';
  oldEmail: string;
  newEmail: string;
  audienceIds: string[];
}

export type MailchimpJob = MailchimpTagJob | MailchimpEmailChangeJob;
