import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { nickname, secret } = await req.json();
    if (secret !== process.env.NEXT_PUBLIC_ADMIN_PW && secret !== "vanguard2024!") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!nickname) {
      return NextResponse.json({ error: "nickname required" }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin.from("users").select("*").eq("nickname", nickname).single();
    if (!existing) {
      await supabaseAdmin.from("users").insert([{
        nickname,
        plan: "ultra",
        goal: "이번 달 목표 달성",
      }]);
    }

    const records = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toISOString().split("T")[0];
      const dayOfWeek = d.getDay();

      records.push({
        nickname,
        date: dateStr,
        task: ["발표 자료 정리", "코드 리뷰", "이메일 답장", "운동 30분", "독서 20분", "프로젝트 기획", "블로그 작성"][i],
        done: true,
        hour_of_day: 9 + Math.floor(Math.random() * 3),
      });

      if (dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6) {
        records.push({
          nickname,
          date: dateStr,
          task: ["심화 학습", "사이드 프로젝트", "영어 공부"][i % 3],
          done: false,
          fail_reason: ["피곤", "집중력 부족", "피곤"][i % 3],
          hour_of_day: 20 + Math.floor(Math.random() * 2),
        });
      }
    }

    await supabaseAdmin.from("execution_records").delete().eq("nickname", nickname);
    await supabaseAdmin.from("execution_records").insert(records);

    return NextResponse.json({
      success: true,
      message: `Demo account "${nickname}" ready. ${records.length} records created.`,
      records_count: records.length,
    });
  } catch (err) {
    return NextResponse.json({ error: "setup failed" }, { status: 500 });
  }
}
