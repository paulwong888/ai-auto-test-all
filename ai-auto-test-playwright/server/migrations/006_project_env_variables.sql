CREATE TABLE IF NOT EXISTS project_env_settings (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  plain_vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
