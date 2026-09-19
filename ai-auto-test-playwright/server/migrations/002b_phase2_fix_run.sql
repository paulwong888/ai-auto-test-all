CREATE TABLE IF NOT EXISTS fix_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  iteration INT NOT NULL,
  suggestion_id UUID REFERENCES fix_suggestions(id) ON DELETE SET NULL,
  patches_applied JSONB NOT NULL DEFAULT '[]'::jsonb,
  verify_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  result TEXT CHECK (result IN ('passed', 'failed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, iteration)
);

CREATE INDEX IF NOT EXISTS idx_fix_iterations_run ON fix_iterations(run_id);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS preset TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS failed_node_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES runs(id) ON DELETE SET NULL;

ALTER TABLE fix_suggestions ADD COLUMN IF NOT EXISTS patches JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fix_suggestions ADD COLUMN IF NOT EXISTS iteration INT;

CREATE INDEX IF NOT EXISTS idx_runs_project_started ON runs(project_id, started_at DESC);
