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
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Validate the user JWT
  const { data: { user }, error: authErr } = await sb.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // Parse body
  let body: { sourceUrl?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body — expected JSON with sourceUrl and userId" }, 400);
  }

  const { sourceUrl, userId } = body;
  if (!sourceUrl) return json({ error: "sourceUrl is required" }, 400);
  if (!userId)    return json({ error: "userId is required" }, 400);

  // Credit pre-check
  const { data: canProcess } = await sb.rpc("can_process_video", { uid: user.id });
  if (!canProcess) {
    return json({ error: "Credit limit reached. Please upgrade your plan." }, 402);
  }

  // Determine whether sourceUrl is a storage object or an external URL (e.g. YouTube)
  const storagePrefix = `${supabaseUrl}/storage/v1/object/public/videos/`;
  let storagePath: string | null = null;
  let sourceType = "youtube";

  if (sourceUrl.startsWith(storagePrefix)) {
    storagePath = sourceUrl.slice(storagePrefix.length);
    sourceType  = "file";
  }

  // Insert job row
  const jobId = crypto.randomUUID();
  const { error: insertErr } = await sb.from("processing_jobs").insert({
    id:            jobId,
    user_id:       user.id,
    storage_path:  storagePath,
    source_type:   sourceType,
    source_url:    sourceType === "youtube" ? sourceUrl : null,
    original_name: storagePath ? storagePath.split("/").pop() ?? "video.mp4" : "video.mp4",
    status:        "queued",
    progress:      0,
  });

  if (insertErr) {
    console.error("[swift-service] DB insert failed:", insertErr.message);
    return json({ error: `DB: ${insertErr.message}` }, 500);
  }

  // Fire worker — fire-and-forget; pipeline is tracked via processing_jobs polling
  const workerUrl = `${supabaseUrl}/functions/v1/worker`;
  fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ jobId }),
  }).catch((err) => console.error("[swift-service] worker trigger error:", err));

  return json({ jobId });
});
