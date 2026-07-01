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

  // 4. Request parsing — frontend always uploads directly to Storage and sends JSON
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body — expected JSON" }, 400);
  }
  const storagePath: string | null = body.storagePath || null;
  const sourceUrl: string | null   = body.sourceUrl   || null;
  const sourceType: string         = body.sourceType  || "youtube";
  const fileName: string           = body.fileName    || "video.mp4";

  if (!storagePath && !sourceUrl) {
    return json({ error: "Request must include storagePath or sourceUrl" }, 400);
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