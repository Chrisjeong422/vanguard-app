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

export async function GET(req: NextRequest) {
  // 입력 검증
  const rawNick = req.nextUrl.searchParams.get("nickname");
  const nickname = sanitizeNickname(rawNick);
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().split("T")[0];
  if (!nickname) return NextResponse.json({ error: "닉네임 필요" }, { status: 400 });

  const { data: schedule } = await supabaseAdmin
    .from("daily_schedules")
    .select("*")
    .eq("nickname", nickname)
    .eq("schedule_date", date)
    .single();

  return NextResponse.json({ schedule });
}


  const fallbackBlocks = [
    { id: "fb1", start: "07:00", end: "07:30", type: "routine", title: "모닝 루틴", description: "세수 + 스트레칭 + 물 한잔", priority: "high", energy_required: "low", is_completed: false, completed_at: null },
    { id: "fb2", start: "07:30", end: "08:00", type: "meal", title: "아침 식사", description: "간단한 아침", priority: "medium", energy_required: "low", is_completed: false, completed_at: null },
    { id: "fb3", start: "08:00", end: "09:30", type: "deep_work", title: "오전 집중 시간", description: "가장 중요한 일 1개", priority: "high", energy_required: "high", is_completed: false, completed_at: null },
    { id: "fb4", start: "09:30", end: "09:45", type: "break", title: "휴식", description: "스트레칭 + 물", priority: "low", energy_required: "low", is_completed: false, completed_at: null },
    { id: "fb5", start: "09:45", end: "11:15", type: "deep_work", title: "오전 집중 2", description: "두 번째 중요한 일", priority: "high", energy_required: "high", is_completed: false, completed_at: null },
    { id: "fb6", start: "12:00", end: "13:00", type: "meal", title: "점심 식사", description: "점심 + 휴식", priority: "medium", energy_required: "low", is_completed: false, completed_at: null },
    { id: "fb7", start: "13:00", end: "14:30", type: "task", title: "오후 태스크", description: "가벼운 업무 처리", priority: "medium", energy_required: "medium", is_completed: false, completed_at: null },
    { id: "fb8", start: "14:30", end: "14:45", type: "break", title: "휴식", description: "산책 또는 스트레칭", priority: "low", energy_required: "low", is_completed: false, completed_at: null },
    { id: "fb9", start: "18:00", end: "19:00", type: "meal", title: "저녁 식사", description: "저녁 + 휴식", priority: "medium", energy_required: "low", is_completed: false, completed_at: null },
    { id: "fb10", start: "22:00", end: "23:00", type: "review", title: "하루 마무리", description: "오늘 돌아보기 + 내일 준비", priority: "medium", energy_required: "low", is_completed: false, completed_at: null },
  ];

export async function POST(req: NextRequest) {
  // 입력 검증
  const { nickname: reqNick, date: targetDate } = await req.json();
  const authNick = await getAuthNickname(req);
  const nickname = authNick || reqNick;
  if (!nickname) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (sanitizeNickname(nickname) === null) return NextResponse.json({ error: "잘못된 닉네임" }, { status: 400 });

  const today = targetDate || new Date().toISOString().split("T")[0];
  const dayOfWeek = new Date(today).toLocaleDateString("ko-KR", { weekday: "long" });

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("plan, goal, nickname")
    .eq("nickname", nickname)
    .single();

  const { data: schedules } = await supabaseAdmin
    .from("schedules")
    .select("*")
    .eq("nickname", nickname)
    .eq("due_date", today);

  const existingSchedules = schedules?.map(s => `${s.due_time || ""} ${s.title}`).join(", ") || "없음";

  const prompt = `하루 스케줄을 JSON으로 만들어. 목표: ${user?.goal || "없음"}. 날짜: ${today}(${dayOfWeek}). 일정: ${existingSchedules}. 블록 10개. JSON만 출력. {"wake_time":"07:00","sleep_time":"23:00","strategy":"전략","blocks":[{"id":"b1","start":"07:00","end":"07:30","type":"routine","title":"제목","description":"설명","priority":"medium","energy_required":"low"}],"risk_slots":["위험시간"],"top_priority":"최우선1개"}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 8000, temperature: 0.7 },
        }),
      }
    );

    if (!geminiRes.ok) {
      console.error("[Schedule] Gemini HTTP error:", geminiRes.status);
      console.log("[Schedule] AI failed, using fallback");
    }

    const geminiData = await geminiRes.json();
    console.log("[Schedule] finish:", geminiData?.candidates?.[0]?.finishReason);
    console.log("[Schedule] tokens:", geminiData?.usageMetadata?.candidatesTokenCount);

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      console.error("[Schedule] Empty response");
      console.log("[Schedule] Empty response, using fallback");
    }

    const aiText = rawText.replace(/```json\n?|```\n?/g, "").trim();

    let scheduleData;
    try {
      scheduleData = JSON.parse(aiText);
    } catch {
      console.error("[Schedule] Parse fail, text:", aiText.slice(0, 300));
      console.log("[Schedule] Parse failed, using fallback");
    }

    const blocks = (scheduleData.blocks || []).map((block: Record<string, unknown>) => ({
      ...block,
      is_completed: false,
      completed_at: null,
    }));

    console.log("[Schedule] Blocks:", blocks.length);

    await supabaseAdmin
      .from("daily_schedules")
      .delete()
      .eq("nickname", nickname)
      .eq("schedule_date", today);

    const { data: schedule, error } = await supabaseAdmin
      .from("daily_schedules")
      .insert({
        nickname,
        schedule_date: today,
        wake_time: scheduleData.wake_time || "07:00",
        sleep_time: scheduleData.sleep_time || "23:00",
        blocks,
        generation_context: {
          strategy: scheduleData.strategy || "",
          risk_slots: scheduleData.risk_slots || [],
          top_priority: scheduleData.top_priority || "",
        },
        total_blocks: blocks.length,
        completed_blocks: 0,
        adherence_score: 0,
        status: "generated",
      })
      .select()
      .single();

    if (error) {
      console.error("[Schedule] DB error:", error);
      throw error;
    }

    return NextResponse.json({ schedule });
  } catch (err) {
    console.error("[Schedule] Error:", err);
    // fallback 스케줄 저장
    await supabaseAdmin.from("daily_schedules").delete().eq("nickname", nickname).eq("schedule_date", today);
    const { data: fbSchedule } = await supabaseAdmin.from("daily_schedules").insert({
      nickname, schedule_date: today, wake_time: "07:00", sleep_time: "23:00",
      blocks: fallbackBlocks,
      generation_context: { strategy: "기본 스케줄입니다. 다시 생성을 눌러주세요.", risk_slots: [], top_priority: "오늘 가장 중요한 일 1개 시작하기" },
      total_blocks: fallbackBlocks.length, completed_blocks: 0, adherence_score: 0, status: "generated",
    }).select().single();
    if (fbSchedule) return NextResponse.json({ schedule: fbSchedule });
    return NextResponse.json({ error: "스케줄 생성 실패" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { scheduleId, blockId, action, newBlock } = await req.json();

  const { data: schedule } = await supabaseAdmin
    .from("daily_schedules")
    .select("*")
    .eq("id", scheduleId)
    .single();

  if (!schedule) return NextResponse.json({ error: "스케줄 없음" }, { status: 404 });

  let updatedBlocks = [...(schedule.blocks || [])];

  if (action === "complete") {
    updatedBlocks = updatedBlocks.map((b: Record<string, unknown>) =>
      b.id === blockId ? { ...b, is_completed: true, completed_at: new Date().toISOString() } : b
    );
  } else if (action === "skip") {
    updatedBlocks = updatedBlocks.map((b: Record<string, unknown>) =>
      b.id === blockId ? { ...b, is_completed: false, skipped: true } : b
    );
  }else if (action === "add" && newBlock) {
    updatedBlocks = [...updatedBlocks, newBlock].sort((a: any, b: any) => (a.start || "").localeCompare(b.start || ""));
  } else if (action === "delete") {
    updatedBlocks = updatedBlocks.filter((b: Record<string, unknown>) => b.id !== blockId);
  }

  const completedCount = updatedBlocks.filter((b: Record<string, unknown>) => b.is_completed).length;
  const adherence = updatedBlocks.length > 0 ? (completedCount / updatedBlocks.length) * 100 : 0;

  const { data: updated, error } = await supabaseAdmin
    .from("daily_schedules")
    .update({
      blocks: updatedBlocks,
      completed_blocks: completedCount,
      adherence_score: adherence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "업데이트 실패" }, { status: 500 });

  return NextResponse.json({ schedule: updated });
}
