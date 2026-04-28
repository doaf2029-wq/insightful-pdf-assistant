import { useCallback, useRef, useState } from "react";
import { Upload, FileText, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export const UploadDropzone = ({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
}) => {
  const { t } = useT();
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = useCallback(
    (f: File): boolean => {
      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        toast.error(t("invalidFile"));
        return false;
      }
      if (f.size > MAX_BYTES) {
        toast.error(t("fileTooLarge"));
        return false;
      }
      return true;
    },
    [t]
  );

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (validate(f)) onFile(f);
  };

  if (file) {
    return (
      <div className="border-2 border-border rounded-lg p-5 bg-card flex items-center gap-4 shadow-paper">
        <div className="w-11 h-11 rounded-md bg-secondary flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-foreground truncate">{file.name}</div>
          <div className="text-xs text-muted-foreground">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onFile(null)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label={t("remove")}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      className={`w-full border-2 border-dashed rounded-lg p-10 transition-all text-center
        ${drag ? "border-accent bg-accent/5" : "border-border bg-card hover:border-accent/50 hover:bg-secondary/40"}
        ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className="w-14 h-14 mx-auto rounded-full bg-secondary flex items-center justify-center mb-4">
        <Upload className="w-6 h-6 text-primary" strokeWidth={1.5} />
      </div>
      <div className="font-display text-xl text-foreground mb-1">{t("dropHere")}</div>
      <div className="text-sm text-muted-foreground mb-3">{t("orBrowse")}</div>
      <div className="text-xs text-muted-foreground">{t("pdfOnly")}</div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </button>
  );
};