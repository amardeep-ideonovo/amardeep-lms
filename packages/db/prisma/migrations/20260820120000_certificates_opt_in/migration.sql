-- Certificates become OPT-IN per class.
--
-- Before: a class with a NULL certificateTemplateId fell back to the single
-- global default template (CertificateTemplate.isDefault = true), so once any
-- default existed EVERY class issued a certificate (effectively compulsory).
--
-- After: a class issues a certificate only when it has its OWN
-- certificateTemplateId; NULL now means "no certificate".
--
-- Backfill so nothing silently loses its certificate: pin every class that is
-- CURRENTLY relying on the default (NULL template + a default exists) to that
-- default template's id. If no default template exists the subquery is empty
-- and no rows change. Additive + reversible (rollback = set these back to NULL).
UPDATE "Level"
SET "certificateTemplateId" = d.id
FROM (
  SELECT "id" FROM "CertificateTemplate" WHERE "isDefault" = true LIMIT 1
) AS d
WHERE "Level"."certificateTemplateId" IS NULL;
