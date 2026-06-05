// Edge Function: start-job
//
// Lightweight enqueue endpoint — returns { jobId } in under one second.
//
// 1. Authenticates the user
// 2. Checks credit balance
// 3. Inserts a processing_jobs row (status = "queued")
// 4. Fires the worker function in the background via EdgeRuntime.waitUntil()
// 5. Returns { jobId } immediately — the client polls processing_jobs for progress

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const STORAGE_BUCKET   = "videos";
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // ── Credit pre-check ─────────────────────────────────────────────────────────
  const { data: canProcess } = await supabase.rpc("can_process_video", { uid: user.id });
  if (!canProcess) {
    return json({ error: "Credit limit reached. Please upgrade your plan." }, 402);
  }

  // ── Parse request ────────────────────────────────────────────────────────────
  let fileName    = "video.mp4";
  let fileType    = "video/mp4";
  let storagePath: string | null = null;
  let sourceUrl:  string | null = null;
  let sourceType  = "file";

  const ct = req.headers.get("Content-Type") ?? "";

  if (ct.includes("multipart/form-data")) {
    // Legacy: small file sent directly in the body (dev/fallback only)
    let form: FormData;
    try { form = await req.formData(); }
    catch { return json({ error: "Failed to parse multipart form data" }, 400); }

    const file = form.get("file") as File | null;
    if (!file) return json({ error: "No file field in form data" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: "File too large (max 500 MB). Upload to storage first." }, 413);
    }

    // Upload directly to storage so the worker can download it
    fileName  = file.name || "video.mp4";
    fileType  = file.type || "video/mp4";
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "mp4";
    const uploadTarget = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const { error: storageErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(uploadTarget, fileBytes, { contentType: fileType, upsert: false });

    if (storageErr) {
      return json({ error: `Storage upload failed: ${storageErr.message}` }, 500);
    }
    storagePath = uploadTarget;
    sourceType  = "file";

  } else {
    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    if (typeof body.storagePath === "string" && body.storagePath) {
      // Client pre-uploaded to storage (primary path)
      storagePath = body.storagePath;
      fileName    = (body.fileName as string) ?? "video.mp4";
      fileType    = (body.fileType as string) ?? "video/mp4";
      sourceType  = "file";
    } else {
      sourceUrl  = ((body.sourceUrl as string) ?? "").trim() || null;
      sourceType = (body.sourceType as string) ?? "youtube";
      if (!sourceUrl) return json({ error: "sourceUrl is required for non-file jobs" }, 400);
      if (!/youtube\.com|youtu\.be/i.test(sourceUrl)) {
        return json({ error: "Only YouTube URLs are supported" }, 400);
      }
    }
  }

  // ── Insert processing_jobs row ───────────────────────────────────────────────
  const jobId = crypto.randomUUID();
  const { error: insertErr } = await supabase.from("processing_jobs").insert({
    id:            jobId,
    user_id:       user.id,
    storage_path:  storagePath,
    source_type:   sourceType,
    source_url:    sourceUrl,
    original_name: fileName,
    status:        "queued",
    progress:      0,
  });

  if (insertErr) {
    return json({ error: `Failed to create job: ${insertErr.message}` }, 500);
  }

  // ── Trigger worker in background ─────────────────────────────────────────────
  const workerUrl      = `${Deno.env.get("SUPABASE_URL")}/functions/v1/worker`;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const triggerWorker = fetch(workerUrl, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ jobId }),
  }).catch(err => console.error("Failed to trigger worker:", err));

  // deno-lint-ignore no-explicit-any
  const ert = (globalThis as any).EdgeRuntime;
  if (ert?.waitUntil) {
    ert.waitUntil(triggerWorker);
  } else {
    triggerWorker; // local dev: fire-and-forget
  }

  return json({ jobId });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
