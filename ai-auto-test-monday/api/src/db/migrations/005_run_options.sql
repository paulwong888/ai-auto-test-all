-- M5: persist pipeline start options so retries/resumes honor the original choice
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS execute_after_generate BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS apply_test_ids BOOLEAN NOT NULL DEFAULT false;
