// deno-lint-ignore-file no-explicit-any
// Thin dispatcher: validates the job, signs a download URL for the PDF,
// and asks the external Python worker (Railway) to do the heavy lifting.
// The worker posts progress + final files back via `worker-callback`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_URL = Deno.env.get("WORKER_URL") ?? "";
const WORKER_SHARED_SECRET = Deno.env.get("WORKER_SHARED_SECRET") ?? "";

const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE);

async function fail(jobId: string, msg: string) {
  await admin().from("jobs").update({
    status: "failed",
    error_message: msg,
    progress: 0,
    status_message: null,
  }).eq("id", jobId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let jobId = "";
  try {
    const body = await req.json().catch(() => ({}));
    jobId = body?.jobId ?? "";
    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!WORKER_URL || !WORKER_SHARED_SECRET) {
      await fail(jobId, "Worker not configured. Set WORKER_URL and WORKER_SHARED_SECRET.");
      return new Response(JSON.stringify({ error: "worker_not_configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = admin();
    const { data: job, error: jErr } = await sb
      .from("jobs")
      .select("id,user_id,pdf_path,filename,prompt,language,status")
      .eq("id", jobId)
      .single();
    if (jErr || !job) {
      return new Response(JSON.stringify({ error: "job_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sign a 6-hour download URL for the worker
    const { data: signed, error: signErr } = await sb.storage
      .from("uploads")
      .createSignedUrl(job.pdf_path, 60 * 60 * 6);
    if (signErr || !signed?.signedUrl) {
      await fail(jobId, `Could not sign PDF URL: ${signErr?.message ?? "unknown"}`);
      return new Response(JSON.stringify({ error: "sign_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark queued; worker will move it to extracting/analyzing/etc.
    await sb.from("jobs").update({
      status: "uploading",
      progress: 1,
      status_message: "Dispatching to processing worker…",
      error_message: null,
    }).eq("id", jobId);

    const callbackUrl = `${SUPABASE_URL}/functions/v1/worker-callback`;
    const payload = {
      jobId: job.id,
      userId: job.user_id,
      filename: job.filename,
      prompt: job.prompt,
      language: job.language,
      pdfUrl: signed.signedUrl,
      callbackUrl,
      // Worker uploads to these buckets using its own service role key
      uploadsBucket: "uploads",
      outputsBucket: "outputs",
    };

    // Fire the worker (it should accept the job and 202 quickly, then process async).
    // We don't await long: 30s ceiling is plenty for an accept handshake.
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 30_000);
    let resp: Response;
    try {
      resp = await fetch(`${WORKER_URL.replace(/\/$/, "")}/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": WORKER_SHARED_SECRET,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(tid);
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      await fail(jobId, `Worker rejected job (${resp.status}): ${txt.slice(0, 300)}`);
      return new Response(JSON.stringify({ error: "worker_error", detail: txt }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accepted = await resp.json().catch(() => ({}));
    if (accepted?.runId) {
      await sb.from("jobs").update({ worker_run_id: accepted.runId }).eq("id", jobId);
    }

    return new Response(JSON.stringify({ ok: true, runId: accepted?.runId ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("process-pdf dispatcher error:", e);
    if (jobId) await fail(jobId, e?.message ?? "Dispatcher error");
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});