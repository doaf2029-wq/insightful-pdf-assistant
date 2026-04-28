import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Sparkles, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/lib/i18n";
import { AppHeader } from "@/components/AppHeader";
import { UploadDropzone } from "@/components/UploadDropzone";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestNotificationPermission, notificationsSupported, notificationsBlocked } from "@/lib/notifications";

const UploadPage = () => {
  const { t, lang } = useT();
  const { user } = useAuth();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [outputLang, setOutputLang] = useState<"auto" | "en" | "ar" | "bilingual">("auto");
  const [busy, setBusy] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(
    typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted"
  );

  const start = async () => {
    if (!file || !user) return;
    setBusy(true);
    try {
      // 1. Upload PDF to storage
      const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("uploads").upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upErr) throw upErr;

      // 2. Create job row
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          filename: file.name,
          pdf_path: path,
          prompt: prompt || null,
          language: outputLang,
          status: "pending",
          progress: 0,
        })
        .select()
        .single();
      if (jobErr) throw jobErr;

      // 3. Trigger processing edge function (fire-and-forget)
      supabase.functions
        .invoke("process-pdf", { body: { jobId: job.id } })
        .catch((e) => console.warn("process-pdf invoke error", e));

      toast.success(t("jobStarted"));
      nav(`/jobs/${job.id}`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? t("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1 container max-w-3xl py-10 space-y-6">
        <div>
          <h1 className="font-display text-4xl text-foreground mb-2">{t("upload")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        <Card className="p-6 space-y-5 shadow-paper">
          <div>
            <Label className="mb-2 block">{t("fileLabel")}</Label>
            <UploadDropzone file={file} onFile={setFile} disabled={busy} />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <Label htmlFor="prompt">{t("promptLabel")}</Label>
              <span className="text-xs text-muted-foreground">{t("promptOptional")}</span>
            </div>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
              placeholder={t("promptPlaceholder")}
              rows={4}
              maxLength={2000}
              disabled={busy}
              className={lang === "ar" ? "font-arabic" : ""}
            />
          </div>

          <div>
            <Label className="mb-2 block">{t("languageLabel")}</Label>
            <Select value={outputLang} onValueChange={(v: any) => setOutputLang(v)} disabled={busy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("autoLang")}</SelectItem>
                <SelectItem value="bilingual">{t("bilingual")}</SelectItem>
                <SelectItem value="en">{t("english")}</SelectItem>
                <SelectItem value="ar">{t("arabic")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              onClick={start}
              disabled={!file || busy}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {t("startProcessing")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                if (!notificationsSupported()) {
                  toast.info("Your browser doesn't support notifications. We'll use in-app alerts.");
                  return;
                }
                if (notificationsBlocked()) {
                  toast.error("Notifications are blocked. Enable them in your browser settings or open this app in a new tab.");
                  return;
                }
                const ok = await requestNotificationPermission();
                setNotifyEnabled(ok);
                if (ok) toast.success(t("notificationsEnabled"));
                else toast.info("Notifications not enabled. You'll still see in-app updates.");
              }}
              disabled={notifyEnabled}
            >
              <Bell className="w-3.5 h-3.5" />
              {notifyEnabled ? t("notificationsEnabled") : t("enableNotifications")}
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
};

export default UploadPage;