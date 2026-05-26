export const MAILCHIMP_QUEUE = 'mailchimp';

export interface MailchimpJob {
  type: 'add' | 'remove';
  email: string;
  tags: string[]; // may be empty for audience-only levels
  audienceId?: string; // target list; falls back to the global Settings audience
}
