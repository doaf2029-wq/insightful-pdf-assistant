// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  ImageRun, PageOrientation, LevelFormat, Footer, PageNumber,
} from "npm:docx@8.5.0";
import JSZip from "npm:jszip@3.10.1";
import { getDocumentProxy, renderPageAsImage } from "npm:unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE);

type Status = "pending" | "uploading" | "extracting" | "analyzing" | "generating" | "completed" | "failed";

async function setStatus(jobId: string, status: Status, progress: number, message?: string) {
  await admin().from("jobs").update({
    status, progress, status_message: message ?? null,
  }).eq("id", jobId);
}

async function setError(jobId: string, message: string) {
  await admin().from("jobs").update({
    status: "failed", error_message: message, progress: 0,
  }).eq("id", jobId);
}

/* -------------------- Base64 encode helper -------------------- */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/* -------------------- PDF page rendering & cropping -------------------- */
type PageImage = { png: Uint8Array; width: number; height: number };

async function renderAndCropPages(
  pdfBytes: Uint8Array,
  pageNumbers: number[],
): Promise<Map<number, PageImage>> {
  const out = new Map<number, PageImage>();
  if (!pageNumbers.length) return out;
  const unique = Array.from(new Set(pageNumbers.filter((p) => p && p > 0)));
  let pdf: any;
  try {
    pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  } catch (e) {
    console.error("PDF render init failed:", e);
    return out;
  }
  const totalPages = pdf.numPages;
  for (const p of unique) {
    if (p > totalPages) continue;
    try {
      const result: any = await renderPageAsImage(new Uint8Array(pdfBytes), p, {
        canvas: () => import("npm:@napi-rs/canvas@0.1.53"),
        scale: 1.5,
      });
      // result is an ArrayBuffer of PNG bytes; width/height not always returned.
      const buf = result instanceof Uint8Array ? result : new Uint8Array(result);
      // Extract dimensions from PNG IHDR (bytes 16-23)
      const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
      const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
      out.set(p, { png: buf, width: w, height: h });
    } catch (e) {
      console.warn(`Render failed for page ${p}:`, (e as any)?.message);
    }
  }
  return out;
}

async function cropPng(
  png: Uint8Array,
  origW: number,
  origH: number,
  bbox?: { x: number; y: number; w: number; h: number },
): Promise<{ data: Uint8Array; width: number; height: number }> {
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) {
    return { data: png, width: origW, height: origH };
  }
  try {
    const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
    const img = await Image.decode(png);
    // Pad bbox slightly (3%) so we don't clip edges
    const pad = 0.02;
    const x = Math.max(0, Math.floor((bbox.x - pad) * img.width));
    const y = Math.max(0, Math.floor((bbox.y - pad) * img.height));
    const w = Math.min(img.width - x, Math.ceil((bbox.w + 2 * pad) * img.width));
    const h = Math.min(img.height - y, Math.ceil((bbox.h + 2 * pad) * img.height));
    if (w < 20 || h < 20) return { data: png, width: img.width, height: img.height };
    const cropped = img.crop(x, y, w, h);
    const encoded = await cropped.encode();
    return { data: encoded, width: cropped.width, height: cropped.height };
  } catch (e) {
    console.warn("Crop failed, using full page:", (e as any)?.message);
    return { data: png, width: origW, height: origH };
  }
}

function imageParagraph(data: Uint8Array, srcW: number, srcH: number, maxWidthPx = 480): Paragraph {
  const ratio = srcH / Math.max(srcW, 1);
  const width = Math.min(maxWidthPx, srcW);
  const height = Math.round(width * ratio);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 160 },
    children: [
      new ImageRun({
        type: "png",
        data,
        transformation: { width, height },
        altText: { title: "Step image", description: "Extracted from source PDF", name: "step" },
      } as any),
    ],
  });
}

/* -------------------- Gemini call via Lovable AI -------------------- */
const SERVICE_SCHEMA = {
  type: "object",
  properties: {
    services: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title_en: { type: "string", description: "Service title in English" },
          title_ar: { type: "string", description: "Service title in Arabic if available, else empty" },
          start_page: { type: "integer" },
          end_page: { type: "integer" },
          overview_en: { type: "string" },
          overview_ar: { type: "string" },
          eligibility_en: { type: "array", items: { type: "string" } },
          eligibility_ar: { type: "array", items: { type: "string" } },
          documents_en: { type: "array", items: { type: "string" } },
          documents_ar: { type: "array", items: { type: "string" } },
          fees_en: { type: "string" },
          fees_ar: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step_en: { type: "string" },
                step_ar: { type: "string" },
                page_ref: { type: "integer", description: "Source page number for this step's image" },
                bbox: {
                  type: "object",
                  description: "Optional normalized bounding box (0-1) of the step's screenshot/diagram on page_ref. x,y is top-left.",
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    w: { type: "number" },
                    h: { type: "number" },
                  },
                },
              },
              required: ["step_en"],
            },
          },
          notes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["note", "warning"] },
                text_en: { type: "string" },
                text_ar: { type: "string" },
              },
              required: ["kind", "text_en"],
            },
          },
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                caption: { type: "string" },
                rows: { type: "array", items: { type: "array", items: { type: "string" } } },
              },
              required: ["rows"],
            },
          },
          important_figures: {
            type: "array",
            description: "Important non-step figures (diagrams, charts, official seals, screenshots) worth embedding. Skip decorative or logo-only images.",
            items: {
              type: "object",
              properties: {
                page_ref: { type: "integer" },
                caption_en: { type: "string" },
                caption_ar: { type: "string" },
                bbox: {
                  type: "object",
                  properties: {
                    x: { type: "number" }, y: { type: "number" },
                    w: { type: "number" }, h: { type: "number" },
                  },
                },
              },
              required: ["page_ref"],
            },
          },
        },
        required: ["title_en", "start_page", "end_page", "overview_en", "steps"],
      },
    },
  },
  required: ["services"],
};

async function callGeminiWithPdf(systemPrompt: string, userPrompt: string, pdfB64: string, model = "google/gemini-2.5-pro") {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${pdfB64}` } },
          ],
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_services",
          description: "Extract structured services from the document",
          parameters: SERVICE_SCHEMA,
        },
      }],
      tool_choice: { type: "function", function: { name: "extract_services" } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI gateway ${resp.status}: ${t.slice(0, 500)}`);
  }
  const data = await resp.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) throw new Error("AI returned no tool call");
  return JSON.parse(tc.function.arguments);
}

/* -------------------- DOCX generation -------------------- */
function makeRun(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string; rtl?: boolean } = {}) {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italic,
    size: opts.size ?? 22, // half-points; 22 = 11pt
    color: opts.color,
    font: opts.rtl ? "Arial" : "Arial",
    rightToLeft: opts.rtl,
  });
}

function heading(text: string, level: 1 | 2 | 3, rtl = false): Paragraph {
  const sizeMap: Record<number, number> = { 1: 40, 2: 30, 3: 26 };
  const headingMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  return new Paragraph({
    heading: headingMap[level],
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { before: 240, after: 120 },
    children: [makeRun(text, { bold: true, size: sizeMap[level], color: "1A2740", rtl })],
  });
}

function para(text: string, opts: { italic?: boolean; rtl?: boolean; bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    bidirectional: opts.rtl,
    alignment: opts.rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { after: 120 },
    children: [makeRun(text, { italic: opts.italic, bold: opts.bold, size: 22, rtl: opts.rtl })],
  });
}

function bulletPara(text: string, rtl = false): Paragraph {
  return new Paragraph({
    numbering: { reference: rtl ? "bullets-rtl" : "bullets", level: 0 },
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    children: [makeRun(text, { size: 22, rtl })],
  });
}

function calloutBox(label: string, text: string, kind: "note" | "warning", rtl = false): Table {
  const fill = kind === "warning" ? "FBE9E7" : "E8F0FE";
  const border = kind === "warning" ? "D84315" : "1A73E8";
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: border };
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill, type: ShadingType.CLEAR, color: "auto" },
            borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: [
              new Paragraph({
                bidirectional: rtl,
                alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
                children: [makeRun(`${label}: `, { bold: true, color: border, size: 22, rtl }), makeRun(text, { size: 22, rtl })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function makeTable(rows: string[][], rtl = false): Table {
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const colWidth = Math.floor(9360 / colCount);
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: new Array(colCount).fill(colWidth),
    rows: rows.map((r, ri) =>
      new TableRow({
        children: new Array(colCount).fill(0).map((_, ci) =>
          new TableCell({
            width: { size: colWidth, type: WidthType.DXA },
            shading: ri === 0 ? { fill: "1A2740", type: ShadingType.CLEAR, color: "auto" } : undefined,
            borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                bidirectional: rtl,
                alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
                children: [makeRun(r[ci] ?? "", { bold: ri === 0, color: ri === 0 ? "FFFFFF" : "1A2740", size: 20, rtl })],
              }),
            ],
          })
        ),
      })
    ),
  });
}

async function buildServiceDoc(
  svc: any,
  language: "en" | "ar" | "bilingual" | "auto",
  pageImages: Map<number, PageImage>,
): Promise<Document> {
  const wantEn = language === "en" || language === "auto" || language === "bilingual";
  const wantAr = (language === "ar" || language === "bilingual" || language === "auto") && (svc.title_ar || svc.overview_ar);

  const numbering = {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets-rtl", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.RIGHT, style: { paragraph: { indent: { right: 720, hanging: 360 } } } }] },
      { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  };

  const children: any[] = [];

  // Title
  if (wantEn) children.push(heading(svc.title_en, 1, false));
  if (wantAr && svc.title_ar) children.push(heading(svc.title_ar, 1, true));

  // Overview
  if (svc.overview_en && wantEn) {
    children.push(heading("Service Overview", 2, false));
    children.push(para(svc.overview_en));
  }
  if (wantAr && svc.overview_ar) {
    children.push(heading("نظرة عامة على الخدمة", 2, true));
    children.push(para(svc.overview_ar, { rtl: true }));
  }

  // Eligibility
  if (wantEn && svc.eligibility_en?.length) {
    children.push(heading("Eligibility Criteria", 2, false));
    for (const e of svc.eligibility_en) children.push(bulletPara(e));
  }
  if (wantAr && svc.eligibility_ar?.length) {
    children.push(heading("شروط الأهلية", 2, true));
    for (const e of svc.eligibility_ar) children.push(bulletPara(e, true));
  }

  // Documents
  if (wantEn && svc.documents_en?.length) {
    children.push(heading("Required Documents", 2, false));
    for (const e of svc.documents_en) children.push(bulletPara(e));
  }
  if (wantAr && svc.documents_ar?.length) {
    children.push(heading("المستندات المطلوبة", 2, true));
    for (const e of svc.documents_ar) children.push(bulletPara(e, true));
  }

  // Fees
  if (wantEn && svc.fees_en) {
    children.push(heading("Fees", 2, false));
    children.push(para(svc.fees_en));
  }
  if (wantAr && svc.fees_ar) {
    children.push(heading("الرسوم", 2, true));
    children.push(para(svc.fees_ar, { rtl: true }));
  }

  // Application steps
  if (svc.steps?.length) {
    if (wantEn) children.push(heading("Application Steps", 2, false));
    for (let i = 0; i < svc.steps.length; i++) {
      const s = svc.steps[i];
      if (wantEn) {
        children.push(new Paragraph({
          numbering: { reference: "steps", level: 0 },
          spacing: { after: 60 },
          children: [makeRun(s.step_en, { bold: true, size: 22 })],
        }));
      }
      if (wantAr && s.step_ar) {
        children.push(new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { after: 60 },
          children: [makeRun(`${i + 1}. ${s.step_ar}`, { italic: true, size: 22, rtl: true })],
        }));
      }
      // Embed step image (cropped from referenced page)
      const pageImg = s.page_ref ? pageImages.get(s.page_ref) : undefined;
      if (pageImg) {
        const { data, width, height } = await cropPng(pageImg.png, pageImg.width, pageImg.height, s.bbox);
        children.push(imageParagraph(data, width, height));
      }
    }
  }

  // Notes & warnings
  if (svc.notes?.length) {
    children.push(new Paragraph({ children: [makeRun("", {})], spacing: { before: 200 } }));
    for (const n of svc.notes) {
      const labelEn = n.kind === "warning" ? "⚠ Warning" : "ℹ Note";
      if (wantEn && n.text_en) children.push(calloutBox(labelEn, n.text_en, n.kind, false));
      if (wantAr && n.text_ar) {
        const labelAr = n.kind === "warning" ? "⚠ تحذير" : "ℹ ملاحظة";
        children.push(calloutBox(labelAr, n.text_ar, n.kind, true));
      }
    }
  }

  // Tables
  if (svc.tables?.length) {
    children.push(heading("Tables", 2, false));
    for (const t of svc.tables) {
      if (t.caption) children.push(para(t.caption, { italic: true }));
      if (t.rows?.length) children.push(makeTable(t.rows));
      children.push(new Paragraph({ children: [makeRun("", {})] }));
    }
  }

  // Important figures (non-step)
  if (svc.important_figures?.length) {
    const figs = svc.important_figures.filter((f: any) => f && f.page_ref);
    if (figs.length) {
      if (wantEn) children.push(heading("Figures", 2, false));
      for (const f of figs) {
        const pageImg = pageImages.get(f.page_ref);
        if (!pageImg) continue;
        const { data, width, height } = await cropPng(pageImg.png, pageImg.width, pageImg.height, f.bbox);
        children.push(imageParagraph(data, width, height));
        if (wantEn && f.caption_en) children.push(para(f.caption_en, { italic: true }));
        if (wantAr && f.caption_ar) children.push(para(f.caption_ar, { italic: true, rtl: true }));
      }
    }
  }

  return new Document({
    creator: "Clarivo",
    title: svc.title_en,
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
    },
    numbering,
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeRun("Page ", { size: 18, color: "808080" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080" })],
          })],
        }),
      },
      children,
    }],
  });
}

/* -------------------- Main handler -------------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let jobId: string | null = null;
  try {
    const { jobId: jid } = await req.json();
    jobId = jid;
    if (!jobId) throw new Error("jobId required");

    const sb = admin();
    const { data: job, error: jobErr } = await sb.from("jobs").select("*").eq("id", jobId).single();
    if (jobErr || !job) throw new Error("Job not found");

    // Respond immediately so the client doesn't block; processing continues
    const work = (async () => {
      try {
        await setStatus(jobId!, "extracting", 10, "Downloading PDF…");
        const { data: pdfBlob, error: dlErr } = await sb.storage.from("uploads").download(job.pdf_path);
        if (dlErr || !pdfBlob) throw new Error("PDF download failed: " + dlErr?.message);
        const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
        const pdfB64 = bytesToBase64(pdfBytes);

        await setStatus(jobId!, "analyzing", 30, "Sending to AI for analysis (may take a few minutes for large PDFs)…");

        const userInstr = job.prompt
          ? `User instructions: ${job.prompt}\n\nNow analyze the attached PDF.`
          : "Analyze the attached PDF.";
        const langInstr =
          job.language === "ar" ? "Output Arabic only (leave _en fields empty unless source is English-only)."
          : job.language === "en" ? "Output English only (leave _ar fields empty unless source is Arabic-only)."
          : job.language === "bilingual" ? "Always output both English (_en) and Arabic (_ar) fields with parallel translation."
          : "Detect document language. If mixed or Arabic, fill both _en and _ar fields with parallel translation. If pure English, leave _ar empty.";

        const sys = [
          "You are a meticulous document analyst that converts government / business service PDFs into structured services.",
          "Each 'service' represents one process a citizen or business can apply for (e.g. 'Issue commercial license', 'Renew passport').",
          "If the document does NOT explicitly list services, divide it by main sections and treat each section as a 'service' with its own subsections.",
          "ALWAYS preserve the EXACT content from the source — do not paraphrase, summarize, or invent. Reorganize, do not rewrite.",
          "For each step, include the source page number in page_ref.",
          "Flag explicit notes/warnings/important callouts in the 'notes' array with kind='note' or 'warning'.",
          "Reproduce any tables found in the source verbatim in the 'tables' array (first row = header).",
          "Set start_page and end_page for each service based on the PDF page numbers.",
          langInstr,
        ].join("\n");

        const result = await callGeminiWithPdf(sys, userInstr, pdfB64);
        const services = (result.services ?? []) as any[];
        if (!services.length) throw new Error("AI did not identify any services");

        // page_count is best-effort from end_page max
        const maxPage = services.reduce((m, s) => Math.max(m, s.end_page || 0), 0) || null;
        await sb.from("jobs").update({ service_count: services.length, page_count: maxPage }).eq("id", jobId!);
        await setStatus(jobId!, "generating", 60, `Generating ${services.length} document(s)…`);

        // Generate DOCX per service and zip
        const zip = new JSZip();
        const sanitize = (s: string) => s.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "service";

        for (let i = 0; i < services.length; i++) {
          const svc = services[i];
          const doc = buildServiceDoc(svc, job.language);
          const buf = await Packer.toBuffer(doc);
          const baseName = `${String(i + 1).padStart(2, "0")}_${sanitize(svc.title_en || "service")}`;
          const docxName = `${baseName}.docx`;
          zip.file(docxName, buf);

          // Upload individual docx
          const docxPath = `${job.user_id}/${jobId}/${docxName}`;
          await sb.storage.from("outputs").upload(docxPath, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

          await sb.from("service_outputs").insert({
            job_id: jobId!,
            user_id: job.user_id,
            title: svc.title_en || `Service ${i + 1}`,
            title_ar: svc.title_ar || null,
            language: job.language,
            docx_path: docxPath,
            order_index: i,
          });

          const prog = 60 + Math.floor(((i + 1) / services.length) * 35);
          await setStatus(jobId!, "generating", prog, `Generated ${i + 1} of ${services.length}`);
        }

        // Upload ZIP
        const zipBuf = await zip.generateAsync({ type: "uint8array" });
        const zipPath = `${job.user_id}/${jobId}/services.zip`;
        await sb.storage.from("outputs").upload(zipPath, new Blob([zipBuf], { type: "application/zip" }), { upsert: true, contentType: "application/zip" });

        await sb.from("jobs").update({
          status: "completed", progress: 100, status_message: "Done", zip_path: zipPath,
        }).eq("id", jobId!);
      } catch (err: any) {
        console.error("Processing error", err);
        await setError(jobId!, err?.message?.slice(0, 1000) ?? "Unknown error");
      }
    })();

    // Use EdgeRuntime.waitUntil if available so the response can return early
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      // Fallback: don't await — but Deno may kill it; best-effort
      work.catch((e) => console.error(e));
    }

    return new Response(JSON.stringify({ ok: true, jobId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    if (jobId) await setError(jobId, err?.message ?? "Unknown error");
    return new Response(JSON.stringify({ error: err?.message ?? "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});