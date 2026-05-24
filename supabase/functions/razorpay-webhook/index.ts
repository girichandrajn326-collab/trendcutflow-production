// Edge Function: razorpay-webhook
// Verifies Razorpay payment signature and upgrades the user's plan in the DB.

import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Plan credit allocations
const PLAN_CREDITS: Record<string, { plan: string; credits: number }> = {
  plan_creator: { plan: "CREATOR", credits: 3 },
  plan_pro:     { plan: "PRO",     credits: 5 },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    const body = await req.text();

    // Verify Razorpay webhook signature when secret is configured
    if (webhookSecret) {
      const signature = req.headers.get("x-razorpay-signature") ?? "";
      const expectedSig = createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");
      if (signature !== expectedSig) {
        return json({ error: "Invalid signature" }, 400);
      }
    }

    const event = JSON.parse(body);
    const eventType: string = event.event ?? "";

    // We only care about successful payments
    if (eventType !== "payment.captured" && eventType !== "order.paid") {
      return json({ ok: true, skipped: true });
    }

    const payment = event.payload?.payment?.entity ?? event.payload?.order?.entity;
    if (!payment) return json({ error: "No payment entity" }, 400);

    // Notes attached to the Razorpay order carry user_id and plan_key
    const notes = payment.notes ?? {};
    const userId: string = notes.user_id ?? "";
    const planKey: string = notes.plan_key ?? "";

    if (!userId || !planKey) {
      return json({ error: "Missing user_id or plan_key in notes" }, 400);
    }

    const planData = PLAN_CREDITS[planKey];
    if (!planData) return json({ error: `Unknown plan_key: ${planKey}` }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase
      .from("users")
      .update({
        current_plan: planData.plan,
        total_credits: planData.credits,
        credits_used: 0, // reset on new billing cycle
      })
      .eq("id", userId);

    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, plan: planData.plan });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
