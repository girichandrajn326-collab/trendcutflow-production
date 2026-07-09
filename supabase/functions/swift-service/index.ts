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

  // ── Determine if the file is already in Supabase Storage ─────────────────────
  const storagePrefix      = `${supabaseUrl}/storage/v1/object/public/videos/`;
  const isAlreadyInStorage = sourceUrl.startsWith(storagePrefix);

  const jobId = crypto.randomUUID();

  // ── Path A: file was uploaded client-side and is already in storage ───────────
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
      status:        "completed",
      progress:      100,
    });

    if (insertErr) {
      console.error("[swift-service] DB insert failed:", insertErr.message);
      return json({ error: `DB insert failed: ${insertErr.message}` }, 500);
    }

    console.log(`[swift-service] Job ${jobId} created — file already in storage: ${storagePath}`);
    return json({ jobId, storagePath });
  }

  // ── Path B: external URL — download synchronously, upload, then mark completed ─
  const { error: insertErr } = await sb.from("processing_jobs").insert({
    id:            jobId,
    user_id:       user.id,
    storage_path:  null,
    source_type:   "url",
    source_url:    sourceUrl,
    original_name: "video.mp4",
    status:        "processing",
    progress:      0,
  });

  if (insertErr) {
    console.error("[swift-service] DB insert failed:", insertErr.message);
    return json({ error: `DB insert failed: ${insertErr.message}` }, 500);
  }

  // Download
  let videoBuffer: ArrayBuffer;
  try {
    const dlRes = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VideoProcessor/1.0)" },
    });
    if (!dlRes.ok) {
      const msg = `Download failed: server returned HTTP ${dlRes.status}`;
      await sb.from("processing_jobs").update({ status: "failed", error_message: msg }).eq("id", jobId);
      return json({ error: msg }, 400);
    }
    videoBuffer = await dlRes.arrayBuffer();
  } catch (err) {
    const msg = `Download failed: ${err instanceof Error ? err.message : String(err)}`;
    await sb.from("processing_jobs").update({ status: "failed", error_message: msg }).eq("id", jobId);
    return json({ error: msg }, 400);
  }

  // Upload to Supabase Storage
  const storagePath = `${user.id}/${jobId}.mp4`;
  const { error: uploadErr } = await sb.storage
    .from("videos")
    .upload(storagePath, new Uint8Array(videoBuffer), { contentType: "video/mp4", upsert: true });

  if (uploadErr) {
    const msg = `Storage upload failed: ${uploadErr.message}`;
    await sb.from("processing_jobs").update({ status: "failed", error_message: msg }).eq("id", jobId);
    return json({ error: msg }, 400);
  }

  // Mark completed
  const { error: updateErr } = await sb.from("processing_jobs")
    .update({ status: "completed", storage_path: storagePath, progress: 100 })
    .eq("id", jobId);

  if (updateErr) {
    // File is in storage — log but don't fail the request
    console.error("[swift-service] Failed to mark job completed:", updateErr.message);
  }

  console.log(`[swift-service] Job ${jobId} completed — file stored at ${storagePath}`);
  return json({ jobId, storagePath });
});
