import { Link, useNavigate } from "react-router-dom";
import { LogOut, Languages, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export const AppHeader = () => {
  const { user } = useAuth();
  const { lang, setLang, t } = useT();
  const nav = useNavigate();

  return (
    <header className="border-b border-border bg-card/70 backdrop-blur-sm sticky top-0 z-40">
      <div className="container flex items-center justify-between h-16">
        <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-md bg-hero flex items-center justify-center shadow-paper">
            <FileText className="w-5 h-5 text-primary-foreground" strokeWidth={1.5} />
          </div>
          <div className="leading-tight">
            <div className="font-display text-xl text-foreground">{t("appName")}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground hidden sm:block">
              {t("tagline")}
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="gap-1.5"
          >
            <Languages className="w-4 h-4" />
            {lang === "en" ? "العربية" : "English"}
          </Button>
          {user && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await supabase.auth.signOut();
                nav("/");
              }}
              className="gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{t("signOut")}</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};