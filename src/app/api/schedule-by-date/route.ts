import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const nickname = searchParams.get("nickname");
    const date = searchParams.get("date");
    if (!nickname || !date) return NextResponse.json({ schedule: null });

    const { data } = await supabaseAdmin
      .from("daily_schedules")
      .select("*")
      .eq("nickname", nickname)
      .eq("schedule_date", date)
      .maybeSingle();

    return NextResponse.json({ schedule: data || null });
  } catch (e: any) {
    return NextResponse.json({ schedule: null, error: e.message }, { status: 500 });
  }
}
