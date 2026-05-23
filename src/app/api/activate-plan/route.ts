import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { nickname, plan, payment_id, payment_provider } = await req.json();
    
    if (!nickname || !plan) {
      return NextResponse.json({ error: "nickname and plan required" }, { status: 400 });
    }
    
    if (!["pro", "ultra"].includes(plan)) {
      return NextResponse.json({ error: "invalid plan" }, { status: 400 });
    }

    // 유저 플랜 업데이트
    const { error } = await supabaseAdmin
      .from("users")
      .update({ 
        plan,
        plan_activated_at: new Date().toISOString(),
        payment_id: payment_id || null,
        payment_provider: payment_provider || null,
      })
      .eq("nickname", nickname);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 결제 로그 저장
    await supabaseAdmin.from("ai_logs").insert([{
      nickname,
      log_type: "plan_activated",
      input_data: { plan, payment_id, payment_provider },
      output_data: { success: true },
      context: { activated_at: new Date().toISOString() },
    }]);

    return NextResponse.json({ success: true, plan });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
