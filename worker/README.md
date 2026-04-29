# Clarivo Processing Worker

Python worker that implements the full 16-section extraction spec. Deploy to
Railway (or any Docker host). The Lovable edge function `process-pdf`
dispatches jobs here; this worker posts progress + results back to
`worker-callback`.

## Quick start (Railway)

1. Push this `worker/` folder to a new GitHub repo.
2. Create a new Railway project from that repo. Railway auto-detects the
   `Dockerfile`.
3. Set these environment variables in Railway:

   | Name | Value |
   |------|-------|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `ANTHROPIC_MODEL_PRIMARY` | `claude-sonnet-4-5-20250929` (default) |
   | `ANTHROPIC_MODEL_FALLBACK` | `claude-3-5-sonnet-20241022` (default) |
   | `SUPABASE_URL` | `https://ulglgugfymjuhfzpcaag.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Lovable Cloud → backend settings |
   | `WORKER_SHARED_SECRET` | same value you set in Lovable secrets |
   | `OUTPUTS_BUCKET` | `outputs` |
   | `PORT` | Railway sets this automatically |

4. Once deployed, copy the public Railway URL (e.g. `https://clarivo-worker.up.railway.app`) into the Lovable secret `WORKER_URL`.

## Local dev

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export WORKER_SHARED_SECRET=devsecret
uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `POST /process` — accepts a job, returns `{ runId }` immediately, then
  processes async in a background task.
  Headers: `X-Worker-Secret: <shared secret>`
  Body: `{ jobId, userId, filename, prompt, language, pdfUrl, callbackUrl, uploadsBucket, outputsBucket }`
- `GET /healthz` — liveness.

## Pipeline (matches spec sections 1–16)

1. Download PDF (signed URL).
2. Pre-extract images with PyMuPDF → `/tmp/<run>/images/`.
3. Pre-extract tables with pdfplumber → `/tmp/<run>/tables/`.
4. Discovery Pass A and Pass B (independent prompts) → cross-validate →
   tiebreaker → `manifest_final.json`.
5. Per component: 30-page chunks, 90s timeout, 2s delay, up to 5 retries
   per model, then fallback to Claude 3.5 Sonnet.
6. Save `component_NN_validated.json` checkpoint.
7. Assemble each component into a docx (python-docx) using the
   path-A 5-section template (services) or path-B semantic structure
   (non-services).
8. Zip everything → upload to `outputs` bucket.
9. POST progress + per-component + completion events to `callbackUrl`.

Recovery: if the process restarts mid-run, existing checkpoint files are
honored — only missing stages are re-run.