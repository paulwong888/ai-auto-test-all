-- API Test Platform — Database Schema
-- PostgreSQL 16+

CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    repo_url    TEXT,
    openapi_spec TEXT,
    base_url    VARCHAR(512),
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
    test_path   VARCHAR(512),
    marker      VARCHAR(128),
    status      VARCHAR(32) NOT NULL DEFAULT 'running',
    passed      INTEGER DEFAULT 0,
    failed      INTEGER DEFAULT 0,
    skipped     INTEGER DEFAULT 0,
    total       INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    report_json TEXT,
    started_at  TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS test_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        UUID REFERENCES test_runs(id) ON DELETE CASCADE,
    test_name     VARCHAR(512) NOT NULL,
    status        VARCHAR(32) NOT NULL,
    endpoint      VARCHAR(512),
    method        VARCHAR(16),
    duration_ms   INTEGER DEFAULT 0,
    error_message TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_endpoints (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    path        VARCHAR(512) NOT NULL,
    method      VARCHAR(16) NOT NULL,
    summary     VARCHAR(512),
    tags        TEXT[],
    parameters  JSONB,
    request_body JSONB,
    responses   JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, path, method)
);

CREATE TABLE IF NOT EXISTS reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID REFERENCES test_runs(id) ON DELETE SET NULL,
    project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
    title       VARCHAR(512) NOT NULL,
    report_type VARCHAR(64) DEFAULT 'test_run',
    content     TEXT NOT NULL,
    format      VARCHAR(32) DEFAULT 'markdown',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_test_runs_project ON test_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
CREATE INDEX IF NOT EXISTS idx_test_runs_started ON test_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_project ON api_endpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type);