CREATE TABLE IF NOT EXISTS plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  version_number INT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'user')),
  base_version_id UUID REFERENCES plan_versions(id),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, module_name, version_number)
);

CREATE INDEX IF NOT EXISTS idx_plan_versions_project ON plan_versions(project_id, module_name);
