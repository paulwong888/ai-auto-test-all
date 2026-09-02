-- ai-auto-test-platform platform storage

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  target_url TEXT NOT NULL,
  audit_profile TEXT,
  auth_mode TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_jobs (
  id UUID PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  current_module_id TEXT,
  feature_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  features_path TEXT,
  modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_jobs_project_created
  ON audit_jobs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_jobs_status ON audit_jobs (status);

CREATE TABLE IF NOT EXISTS run_history (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  last_success BOOLEAN NOT NULL,
  last_run_at TIMESTAMPTZ NOT NULL,
  playwright_attempts INTEGER NOT NULL DEFAULT 0,
  failure_summary TEXT,
  last_playwright_exit_error TEXT,
  PRIMARY KEY (project_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_run_history_project ON run_history (project_id);
