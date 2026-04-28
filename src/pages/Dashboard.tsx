import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, FileText, Trash2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/lib/i18n";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Job = {
  id: string;
  filename: string;
  status: string;
  progress: number;
  service_count: number | null;
  page_count: number | null;
  zip_path: string | null;
  created_at: string;
};

const Dashboard = () => {
  const { t } = useT();
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id,filename,status,progress,service_count,page_count,zip_path,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setJobs((data as Job[]) ?? []);
    };
    load();
    const ch = supabase
      .channel("jobs-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const downloadZip = async (path: string, filename: string) => {
    const { data, error } = await supabase.storage.from("outputs").download(path);
    if (error || !data) {
      toast.error(error?.message ?? "Download failed");
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/\.pdf$/i, "") + "-services.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (job: Job) => {
    if (!confirm(t("deleteConfirm"))) return;
    await supabase.from("jobs").delete().eq("id", job.id);
    setJobs((j) => j.filter((x) => x.id !== job.id));
  };

  const statusBadge = (s: string) => {
    if (s === "completed") return <Badge className="bg-success text-success-foreground hover:bg-success">{t("completed")}</Badge>;
    if (s === "failed") return <Badge variant="destructive">{t("failed")}</Badge>;
    return <Badge variant="secondary">{t("processing")}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1 container max-w-5xl py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-4xl text-foreground">{t("dashboard")}</h1>
            <p className="text-muted-foreground mt-1">{t("history")}</p>
          </div>
          <Link to="/upload">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
              <Plus className="w-4 h-4" />
              {t("upload")}
            </Button>
          </Link>
        </div>

        {jobs.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground border-dashed">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            {t("noJobs")}
          </Card>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <Card key={job.id} className="p-4 flex items-center gap-4 shadow-paper hover:shadow-elegant transition-shadow">
                <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">{job.filename}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                    <span>{new Date(job.created_at).toLocaleString()}</span>
                    {job.page_count != null && <span>· {job.page_count} {t("pages")}</span>}
                    {job.service_count != null && (
                      <span>· {job.service_count} {job.service_count === 1 ? t("service") : t("services")}</span>
                    )}
                  </div>
                </div>
                {statusBadge(job.status)}
                <div className="flex items-center gap-1">
                  {job.status === "completed" && job.zip_path && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadZip(job.zip_path!, job.filename)}>
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">ZIP</span>
                    </Button>
                  )}
                  <Link to={`/jobs/${job.id}`}>
                    <Button size="sm" variant="ghost">
                      {t("viewJob")}
                    </Button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(job)}
                    className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    aria-label={t("delete")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;