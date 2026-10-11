-- Runtime migration reference. database.ts guards each column with
-- PRAGMA table_info and applies these additions in one transaction.
-- NULL means historical provenance is unknown; do not infer a model from settings.
ALTER TABLE quiz_attempts ADD COLUMN generation_provenance_json TEXT;
ALTER TABLE quiz_attempts ADD COLUMN grading_provenance_json TEXT;
ALTER TABLE writing_evaluations ADD COLUMN provenance_json TEXT;
