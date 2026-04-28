ALTER TABLE public.service_outputs REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='service_outputs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_outputs;
  END IF;
END $$;