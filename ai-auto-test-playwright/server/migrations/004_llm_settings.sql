CREATE TABLE IF NOT EXISTS global_llm_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  provider TEXT NOT NULL DEFAULT 'dashscope',
  base_url TEXT NOT NULL,
  default_model TEXT NOT NULL,
  encrypted_api_key TEXT,
  extra_models JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_llm_overrides (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  provider TEXT,
  base_url TEXT,
  default_model TEXT,
  encrypted_api_key TEXT,
  extra_models JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
