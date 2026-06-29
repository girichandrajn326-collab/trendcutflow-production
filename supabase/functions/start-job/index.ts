import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-Client-Info, Apikey, Content-Type",
};

const STORAGE_BUCKET = "videos";
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // 1. Explicitly handle OPTIONS for CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // 2. Auth logic
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

  // 3. Credit pre-check
  const { data: canProcess } = await supabase.rpc("can_process_video", { uid: user.id });
  if (!canProcess) {
    return json({ error: "Credit limit reached. Please upgrade your plan." }, 402);
  }

  // 4. Request parsing
  let fileName = "video.mp4";
  let storagePath: string | null = null;
  let sourceUrl: string | null = null;
  let sourceType = "file";

  const contentType = req.headers.get("Content-Type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return json({ error: "No file field in form data" }, 400);
    
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "File too large" }, 413);

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
    storagePath = `${user.id}/uploads/${crypto.randomUUID()}.${ext}`;

    const { error: storageErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (storageErr) return json({ error: `Storage: ${storageErr.message}` }, 500);
    fileName = file.name;
  } else {
    const body = await req.json();
    storagePath = body.storagePath || null;
    sourceUrl = body.sourceUrl || null;
    sourceType = body.sourceType || "youtube";
    fileName = body.fileName || "video.mp4";
  }

  // 5. Database insert
  const jobId = crypto.randomUUID();
  const { error: insertErr } = await supabase.from("processing_jobs").insert({
    id: jobId,
    user_id: user.id,
    storage_path: storagePath,
    source_type: sourceType,
    source_url: sourceUrl,
    original_name: fileName,
    status: "queued",
    progress: 0,
  });

  if (insertErr) return json({ error: `DB: ${insertErr.message}` }, 500);

  // 6. Trigger worker — fire-and-forget; pipeline status is tracked via processing_jobs polling
  const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/worker`;
  fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
    },
    body: JSON.stringify({ jobId }),
  }).catch((err) => console.error("[start-job] worker trigger error:", err));

  return json({ jobId });
});