import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function kstDateStr(ms: number) {
  const k = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, "0")}-${String(k.getDate()).padStart(2, "0")}`;
}

export async function GET() {
  try {
    const weekAgo = kstDateStr(Date.now() - 7 * 86400000);

    // 모든 유저
    const { data: users } = await supabaseAdmin.from("users").select("nickname");
    // 이번 주 완료 기록
    const { data: recs } = await supabaseAdmin
      .from("execution_records")
      .select("nickname, done, date, xp_earned")
      .gte("date", weekAgo);

    const xpByUser: Record<string, number> = {};
    if (users) {
      users.forEach((u: any) => { if (u.nickname) xpByUser[u.nickname] = 0; });
    }
    if (recs) {
      recs.forEach((r: any) => {
        if (r.done && r.nickname) {
          const xp = (r.xp_earned !== null && r.xp_earned !== undefined) ? r.xp_earned : 10;
          xpByUser[r.nickname] = (xpByUser[r.nickname] || 0) + xp;
        }
      });
    }

    const board = Object.entries(xpByUser)
      .map(([nickname, xp]) => ({ nickname, xp }))
      .sort((a, b) => b.xp - a.xp);

    return NextResponse.json({ leaderboard: board });
  } catch (e: any) {
    return NextResponse.json({ leaderboard: [], error: e.message }, { status: 500 });
  }
}
