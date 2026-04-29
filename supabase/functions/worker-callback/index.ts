// deno-lint-ignore-file no-explicit-any
// Receives progress + completion events from the external Python worker.
// Authenticated via shared secret in the X-Worker-Secret header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SHARED_SECRET = Deno.env.get("WORKER_SHARED_SECRET") ?? "";

const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE);

type Event =
  | {
      type: "progress";
      jobId: string;
      status?: "uploading" | "extracting" | "analyzing" | "generating";
      progress?: number;
      message?: string;
      pageCount?: number;
      componentCount?: number;
    }
  | {
      type: "manifest";
      jobId: string;
      conflicts?: any;
      labelMappings?: any;
      componentCount?: number;
    }
  | {
      type: "component";
      jobId: string;
      userId: string;
      title: string;
      titleAr?: string | null;
      language?: string | null;
      docxPath: string; // path inside `outputs` bucket
      orderIndex: number;
      componentType?: string;
      validationStatus?: "complete" | "incomplete";
      missingSections?: string[];
    }
  | {
      type: "completed";
      jobId: string;
      zipPath: string;
      failedChunks?: any;
      manifestConflicts?: any;
      labelMappings?: any;
      componentCount?: number;
      pageCount?: number;
    }
  | { type: "failed"; jobId: string; error: string; failedChunks?: any };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const provided = req.headers.get("X-Worker-Secret") ?? "";
  if (!WORKER_SHARED_SECRET || provided !== WORKER_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let evt: Event;
  try {
    evt = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!evt?.jobId || !evt?.type) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = admin();

  try {
    if (evt.type === "progress") {
      const upd: Record<string, unknown> = {};
      if (evt.status) upd.status = evt.status;
      if (typeof evt.progress === "number") {
        upd.progress = Math.max(0, Math.min(99, Math.round(evt.progress)));
      }
      if (typeof evt.message === "string") upd.status_message = evt.message;
      if (typeof evt.pageCount === "number") upd.page_count = evt.pageCount;
      if (typeof evt.componentCount === "number") upd.component_count = evt.componentCount;
      if (Object.keys(upd).length) await sb.from("jobs").update(upd).eq("id", evt.jobId);
    } else if (evt.type === "manifest") {
      await sb.from("jobs").update({
        manifest_conflicts: evt.conflicts ?? null,
        label_mappings: evt.labelMappings ?? null,
        component_count: evt.componentCount ?? null,
      }).eq("id", evt.jobId);
    } else if (evt.type === "component") {
      await sb.from("service_outputs").insert({
        job_id: evt.jobId,
        user_id: evt.userId,
        title: evt.title,
        title_ar: evt.titleAr ?? null,
        language: evt.language ?? null,
        docx_path: evt.docxPath,
        order_index: evt.orderIndex,
        component_type: evt.componentType ?? "service",
        validation_status: evt.validationStatus ?? null,
        missing_sections: evt.missingSections ?? null,
      });
      // also bump service_count
      const { count } = await sb
        .from("service_outputs")
        .select("id", { count: "exact", head: true })
        .eq("job_id", evt.jobId);
      if (typeof count === "number") {
        await sb.from("jobs").update({ service_count: count }).eq("id", evt.jobId);
      }
    } else if (evt.type === "completed") {
      await sb.from("jobs").update({
        status: "completed",
        progress: 100,
        status_message: "Done",
        error_message: null,
        zip_path: evt.zipPath,
        failed_chunks: evt.failedChunks ?? null,
        manifest_conflicts: evt.manifestConflicts ?? null,
        label_mappings: evt.labelMappings ?? null,
        component_count: evt.componentCount ?? null,
        page_count: evt.pageCount ?? null,
      }).eq("id", evt.jobId);
    } else if (evt.type === "failed") {
      await sb.from("jobs").update({
        status: "failed",
        error_message: evt.error?.slice(0, 2000) ?? "Worker failed",
        failed_chunks: evt.failedChunks ?? null,
      }).eq("id", evt.jobId);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("worker-callback error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});