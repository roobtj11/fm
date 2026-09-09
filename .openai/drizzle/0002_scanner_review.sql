ALTER TABLE scanner_training_examples ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE scanner_training_examples ADD COLUMN trust_weight INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scanner_training_examples ADD COLUMN reviewed_by TEXT;
ALTER TABLE scanner_training_examples ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS scanner_training_review_status
ON scanner_training_examples (review_status, created_at);
