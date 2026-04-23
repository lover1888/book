CREATE TABLE IF NOT EXISTS upload_jobs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  release_tag TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  asset_url TEXT NOT NULL,
  raw_target TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  uploaded_at TEXT NOT NULL,
  published_at TEXT,
  failed_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_status_uploaded_at
ON upload_jobs(status, uploaded_at);
