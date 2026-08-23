-- Standing warning for an academy whose checkout is running on the operator's
-- shared Stripe TEST keys: it can appear to sell while collecting nothing, and
-- the only signal until now was a banner the admin had to navigate to.
ALTER TYPE "AdminNotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_KEYS_DEMO';
