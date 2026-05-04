import { NextRequest, NextResponse } from "next/server";

import { createClient as createAuthClient } from "@supabase/supabase-js";

async function getAuthNickname(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("cookie") || "";
  const supabaseAuth = createAuthClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const accessToken = authHeader.match(/sb-[^=]+-auth-token=([^;]+)/)?.[1];
  if (!accessToken) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(accessToken));
    const token = decoded?.[0] || decoded;
    const { data: { user } } = await supabaseAuth.auth.getUser(typeof token === 'string' ? token : token?.access_token);
    if (!user) return null;
    const nickname = user.user_metadata?.nickname;
    return nickname || null;
  } catch {
    return null;
  }
}

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


function sanitizeNickname(nick: unknown): string | null {
  if (typeof nick !== "string") return null;
  const trimmed = nick.trim();
  if (trimmed.length === 0 || trimmed.length > 50) return null;
  // SQL injection, XSS 방지
  if (/[<>'";\/\\]/.test(trimmed)) return null;
  return trimmed;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  const nickname = req.nextUrl.searchParams.get("nickname");
  if (!nickname) return NextResponse.json({ error: "닉네임 필요" }, { status: 400 });
  if (sanitizeNickname(nickname) === null) return NextResponse.json({ error: "잘못된 닉네임" }, { status: 400 });

  const weekStart = req.nextUrl.searchParams.get("week") || getWeekStart();

  const { data: review } = await supabaseAdmin
    .from("weekly_reviews")
    .select("*")
    .eq("nickname", nickname)
    .eq("week_start", weekStart)
    .single();

  const { data: history } = await supabaseAdmin
    .from("weekly_reviews")
    .select("week_start, avg_daily_score, completed_tasks, total_tasks, status")
    .eq("nickname", nickname)
    .order("week_start", { ascending: false })
    .limit(4);

  return NextResponse.json({ review, history });
}

export async function POST(req: NextRequest) {
  const { nickname } = await req.json();
  if (!nickname) return NextResponse.json({ error: "닉네임 필요" }, { status: 400 });

  // 플랜 확인
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("plan, nickname")
    .eq("nickname", nickname)
    .single();

  if (user?.plan !== "ultra") {
    return NextResponse.json({ error: "Ultra 플랜 전용 기능입니다." }, { status: 403 });
  }

  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);

  // 이번 주 기록 수집
  const { data: records } = await supabaseAdmin
    .from("execution_records")
    .select("*")
    .eq("nickname", nickname)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  const completed = records?.filter(r => r.done).length || 0;
  const failed = records?.filter(r => !r.done).length || 0;
  const total = records?.length || 0;

  // 요일별 분석
  const dailyMap: Record<string, { done: number; fail: number }> = {};
  records?.forEach(r => {
    if (!dailyMap[r.date]) dailyMap[r.date] = { done: 0, fail: 0 };
    if (r.done) dailyMap[r.date].done++;
    else dailyMap[r.date].fail++;
  });

  // 실패 이유 분석
  const failReasons = records
    ?.filter(r => !r.done && r.fail_reason)
    .map(r => r.fail_reason) || [];

  // 시간대별 실패
  const failByHour: Record<number, number> = {};
  records?.filter(r => !r.done && r.hour_of_day !== undefined).forEach(r => {
    failByHour[r.hour_of_day!] = (failByHour[r.hour_of_day!] || 0) + 1;
  });

  const prompt = `너는 Vanguard 앱의 주간 코치다. 절대 부드럽게 말하지 마. 팩트만 말해.

유저: ${nickname}
기간: ${weekStart} ~ ${weekEnd}

이번 주 데이터:
- 완료: ${completed}개, 실패: ${failed}개, 총: ${total}개
- 일별 기록: ${JSON.stringify(dailyMap)}
- 실패 이유들: ${failReasons.join(", ") || "없음"}
- 시간대별 실패: ${JSON.stringify(failByHour)}

JSON으로만 응답해. 다른 텍스트 없이 JSON만.
{
  "summary": "이번 주를 한 문장으로 (솔직하고 날카롭게)",
  "wins": ["잘한 점 최대 3개"],
  "failures": ["실패한 점 최대 3개, 원인 포함"],
  "root_cause": "반복 실패의 근본 원인 한 줄",
  "energy_pattern": {
    "best_time": "가장 잘한 시간대",
    "worst_time": "가장 무너진 시간대",
    "insight": "패턴에서 발견한 것"
  },
  "next_week_focus": "다음 주 딱 하나만 집중할 것",
  "adjustments": ["구체적 조정 사항 최대 3개"],
  "danger_prediction": "다음 주 가장 위험한 요일과 시간",
  "pressure_message": "각성 메시지 (현실적이고 압박감 있게)"
}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2000, temperature: 0.7 },
        }),
      }
    );

    const geminiData = await geminiRes.json();
    let aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    aiText = aiText.replace(/```json\n?|```\n?/g, "").trim();
    const aiAnalysis = JSON.parse(aiText);

    const avgScore = total > 0 ? Math.round((completed / total) * 100) : 0;

    await supabaseAdmin
      .from("weekly_reviews")
      .delete()
      .eq("nickname", nickname)
      .eq("week_start", weekStart);

    const { data: review, error } = await supabaseAdmin
      .from("weekly_reviews")
      .insert({
        nickname,
        week_start: weekStart,
        week_end: weekEnd,
        total_score: completed * 20 - failed * 10,
        avg_daily_score: avgScore,
        completed_tasks: completed,
        total_tasks: total,
        streak_days: Object.keys(dailyMap).length,
        ai_analysis: aiAnalysis,
        status: "generated",
      })
      .select()
      .single();
    if (error) throw error;
    if (error) throw error;

    return NextResponse.json({ review });
  } catch (err) {
    console.error("[WeeklyReview] Error:", err);
    return NextResponse.json({ error: "주간 리뷰 생성 실패" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { nickname, weekStart, reflection, commitment } = await req.json();

  const { data, error } = await supabaseAdmin
    .from("weekly_reviews")
    .update({
      user_reflection: reflection || "",
      next_week_commitment: commitment || "",
      status: "reviewed",
      updated_at: new Date().toISOString(),
    })
    .eq("nickname", nickname)
    .eq("week_start", weekStart)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "저장 실패" }, { status: 500 });

  return NextResponse.json({ review: data });
}
