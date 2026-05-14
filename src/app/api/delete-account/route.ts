import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { userId } = await req.json();
    
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 모든 유저 데이터 삭제
    await supabaseAdmin.from("execution_records").delete().eq("user_id", userId);
    await supabaseAdmin.from("schedules").delete().eq("user_id", userId);
    await supabaseAdmin.from("daily_schedules").delete().eq("user_id", userId);
    await supabaseAdmin.from("weekly_reviews").delete().eq("user_id", userId);
    await supabaseAdmin.from("user_events").delete().eq("user_id", userId);
    await supabaseAdmin.from("audit_logs").delete().eq("user_id", userId);
    await supabaseAdmin.from("inquiries").delete().eq("user_id", userId);
    await supabaseAdmin.from("users").delete().eq("id", userId);

    // Auth 유저 삭제
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
