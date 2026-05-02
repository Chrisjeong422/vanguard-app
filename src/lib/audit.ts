import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function logAudit(
  action: string,
  req: Request,
  nickname?: string,
  details?: Record<string, unknown>
) {
  try {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";
    await supabaseAdmin.from("audit_logs").insert({
      action,
      ip_address: ip,
      user_agent: userAgent.slice(0, 200),
      nickname: nickname || null,
      details: details || {},
    });
  } catch {}
}
