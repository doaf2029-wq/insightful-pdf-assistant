ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS worker_run_id text,
  ADD COLUMN IF NOT EXISTS manifest_conflicts jsonb,
  ADD COLUMN IF NOT EXISTS failed_chunks jsonb,
  ADD COLUMN IF NOT EXISTS label_mappings jsonb,
  ADD COLUMN IF NOT EXISTS component_count integer;

CREATE INDEX IF NOT EXISTS jobs_worker_run_id_idx ON public.jobs(worker_run_id);

ALTER TABLE public.service_outputs
  ADD COLUMN IF NOT EXISTS component_type text DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS validation_status text,
  ADD COLUMN IF NOT EXISTS missing_sections jsonb;