-- Runtime migration reference. database.ts checks PRAGMA table_info before
-- adding this column, and applies this migration in a transaction on startup.
ALTER TABLE reviews ADD COLUMN name TEXT NOT NULL DEFAULT '';

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY paper_id ORDER BY created_at, rowid) AS number
  FROM reviews
)
UPDATE reviews
SET name = 'Review ' || (SELECT number FROM numbered WHERE numbered.id = reviews.id)
WHERE trim(name) = '';

CREATE INDEX IF NOT EXISTS reviews_updated ON reviews(updated_at DESC);
CREATE INDEX IF NOT EXISTS reviews_paper_updated ON reviews(paper_id, updated_at DESC);
