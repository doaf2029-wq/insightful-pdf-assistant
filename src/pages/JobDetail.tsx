import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Download, FileText } from "lucide-react";
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
  component_count: number | null;
  manifest_conflicts: any | null;
  failed_chunks: any | null;
  label_mappings: any | null;
};
type ServiceOutput = {
  id: string;
  title: string;
  title_ar: string | null;
  docx_path: string;
  order_index: number;
  component_type: string | null;
  validation_status: string | null;
  missing_sections: string[] | null;
};

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
        .select("id,title,title_ar,docx_path,order_index,component_type,validation_status,missing_sections")
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

        {(job.manifest_conflicts || job.failed_chunks) && (
          <Card className="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium text-sm">
              <AlertTriangle className="w-4 h-4" />
              Review needed
            </div>
            {job.manifest_conflicts && (
              <div className="text-xs text-foreground/80">
                Discovery conflicts: <span className="font-mono">{Array.isArray(job.manifest_conflicts) ? job.manifest_conflicts.length : Object.keys(job.manifest_conflicts).length}</span> resolved by tiebreaker.
              </div>
            )}
            {job.failed_chunks && Array.isArray(job.failed_chunks) && job.failed_chunks.length > 0 && (
              <div className="text-xs text-foreground/80">
                Failed chunks (skipped after retries): <span className="font-mono">{job.failed_chunks.length}</span>
              </div>
            )}
          </Card>
        )}

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
                  <div className="font-medium text-sm text-foreground truncate flex items-center gap-2">
                    {o.title}
                    {o.component_type && o.component_type !== "service" && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {o.component_type}
                      </span>
                    )}
                    {o.validation_status === "incomplete" && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        incomplete
                      </span>
                    )}
                  </div>
                  {o.title_ar && (
                    <div className="text-xs text-muted-foreground font-arabic truncate" dir="rtl">
                      {o.title_ar}
                    </div>
                  )}
                  {o.missing_sections && o.missing_sections.length > 0 && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 truncate">
                      Missing: {o.missing_sections.join(", ")}
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