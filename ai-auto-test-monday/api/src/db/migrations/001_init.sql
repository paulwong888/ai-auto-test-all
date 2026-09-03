-- ai-auto-test-monday initial schema
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  frontend_git_url TEXT,
  frontend_branch TEXT NOT NULL DEFAULT 'main',
  backend_git_url TEXT,
  backend_branch TEXT NOT NULL DEFAULT 'main',
  local_path_override TEXT,
  target_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  temporal_workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  current_agent TEXT,
  artifact_root TEXT NOT NULL,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS artifacts_index (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  summary_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project ON pipeline_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts_index(run_id);
