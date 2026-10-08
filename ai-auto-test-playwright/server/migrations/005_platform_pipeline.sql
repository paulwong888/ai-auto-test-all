CREATE TABLE IF NOT EXISTS platform_pipeline_runs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  temporal_workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  current_stage TEXT NOT NULL DEFAULT 'starting',
  module_name TEXT,
  run_id UUID,
  fix_iteration INT NOT NULL DEFAULT 0,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_pipeline_runs_project
  ON platform_pipeline_runs (project_id, created_at DESC);
