
-- profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- jobs table
CREATE TYPE public.job_status AS ENUM ('pending','uploading','extracting','analyzing','generating','completed','failed');

CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  pdf_path TEXT NOT NULL,
  prompt TEXT,
  language TEXT NOT NULL DEFAULT 'auto',
  status public.job_status NOT NULL DEFAULT 'pending',
  progress INT NOT NULL DEFAULT 0,
  status_message TEXT,
  error_message TEXT,
  page_count INT,
  service_count INT,
  zip_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own jobs" ON public.jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own jobs" ON public.jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users delete own jobs" ON public.jobs FOR DELETE USING (auth.uid() = user_id);

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;

-- service_outputs
CREATE TABLE public.service_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_ar TEXT,
  language TEXT,
  docx_path TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.service_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own outputs" ON public.service_outputs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own outputs" ON public.service_outputs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own outputs" ON public.service_outputs FOR DELETE USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads','uploads',false), ('outputs','outputs',false);

-- storage policies (folder = user_id)
CREATE POLICY "users read own uploads" ON storage.objects FOR SELECT
  USING (bucket_id='uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "users write own uploads" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id='uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "users delete own uploads" ON storage.objects FOR DELETE
  USING (bucket_id='uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users read own outputs" ON storage.objects FOR SELECT
  USING (bucket_id='outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "users delete own outputs" ON storage.objects FOR DELETE
  USING (bucket_id='outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
