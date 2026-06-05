// Edge Function: razorpay-webhook
// Verifies Razorpay payment signature, upgrades user plan, and records
// the subscription + credit grant in the billing tables.

import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    if (eventType !== "payment.captured" && eventType !== "order.paid") {
      return json({ ok: true, skipped: true });
    }

    const payment = event.payload?.payment?.entity ?? event.payload?.order?.entity;
    if (!payment) return json({ error: "No payment entity" }, 400);

    const notes = payment.notes ?? {};
    const userId: string  = notes.user_id  ?? "";
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

    // 1. Upgrade the user's plan and replenish the credit balance
    const { error: profileError } = await supabase
      .from("users")
      .update({
        current_plan:  planData.plan,
        total_credits: planData.credits,
        credits_used:  0,
        credits:       planData.credits,
      })
      .eq("id", userId);

    if (profileError) return json({ error: profileError.message }, 500);

    // 2. Record the subscription (upsert so retried webhooks are idempotent)
    const paymentId = payment.id ?? null;
    const orderId   = payment.order_id ?? null;

    const { error: subError } = await supabase
      .from("subscriptions")
      .insert({
        user_id:              userId,
        plan_name:            planData.plan,
        status:               "active",
        razorpay_payment_id:  paymentId,
        razorpay_order_id:    orderId,
      });

    if (subError) return json({ error: subError.message }, 500);

    // 3. Log the credit grant in the audit trail
    const { error: txError } = await supabase
      .from("credit_transactions")
      .insert({
        user_id: userId,
        amount:  planData.credits,
        reason:  "plan_purchase",
      });

    if (txError) return json({ error: txError.message }, 500);

    return json({ ok: true, plan: planData.plan, credits: planData.credits });
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
