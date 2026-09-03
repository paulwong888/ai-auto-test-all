-- M1: clone status and resolved repo paths
ALTER TABLE projects ADD COLUMN IF NOT EXISTS clone_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS clone_error TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS frontend_repo_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS backend_repo_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_cloned_at TIMESTAMPTZ;
