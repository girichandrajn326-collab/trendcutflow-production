import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-Client-Info, Apikey, Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const { data: { user }, error: authErr } = await sb.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // ── Parse body ────────────────────────────────────────────────────────────────
  let body: { sourceUrl?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body — expected { sourceUrl: string }" }, 400);
  }

  const { sourceUrl } = body;
  if (!sourceUrl) return json({ error: "sourceUrl is required" }, 400);

  // ── Credit check ──────────────────────────────────────────────────────────────
  const { data: canProcess } = await sb.rpc("can_process_video", { uid: user.id });
  if (!canProcess) return json({ error: "Credit limit reached. Please upgrade your plan." }, 402);

  // ── Determine whether the file is already in Supabase Storage ─────────────────
  const storagePrefix      = `${supabaseUrl}/storage/v1/object/public/videos/`;
  const isAlreadyInStorage = sourceUrl.startsWith(storagePrefix);

  const jobId = crypto.randomUUID();

  // ── Path A: client-uploaded file — already confirmed in storage ───────────────
  if (isAlreadyInStorage) {
    const storagePath  = sourceUrl.slice(storagePrefix.length);
    const originalName = storagePath.split("/").pop() ?? "video.mp4";

    const { error: insertErr } = await sb.from("processing_jobs").insert({
      id:            jobId,
      user_id:       user.id,
      storage_path:  storagePath,
      source_type:   "file",
      source_url:    null,
      original_name: originalName,
      status:        "queued",   // worker picks up 'queued' jobs
      progress:      0,
    });

    if (insertErr) {
      console.error("[swift-service] DB insert failed:", insertErr.message);
      return json({ error: `DB insert failed: ${insertErr.message}` }, 500);
    }

    // Trigger worker and await the HTTP handshake so we know it was received
    const workerErr = await triggerWorker(supabaseUrl, serviceRoleKey, jobId);
    if (workerErr) {
      await sb.from("processing_jobs")
        .update({ status: "failed", error_message: workerErr })
        .eq("id", jobId);
      return json({ error: `Worker could not be started: ${workerErr}` }, 500);
    }

    console.log(`[swift-service] Job ${jobId} queued — file already in storage: ${storagePath}`);
    return json({ jobId });
  }

  // ── Path B: external URL — download synchronously, upload, then queue ─────────
  const { error: insertErr } = await sb.from("processing_jobs").insert({
    id:            jobId,
    user_id:       user.id,
    storage_path:  null,
    source_type:   "url",
    source_url:    sourceUrl,
    original_name: "video.mp4",
    status:        "processing",  // transient — updated to 'queued' after upload
    progress:      0,
  });

  if (insertErr) {
    console.error("[swift-service] DB insert failed:", insertErr.message);
    return json({ error: `DB insert failed: ${insertErr.message}` }, 500);
  }

  // Download — explicitly awaited inside try/catch
  let videoBuffer: ArrayBuffer;
  try {
    const dlRes = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VideoProcessor/1.0)" },
    });
    if (!dlRes.ok) {
      throw new Error(`Remote server returned HTTP ${dlRes.status}`);
    }
    videoBuffer = await dlRes.arrayBuffer();
  } catch (err) {
    const msg = `Download failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[swift-service] ${msg}`);
    await sb.from("processing_jobs")
      .update({ status: "failed", error_message: msg })
      .eq("id", jobId);
    return json({ error: msg }, 400);
  }

  // Upload to Supabase Storage — status is only set to 'queued' after this succeeds
  const storagePath = `${user.id}/${jobId}.mp4`;
  const { error: uploadErr } = await sb.storage
    .from("videos")
    .upload(storagePath, new Uint8Array(videoBuffer), { contentType: "video/mp4", upsert: true });

  if (uploadErr) {
    const msg = `Storage upload failed: ${uploadErr.message}`;
    console.error(`[swift-service] ${msg}`);
    await sb.from("processing_jobs")
      .update({ status: "failed", error_message: msg })
      .eq("id", jobId);
    return json({ error: msg }, 400);
  }

  // File confirmed in storage — now mark as 'queued' so the worker can process it
  const { error: updateErr } = await sb.from("processing_jobs")
    .update({ status: "queued", storage_path: storagePath })
    .eq("id", jobId);

  if (updateErr) {
    console.error("[swift-service] Failed to set status to queued:", updateErr.message);
    // Non-fatal: worker will still find the job if we continue
  }

  // Trigger worker and await the HTTP handshake
  const workerErr = await triggerWorker(supabaseUrl, serviceRoleKey, jobId);
  if (workerErr) {
    await sb.from("processing_jobs")
      .update({ status: "failed", error_message: workerErr })
      .eq("id", jobId);
    return json({ error: `Worker could not be started: ${workerErr}` }, 500);
  }

  console.log(`[swift-service] Job ${jobId} queued — file stored at ${storagePath}`);
  return json({ jobId });
});

// ── Worker trigger ─────────────────────────────────────────────────────────────
// Awaited so we know the worker HTTP handshake succeeded. The worker itself returns
// immediately and runs the pipeline via EdgeRuntime.waitUntil().

async function triggerWorker(
  supabaseUrl: string,
  serviceRoleKey: string,
  jobId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/worker`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ jobId }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return `worker responded ${res.status}: ${body.slice(0, 200)}`;
    }

    return null; // success
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
