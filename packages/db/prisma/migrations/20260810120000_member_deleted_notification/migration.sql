-- A member erased their own account (or an admin deleted them). Additive enum
-- value only — no data change. PG14+ allows ADD VALUE outside its own txn use;
-- the value is only referenced at runtime, never within this migration.
ALTER TYPE "AdminNotificationType" ADD VALUE IF NOT EXISTS 'MEMBER_DELETED';
