export const MAILCHIMP_QUEUE = 'mailchimp';

export interface MailchimpJob {
  type: 'add' | 'remove';
  email: string;
  tag: string;
}
