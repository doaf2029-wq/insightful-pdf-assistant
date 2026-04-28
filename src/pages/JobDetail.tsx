import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/lib/i18n";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { JobProgress } from "@/components/JobProgress";
import { notify } from "@/lib/notifications";

type Job = {
  id: string;
  filename: string;
  status: string;
  progress: number;
  status_message: string | null;
  error_message: string | null;
  page_count: number | null;
  service_count: number | null;
  zip_path: string | null;
  language: string;
  prompt: string | null;
};
type ServiceOutput = { id: string; title: string; title_ar: string | null; docx_path: string; order_index: number };

const JobDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, lang } = useT();
  const [job, setJob] = useState<Job | null>(null);
  const [outputs, setOutputs] = useState<ServiceOutput[]>([]);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!id || !user) return;
    let active = true;

    const loadJob = async () => {
      const { data } = await supabase.from("jobs").select("*").eq("id", id).single();
      if (active) setJob(data as Job);
      if (data && (data.status === "completed" || data.status === "failed")) {
        if (!notifiedRef.current) {
          notifiedRef.current = true;
          if (data.status === "completed")
            notify(t("completed"), data.filename);
          else notify(t("failed"), data.error_message ?? data.filename);
        }
      }
    };
    const loadOutputs = async () => {
      const { data } = await supabase
        .from("service_outputs")
        .select("id,title,title_ar,docx_path,order_index")
        .eq("job_id", id)
        .order("order_index", { ascending: true });
      if (active) setOutputs((data as ServiceOutput[]) ?? []);
    };

    loadJob();
    loadOutputs();

    const ch = supabase
      .channel(`job-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${id}` }, () => loadJob())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "service_outputs", filter: `job_id=eq.${id}` }, () => loadOutputs())
      .subscribe();

    // Polling fallback in case realtime is delayed/blocked (iframe, network, etc.)
    const poll = setInterval(() => {
      loadJob();
      loadOutputs();
    }, 3000);

    return () => {
      active = false;
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [id, user, t]);

  const download = async (path: string, filename: string) => {
    const { data, error } = await supabase.storage.from("outputs").download(path);
    if (error || !data) {
      toast.error(error?.message ?? "Download failed");
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!job) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <AppHeader />
        <main className="flex-1 container max-w-3xl py-10">
          <div className="text-muted-foreground">Loading…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1 container max-w-3xl py-10 space-y-6">
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("backToDashboard")}
        </Link>

        <div>
          <h1 className="font-display text-3xl text-foreground break-words">{job.filename}</h1>
          {job.prompt && (
            <p className={`text-sm text-muted-foreground mt-2 italic ${lang === "ar" ? "font-arabic" : ""}`}>
              "{job.prompt}"
            </p>
          )}
        </div>

        <JobProgress job={job} />

        {job.status === "completed" && job.zip_path && (
          <Button
            size="lg"
            className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 w-full"
            onClick={() => download(job.zip_path!, job.filename.replace(/\.pdf$/i, "") + "-services.zip")}
          >
            <Download className="w-4 h-4" />
            {t("download")}
          </Button>
        )}

        {outputs.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display text-xl text-foreground">{t("extractedServices")}</h2>
            {outputs.map((o) => (
              <Card key={o.id} className="p-4 flex items-center gap-4 shadow-paper">
                <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">{o.title}</div>
                  {o.title_ar && (
                    <div className="text-xs text-muted-foreground font-arabic truncate" dir="rtl">
                      {o.title_ar}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => download(o.docx_path, `${o.title.replace(/[^\w\s-]/g, "").trim().slice(0, 80) || "service"}.docx`)}
                >
                  <Download className="w-3.5 h-3.5" />
                  {t("downloadOne")}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default JobDetail;