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
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function GET(req: NextRequest) {
  // 입력 검증
  const rawNick = req.nextUrl.searchParams.get("nickname");
  const nickname = sanitizeNickname(rawNick);
  const kstDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const date = req.nextUrl.searchParams.get("date") || `${kstDate.getFullYear()}-${String(kstDate.getMonth()+1).padStart(2,"0")}-${String(kstDate.getDate()).padStart(2,"0")}`;
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
  const { nickname: reqNick, date: targetDate, difficulty, recentSuccess, recentFail, avgDuration } = await req.json();
  const authNick = await getAuthNickname(req);
  const nickname = authNick || reqNick;
  if (!nickname) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  if (sanitizeNickname(nickname) === null) return NextResponse.json({ error: "잘못된 닉네임" }, { status: 400 });

  const kstNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const today = targetDate || `${kstNow.getFullYear()}-${String(kstNow.getMonth()+1).padStart(2,"0")}-${String(kstNow.getDate()).padStart(2,"0")}`;
  
  const kstHour = kstNow.getHours();
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


  // 유저 프로필 가져오기
  const { data: userProfile } = await supabaseAdmin.from("users").select("occupation, focus_time, obstacle, goal, age, personality, want_to_do, priority, free_time").eq("nickname", nickname).single();
  const occupation = userProfile?.occupation || "";
  const focusTime = userProfile?.focus_time || "";
  const obstacle = userProfile?.obstacle || "";
  const age = userProfile?.age || "";
  const personality = userProfile?.personality || "";
  const wantToDo = userProfile?.want_to_do || "";
  const priority = userProfile?.priority || "";
  const freeTime = userProfile?.free_time || "";
  const userGoal = userProfile?.goal || user?.goal || "없음";
  const focusLabel = focusTime === "morning" ? "아침6-9시" : focusTime === "forenoon" ? "오전9-12시" : focusTime === "afternoon" ? "오후12-18시" : focusTime === "evening" ? "저녁18시이후" : "미설정";
  const profileContext = occupation || age ? `유저를 깊이 이해해라. 나이=${age}, 성격=${personality}, 실행유형=${occupation}, 집중시간=${focusLabel}, 하고싶은것=${wantToDo}, 방해요소=${obstacle}, 하루자유시간=${freeTime}, 가장중요한것=${priority}. 이 사람의 성격과 나이에 맞는 톤과 미션을 만들어라. 자유시간이 적으면 미션 개수를 줄이고, 방해요소를 피하는 전략을 짜라. 집중 잘 되는 시간에 중요한 미션을 배치해라.` : "";
  const goalContext = userGoal !== "없음" 
    ? "유저목표: " + userGoal + ". 이 목표 달성을 위한 구체적 행동 미션을 만들어라. 래퍼면 가사4줄쓰기, 수능생이면 수학10문제, 다이어트면 스쿼트20개 같은 구체적 미션."
    : "유저는 아직 목표가 없다. 절대 '목표를 정하세요'라고 하지 마라. 대신 AI인 네가 유저의 프로필(직업, 집중시간, 실행유형)을 분석해서 오늘 당장 할 수 있는 아주 작고 구체적인 행동을 직접 정해줘라. 예: 물 한 잔 마시기, 책상 정리 3분, 스트레칭 5개, 오늘 할 일 1개 적어보기, 산책 10분. 목표가 없는 사람일수록 더 쉽고 부담 없는 것부터 시작시켜서 '시작하는 경험' 자체를 만들어줘라. 작은 성공이 쌓이면 방향이 보인다.";
  const difficultyGuide = difficulty === "high" ? "유저가 최근 연속 성공 중이다. 미션 시간을 평소보다 10~20% 늘려라. 도전적인 미션을 포함해라." : difficulty === "low" ? "유저가 최근 연속 실패 중이다. 미션을 극단적으로 줄여라. 3분~5분짜리 미션 위주로 구성해라. 시작의 마찰을 최소화해라." : "보통 수준으로 구성해라.";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTime = `${String(currentHour).padStart(2,"0")}:${String(currentMin).padStart(2,"0")}`;
  const remainingHours = Math.max(1, 23 - currentHour);
  const timeContext = currentHour >= 20 ? "지금은 저녁 늦은 시간이다. 오늘 남은 시간에 할 수 있는 가벼운 미션 1~3개만 만들어라. 취침 준비도 포함해라." : currentHour >= 17 ? "지금은 저녁 시간이다. 오늘 남은 시간에 집중할 수 있는 미션 3~5개를 만들어라." : currentHour >= 12 ? "지금은 오후다. 오후~저녁 시간에 할 미션을 만들어라." : "아침부터 시작하는 하루 전체 스케줄을 만들어라.";
  const prompt = `너는 세계 최고의 실행 코치다. 유저의 하루 스케줄을 JSON으로 만들어라.

현재 시간: ${currentTime}. ${timeContext}
${profileContext}
${goalContext}
목표: ${userGoal}. 날짜: ${today}(${dayOfWeek}).
기존 일정: ${existingSchedules}.
${difficultyGuide}
최근 성공 ${recentSuccess || 0}회, 실패 ${recentFail || 0}회, 평균 집중시간 ${avgDuration || 15}분.

핵심 규칙:
1. 현재 시간(${currentTime}) 이후의 블록만 만들어라. 지나간 시간은 절대 만들지 마라.
2. 블록 개수는 이 사람에게 진짜 필요한 만큼만 만들어라. 억지로 3개를 채우거나 8개로 늘리지 마라. 자유시간이 적으면 1~2개도 좋다. 시간을 채우려고 의미 없는 블록을 만들지 마라. 알찬 2개가 대충 6개보다 낫다.
3. 미션 제목은 반드시 구체적인 행동이어야 한다. "30분 집중", "독서 준비" 같은 애매한 제목 금지.
4. 좋은 예: "팔굽혀펴기 20개", "영어 단어 30개 암기", "보고서 서론 500자 쓰기", "스쿼트 3세트", "코드 리뷰 3개"
5. 나쁜 예: "운동하기", "공부하기", "독서", "집중 시간", "휴식 및 정리"
6. 유저 목표가 있으면 그 목표에 직접 연결되는 미션을 만들어라. 다이어트면 운동+식단, 공부면 과목별 구체적 분량.
7. 목표가 없는 유저에게 무성의하게 "물 한 잔" 같은 것만 주지 마라. 이 사람의 나이/성격/상황을 보고 삶의 질을 높이는 의미 있는 활동을 제안해라. 예: "20분 산책 - 머리가 맑아지고 기분이 나아져요", "오늘 가장 미뤘던 일 1개 - 이것만 해도 마음이 가벼워져요", "방 정리 15분 - 공간이 정리되면 생각도 정리돼요". 부담은 적되 의미는 있게.
8. 블록 사이 간격을 일괄로 정하지 마라(10분 같은 식 금지). 미션 성격과 이 유저의 평균 집중시간(${avgDuration || 15}분), 실행 속도를 분석해서 자연스럽게 배치해라. 짧은 일은 붙이고, 힘든 일 뒤엔 쉬게 해라.
9. 각 미션이 실제로 그 시간 안에 가능한지 따져라. 무리한 일정 금지. 30분 걸릴 일에 10분만 주지 마라.
10. description에는 "왜 이걸 해야 하는지"를 이 사람의 목표/상황과 연결해서 한 줄로 써라.
11. strategy와 top_priority에 이 유저의 목표와 상황을 직접 언급해서 "이건 나만을 위한 계획"이라고 느끼게 만들어라.

JSON만 출력. 다른 텍스트 쓰지 마라.
{"wake_time":"기상시간 추정","sleep_time":"유저 취침시간 추정(집중시간이 저녁/밤이면 늦게, 아침형이면 일찍)","strategy":"오늘의 전략 한 줄","blocks":[{"id":"b1","start":"${currentTime}","end":"${String(currentHour).padStart(2,"0")}:30","type":"task","title":"구체적 행동","description":"왜 해야 하는지","priority":"high","energy_required":"medium"}],"risk_slots":["위험시간"],"top_priority":"오늘 가장 중요한 1개"}`;

  try {
    const claudeMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const rawText = claudeMsg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => (b as any).text)
      .join("\n");
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
