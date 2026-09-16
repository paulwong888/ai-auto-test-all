-- Project-level E2E login credentials for Playwright direct execution
ALTER TABLE projects ADD COLUMN IF NOT EXISTS e2e_auth_json JSONB;
