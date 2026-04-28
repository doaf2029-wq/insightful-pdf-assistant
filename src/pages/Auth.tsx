import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/lib/i18n";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Mail, Lock, User as UserIcon } from "lucide-react";

const schema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80).optional(),
});

type Mode = "in" | "up";

const Auth = ({ mode: initialMode }: { mode: Mode }) => {
  const { t } = useT();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) nav("/dashboard", { replace: true });
  }, [user, loading, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, displayName: mode === "up" ? displayName : undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/dashboard",
            data: { display_name: displayName },
          },
        });
        if (error) throw error;
        toast.success(t("accountCreated"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err?.message ?? t("invalidCredentials"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md p-8 shadow-elegant border-border">
          <h1 className="font-display text-3xl text-foreground mb-2">
            {mode === "in" ? t("welcome") : t("createYourAccount")}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "in" ? t("signInDesc") : t("signUpDesc")}
          </p>

          <form onSubmit={submit} className="space-y-4">
            {mode === "up" && (
              <div className="space-y-1.5">
                <Label htmlFor="dn">{t("displayName")}</Label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="pl-9" required maxLength={80} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="em">{t("email")}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" required maxLength={255} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">{t("password")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" required minLength={8} maxLength={128} />
              </div>
            </div>
            <Button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
              {busy && <Loader2 className="w-4 h-4 animate-spin me-2" />}
              {mode === "in" ? t("signIn") : t("signUp")}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground text-center mt-6">
            {mode === "in" ? t("needAccount") : t("alreadyHaveAccount")}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "in" ? "up" : "in")}
              className="text-accent font-medium hover:underline"
            >
              {mode === "in" ? t("signUp") : t("signIn")}
            </button>
          </p>
        </Card>
      </main>
    </div>
  );
};

export const SignIn = () => <Auth mode="in" />;
export const SignUp = () => <Auth mode="up" />;