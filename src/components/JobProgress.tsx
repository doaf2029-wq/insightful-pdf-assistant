import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";

type Job = {
  status: string;
  progress: number;
  status_message?: string | null;
  error_message?: string | null;
};

export const JobProgress = ({ job }: { job: Job }) => {
  const { t } = useT();
  const statusKey = (job.status === "uploading" ? "uploading"
    : job.status === "extracting" ? "extracting"
    : job.status === "analyzing" ? "analyzing"
    : job.status === "generating" ? "generating"
    : job.status === "completed" ? "completed"
    : job.status === "failed" ? "failed"
    : "processing") as any;

  return (
    <div className="border border-border rounded-lg bg-card p-5 shadow-paper">
      <div className="flex items-center gap-3 mb-3">
        {job.status === "completed" ? (
          <CheckCircle2 className="w-5 h-5 text-success" />
        ) : job.status === "failed" ? (
          <AlertCircle className="w-5 h-5 text-destructive" />
        ) : (
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
        )}
        <div className="flex-1">
          <div className="font-medium text-sm text-foreground">{t(statusKey)}</div>
          {job.status_message && (
            <div className="text-xs text-muted-foreground">{job.status_message}</div>
          )}
        </div>
        <div className="text-xs font-mono text-muted-foreground tabular-nums">
          {job.progress}%
        </div>
      </div>
      <Progress value={job.progress} className="h-2" />
      {job.error_message && (
        <div className="mt-3 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded p-2">
          {job.error_message}
        </div>
      )}
    </div>
  );
};