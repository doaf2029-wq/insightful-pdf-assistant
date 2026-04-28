import { Link, Navigate } from "react-router-dom";
import { ArrowRight, FileText, Languages, Layers, Sparkles } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/lib/i18n";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

const Index = () => {
  const { user, loading } = useAuth();
  const { t, lang } = useT();

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="container max-w-4xl py-20 md:py-28 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary text-xs uppercase tracking-widest text-muted-foreground mb-6">
            <Sparkles className="w-3 h-3 text-accent" />
            AI · EN · العربية
          </div>
          <h1 className={`font-display text-5xl md:text-7xl text-foreground text-balance leading-tight mb-6 ${lang === "ar" ? "font-arabic" : ""}`}>
            {t("tagline")}
          </h1>
          <p className={`text-lg text-muted-foreground max-w-2xl mx-auto text-balance mb-10 ${lang === "ar" ? "font-arabic" : ""}`}>
            {t("description")}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link to="/signup">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                {t("signUp")}
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </Button>
            </Link>
            <Link to="/signin">
              <Button size="lg" variant="outline">
                {t("signIn")}
              </Button>
            </Link>
          </div>
        </section>

        <section className="container max-w-5xl pb-24 grid md:grid-cols-3 gap-6">
          {[
            { icon: FileText, title: "Service overview · eligibility · documents · fees · steps", desc: "Every service in your PDF becomes its own polished DOCX with the structure officials expect." },
            { icon: Layers, title: "One service per file", desc: "The agent detects where each service starts and ends, then bundles the results in a ZIP." },
            { icon: Languages, title: "Bilingual & RTL-aware", desc: "Arabic, English, or mixed input. Side-by-side parallel translation in the output." },
          ].map((f, i) => (
            <div key={i} className="p-6 rounded-lg bg-card border border-border shadow-paper">
              <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-primary" strokeWidth={1.5} />
              </div>
              <div className="font-display text-lg text-foreground mb-2 leading-snug">{f.title}</div>
              <div className="text-sm text-muted-foreground">{f.desc}</div>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-6">
        <div className="container text-xs text-muted-foreground text-center">
          © {new Date().getFullYear()} {t("appName")}
        </div>
      </footer>
    </div>
  );
};

export default Index;
