-- UP
CREATE TABLE entries (
  id         BIGSERIAL PRIMARY KEY,
  amount     NUMERIC(20, 4) NOT NULL,
  memo       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entries_created_at_idx ON entries (created_at DESC);

-- DOWN
DROP TABLE entries;
