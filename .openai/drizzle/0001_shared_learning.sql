CREATE TABLE IF NOT EXISTS stepping_stone_events (
    contributor_key TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    stone INTEGER NOT NULL CHECK (stone >= 1),
    choice TEXT NOT NULL CHECK (choice IN ('up', 'down')),
    outcome TEXT NOT NULL CHECK (outcome IN ('safe', 'fall')),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (contributor_key, entry_id)
);
CREATE INDEX IF NOT EXISTS stepping_stone_events_stone_choice ON stepping_stone_events (stone, choice);

CREATE TABLE IF NOT EXISTS scanner_training_examples (
    contributor_key TEXT NOT NULL,
    example_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('item', 'pet', 'mount')),
    field TEXT NOT NULL,
    region_json TEXT NOT NULL,
    aspect_ratio REAL NOT NULL,
    observed_text TEXT,
    corrected_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (contributor_key, example_id)
);
CREATE INDEX IF NOT EXISTS scanner_training_layout ON scanner_training_examples (kind, aspect_ratio, created_at);
