-- Gherkin features stored per project (row-level, supports manual edit)

CREATE TABLE IF NOT EXISTS feature_sets (
  project_id    TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  version       TEXT NOT NULL DEFAULT '1.0',
  generated_at  TIMESTAMPTZ NOT NULL,
  repo_path     TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_features (
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  source_file   TEXT NOT NULL,
  route         TEXT,
  gherkin       JSONB NOT NULL,
  gherkin_text  TEXT NOT NULL,
  manual_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  source        TEXT NOT NULL DEFAULT 'audit',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_project_features_project ON project_features (project_id);
CREATE INDEX IF NOT EXISTS idx_project_features_source ON project_features (project_id, source);

CREATE TABLE IF NOT EXISTS audit_module_partials (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id  TEXT NOT NULL,
  features   JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, module_id)
);
