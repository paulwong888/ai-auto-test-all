-- v2 execution + platform bridge
ALTER TABLE projects ADD COLUMN IF NOT EXISTS platform_project_id TEXT;

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS execution_mode TEXT;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS execution_status TEXT;
