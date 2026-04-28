import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LangContext, translations, type Lang, type TranslationKey } from "@/lib/i18n";

export const LangProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("khidma_lang") : null;
    return (stored as Lang) || "en";
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("khidma_lang", lang);
  }, [lang]);

  const value = useMemo(() => ({
    lang,
    setLang: setLangState,
    t: (k: TranslationKey) => translations[lang][k] ?? translations.en[k],
  }), [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
};