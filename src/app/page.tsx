"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase,
  getUser,
  createUser,
  saveRecord,
  getRecords,
  calcStreak,
  calcFailCount,
  saveSchedule,
  getSchedules,
  getTomorrowSchedules,
  updateGoal,
  getGoal,
  type ExecutionRecord,
  deleteSchedule,
  toggleScheduleDone,
  type Schedule,
} from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Tab = "home" | "briefing" | "analysis" | "settings";
type HomeMode = "mission_input" | "running" | "done" | "fail";

// ── 유저 상태 타입 ──
type UserState = {
  lastSuccess: boolean;
  failStreak: number;
  currentHour: number;
  todayCompleted: boolean;
  consecutiveFails: number;
  thisWeekFails: number;
};

// ── 1. 로그인 시 메시지 ──
function getLoginMessage(state: UserState): { message: string; sub: string; level: "success" | "warning" | "critical" } | null {
  if (state.todayCompleted) return null;

  if (state.consecutiveFails >= 3) return {
    message: `${state.consecutiveFails}일 연속이다. 이건 습관으로 굳는 구간이다.`,
    sub: "근데 이건 끊을 수 있다. 지금 시작하면 오늘부터 바뀐다.",
    level: "critical"
  };
  if (state.consecutiveFails >= 2) return {
    message: "이틀 연속이다. 혼자서 끊기 어려운 구간이다.",
    sub: "근데 이건 끊을 수 있다. 지금 시작하면 아직 살릴 수 있다.",
    level: "critical"
  };
  if (!state.lastSuccess && state.failStreak >= 1) return {
    message: "어제 놓쳤다. 오늘까지 놓치면 패턴 된다.",
    sub: "이건 끊을 수 있다. 지금 시작하면 오늘 복구된다.",
    level: "critical"
  };
  if (state.lastSuccess) return {
    message: "어제 했다. 오늘도 이어가면 된다.",
    sub: "지금 streak 이어가면 이번 주 흐름 잡는다.",
    level: "success"
  };
  return null;
}

// ── Pattern Breaker — 위험 시간 선제 개입 ──
function getRiskyHour(records: {done: boolean, hour_of_day?: number}[]): number | null {
  const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
  if (failsByHour.length < 3) return null;
  const hourCounts: Record<number, number> = {};
  failsByHour.forEach(r => {
    const h = r.hour_of_day!;
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  });
  const sorted = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]));
  return Number(sorted[0][0]);
}

function getPatternBreakerMessage(currentHour: number, riskyHour: number | null, userPlan: string): {
  show: boolean;
  message: string;
  sub: string;
} {
  if (!riskyHour || userPlan === "free") return { show: false, message: "", sub: "" };
  const diff = riskyHour - currentHour;
  if (diff === 1) return {
    show: true,
    message: `너는 ${riskyHour}시에 항상 무너진다. 1시간 남았다.`,
    sub: "지금 3분만 먼저 시작하면 그 시간을 넘길 수 있다.",
  };
  if (diff === 0) return {
    show: true,
    message: `지금이 너가 항상 무너지는 시간이다.`,
    sub: "이 시간을 버텨내면 오늘은 이긴다. 지금 시작해라.",
  };
  if (diff === -1) return {
    show: true,
    message: `위험 시간을 지나고 있다. 아직 늦지 않았다.`,
    sub: "지금 바로 복귀하면 오늘 살릴 수 있다.",
  };
  return { show: false, message: "", sub: "" };
}

// ── 2. 시간대별 압박 메시지 ──
function getUrgencyMessage(hour: number, failCount: number, goal: string) {
  const baseProb = Math.max(15, Math.min(85, 80 - failCount * 8 - Math.max(0, hour - 9) * 2));
  const dropProb = Math.max(5, baseProb - 21);

  if (failCount >= 5) return {
    headline: `이번 달 ${failCount}번. 같은 패턴이 반복되고 있다.`,
    sub: "이 패턴 계속 가면 이번 달 목표 못 이룬다. 지금 복귀 안 하면 오늘 완전히 끝난다.",
    dangerLevel: 99, dangerText: "패턴 반복 — 지금 안 끊으면 이달 끝",
  };
  if (failCount >= 3) return {
    headline: `이번 달 ${failCount}번째 같은 시간에 무너지고 있다.`,
    sub: "넌 이미 망하고 있는 중이다. 지금 안 하면 오늘도 똑같이 끝난다.",
    dangerLevel: Math.min(99, 75 + failCount * 4),
    dangerText: "이 패턴 지금 안 끊으면 이달 끝",
  };
  if (hour >= 23) return {
    headline: "지금 안 하면 오늘 끝이다.",
    sub: "오늘 핵심 1개도 못 끝냈다. 지금 10분만 해라.",
    dangerLevel: 99, dangerText: "오늘 완전 실패 직전",
  };
  if (hour >= 22) return {
    headline: "오늘도 놓치면 이 패턴 반복된다.",
    sub: "지금 30분만 해라. 안 하면 내일도 같은 자리다.",
    dangerLevel: 97, dangerText: "오늘 실패 확정 — 지금이 진짜 마지막",
  };
  if (hour >= 20) return {
    headline: "오늘 2시간 남았다. 지금이 진짜 마지막이다.",
    sub: "이미 늦었다. 근데 지금 시작하면 아직 살릴 수 있다.",
    dangerLevel: 94, dangerText: "오늘 실패 직전 — 지금 아니면 없다",
  };
  if (hour >= 18) return {
    headline: "저녁이 왔다. 지금이 마지막 정상 구간이다.",
    sub: `지금 안 하면 오늘 밀린다. 이 시간 넘기면 성공 확률 ${dropProb}%로 떨어진다.`,
    dangerLevel: 82, dangerText: "저녁 지나면 오늘 시작 불가",
  };
  if (hour >= 16) return {
    headline: "오후가 가고 있다. 지금이 마지막 타이밍이다.",
    sub: `이 시간 놓치면 오늘 실패 확정이다.`,
    dangerLevel: 74, dangerText: "지금이 유일한 착수 타이밍",
  };
  if (hour >= 14) return {
    headline: "이미 늦기 시작했다. 지금 안 하면 저녁에 더 힘들어진다.",
    sub: `오후 넘기면 또 밤에 포기한다.`,
    dangerLevel: 58, dangerText: "이 시간 지나면 시작 확률 급감",
  };
  if (hour >= 12) return {
    headline: "오전은 갔다. 지금이 오늘 마지막 골든타임이다.",
    sub: `지금 미루면 오늘 성공 확률 절반으로 떨어진다.`,
    dangerLevel: 48, dangerText: "지금 안 하면 오늘 기회 없다",
  };
  if (hour >= 9) return {
    headline: goal ? `"${goal}" — 오늘 뭘 할지 정했나?` : "오전이 가장 중요하다. 지금 시작해라.",
    sub: "지금 시작하면 오늘 쉽게 간다.",
    dangerLevel: 28, dangerText: "지금이 오늘 최고의 타이밍",
  };
  return {
    headline: "하루가 시작됐다. 지금 첫 번째 행동을 해라.",
    sub: `오전을 잡으면 하루가 달라진다.`,
    dangerLevel: 20, dangerText: "오전이 하루를 결정한다",
  };
}

// ── 3. 복귀 프로토콜 ──
function getRecoveryProtocol(failReason: string) {
  const protocols: Record<string, string> = {
    "집중력 부족": "폰 뒤집어라. 지금 당장 타이머 3분 눌러라. 생각하지 마.",
    "시간 없음": "거짓말하지 마라. 3분은 있다. 지금 열기만 해라.",
    "피곤": "피곤해서 못 하는 게 아니다. 시작이 무서운 거다. 30초만 열어라.",
    "의욕 없음": "의욕 기다리면 평생 못 한다. 지금 열기만 해라. 의욕은 시작 후에 온다.",
    "기타": "이유 없다. 지금 30초만 시작해라. 그게 전부다.",
  };
  for (const [key, msg] of Object.entries(protocols)) {
    if (failReason.includes(key)) return msg;
  }
  return "변명 그만해라. 지금 30초만 시작하면 된다.";
}

function getABMessage(nickname: string): "A" | "B" {
  const code = nickname.charCodeAt(0) || 0;
  return code % 2 === 0 ? "A" : "B";
}

function getFailMessage(variant: "A" | "B", failCount: number, hour: number): string {
  const timeLabel = hour >= 20 ? "밤" : hour >= 16 ? "오후" : hour >= 12 ? "낮" : "오전";
  if (variant === "A") {
    if (failCount >= 3) return `이번 달 ${failCount}번째다. 지금 안 하면 오늘 끝이다.`;
    return `${timeLabel}에 또 멈췄다. 이 패턴 계속 반복 중이다.`;
  } else {
    if (failCount >= 3) return `이번 달 ${failCount}번 같은 패턴이다. 근데 지금 3분이면 끊을 수 있다.`;
    return `${timeLabel}에 멈췄다. 근데 이건 끊을 수 있다. 지금 3분만 해라.`;
  }
}

// ── 실행 중 실시간 개입 메시지 ──
function getRunningIntervention(elapsedSeconds: number, pressureMode: "strong" | "normal" | "gentle"): { show: boolean; message: string; type: "encourage" | "push" | "celebrate" } {
  if (pressureMode === "gentle") {
    if (elapsedSeconds === 300) return { show: true, message: "5분째! 잘하고 있어요. 이 흐름 유지해봐요.", type: "encourage" };
    if (elapsedSeconds === 600) return { show: true, message: "10분 돌파! 대단해요. 조금만 더 해봐요.", type: "celebrate" };
    if (elapsedSeconds === 900) return { show: true, message: "15분! 오늘 확실히 해내고 있어요.", type: "celebrate" };
    if (elapsedSeconds === 1800) return { show: true, message: "30분 집중! 정말 대단합니다.", type: "celebrate" };
  } else if (pressureMode === "normal") {
    if (elapsedSeconds === 300) return { show: true, message: "5분 경과. 집중 유지하세요.", type: "encourage" };
    if (elapsedSeconds === 600) return { show: true, message: "10분 돌파. 여기서 멈추면 아깝습니다.", type: "push" };
    if (elapsedSeconds === 900) return { show: true, message: "15분! 여기까지 온 거 멈추지 마세요.", type: "push" };
    if (elapsedSeconds === 1800) return { show: true, message: "30분 집중 완료. 완료 버튼을 누를 자격이 있습니다.", type: "celebrate" };
  } else {
    if (elapsedSeconds === 300) return { show: true, message: "5분. 아직 부족하다. 계속해라.", type: "push" };
    if (elapsedSeconds === 600) return { show: true, message: "10분. 여기서 멈추면 한 것도 아니다.", type: "push" };
    if (elapsedSeconds === 900) return { show: true, message: "15분 버텼다. 근데 아직 끝 아니다.", type: "push" };
    if (elapsedSeconds === 1800) return { show: true, message: "30분. 진짜로 했다. 이게 실행이다.", type: "celebrate" };
  }
  return { show: false, message: "", type: "encourage" };
}

// ── 실패 패턴 분석 ──
function getFailPattern(failCount: number, failReason: string, hour: number): string {
  const timeLabel = hour >= 20 ? "밤" : hour >= 16 ? "오후 늦게" : hour >= 12 ? "오후" : "오전";
  if (failCount >= 5) return `이번 달 ${failCount}번 같은 패턴으로 무너졌다. 너는 항상 이 시간에 무너진다.`;
  if (failCount >= 3) return `이번 달 ${failCount}번째 같은 ${timeLabel}에 실패다. 이건 우연이 아니라 패턴이다.`;
  if (failCount >= 2) return `이번 달 ${failCount}번째다. 이 패턴 지금 끊지 않으면 계속 간다.`;
  return "실패 기록됐다. 지금 바로 복귀하면 오늘 살릴 수 있다.";
}

// ── Pro 전환 유도 메시지 ──
function getProUpsellMessage(records: ExecutionRecord[], failCount: number, streak: number): { show: boolean; title: string; sub: string } {
  if (failCount >= 3) return {
    show: true,
    title: "같은 패턴이 3번 반복됐다",
    sub: "Pro의 패턴 분석이 왜 무너지는지 찾아준다"
  };
  if (records.length >= 7 && streak === 0) return {
    show: true,
    title: "일주일째 스트릭이 0이다",
    sub: "Pro가 무너지는 시간을 미리 잡아준다"
  };
  if (records.filter(r => r.done).length >= 5) return {
    show: true,
    title: "실행력이 생기고 있다",
    sub: "Pro로 이 흐름을 데이터로 만들어라"
  };
  return { show: false, title: "", sub: "" };
}

// ── 유저 상태 계산 ──
function calcUserState(records: ExecutionRecord[], hour: number): UserState {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const byDate: Record<string, boolean> = {};
  records.forEach(r => {
    if (byDate[r.date] === undefined) byDate[r.date] = r.done;
    else if (r.done) byDate[r.date] = true;
  });

  const todayCompleted = byDate[today] === true;
  const lastSuccess = byDate[yesterday] === true;

  let consecutiveFails = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() - 86400000 * i).toISOString().split("T")[0];
    if (byDate[d] === false) consecutiveFails++;
    else break;
  }

  const weekAgo = new Date(Date.now() - 86400000 * 7).toISOString().split("T")[0];
  const thisWeekFails = records.filter(r => !r.done && r.date >= weekAgo).length;
  const failStreak = records.filter(r => !r.done).length;

  return { lastSuccess, failStreak, currentHour: hour, todayCompleted, consecutiveFails, thisWeekFails };
}

export default function VanguardHome() {
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [homeMode, setHomeMode] = useState<HomeMode>("mission_input");
  const [mission, setMission] = useState("");
  const [currentMission, setCurrentMission] = useState("");
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [failReason, setFailReason] = useState("");
  const [showFailSelect, setShowFailSelect] = useState(false);

  const [nickname, setNickname] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [isGuest, setIsGuest] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  const [userType, setUserType] = useState<"planner" | "starter" | "repeater" | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("vanguard_user_type") as "planner" | "starter" | "repeater" | null;
    }
    return null;
  });
  const [pressureMode, setPressureMode] = useState<"strong" | "normal" | "gentle">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("vanguard_pressure") as "strong" | "normal" | "gentle") || "strong";
    }
    return "strong";
  });

  const [goal, setGoal] = useState("");
  const [userPlan, setUserPlan] = useState("free");
  const [goalInput, setGoalInput] = useState("");
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalSaving, setGoalSaving] = useState(false);

  const [aiCommand, setAiCommand] = useState("");
  const [aiUsedCount, setAiUsedCount] = useState(0);
  const [tomorrowLetter, setTomorrowLetter] = useState("");
  const [showInquiry, setShowInquiry] = useState(false);
  const [inquiryMsg, setInquiryMsg] = useState("");
  const [inquirySent, setInquirySent] = useState(false);
  const [yesterdayLetter, setYesterdayLetter] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBriefing, setAiBriefing] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingDate, setBriefingDate] = useState("");

  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [streak, setStreak] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tomorrowSchedules, setTomorrowSchedules] = useState<Schedule[]>([]);
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [weeklyReview, setWeeklyReview] = useState<any>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyExpanded, setWeeklyExpanded] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [dailySchedule, setDailySchedule] = useState<any>(null);
  const [scheduleGenerating, setScheduleGenerating] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [newBlockTitle, setNewBlockTitle] = useState("");
  const [newBlockStart, setNewBlockStart] = useState("");
  const [newBlockEnd, setNewBlockEnd] = useState("");
  const [weeklyReflection, setWeeklyReflection] = useState("");
  const [weeklyCommitment, setWeeklyCommitment] = useState("");
  const [weeklySaving, setWeeklySaving] = useState(false);

  // 실행 중 개입 메시지
  const [runningMessage, setRunningMessage] = useState("");
  const [runningMessageType, setRunningMessageType] = useState<"encourage" | "push" | "celebrate">("encourage");
  const [showRunningMessage, setShowRunningMessage] = useState(false);

  // 연속 개입 타이머 (실패 후)
  const [failTime, setFailTime] = useState<Date | null>(null);
  const [interventionMsg, setInterventionMsg] = useState("");

  // 복구 스케줄 제안
  const [recoverySchedule, setRecoverySchedule] = useState<{title: string; duration: string}[]>([]);

  const hour = new Date().getHours();
  const urgency = getUrgencyMessage(hour, failCount, goal);
  const today = new Date().toISOString().split("T")[0];

  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        const trial = localStorage.getItem("vanguard_guest_trial");
        if (!trial) {
          router.replace("/landing");
        } else {
          setIsGuest(true);
          setNickname("게스트");
          const now = new Date();
          const h = now.getHours();
          setDailySchedule({
            id: "guest",
            blocks: [
              { id: "g1", start: `${String(h).padStart(2,"0")}:00`, end: `${String(h).padStart(2,"0")}:30`, type: "task", title: "지금 할 수 있는 것 1개", description: "작은 것부터 시작하세요", is_completed: false },
              { id: "g2", start: `${String(h+1).padStart(2,"0")}:00`, end: `${String(h+1).padStart(2,"0")}:30`, type: "deep_work", title: "30분 집중", description: "가장 중요한 일에 집중", is_completed: false },
              { id: "g3", start: `${String(h+2).padStart(2,"0")}:00`, end: `${String(h+2).padStart(2,"0")}:15`, type: "break", title: "휴식", description: "잠깐 쉬고 다시 시작", is_completed: false },
            ],
            total_blocks: 3,
            completed_blocks: 0,
            generation_context: { top_priority: "지금 1개만 시작하기" },
          });
        }
      }
    });
  }, [router]);

  const loadUserData = useCallback(async (nick: string) => {
    const recs = await getRecords(nick);
    setRecords(recs);
    setStreak(calcStreak(recs));
    setFailCount(calcFailCount(recs));
    const schs = await getSchedules(nick);
    setSchedules(schs);
    const tmr = await getTomorrowSchedules(nick);
    setTomorrowSchedules(tmr);
    const user = await getUser(nick);
    setUserPlan(user?.plan || "free");
    const g = await getGoal(nick);
    setGoal(g);
    setGoalInput(g);

    if (recs.length === 0 && !g) {
      setIsNewUser(true);
    } else {
      setIsNewUser(false);
    }

    try {
      const today = new Date().toISOString().split("T")[0];
      const schedRes = await fetch(`/api/schedule?nickname=${nick}&date=${today}`);
      const schedData = await schedRes.json();
      if (schedData.schedule) {
        setDailySchedule(schedData.schedule);
      } else {
        const genRes = await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: nick }),
        });
        const genData = await genRes.json();
        if (genData.schedule) setDailySchedule(genData.schedule);
      }
    } catch (err) {
      console.error("Schedule auto-load failed:", err);
    }

    try {
      const weekRes = await fetch(`/api/weekly-review?nickname=${nick}`);
      const weekData = await weekRes.json();
      if (weekData.review) {
        setWeeklyReview(weekData.review);
        if (weekData.review.user_reflection) setWeeklyReflection(weekData.review.user_reflection);
        if (weekData.review.next_week_commitment) setWeeklyCommitment(weekData.review.next_week_commitment);
      }
    } catch (err) {
      console.error("Weekly review load failed:", err);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("vanguard_nickname");
    const letter = localStorage.getItem("vanguard_letter");
    const letterDate = localStorage.getItem("vanguard_letter_date");
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    if (letter && letterDate === yesterday) setYesterdayLetter(letter);
    if (saved) {
      setNickname(saved);
      setIsGuest(false);
      loadUserData(saved);
    }
  }, [loadUserData]);

  // 실패 후 연속 개입 타이머
  useEffect(() => {
    if (!failTime) return;
    const msgs = [
      { delay: 10 * 60 * 1000, msg: "아직 안 했다. 지금이라도 시작해라." },
      { delay: 30 * 60 * 1000, msg: "이렇게 해서 계속 무너진다. 3분만 시작해라." },
    ];
    const timers = msgs.map(({ delay, msg }) =>
      setTimeout(() => {
        if (homeMode === "fail") setInterventionMsg(msg);
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [failTime, homeMode]);

  async function handleSetNickname() {
    if (nicknameInput.trim().length < 2) return;
    setLoading(true);
    let user = await getUser(nicknameInput.trim());
    if (!user) user = await createUser(nicknameInput.trim());
    if (user) {
      const nick = nicknameInput.trim();
      localStorage.setItem("vanguard_nickname", nick);
      setNickname(nick);
      setIsGuest(false);
      setShowNicknameModal(false);
      await loadUserData(nick);
    }
    setLoading(false);
  }

  async function handleSaveGoal() {
    if (!goalInput.trim() || isGuest) return;
    setGoalSaving(true);
    await updateGoal(nickname, goalInput.trim());
    setGoal(goalInput.trim());
    setShowGoalModal(false);
    setGoalSaving(false);
  }

  async function generateBriefing() {
    if (schedules.length === 0 && !goal && records.length === 0) return;
    if (userPlan === "free" && aiUsedCount >= 4) { setAiBriefing("무료는 하루 4회까지 가능합니다. Pro로 업그레이드하면 무제한으로 사용할 수 있습니다."); return; }
    setBriefingLoading(true);
    setAiBriefing("");
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    const upcomingSchedules = schedules.slice(0, 5)
      .map(s => `${s.due_date === today ? "오늘" : s.due_date === tomorrow ? "내일" : s.due_date} ${s.due_time || ""} - ${s.title}`)
      .join(", ");
    const prompt = `너는 실행 코치다. 유저의 일정과 목표를 보고 현실적인 조언을 해. 로봇처럼 말하지 마. 친구처럼 솔직하게, 하지만 단호하게 말해. 목표: ${goal || "없음"}. 일정: ${upcomingSchedules || "없음"}. 오늘: ${today}. 이번달 실패: ${failCount}회. 이 형식으로만 답해: [긴급]: 오늘 가장 먼저 해야 하는 이유 1줄 (구체적으로) [오늘 1개]: 오늘 꼭 해야 할 행동 1개 (20자 이내) [안 하면]: 안 했을 때 실제로 생기는 결과 1줄. 절대 시스템, 프로토콜, 모듈, 감독관 같은 기계 용어 쓰지 마. 사람한테 말하듯이 해.`;
    try {
      const res = await fetch("/api/gemini", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setAiBriefing(data.text || "");
      setAiUsedCount(prev => prev + 1);
      setBriefingDate(today);
    } catch { setAiBriefing("브리핑 생성 실패."); }
    setBriefingLoading(false);
  }

  async function generateAICommand() {
    if (userPlan === "free" && aiUsedCount >= 4) { setAiCommand("무료는 하루 4회까지 가능합니다. Pro로 업그레이드하면 무제한으로 사용할 수 있습니다."); return; }
    setAiLoading(true);
    setAiCommand("");
    const userState = calcUserState(records, hour);
    const failReasons = records.filter(r => !r.done && r.fail_reason).slice(0, 3).map(r => r.fail_reason).join(", ");
    const prompt = `너는 실행 코치다. 유저가 지금 당장 할 수 있는 행동 1개를 알려줘. 사람한테 말하듯이, 솔직하고 단호하게.

유저 정보:
- 목표: ${goal || "없음"}
- 이번 달 실패: ${failCount}회
- 연속 미완료: ${userState.consecutiveFails}일
- 주요 실패 이유: ${failReasons || "없음"}
- 현재 시간: ${hour}시
- streak: ${streak}일

이 형식으로만 답해:
[행동]: 지금 당장 할 수 있는 구체적인 행동 1개 (20자 이내)
[이유]: 안 하면 실제로 생기는 결과 1줄
[시작]: 30초짜리 첫 행동 1개

절대 시스템, 프로토콜, 모듈 같은 기계 용어 쓰지 마. "화이팅", "할 수 있어" 같은 말도 쓰지 마. 현실적으로만 말해.`;
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setAiCommand(data.text || "AI 호출 실패");
    } catch {
      setAiCommand("AI 호출 실패. 다시 시도하세요.");
    }
    setAiUsedCount(prev => prev + 1);
    setAiLoading(false);
  }

  function handleStart() {
    if (mission.trim().length < 2) return;
    setCurrentMission(mission.trim());
    setStartTime(new Date());
    setRunningMessage("");
    setShowRunningMessage(false);
    setHomeMode("running");
  }

  async function trackEvent(eventType: string, data: Record<string, unknown> = {}) {
    try {
      await supabase.from("user_events").insert([{
        nickname,
        event_type: eventType,
        event_data: data,
      }]);
    } catch {}
  }

  async function handleComplete() {
    if (!isGuest && nickname) {
      await saveRecord({ nickname, date: today, task: currentMission, done: true, hour_of_day: hour });
      await loadUserData(nickname);
    }
    setFailTime(null);
    // 내일 스케줄 미리 생성
    if (userPlan !== "free") {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
      fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, date: tomorrow }),
      }).catch(() => {});
    }
    trackEvent("mission_complete", { task: currentMission, hour, elapsed_seconds: elapsedSeconds });
    setHomeMode("done");
  }

  async function handleFail(reason: string) {
    setFailReason(reason);
    setShowFailSelect(false);
    if (!isGuest && nickname) {
      await saveRecord({ nickname, date: today, task: currentMission, done: false, fail_reason: reason, hour_of_day: hour });
      await loadUserData(nickname);
    }
    trackEvent("mission_fail", { task: currentMission, reason, hour });
    setFailTime(new Date());

    // 복구 스케줄 생성
    setRecoverySchedule([
      { title: "30초 — 파일만 열기", duration: "30초" },
      { title: "3분 — 첫 단계만 시작", duration: "3분" },
      { title: "10분 — 핵심만 끝내기", duration: "10분" },
    ]);

    // Pro AI 맞춤 복귀 메시지 생성
    if (userPlan !== "free" && nickname) {
      try {
        const failHistory = records.filter(r => !r.done && r.fail_reason).slice(0, 5).map(r => r.fail_reason).join(", ");
        const prompt = `너는 실행 코치다. 유저가 방금 실패했다. 실패 이유: "${reason}". 과거 실패 이유: ${failHistory || "없음"}. 현재 시간: ${hour}시. 이 유저한테 딱 맞는 복귀 방법을 1줄로 알려줘. "~해라" 체로 끝내. 구체적인 행동 1개만. 예: "지금 일어나서 30초 스트레칭하고 다시 앉아라." 절대 이모지, 시스템, 프로토콜 같은 단어 쓰지 마.`;
        fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        }).then(res => res.json()).then(data => {
          if (data.text) {
            setRecoverySchedule([
              { title: data.text, duration: "AI 추천" },
              { title: "30초 — 파일만 열기", duration: "30초" },
              { title: "3분 — 첫 단계만 시작", duration: "3분" },
              { title: "10분 — 핵심만 끝내기", duration: "10분" },
            ]);
          }
        }).catch(() => {});
      } catch {}
    }

    setHomeMode("fail");
  }

  async function generateDailySchedule() {
    if (userPlan === "free" && aiUsedCount >= 4) { return; }
    setScheduleGenerating(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (data.schedule) setDailySchedule(data.schedule);
      setAiUsedCount(prev => prev + 1);
    } catch (err) {
      console.error(err);
    }
    setScheduleGenerating(false);
  }

  async function toggleScheduleBlock(blockId: string, action: "complete" | "skip") {
    if (!dailySchedule) return;
    try {
      const res = await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId: dailySchedule.id,
          blockId,
          action,
          nickname,
        }),
      });
      const data = await res.json();
      if (data.schedule) setDailySchedule(data.schedule);
    } catch (err) {
      console.error(err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function addScheduleBlock() {
    if (userPlan === "free") return;
    if (!dailySchedule || !newBlockTitle || !newBlockStart || !newBlockEnd) return;
    const newBlock = {
      id: `custom_${Date.now()}`,
      start: newBlockStart,
      end: newBlockEnd,
      type: "task",
      title: newBlockTitle,
      description: "",
      priority: "medium",
      energy_required: "medium",
      is_completed: false,
      completed_at: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedBlocks = [...dailySchedule.blocks, newBlock].sort((a: any, b: any) => a.start.localeCompare(b.start));
    try {
      await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId: dailySchedule.id,
          blockId: newBlock.id,
          action: "add",
          nickname,
          newBlock,
        }),
      });
      setDailySchedule({ ...dailySchedule, blocks: updatedBlocks, total_blocks: updatedBlocks.length });
      setNewBlockTitle("");
      setNewBlockStart("");
      setNewBlockEnd("");
      setShowAddBlock(false);
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteScheduleBlock(blockId: string) {
    if (userPlan === "free") return;
    if (!dailySchedule) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedBlocks = dailySchedule.blocks.filter((b: any) => b.id !== blockId);
    try {
      await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId: dailySchedule.id,
          blockId,
          action: "delete",
          nickname,
        }),
      });
      setDailySchedule({ ...dailySchedule, blocks: updatedBlocks, total_blocks: updatedBlocks.length });
    } catch (err) {
      console.error(err);
    }
  }

  async function generateWeeklyReview() {
    if (userPlan === "free") return;
    setWeeklyLoading(true);
    try {
      const res = await fetch("/api/weekly-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (data.review) {
        setWeeklyReview(data.review);
        if (data.review.user_reflection) setWeeklyReflection(data.review.user_reflection);
        if (data.review.next_week_commitment) setWeeklyCommitment(data.review.next_week_commitment);
      }
    } catch (err) {
      console.error(err);
    }
    setWeeklyLoading(false);
  }

  async function saveWeeklyReflection() {
    if (!weeklyReview) return;
    setWeeklySaving(true);
    try {
      const res = await fetch("/api/weekly-review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          weekStart: weeklyReview.week_start,
          reflection: weeklyReflection,
          commitment: weeklyCommitment,
        }),
      });
      const data = await res.json();
      if (data.review) setWeeklyReview(data.review);
    } catch (err) {
      console.error(err);
    }
    setWeeklySaving(false);
  }

  async function handleAddSchedule() {
    if (!scheduleTitle.trim() || !scheduleDate) return;
    if (isGuest) { setShowNicknameModal(true); return; }
    setScheduleLoading(true);
    await saveSchedule({ nickname, title: scheduleTitle.trim(), due_date: scheduleDate, due_time: scheduleTime || undefined });
    setScheduleTitle(""); setScheduleDate(""); setScheduleTime("");
    await loadUserData(nickname);
    setScheduleLoading(false);
  }

  useEffect(() => {
    if (!startTime) { setElapsed("0:00"); setElapsedSeconds(0); return; }
    const timer = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime.getTime()) / 1000);
      setElapsed(`${Math.floor(diff / 60)}:${(diff % 60).toString().padStart(2, "0")}`);
      setElapsedSeconds(diff);

      // 실행 중 실시간 개입
      const intervention = getRunningIntervention(diff, pressureMode);
      if (intervention.show) {
        setRunningMessage(intervention.message);
        setRunningMessageType(intervention.type);
        setShowRunningMessage(true);
        setTimeout(() => setShowRunningMessage(false), 5000);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime, pressureMode]);

  // 브리핑 자동 생성
  useEffect(() => {
    if (!isGuest && nickname && briefingDate !== today && (schedules.length > 0 || goal)) {
      generateBriefing();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules.length, goal, nickname]);

  const successCount = records.filter(r => r.done).length;
  const totalCount = records.length;
  const successRate = totalCount > 0 ? Math.round(successCount / totalCount * 100) : 0;
  const userState = calcUserState(records, hour);

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#1A1A2E] flex justify-center">
      {showSplash && (
        <div className="fixed inset-0 bg-[#4F46E5] flex flex-col items-center justify-center z-50">
          <div className="text-[3.5rem] font-black uppercase text-white" style={{letterSpacing: "0.2em", animation: "fadeIn 0.8s ease-in"}}>VANGUARD</div>
          <div className="text-[0.8rem] text-[#999999] mt-0" style={{letterSpacing: "0.35em", fontWeight: 700}}>Life OS</div>
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
      )}
      <div className="w-full max-w-[420px] px-4 pb-8">

        {/* 닉네임 모달 */}
        {showNicknameModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-6">
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 w-full max-w-[340px]">
              <div className="text-[1rem] font-black mb-1">닉네임 설정</div>
              <div className="text-[0.85rem] text-[#9CA3AF] mb-4">기록 저장과 패턴 분석에 사용돼요</div>
              <input type="text" value={nicknameInput} onChange={e => setNicknameInput(e.target.value)}
                placeholder="닉네임 입력 (2자 이상)"
                className="w-full bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.92rem] text-[#1A1A2E] placeholder-white/25 focus:outline-none focus:border-[#D1D5DB] mb-3"
                onKeyDown={e => e.key === "Enter" && handleSetNickname()} />
              <button onClick={handleSetNickname} disabled={loading}
                className="w-full bg-white text-[#050A12] font-bold rounded-2xl py-3 text-[0.88rem] mb-2">
                {loading ? "설정 중..." : "시작하기"}
              </button>
              <button onClick={() => setShowNicknameModal(false)} className="w-full text-[#9CA3AF] text-[0.78rem] py-2">나중에 하기</button>
            </div>
          </div>
        )}

        {/* 목표 모달 */}
        {showGoalModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-6">
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 w-full max-w-[340px]">
              <div className="text-[1rem] font-black mb-1">이번 달 목표</div>
              <div className="text-[0.85rem] text-[#9CA3AF] mb-4">목표가 있어야 AI가 맞춤 압박을 줍니다</div>
              <input type="text" value={goalInput} onChange={e => setGoalInput(e.target.value)}
                placeholder="예: 앱 출시, 운동 20회, 매출 100만원"
                className="w-full bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.92rem] text-[#1A1A2E] placeholder-white/25 focus:outline-none focus:border-[#D1D5DB] mb-3"
                onKeyDown={e => e.key === "Enter" && handleSaveGoal()} />
              <button onClick={handleSaveGoal} disabled={goalSaving}
                className="w-full bg-white text-[#050A12] font-bold rounded-2xl py-3 text-[0.88rem] mb-2">
                {goalSaving ? "저장 중..." : "목표 저장"}
              </button>
              <button onClick={() => setShowGoalModal(false)} className="w-full text-[#9CA3AF] text-[0.78rem] py-2">닫기</button>
            </div>
          </div>
        )}

        {/* 문의 모달 */}
        {showInquiry && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-6">
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 w-full max-w-[340px]">
              <div className="text-[1rem] font-black mb-1">문의하기</div>
              <div className="text-[0.85rem] text-[#9CA3AF] mb-4">궁금한 점이나 불편한 점을 알려주세요</div>
              {inquirySent ? (
                <div>
                  <div className="text-[0.88rem] text-[#1A1A2E] font-bold mb-2 text-center">전송 완료!</div>
                  <div className="text-[0.85rem] text-[#9CA3AF] text-center mb-4">빠르게 확인하겠습니다.</div>
                  <button onClick={() => { setShowInquiry(false); setInquirySent(false); setInquiryMsg(""); }}
                    className="w-full bg-white text-[#050A12] font-bold rounded-2xl py-3 text-[0.88rem]">닫기</button>
                </div>
              ) : (
                <div>
                  <textarea value={inquiryMsg} onChange={e => setInquiryMsg(e.target.value)}
                    placeholder="메시지를 입력하세요"
                    rows={4}
                    className="w-full bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.92rem] text-[#1A1A2E] placeholder-white/20 focus:outline-none focus:border-[#D1D5DB] mb-3 resize-none" />
                  <button onClick={async () => {
                    if (!inquiryMsg.trim()) return;
                    await supabase.from("inquiries").insert([{ nickname, message: inquiryMsg.trim() }]);
                    setInquirySent(true);
                  }}
                    className="w-full bg-white text-[#050A12] font-bold rounded-2xl py-3 text-[0.88rem] mb-2">보내기</button>
                  <button onClick={() => { setShowInquiry(false); setInquiryMsg(""); }}
                    className="w-full text-[#9CA3AF] text-[0.78rem] py-2">닫기</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 헤더 */}
        <div className="pt-12 pb-4 border-b border-[#E5E7EB] mb-3">
          <div className="text-center mb-3">
            <div className="text-[2rem] font-black leading-none uppercase" style={{letterSpacing: "0.15em"}}>VANGUARD</div>
            <div className="text-[0.8rem] text-[#999999] mt-0" style={{letterSpacing: "0.35em", fontWeight: 700}}>Life OS</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[0.85rem] text-[#9CA3AF]">
              {streak}일 &nbsp;<span className="text-[#6B7280]">{isGuest ? "게스트" : nickname}</span> {userPlan !== "free" && <span className={`ml-1 text-[0.75rem] font-bold px-1.5 py-0.5 rounded ${userPlan === "ultra" ? "bg-[#7C3AED]/20 text-[#7C3AED]" : "bg-white/10 text-[#1A1A2E]"}`}>{userPlan.toUpperCase()}</span>}
            </div>
            {isGuest ? (
              <button onClick={() => setShowNicknameModal(true)}
                className="text-[0.7rem] border border-[#D1D5DB] rounded-lg px-2 py-1 text-[#9CA3AF]">로그인</button>
            ) : (
              <button onClick={() => setShowGoalModal(true)}
                className="text-[0.7rem] border border-[#D1D5DB] rounded-lg px-2 py-1 text-[#9CA3AF]">목표</button>
            )}
          </div>
        </div>

        <div className="pb-20">

        {/* ── 홈 탭 ── */}
        {activeTab === "home" && (
          <div className="tab-content">
            {/* 신규 유저 온보딩 */}
            {isNewUser && homeMode === "mission_input" && !userType && (
              <div className="mb-4 card-enter">
                <div className="text-center mb-8">
                  <div className="text-[1.2rem] font-black text-[#1A1A2E] mb-2">당신은 어떤 타입인가요?</div>
                  <div className="text-[0.78rem] text-[#6B7280]">맞춤 코칭을 위해 알려주세요</div>
                </div>
                <div className="space-y-3">
                  {[
                    { type: "planner" as const, title: "계획도 못 세우겠어", desc: "뭘 해야 할지 모르겠다. AI가 다 정해줬으면 좋겠다." },
                    { type: "starter" as const, title: "시작을 못 하겠어", desc: "해야 하는 건 아는데, 자꾸 미루게 된다." },
                    { type: "repeater" as const, title: "시작은 하는데 계속 포기해", desc: "작심삼일이 반복된다. 끝까지 가본 적이 없다." },
                  ].map(opt => (
                    <button key={opt.type} onClick={() => { setUserType(opt.type); localStorage.setItem("vanguard_user_type", opt.type); }}
                      className="w-full bg-white border border-[#E5E7EB] rounded-3xl p-5 text-left press-effect">
                      <div className="text-[1rem] font-black text-[#1A1A2E] mb-1">{opt.title}</div>
                      <div className="text-[0.75rem] text-[#9CA3AF]">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isNewUser && homeMode === "mission_input" && userType && (
              <div className="mb-4 card-enter">
                <div className="text-center mb-6">
                  <div className="text-[1.1rem] font-black text-[#1A1A2E] mb-2">
                    {userType === "planner" ? "좋아요. AI가 다 정해줄게요." :
                     userType === "starter" ? "좋아요. 시작을 끝까지 시킬게요." :
                     "좋아요. 이번엔 끝까지 가게 만들게요."}
                  </div>
                  <div className="text-[0.78rem] text-[#6B7280]">
                    {userType === "planner" ? "목표만 알려주면 오늘 할 일을 만들어줍니다." :
                     userType === "starter" ? "미루는 패턴을 감지하고 시작하게 만듭니다." :
                     "무너지는 시점을 잡아서 다시 끌어옵니다."}
                  </div>
                </div>
                <button onClick={() => { setShowGoalModal(true); setIsNewUser(false); }}
                  className="w-full bg-white text-[#050A12] font-black rounded-2xl py-3.5 text-[0.88rem] press-effect mb-2">
                  목표 설정하고 시작하기
                </button>
                <button onClick={() => setIsNewUser(false)}
                  className="w-full text-[#9CA3AF] text-[0.78rem] py-2">바로 시작할게</button>
              </div>
            )}

            {/* 메인: 실행실 */}
            {!isNewUser && homeMode === "mission_input" && (
              <div className="card-enter">
                {dailySchedule?.blocks?.length > 0 ? (() => {
                  const now = new Date();
                  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const nextBlock = dailySchedule.blocks.find(
                    (b: any) => !b.is_completed && !b.skipped && b.end > currentTime
                  ) || dailySchedule.blocks.find((b: any) => !b.is_completed && !b.skipped);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const completedCount = dailySchedule.blocks.filter((b: any) => b.is_completed).length;
                  const totalCount = dailySchedule.blocks.length;
                  const userState = calcUserState(records, hour);

                  let statusLine = "";
                  if (pressureMode === "gentle") {
                    if (userState.consecutiveFails >= 3) statusLine = `${userState.consecutiveFails}일 쉬었어요. 오늘 3분만 해볼까요?`;
                    else if (userState.consecutiveFails >= 1) statusLine = "어제 쉬었어요. 오늘 가볍게 시작해봐요.";
                    else if (userState.lastSuccess) statusLine = `${streak}일째 잘하고 있어요. 오늘도 해봐요.`;
                    else if (completedCount > 0) statusLine = `${completedCount}/${totalCount} 했어요. 잘하고 있어요.`;
                    else statusLine = "오늘 하나만 시작해봐요.";
                  } else if (pressureMode === "normal") {
                    if (userState.consecutiveFails >= 3) statusLine = `${userState.consecutiveFails}일 연속 멈췄습니다. 오늘은 3분만 하세요.`;
                    else if (userState.consecutiveFails >= 1) statusLine = "어제 멈췄습니다. 오늘 1개만 하면 흐름이 돌아옵니다.";
                    else if (userState.lastSuccess) statusLine = `${streak}일 연속 실행 중. 오늘도 이어가세요.`;
                    else if (completedCount > 0) statusLine = `${completedCount}/${totalCount} 완료. 다음 1개 하세요.`;
                    else statusLine = "오늘 첫 행동을 시작하세요.";
                  } else {
                    if (userState.consecutiveFails >= 3) statusLine = `${userState.consecutiveFails}일 연속 멈췄다. 지금 안 하면 이번 주 끝이다.`;
                    else if (userState.consecutiveFails >= 1) statusLine = "어제 멈췄다. 오늘까지 놓치면 패턴 된다.";
                    else if (userState.lastSuccess) statusLine = `${streak}일 연속이다. 끊기면 처음부터다.`;
                    else if (completedCount > 0) statusLine = `${completedCount}/${totalCount} 완료. 멈추면 다 무너진다.`;
                    else statusLine = urgency.headline;
                  }

                  return (
                    <div>
                      {/* 미접속 경고 + Pro 유도 */}
                      {userState.consecutiveFails >= 2 && (
                        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl p-4 mb-4" style={{animation: "fadeIn 0.5s ease-in"}}>
                          <div className="text-[0.92rem] font-black text-[#FCA5A5] mb-1">{userState.consecutiveFails}일째 안 왔다.</div>
                          <div className="text-[0.75rem] text-[#6B7280] mb-2">이건 의지가 아니라 반복 패턴이다. 지금 3분만 해라.</div>
                          {userPlan === "free" && userState.consecutiveFails >= 3 && (
                            <button onClick={() => { setActiveTab("settings"); }}
                              className="w-full bg-[#FCA5A5]/10 border border-[#FECACA] text-[#FCA5A5] font-bold rounded-2xl py-2.5 text-[0.75rem] press-effect mt-2">
                              {userState.consecutiveFails}일 연속 무너지고 있다 — Pro가 패턴을 잡아준다
                            </button>
                          )}
                        </div>
                      )}
                      {/* 1일 미접속 + 무료 유저 */}
                      {userState.consecutiveFails === 1 && userPlan === "free" && (
                        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 mb-5">
                          <div className="text-[0.78rem] text-[#6B7280]">어제 멈췄다. 오늘까지 놓치면 패턴이 된다.</div>
                        </div>
                      )}

                      {/* 어제 편지 */}
                      {yesterdayLetter && !userState.consecutiveFails && (
                        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 mb-4">
                          <div className="text-[0.75rem] text-[#9CA3AF] font-bold mb-2">어제의 나로부터</div>
                          <div className="text-[0.78rem] text-[#1A1A2E] leading-relaxed">{yesterdayLetter}</div>
                        </div>
                      )}

                      {/* 스트릭 복구권 (Pro) */}
                      {userPlan !== "free" && streak === 0 && userState.consecutiveFails === 1 && (
                        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-4 mb-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-[0.82rem] font-bold text-[#1A1A2E] mb-1">스트릭이 끊어졌다</div>
                              <div className="text-[0.8rem] text-[#6B7280]">지금 미션 1개를 완료하면 스트릭을 복구할 수 있습니다</div>
                            </div>
                            <div className="text-[0.75rem] text-[#1A1A2E] font-bold px-2 py-1 bg-[#FCD34D]/10 rounded-lg">복구 가능</div>
                          </div>
                        </div>
                      )}

                      {/* 상태 한 줄 */}
                      <div className="text-[0.82rem] text-[#6B7280] text-center mb-4 leading-relaxed font-medium">
                        {statusLine}
                      </div>

                      {/* 원형 진행률 */}
                      <div className="flex flex-col items-center mb-6">
                        <div className="relative mb-3">
                          <svg width="120" height="120" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="48" fill="none" stroke="#E5E7EB" strokeWidth="7" />
                            <circle cx="60" cy="60" r="48" fill="none" stroke={completedCount === totalCount && totalCount > 0 ? "#4ADE80" : "#FFFFFF"} strokeWidth="7"
                              strokeLinecap="round"
                              strokeDasharray={`${(totalCount > 0 ? completedCount / totalCount : 0) * 2 * Math.PI * 48} ${2 * Math.PI * 48}`}
                              transform="rotate(-90 60 60)" style={{ transition: "stroke-dasharray 0.5s ease" }} />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-[1.5rem] font-black text-[#1A1A2E]">{totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%</span>
                            <span className="text-[0.75rem] text-[#9CA3AF]">{completedCount}/{totalCount}</span>
                          </div>
                        </div>
                      </div>

                      {/* 패턴 브레이커 경고 (Pro/Ultra) */}
                      {userPlan !== "free" && (() => {
                        const riskyHour = getRiskyHour(records);
                        const pb = getPatternBreakerMessage(hour, riskyHour, userPlan);
                        if (pb.show) return (
                          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl p-4 mb-5">
                            <div className="text-[0.82rem] text-[#FCA5A5] font-bold mb-1">{pb.message}</div>
                            <div className="text-[0.85rem] text-[#6B7280]">{pb.sub}</div>
                          </div>
                        );
                        return null;
                      })()}

                      {/* Ultra 선제 개입 — 내일 위험 예측 */}
                      {userPlan === "ultra" && (() => {
                        const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
                        if (failsByHour.length < 3) return null;
                        const hourCounts: Record<number, number> = {};
                        failsByHour.forEach(r => { hourCounts[r.hour_of_day!] = (hourCounts[r.hour_of_day!] || 0) + 1; });
                        const sorted = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]));
                        const peakHour = Number(sorted[0][0]);
                        const peakCount = Number(sorted[0][1]);
                        const hoursUntil = peakHour - hour;
                        if (hoursUntil > 0 && hoursUntil <= 3) return (
                          <div className="bg-[#F5F3FF] border border-[#DDD6FE] rounded-2xl p-4 mb-4" style={{animation: "fadeIn 0.5s ease-in"}}>
                            <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-wider mb-1">ULTRA 선제 개입</div>
                            <div className="text-[0.88rem] font-black text-[#1A1A2E] mb-1">오늘 {peakHour}시에 무너질 확률이 높습니다.</div>
                            <div className="text-[0.85rem] text-[#6B7280]">{peakCount}번 같은 시간에 실패했습니다. 지금 미리 3분 시작하면 오늘은 버틸 수 있습니다.</div>
                          </div>
                        );
                        if (hoursUntil === 0) return (
                          <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-2xl p-4 mb-4" style={{animation: "fadeIn 0.5s ease-in"}}>
                            <div className="text-[0.75rem] text-[#FCA5A5] font-bold tracking-wider mb-1">ULTRA 긴급 개입</div>
                            <div className="text-[0.88rem] font-black text-[#FCA5A5] mb-1">지금이 당신이 항상 무너지는 시간입니다.</div>
                            <div className="text-[0.85rem] text-[#6B7280]">이 시간을 버텨내면 오늘은 이깁니다. 지금 바로 시작하세요.</div>
                          </div>
                        );
                        return null;
                      })()}

                      {/* 오늘 할 것 1개 */}
                      {nextBlock ? (
                        <div className="mb-6">
                          <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-wider mb-3 text-center">지금 해야 할 것</div>
                          <div className="text-[1.4rem] font-black text-[#1A1A2E] text-center mb-1">{nextBlock.title}</div>
                          <div className="text-[0.75rem] text-[#9CA3AF] text-center mb-1">{nextBlock.start} — {nextBlock.end}</div>
                          {nextBlock.description && (
                            <div className="text-[0.75rem] text-[#9CA3AF] text-center">{nextBlock.description}</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center mb-6">
                          <div className="text-[1.2rem] font-black text-[#4ADE80] mb-1">오늘 전부 완료</div>
                          <div className="text-[0.75rem] text-[#9CA3AF]">내일도 이어가세요</div>
                        </div>
                      )}

                      {/* 메인 버튼 */}
                      {nextBlock && (
                        <button onClick={() => {
                          setMission(nextBlock.title);
                          setCurrentMission(nextBlock.title);
                          setStartTime(new Date());
                          setRunningMessage("");
                          setShowRunningMessage(false);
                          setHomeMode("running");
                        }}
                          className="w-full bg-white text-[#050A12] font-black rounded-3xl py-5 text-[1.1rem] press-effect mb-4"
                          style={{letterSpacing: "0.2em", paddingLeft: "0.2em"}}>
                          시작
                        </button>
                      )}

                      {/* 직접 입력 */}
                      <div className="mt-4">
                        <input type="text" value={mission} onChange={e => setMission(e.target.value)}
                          placeholder="또는 직접 입력"
                          className="w-full bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.85rem] text-[#1A1A2E] placeholder-[#334155] focus:outline-none focus:border-[#D1D5DB]"
                          onKeyDown={e => e.key === "Enter" && handleStart()} />
                        {mission && (
                          <button onClick={handleStart}
                            className="w-full bg-white border border-[#E5E7EB] text-[#6B7280] font-bold rounded-2xl py-3 text-[0.82rem] press-effect mt-2">
                            직접 미션 시작
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="text-center">
                    <div className="text-[0.78rem] text-[#6B7280] mb-8">{urgency.headline}</div>
                    <button onClick={generateDailySchedule} disabled={scheduleGenerating}
                      className="w-full bg-white text-[#050A12] font-black rounded-3xl py-5 text-[1.1rem] press-effect mb-4"
                      style={{letterSpacing: "0.2em", paddingLeft: "0.2em"}}>
                      {scheduleGenerating ? "AI가 설계 중..." : "오늘 시작하기"}
                    </button>
                    <div className="mt-4">
                      <input type="text" value={mission} onChange={e => setMission(e.target.value)}
                        placeholder="또는 직접 입력"
                        className="w-full bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.85rem] text-[#1A1A2E] placeholder-[#334155] focus:outline-none focus:border-[#D1D5DB]"
                        onKeyDown={e => e.key === "Enter" && handleStart()} />
                      {mission && (
                        <button onClick={handleStart}
                          className="w-full bg-white border border-[#E5E7EB] text-[#6B7280] font-bold rounded-2xl py-3 text-[0.82rem] press-effect mt-2">
                          직접 미션 시작
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 실행 중 (업그레이드: 실시간 AI 개입 + 진행률 바) ── */}
            {homeMode === "running" && (
              <div className="card-enter">
                <div className="text-center mb-6">
                  <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-4">집중 중</div>

                  {/* 진행률 링 */}
                  <div className="relative inline-block mb-4">
                    <svg width="160" height="160" viewBox="0 0 160 160">
                      <circle cx="80" cy="80" r="68" fill="none" stroke="#E5E7EB" strokeWidth="5" />
                      <circle cx="80" cy="80" r="68" fill="none"
                        stroke={elapsedSeconds >= 1800 ? "#4ADE80" : elapsedSeconds >= 900 ? "#FCD34D" : "#FFFFFF"}
                        strokeWidth="5" strokeLinecap="round"
                        strokeDasharray={`${Math.min(1, elapsedSeconds / 1800) * 2 * Math.PI * 68} ${2 * Math.PI * 68}`}
                        transform="rotate(-90 80 80)"
                        style={{ transition: "stroke-dasharray 1s ease, stroke 0.5s ease" }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[2.5rem] font-black text-[#1A1A2E] font-mono tracking-tight">{elapsed}</span>
                      <span className="text-[0.8rem] text-[#9CA3AF]">{currentMission}</span>
                    </div>
                  </div>

                  {/* 실시간 개입 메시지 */}
                  {showRunningMessage && (
                    <div className={`rounded-2xl p-4 mb-5 transition-all ${
                      runningMessageType === "celebrate" ? "bg-[#F0FDF4] border border-[#BBF7D0]" :
                      runningMessageType === "push" ? "bg-[#FEF2F2] border border-[#FECACA]" :
                      "bg-white border border-[#E5E7EB]"
                    }`} style={{animation: "fadeIn 0.5s ease-in"}}>
                      <div className={`text-[0.82rem] font-bold ${
                        runningMessageType === "celebrate" ? "text-[#4ADE80]" :
                        runningMessageType === "push" ? "text-[#FCA5A5]" :
                        "text-[#1A1A2E]"
                      }`}>{runningMessage}</div>
                    </div>
                  )}

                  {/* 경과 시간 마일스톤 */}
                  <div className="flex justify-center gap-4 mb-6">
                    {[5, 10, 15, 30].map(min => (
                      <div key={min} className={`text-center ${elapsedSeconds >= min * 60 ? "opacity-100" : "opacity-20"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[0.75rem] font-bold mx-auto mb-1 ${
                          elapsedSeconds >= min * 60 ? "bg-[#4ADE80] text-[#050A12]" : "bg-[#F3F4F6] text-[#9CA3AF]"
                        }`}>{elapsedSeconds >= min * 60 ? "✓" : min}</div>
                        <div className="text-[0.7rem] text-[#9CA3AF]">{min}분</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-[0.85rem] text-[#FCA5A5] font-bold text-center mb-6">
                  {elapsedSeconds < 180 ? "지금 이것만 해라." :
                   elapsedSeconds < 600 ? "잘하고 있다. 멈추지 마라." :
                   elapsedSeconds < 1800 ? "이미 10분 넘겼다. 끝까지 가라." :
                   "30분 돌파. 이게 진짜 실행이다."}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button onClick={handleComplete}
                    className="bg-white text-[#050A12] font-black rounded-2xl py-4 text-[0.92rem] press-effect">
                    완료
                  </button>
                  <button onClick={() => setShowFailSelect(true)}
                    className="bg-white border border-[#E5E7EB] text-[#FCA5A5] font-bold rounded-2xl py-4 text-[0.92rem] press-effect">
                    실패
                  </button>
                </div>
                {showFailSelect && (
                  <div className="mt-4 bg-white border border-[#E5E7EB] rounded-3xl p-4">
                    <div className="text-[0.85rem] text-[#9CA3AF] font-bold mb-3">왜 멈췄어?</div>
                    {["집중력 부족", "시간 없음", "피곤", "의욕 없음", "기타"].map(reason => (
                      <button key={reason} onClick={() => handleFail(reason)}
                        className="w-full text-left text-[0.82rem] text-[#6B7280] py-2.5 border-b border-[#E5E7EB] last:border-0 press-effect">
                        {reason}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 완료 ── */}
            {homeMode === "done" && (
              <div className="card-enter text-center">
                <div className="mb-6">
                  <div className="text-[2rem] font-black text-[#1A1A2E] mb-1" style={{animation: "fadeIn 0.5s ease-in"}}>완료</div>
                  {elapsedSeconds >= 1800 && (
                    <div className="text-[0.82rem] text-[#4ADE80] font-bold mb-2">30분 이상 집중! 대단하다.</div>
                  )}
                  {elapsedSeconds >= 600 && elapsedSeconds < 1800 && (
                    <div className="text-[0.82rem] text-[#1A1A2E] font-bold mb-2">{Math.floor(elapsedSeconds / 60)}분 집중 완료.</div>
                  )}
                </div>

                <div className="text-[0.85rem] text-[#6B7280] mb-6">
                  {streak > 0 ? `${streak}일 연속 실행 중` : "오늘 첫 실행 완료"}
                </div>

                {/* SNS 공유 */}
                <button onClick={() => {
                  const text = `오늘 Vanguard로 ${Math.floor(elapsedSeconds / 60)}분 집중했다. ${streak > 0 ? streak + "일 연속 실행 중." : ""} 계획은 AI가 세운다. 실행만 하면 된다.`;
                  const url = "https://vanguard-five-ecru.vercel.app/landing";
                  if (navigator.share) {
                    navigator.share({ title: "Vanguard", text, url }).catch(() => {});
                  } else {
                    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text + " " + url)}`, "_blank");
                  }
                }}
                  className="w-full bg-white border border-[#E5E7EB] rounded-2xl py-3 text-[0.78rem] text-[#6B7280] press-effect mb-3">
                  오늘 실행 공유하기
                </button>

                {/* 내일의 편지 */}
                {!tomorrowLetter && (
                  <button onClick={async () => {
                    const prompt = `너는 행동 코치다. 유저가 오늘 미션을 완료했다. 내일의 유저한테 보내는 짧은 메시지를 써라. 2줄 이내. 첫줄은 오늘 해낸것 인정. 둘째줄은 내일도 이어가라는 단호한 말. streak: ${streak}일. 절대 이모지 쓰지마.`;
                    try {
                      const res = await fetch("/api/gemini", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({prompt}) });
                      const data = await res.json();
                      setTomorrowLetter(data.text || "");
                      localStorage.setItem("vanguard_letter", data.text || "");
                      localStorage.setItem("vanguard_letter_date", new Date().toISOString().split("T")[0]);
                    } catch {}
                  }}
                    className="w-full bg-white border border-[#E5E7EB] rounded-2xl py-3 text-[0.78rem] text-[#6B7280] press-effect mb-3">
                    내일의 나한테 편지 쓰기
                  </button>
                )}
                {tomorrowLetter && (
                  <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 mb-4 text-left">
                    <div className="text-[0.75rem] text-[#9CA3AF] font-bold mb-2">내일의 나한테</div>
                    <div className="text-[0.78rem] text-[#1A1A2E] leading-relaxed">{tomorrowLetter}</div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => { setMission(""); setCurrentMission(""); setHomeMode("mission_input"); }}
                    className="bg-white text-[#050A12] font-black rounded-2xl py-3.5 text-[0.85rem] press-effect">
                    다음 미션
                  </button>
                  <button onClick={() => { setMission(""); setCurrentMission(""); setStartTime(null); setActiveTab("analysis"); }}
                    className="bg-white border border-[#E5E7EB] text-[#9CA3AF] font-bold rounded-2xl py-3.5 text-[0.85rem] press-effect">
                    마무리
                  </button>
                </div>

                {/* Pro 업셀 (완료 후) */}
                {userPlan === "free" && records.filter(r => r.done).length >= 3 && (
                  <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4 mt-4">
                    <div className="text-[0.82rem] font-bold text-[#1A1A2E] mb-1">실행력이 생기고 있다</div>
                    <div className="text-[0.85rem] text-[#9CA3AF] mb-3">Pro에서 이 흐름을 데이터로 만들어라. 언제 무너지는지, 왜 무너지는지 AI가 분석한다.</div>
                    <button onClick={() => setActiveTab("settings")}
                      className="w-full bg-white text-[#050A12] font-bold rounded-2xl py-2.5 text-[0.82rem] press-effect">
                      Pro 시작하기 →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── 실패 (업그레이드: 복구 스케줄 + 더 강한 개입) ── */}
            {homeMode === "fail" && (
              <div className="card-enter">
                {interventionMsg && (
                  <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl p-4 mb-4">
                    <div className="text-[0.78rem] text-[#FCA5A5] font-bold">{interventionMsg}</div>
                  </div>
                )}

                {/* 패턴 감지 문장 */}
                <div className="text-center mb-4">
                  {(() => {
                    const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
                    const sameHourFails = failsByHour.filter(r => r.hour_of_day === hour).length;
                    const timeLabel = hour >= 20 ? "밤" : hour >= 16 ? "저녁" : hour >= 12 ? "오후" : "오전";
                    if (sameHourFails >= 3) return (
                      <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-3xl p-5 mb-4">
                        <div className="text-[1.2rem] font-black text-[#FCA5A5] mb-2">이번 주 {sameHourFails}번째 같은 시간 실패입니다.</div>
                        <div className="text-[0.88rem] text-[#1A1A2E] font-bold mb-2">이건 의지가 아니라 반복 패턴입니다.</div>
                        <div className="text-[0.75rem] text-[#6B7280]">매번 {timeLabel}에 무너지고 있습니다. 원래 미션을 3분짜리로 줄였습니다.</div>
                      </div>
                    );
                    if (sameHourFails >= 1) return (
                      <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-3xl p-5 mb-4">
                        <div className="text-[1.1rem] font-black text-[#FCA5A5] mb-2">{getFailMessage(getABMessage(nickname || "guest"), failCount, hour)}</div>
                        <div className="text-[0.82rem] text-[#1A1A2E] font-bold mb-2">이 시간에 또 멈췄습니다.</div>
                        <div className="text-[0.75rem] text-[#6B7280]">아직 오늘은 끝나지 않았습니다.</div>
                      </div>
                    );
                    return (
                      <div className="mb-4">
                        <div className="text-[1.1rem] font-black text-[#FCA5A5] mb-2">{getFailMessage(getABMessage(nickname || "guest"), failCount, hour)}</div>
                        <div className="text-[0.78rem] text-[#4ADE80] font-bold mb-2">근데 이건 끊을 수 있다.</div>
                      </div>
                    );
                  })()}
                </div>

                {/* AI 맞춤 복귀 (Pro) 또는 기본 복귀 */}
                <div className="mb-2">
                  <div className="text-[0.88rem] font-black text-[#1A1A2E] text-center mb-4">{getRecoveryProtocol(failReason)}</div>
                </div>

                {/* 복구 스케줄 */}
                <div className="space-y-2 mb-4">
                  {recoverySchedule.map((item, idx) => (
                    <button key={idx} onClick={() => {
                      trackEvent(`recovery_${item.duration}`, { hour });
                      setMission(item.title);
                      setCurrentMission(item.title);
                      setStartTime(new Date());
                      setInterventionMsg("");
                      setRunningMessage("");
                      setShowRunningMessage(false);
                      setHomeMode("running");
                    }}
                      className={`w-full ${idx === 0 ? "bg-white text-[#050A12]" : "bg-white border border-[#E5E7EB] text-[#1A1A2E]"} font-bold rounded-2xl py-3.5 text-[0.88rem] press-effect`}>
                      {item.duration} 복귀 — {item.title}
                    </button>
                  ))}
                  <button onClick={() => { trackEvent("give_up", { hour }); setMission(""); setCurrentMission(""); setFailTime(null); setInterventionMsg(""); setRecoverySchedule([]); setHomeMode("mission_input"); }}
                    className="w-full text-[#9CA3AF] text-[0.78rem] py-2">
                    오늘은 포기
                  </button>
                </div>

                {/* Pro 업셀 (실패 후) — 패턴 데이터 흐림 처리 */}
                {userPlan === "free" && (
                  <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4">
                    {/* 흐림 처리된 패턴 분석 미리보기 */}
                    <div className="relative mb-3">
                      <div className="blur-[6px] pointer-events-none">
                        <div className="text-[0.75rem] text-[#FCA5A5] font-bold tracking-wider mb-2">실패 패턴 분석</div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <div className="bg-[#FAFAFA] rounded-lg p-2 text-center">
                            <div className="text-[1rem] font-black text-[#FCA5A5]">{failCount}</div>
                            <div className="text-[0.7rem] text-[#9CA3AF]">이번 달 실패</div>
                          </div>
                          <div className="bg-[#FAFAFA] rounded-lg p-2 text-center">
                            <div className="text-[1rem] font-black text-[#1A1A2E]">{hour >= 18 ? "저녁" : hour >= 12 ? "오후" : "오전"}</div>
                            <div className="text-[0.7rem] text-[#9CA3AF]">위험 시간대</div>
                          </div>
                          <div className="bg-[#FAFAFA] rounded-lg p-2 text-center">
                            <div className="text-[1rem] font-black text-[#1A1A2E]">{failReason}</div>
                            <div className="text-[0.7rem] text-[#9CA3AF]">주요 원인</div>
                          </div>
                        </div>
                        <div className="text-[0.85rem] text-[#6B7280]">다음 실패 예측: 내일 {hour >= 18 ? "20" : hour >= 12 ? "18" : "15"}시에 같은 패턴 반복 가능성 높음</div>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-[#FAFAFA]/80 rounded-2xl px-4 py-2">
                          <div className="text-[0.85rem] text-[#1A1A2E] font-bold text-center">Pro에서 잠금 해제</div>
                        </div>
                      </div>
                    </div>
                    <div className="text-[0.82rem] font-bold text-[#1A1A2E] mb-1">
                      {failCount >= 3 ? "같은 패턴이 반복되고 있다. 혼자서는 안 끊긴다." :
                       failCount >= 2 ? "이 패턴, 혼자서 끊기 어렵다." :
                       "왜 무너졌는지 알면 다음엔 안 무너진다."}
                    </div>
                    <div className="text-[0.85rem] text-[#9CA3AF] mb-3">
                      {failCount >= 3 ? "Pro가 패턴을 분석하고, 무너지기 전에 잡아준다. 지금 안 바꾸면 다음 달도 같다." :
                       failCount >= 2 ? "Pro가 왜 무너지는지 분석하고, 무너지기 전에 잡아준다." :
                       "Pro에서 실패 패턴 분석, AI 맞춤 복귀, 주간 리포트를 받을 수 있다."}
                    </div>
                    <button onClick={() => { if (isGuest) { setShowNicknameModal(true); return; } setActiveTab("settings"); setHomeMode("mission_input"); }}
                      className="w-full bg-white text-[#050A12] font-bold rounded-2xl py-3 text-[0.85rem] press-effect">
                      {failCount >= 3 ? "지금 바로 패턴 끊기 — Pro ₩9,900/월" :
                       failCount >= 2 ? "패턴 분석 시작하기 — Pro ₩9,900/월" :
                       "Pro 시작하기 — ₩9,900/월"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 브리핑 탭 ── */}
        {activeTab === "briefing" && (
          <div className="tab-content">
            {/* AI 브리핑 */}
            <div className="mb-4">
              {aiBriefing ? (
                <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[0.75rem] text-[#6B7280] font-bold tracking-wider">오늘의 브리핑</div>
                    <button onClick={generateBriefing} disabled={briefingLoading}
                      className="text-[0.75rem] text-[#9CA3AF]">새로고침</button>
                  </div>
                  <div className="text-[0.82rem] text-[#1A1A2E] leading-relaxed whitespace-pre-line break-all">{aiBriefing}</div>
                </div>
              ) : (
                <button onClick={generateBriefing} disabled={briefingLoading}
                  className="w-full bg-white border border-[#E5E7EB] rounded-3xl p-3 text-left">
                  <div className="text-[0.75rem] text-[#6B7280] font-bold tracking-wider mb-1">오늘의 브리핑</div>
                  <div className="text-[0.8rem] text-[#9CA3AF]">
                    {briefingLoading ? "AI 분석 중..." : "일정 기반 오늘 반드시 해야 할 것 →"}
                  </div>
                </button>
              )}
            </div>

            {/* 오늘의 스케줄 타임라인 */}
            {dailySchedule?.blocks?.length > 0 && (
              <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase">오늘의 스케줄</div>
                  <button onClick={generateDailySchedule} disabled={scheduleGenerating}
                    className="text-[0.75rem] text-[#9CA3AF]">{scheduleGenerating ? "생성 중..." : "다시 생성"}</button>
                </div>
                <div className="flex items-center justify-between mb-2">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <span className="text-[0.7rem] text-[#9CA3AF]">{dailySchedule.blocks.filter((b: any) => b.is_completed).length}/{dailySchedule.blocks.length} 완료</span>
                  <span className="text-[0.7rem] text-[#9CA3AF]">{dailySchedule.total_blocks > 0 ? Math.round((dailySchedule.completed_blocks / dailySchedule.total_blocks) * 100) : 0}%</span>
                </div>
                <div className="w-full bg-[#F3F4F6] rounded-full h-1.5 mb-3">
                  <div className="bg-white h-1.5 rounded-full transition-all" style={{ width: `${dailySchedule.total_blocks > 0 ? (dailySchedule.completed_blocks / dailySchedule.total_blocks) * 100 : 0}%` }} />
                </div>
                <div className="space-y-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {dailySchedule.blocks.map((block: any, idx: number) => (
                    <div key={idx} className={`flex items-center gap-2 rounded-2xl p-2.5 ${
                      block.is_completed ? "bg-[#4ADE80]/10 opacity-60" :
                      block.skipped ? "bg-zinc-900/30 opacity-40" : "bg-[#FAFAFA]"
                    }`}>
                      <button onClick={() => toggleScheduleBlock(block.id, block.is_completed ? "skip" : "complete")}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center text-[0.85rem] shrink-0 ${
                          block.is_completed ? "bg-[#4ADE80] border-[#4ADE80] text-[#050A12]" : "border-[#D1D5DB]"
                        }`}>
                        {block.is_completed ? "✓" : ""}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[0.8rem] text-[#9CA3AF] font-mono">{block.start}</span>
                          <span className={`text-[0.78rem] font-bold truncate ${block.is_completed ? "line-through text-[#9CA3AF]" : "text-[#1A1A2E]"}`}>{block.title}</span>
                        </div>
                      </div>
                      {!block.is_completed && !block.skipped && userPlan !== "free" && (
                        <button onClick={() => deleteScheduleBlock(block.id)}
                          className="text-[0.75rem] text-[#FCA5A5]/40 hover:text-[#FCA5A5] shrink-0">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                {/* 블록 추가 (Pro 이상) */}
                {userPlan !== "free" && (
                  <>
                    {!showAddBlock ? (
                      <button onClick={() => setShowAddBlock(true)}
                        className="w-full bg-[#FAFAFA] border border-dashed border-[#E5E7EB] rounded-2xl py-2.5 text-[0.75rem] text-[#9CA3AF] press-effect mt-3">
                        + 블록 추가
                      </button>
                    ) : (
                      <div className="bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl p-3 mt-3 space-y-2">
                        <input type="text" value={newBlockTitle} onChange={e => setNewBlockTitle(e.target.value)}
                          placeholder="할 일"
                          className="w-full bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 text-[0.82rem] text-[#1A1A2E] placeholder-[#334155] focus:outline-none focus:border-[#D1D5DB]" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="time" value={newBlockStart} onChange={e => setNewBlockStart(e.target.value)}
                            className="bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 text-[0.82rem] text-[#1A1A2E] focus:outline-none" />
                          <input type="time" value={newBlockEnd} onChange={e => setNewBlockEnd(e.target.value)}
                            className="bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 text-[0.82rem] text-[#1A1A2E] focus:outline-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={addScheduleBlock}
                            className="bg-white text-[#050A12] font-bold rounded-lg py-2 text-[0.78rem] press-effect">추가</button>
                          <button onClick={() => { setShowAddBlock(false); setNewBlockTitle(""); setNewBlockStart(""); setNewBlockEnd(""); }}
                            className="bg-white border border-[#E5E7EB] text-[#9CA3AF] font-bold rounded-lg py-2 text-[0.78rem] press-effect">취소</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 위험도 + 실패 카드 */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className={`border rounded-3xl p-3 ${urgency.dangerLevel >= 70 ? "bg-[#FEF2F2] border-[#FECACA]" : urgency.dangerLevel >= 40 ? "bg-[#FFFBEB] border-[#FDE68A]" : "bg-[#F0FDF4] border-[#BBF7D0]"}`}>
                <div className="text-[0.75rem] text-[#9CA3AF] font-bold tracking-wider mb-1">오늘 망함 위험도</div>
                <div className={`text-2xl font-black ${urgency.dangerLevel >= 70 ? "text-[#FCA5A5]" : urgency.dangerLevel >= 40 ? "text-[#1A1A2E]" : "text-[#4ADE80]"}`}>
                  {urgency.dangerLevel}%
                </div>
              </div>
              <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-3xl p-3">
                <div className="text-[0.75rem] text-[#9CA3AF] font-bold tracking-wider mb-1">이번 달 실패</div>
                <div className="text-2xl font-black text-[#FCA5A5]">{failCount}회</div>
              </div>
            </div>

            {/* AI 명령 */}
            <div className="mb-4">
              {aiCommand && (
                <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4 mb-2">
                  <div className="text-[0.75rem] text-[#6B7280] font-bold tracking-wider mb-2">AI 명령</div>
                  <div className="text-[0.82rem] text-[#1A1A2E] leading-relaxed whitespace-pre-line break-all">{aiCommand}</div>
                </div>
              )}
              <button onClick={generateAICommand} disabled={aiLoading}
                className="w-full bg-white border border-[#E5E7EB] text-[#6B7280] font-bold rounded-2xl py-2.5 text-[0.82rem]">
                {aiLoading ? "AI 분석 중..." : aiCommand ? "AI 명령 다시 받기" : "AI 명령 받기"}
              </button>
            </div>

            {/* 일정 추가 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">일정 추가</div>
              <input type="text" value={scheduleTitle} onChange={e => setScheduleTitle(e.target.value)}
                placeholder="일정 내용"
                className="w-full bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-3 py-2.5 text-[0.85rem] text-[#1A1A2E] placeholder-white/25 focus:outline-none focus:border-[#D1D5DB] mb-2" />
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                  className="bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-3 py-2.5 text-[0.82rem] text-[#1A1A2E] focus:outline-none focus:border-[#D1D5DB]" />
                <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
                  className="bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-3 py-2.5 text-[0.82rem] text-[#1A1A2E] focus:outline-none focus:border-[#D1D5DB]" />
              </div>
              <button onClick={handleAddSchedule} disabled={scheduleLoading}
                className="w-full bg-white text-[#050A12] font-bold rounded-2xl py-2.5 text-[0.85rem]">
                {scheduleLoading ? "저장 중..." : "일정 추가"}
              </button>
            </div>

            {schedules.length === 0 ? (
              <div className="text-center py-8 text-[#9CA3AF] text-[0.82rem]">일정을 추가하면 여기에 보여요</div>
            ) : (
              <div>
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-2">다가오는 일정</div>
                {schedules.map((s, i) => (
                  <div key={i} className={`bg-white border border-[#E5E7EB] rounded-2xl p-3 mb-2 ${s.done ? "opacity-50" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button onClick={async () => { if (s.id) { await toggleScheduleDone(s.id, !s.done); await loadUserData(nickname); } }}
                          className={`w-5 h-5 rounded-md border flex items-center justify-center text-[0.75rem] ${s.done ? "bg-[#4ADE80] border-[#4ADE80] text-[#050A12]" : "border-[#D1D5DB]"}`}>
                          {s.done ? "✓" : ""}
                        </button>
                        <div className={`text-[0.85rem] font-bold ${s.done ? "line-through text-[#9CA3AF]" : "text-[#1A1A2E]"}`}>{s.title}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-[0.8rem] text-[#9CA3AF]">
                          {s.due_date === today ? "오늘" : s.due_date === new Date(Date.now() + 86400000).toISOString().split("T")[0] ? "내일" : s.due_date}
                        </div>
                        <button onClick={async () => { if (s.id && confirm("이 일정을 삭제할까요?")) { await deleteSchedule(s.id); await loadUserData(nickname); } }}
                          className="text-[0.8rem] text-[#FCA5A5]/50 hover:text-[#FCA5A5]">✕</button>
                      </div>
                    </div>
                    {s.due_time && <div className="text-[0.85rem] text-[#9CA3AF] mt-1 ml-7">{s.due_time}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* 내일 일정 압박 */}
            {tomorrowSchedules.length > 0 && (
              <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-3xl p-3 mb-3">
                <div className="text-[0.75rem] text-[#1A1A2E] font-bold tracking-wider mb-2">내일 일정 — 오늘 준비해야 함</div>
                {tomorrowSchedules.map((s, i) => (
                  <div key={i} className="text-[0.82rem] text-[#1A1A2E] font-bold mb-1">{s.due_time ? `${s.due_time} ` : ""}{s.title}</div>
                ))}
                <div className="text-[0.8rem] text-[#9CA3AF] mt-2">지금 준비 안 하면 내일 즉흥 대응입니다.</div>
              </div>
            )}

            {/* 내일 준비 상태 (Ultra 전용) */}
            {userPlan === "ultra" && tomorrowSchedules.length > 0 && (
              <div className="bg-[#F5F3FF] border border-[#DDD6FE] rounded-3xl p-5 mb-4">
                <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-wider mb-2">내일 준비 상태</div>
                {tomorrowSchedules.map((s, i) => {
                  const todayPrepped = records.some(r => r.date === today && r.done && r.task.includes(s.title));
                  return (
                    <div key={i} className="mb-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[0.82rem] font-bold text-[#1A1A2E]">{s.due_time ? `${s.due_time} ` : ""}{s.title}</div>
                        <div className={`text-[0.75rem] font-bold px-2 py-0.5 rounded-full ${todayPrepped ? "bg-[#4ADE80]/20 text-[#4ADE80]" : "bg-[#FCA5A5]/20 text-[#FCA5A5]"}`}>
                          {todayPrepped ? "준비됨" : "미준비"}
                        </div>
                      </div>
                      {!todayPrepped && (
                        <div className="text-[0.8rem] text-[#FCA5A5] mt-1">지금 15분만 준비하면 내일 여유롭다.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 분석 탭 ── */}
        {activeTab === "analysis" && (
          <div className="tab-content">
            {/* 주간 방향 조정 (Pro + Ultra) */}
            {userPlan !== "free" && (
              <div className="mb-4">
                {!weeklyReview ? (
                  <button onClick={generateWeeklyReview} disabled={weeklyLoading}
                    className="w-full bg-[#F5F3FF] border border-[#DDD6FE] rounded-3xl p-4 text-left press-effect">
                    <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-wider mb-1">주간 방향 조정</div>
                    <div className="text-[0.85rem] text-[#1A1A2E] font-bold mb-1">
                      {weeklyLoading ? "AI 분석 중..." : "이번 주 리뷰 생성하기"}
                    </div>
                    <div className="text-[0.8rem] text-[#9CA3AF]">AI가 이번 주 패턴을 분석하고 다음 주 전략을 제안합니다</div>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-wider">주간 방향 조정</div>
                      <button onClick={generateWeeklyReview} disabled={weeklyLoading}
                        className="text-[0.75rem] text-[#9CA3AF]">{weeklyLoading ? "분석 중..." : "다시 생성"}</button>
                    </div>

                    <button onClick={() => setWeeklyExpanded(!weeklyExpanded)}
                      className="w-full bg-white border border-[#E5E7EB] rounded-2xl py-2.5 text-[0.75rem] text-[#6B7280] press-effect mb-3">
                      {weeklyExpanded ? "접기" : "상세 보기"}
                    </button>

                    {weeklyExpanded && (<>
                      <div className="bg-[#F5F3FF] border border-[#EDE9FE] rounded-3xl p-4">
                        <div className="text-[0.92rem] font-black text-[#1A1A2E] leading-relaxed">
                          {weeklyReview.ai_analysis?.summary}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-3 text-center">
                          <div className="text-xl font-black text-[#4ADE80]">{weeklyReview.completed_tasks as number}</div>
                          <div className="text-[0.85rem] text-[#9CA3AF] mt-1">완료</div>
                        </div>
                        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-3 text-center">
                          <div className="text-xl font-black text-[#FCA5A5]">{(weeklyReview.total_tasks) - (weeklyReview.completed_tasks)}</div>
                          <div className="text-[0.85rem] text-[#9CA3AF] mt-1">실패</div>
                        </div>
                        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-3 text-center">
                          <div className="text-xl font-black text-[#1A1A2E]">{weeklyReview.streak_days as number}일</div>
                          <div className="text-[0.85rem] text-[#9CA3AF] mt-1">활동일</div>
                        </div>
                      </div>

                      <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-3xl p-4">
                        <div className="text-[0.75rem] text-[#4ADE80] font-bold tracking-wider mb-2">잘한 것</div>
                        {(weeklyReview.ai_analysis?.wins as string[])?.map((win: string, i: number) => (
                          <div key={i} className="text-[0.78rem] text-[#6B7280] mb-1">• {win}</div>
                        ))}
                      </div>

                      <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-3xl p-4">
                        <div className="text-[0.75rem] text-[#FCA5A5] font-bold tracking-wider mb-2">실패한 것</div>
                        {(weeklyReview.ai_analysis?.failures as string[])?.map((fail: string, i: number) => (
                          <div key={i} className="text-[0.78rem] text-[#6B7280] mb-1">• {fail}</div>
                        ))}
                        <div className="mt-3 pt-2 border-t border-[#FCA5A5]/10">
                          <div className="text-[0.75rem] text-[#FCA5A5] font-bold mb-1">근본 원인</div>
                          <div className="text-[0.78rem] text-[#1A1A2E] font-bold">{weeklyReview.ai_analysis?.root_cause}</div>
                        </div>
                      </div>

                      <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-3xl p-4">
                        <div className="text-[0.75rem] text-[#1A1A2E] font-bold tracking-wider mb-2">다음 주 포커스</div>
                        <div className="text-[0.92rem] font-black text-[#1A1A2E] mb-3">{weeklyReview.ai_analysis?.next_week_focus}</div>
                        {(weeklyReview.ai_analysis?.adjustments as string[])?.map((adj: string, i: number) => (
                          <div key={i} className="text-[0.78rem] text-[#6B7280] mb-1">→ {adj}</div>
                        ))}
                      </div>

                      <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-3xl p-4 text-center">
                        <div className="text-[0.85rem] font-semibold text-[#FCA5A5] leading-relaxed">{weeklyReview.ai_analysis?.pressure_message}</div>
                      </div>
                    </>)}

                    {/* 사용자 회고 */}
                    <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4">
                      <div className="text-[0.75rem] text-[#6B7280] font-bold tracking-wider mb-2">내 회고</div>
                      <textarea value={weeklyReflection} onChange={e => setWeeklyReflection(e.target.value)}
                        placeholder="이번 주를 돌아보며..."
                        className="w-full bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-3 py-2.5 text-[0.82rem] text-[#1A1A2E] placeholder-white/20 focus:outline-none focus:border-[#D1D5DB] mb-2 resize-none h-20" />
                      <textarea value={weeklyCommitment} onChange={e => setWeeklyCommitment(e.target.value)}
                        placeholder="다음 주 나와의 약속 하나..."
                        className="w-full bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-3 py-2.5 text-[0.82rem] text-[#1A1A2E] placeholder-white/20 focus:outline-none focus:border-[#D1D5DB] mb-3 resize-none h-14" />
                      <button onClick={saveWeeklyReflection} disabled={weeklySaving || (!weeklyReflection && !weeklyCommitment)}
                        className="w-full bg-[#7C3AED] text-[#1A1A2E] font-bold rounded-2xl py-2.5 text-[0.82rem] disabled:opacity-30 press-effect">
                        {weeklySaving ? "저장 중..." : "회고 저장하기"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 무료 유저에게 주간 리뷰 프로모션 */}
            {userPlan === "free" && records.length >= 5 && (
              <div className="bg-[#F5F3FF] border border-[#EDE9FE] rounded-3xl p-4 mb-4 press-effect" onClick={() => setActiveTab("settings")}>
                <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-wider mb-1">주간 방향 조정</div>
                <div className="text-[0.82rem] text-[#1A1A2E] font-bold mb-1">AI가 이번 주 왜 무너졌는지 알려준다</div>
                <div className="text-[0.8rem] text-[#9CA3AF]">Pro에서 사용 가능 →</div>
              </div>
            )}

            {/* 주간 실행률 그래프 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">최근 7일 실행률</div>
              <div className="flex items-end justify-between gap-1" style={{height: "100px"}}>
                {(() => {
                  const days = [];
                  const dayNames = ["일","월","화","수","목","금","토"];
                  for (let i = 6; i >= 0; i--) {
                    const d = new Date(Date.now() - 86400000 * i);
                    const dateStr = d.toISOString().split("T")[0];
                    const dayRecs = records.filter(r => r.date === dateStr);
                    const success = dayRecs.filter(r => r.done).length;
                    const fail = dayRecs.filter(r => !r.done).length;
                    const total = success + fail;
                    const rate = total > 0 ? Math.round((success / total) * 100) : 0;
                    const isToday = i === 0;
                    days.push(
                      <div key={i} className="flex flex-col items-center flex-1">
                        <div className="w-full flex flex-col items-center justify-end" style={{height: "70px"}}>
                          {total > 0 ? (
                            <div className={`w-full max-w-[28px] rounded-t-md ${rate >= 70 ? "bg-[#4ADE80]" : rate >= 40 ? "bg-[#FCD34D]" : "bg-[#FCA5A5]"}`}
                              style={{height: `${Math.max(8, rate * 0.7)}px`, transition: "height 0.5s ease"}} />
                          ) : (
                            <div className="w-full max-w-[28px] h-[4px] rounded bg-[#F3F4F6]" />
                          )}
                        </div>
                        <div className={`text-[0.85rem] mt-1.5 ${isToday ? "text-[#1A1A2E] font-bold" : "text-[#9CA3AF]"}`}>
                          {dayNames[d.getDay()]}
                        </div>
                        {total > 0 && (
                          <div className={`text-[0.7rem] ${rate >= 70 ? "text-[#4ADE80]" : rate >= 40 ? "text-[#1A1A2E]" : "text-[#FCA5A5]"}`}>
                            {rate}%
                          </div>
                        )}
                      </div>
                    );
                  }
                  return days;
                })()}
              </div>
            </div>

            {/* 실패 시간대 히트맵 */}
            {records.filter(r => !r.done && r.hour_of_day !== undefined).length >= 3 && (
              <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">실패가 많은 시간대</div>
                <div className="grid grid-cols-6 gap-1">
                  {(() => {
                    const hourCounts: Record<number, number> = {};
                    records.filter(r => !r.done && r.hour_of_day !== undefined).forEach(r => {
                      const h = r.hour_of_day!;
                      hourCounts[h] = (hourCounts[h] || 0) + 1;
                    });
                    const maxCount = Math.max(...Object.values(hourCounts), 1);
                    const slots = [
                      { label: "오전", hours: [6,7,8,9,10,11] },
                      { label: "오후", hours: [12,13,14,15,16,17] },
                      { label: "저녁", hours: [18,19,20,21,22,23] },
                    ];
                    return slots.flatMap(slot =>
                      slot.hours.map(h => {
                        const count = hourCounts[h] || 0;
                        const intensity = count / maxCount;
                        return (
                          <div key={h} className="flex flex-col items-center">
                            <div className="w-full aspect-square rounded-md flex items-center justify-center text-[0.7rem]"
                              style={{
                                background: count > 0 ? `rgba(252, 165, 165, ${0.15 + intensity * 0.65})` : "#1E293B",
                                color: count > 0 ? "#FCA5A5" : "#334155",
                              }}>
                              {h}
                            </div>
                          </div>
                        );
                      })
                    );
                  })()}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[0.7rem] text-[#9CA3AF]">오전</span>
                  <span className="text-[0.7rem] text-[#9CA3AF]">오후</span>
                  <span className="text-[0.7rem] text-[#9CA3AF]">저녁</span>
                </div>
                {(() => {
                  const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
                  if (failsByHour.length === 0) return null;
                  const hourCounts: Record<number, number> = {};
                  failsByHour.forEach(r => { hourCounts[r.hour_of_day!] = (hourCounts[r.hour_of_day!] || 0) + 1; });
                  const sorted = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]));
                  const peakHour = Number(sorted[0][0]);
                  const timeLabel = peakHour >= 20 ? "밤" : peakHour >= 16 ? "저녁" : peakHour >= 12 ? "오후" : "오전";
                  return (
                    <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl p-3 mt-3">
                      <div className="text-[0.78rem] font-bold text-[#1A1A2E]">당신은 {timeLabel} {peakHour}시에 가장 자주 무너집니다.</div>
                      {userPlan !== "free" && (
                        <div className="text-[0.8rem] text-[#6B7280] mt-1">다음부터 {peakHour > 0 ? peakHour - 1 : 23}시에 미리 개입합니다.</div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 전체 현황 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">전체 현황</div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-2xl font-black text-[#4ADE80]">{successCount}</div>
                  <div className="text-[0.75rem] text-[#9CA3AF] mt-1">성공</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-[#FCA5A5]">{failCount}</div>
                  <div className="text-[0.75rem] text-[#9CA3AF] mt-1">실패</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-[#1A1A2E]">{streak}</div>
                  <div className="text-[0.75rem] text-[#9CA3AF] mt-1">streak</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-2">성공률</div>
              <div className="text-3xl font-black text-[#1A1A2E] mb-2">{successRate}%</div>
              <div className="w-full bg-[#F3F4F6] rounded-full h-2">
                <div className="bg-white h-2 rounded-full" style={{ width: `${successRate}%` }}></div>
              </div>
            </div>

            {/* 달력 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">이번 달 기록</div>
              <div className="grid grid-cols-7 gap-1">
                {["월","화","수","목","금","토","일"].map(d => (
                  <div key={d} className="text-center text-[0.85rem] text-[#9CA3AF] mb-1">{d}</div>
                ))}
                {(() => {
                  const now = new Date();
                  const year = now.getFullYear();
                  const month = now.getMonth();
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const todayDate = now.getDate();
                  const offset = firstDay === 0 ? 6 : firstDay - 1;
                  const cells = [];
                  for (let i = 0; i < offset; i++) cells.push(<div key={`e${i}`} />);
                  for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                    const dayRecords = records.filter(r => r.date === dateStr);
                    const hasSuccess = dayRecords.some(r => r.done);
                    const hasFail = dayRecords.some(r => !r.done);
                    const isFuture = day > todayDate;
                    const isToday = day === todayDate;
                    let bg = "bg-[#F3F4F6]";
                    if (hasSuccess) bg = "bg-[#4ADE80]";
                    else if (hasFail) bg = "bg-[#FCA5A5]";
                    else if (isFuture) bg = "bg-white border border-[#E5E7EB]/50";
                    else if (!isFuture && day < todayDate) bg = "bg-[#FCA5A5]/30";
                    cells.push(
                      <div key={day} className={`aspect-square rounded-md flex items-center justify-center text-[0.75rem] font-bold ${bg} ${isToday ? "ring-1 ring-white" : ""}`}>
                        <span className={hasSuccess ? "text-[#050A12]" : hasFail ? "text-[#050A12]" : isFuture ? "text-[#9CA3AF]" : "text-[#9CA3AF]"}>{day}</span>
                      </div>
                    );
                  }
                  return cells;
                })()}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-[#4ADE80]"></div><span className="text-[0.85rem] text-[#9CA3AF]">성공</span></div>
                <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-[#FCA5A5]"></div><span className="text-[0.85rem] text-[#9CA3AF]">실패</span></div>
                <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-[#FCA5A5]/30"></div><span className="text-[0.85rem] text-[#9CA3AF]">미접속</span></div>
              </div>
            </div>

            {/* 실행 점수 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-2">실행 점수</div>
              {(() => {
                const score = records.reduce((s, r) => s + (r.done ? 20 : -10), 0);
                const level = score >= 500 ? "다이아몬드" : score >= 200 ? "골드" : score >= 80 ? "실버" : "브론즈";
                const levelColor = score >= 500 ? "#60A5FA" : score >= 200 ? "#FCD34D" : score >= 80 ? "#94A3B8" : "#B45309";
                const nextLevel = score >= 500 ? null : score >= 200 ? 500 : score >= 80 ? 200 : 80;
                const progress = nextLevel ? Math.min(100, Math.round(score / nextLevel * 100)) : 100;
                return (
                  <div>
                    <div className="flex items-end gap-2 mb-2">
                      <div className="text-3xl font-black" style={{color: levelColor}}>{score}</div>
                      <div className="text-[0.85rem] font-bold mb-1" style={{color: levelColor}}>{level}</div>
                    </div>
                    <div className="w-full bg-[#F3F4F6] rounded-full h-2 mb-1">
                      <div className="h-2 rounded-full" style={{width: `${progress}%`, background: levelColor}}></div>
                    </div>
                    {nextLevel && <div className="text-[0.75rem] text-[#9CA3AF]">다음 등급까지 {nextLevel - score}점</div>}
                    <div className="text-[0.85rem] text-[#9CA3AF] mt-2">완료 +20 · 실패 -10</div>
                  </div>
                );
              })()}
            </div>

            {/* 스트릭 등급 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">스트릭 등급</div>
              {(() => {
                const sLevel = streak >= 30 ? "골드" : streak >= 7 ? "실버" : "브론즈";
                const sColor = streak >= 30 ? "#FCD34D" : streak >= 7 ? "#94A3B8" : "#B45309";
                const sNext = streak >= 30 ? null : streak >= 7 ? 30 : 7;
                return (
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="text-3xl font-black text-[#1A1A2E]">{streak}일</div>
                      <div className="text-[0.82rem] font-bold" style={{color: sColor}}>{sLevel}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { name: "브론즈", days: "0일+", min: 0, color: "#B45309" },
                        { name: "실버", days: "7일+", min: 7, color: "#94A3B8" },
                        { name: "골드", days: "30일+", min: 30, color: "#FCD34D" },
                      ].map(tier => (
                        <div key={tier.name} className={`text-center py-2 rounded-lg ${streak >= tier.min ? `bg-[${tier.color}]/20` : "bg-[#F3F4F6]"}`}>
                          <div className="text-[0.85rem] font-bold" style={{color: streak >= tier.min ? tier.color : "#334155"}}>{tier.name}</div>
                          <div className="text-[0.85rem] text-[#9CA3AF]">{tier.days}</div>
                        </div>
                      ))}
                    </div>
                    {sNext && <div className="text-[0.75rem] text-[#9CA3AF] mt-2 text-center">다음 등급까지 {sNext - streak}일</div>}
                    <div className="text-[0.8rem] text-[#FCA5A5] mt-2 text-center font-bold">스트릭 끊기면 등급 리셋됩니다</div>
                  </div>
                );
              })()}
            </div>

            {/* 패턴 분석 - Pro/Ultra */}
            {records.length >= 3 && userPlan === "free" && (
              <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-3xl p-4 mb-3 opacity-60">
                <div className="text-[0.8rem] text-[#FCA5A5] font-bold tracking-widest uppercase mb-2">내가 왜 망하는지</div>
                <div className="text-[0.82rem] text-[#9CA3AF]">Pro 이상에서 확인할 수 있습니다.</div>
                <button onClick={() => setActiveTab("settings")} className="mt-2 text-[0.85rem] text-[#1A1A2E] font-bold">Pro 시작하기 →</button>
              </div>
            )}
            {records.length >= 3 && userPlan !== "free" && (
              <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-3xl p-5 mb-4">
                <div className="text-[0.8rem] text-[#FCA5A5] font-bold tracking-widest uppercase mb-2">내가 왜 망하는지</div>
                <div className="text-[0.92rem] font-black text-[#1A1A2E]">
                  {(() => {
                    const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
                    if (failsByHour.length === 0) return "데이터가 쌓이면 패턴을 분석합니다";
                    const avgHour = Math.round(failsByHour.reduce((s, r) => s + (r.hour_of_day || 0), 0) / failsByHour.length);
                    const topReason = Object.entries(
                      records.filter(r => !r.done && r.fail_reason).reduce((acc, r) => {
                        const k = r.fail_reason || "기타"; acc[k] = (acc[k] || 0) + 1; return acc;
                      }, {} as Record<string, number>)
                    ).sort((a, b) => b[1] - a[1])[0];
                    const timeLabel = avgHour >= 20 ? "밤" : avgHour >= 16 ? "오후 늦게" : avgHour >= 12 ? "오후" : "오전";
                    return topReason
                      ? `너는 ${timeLabel}에 "${topReason[0]}" 때문에 항상 무너진다.`
                      : `너는 ${timeLabel}에 항상 무너진다.`;
                  })()}
                </div>
              </div>
            )}

            {goal && (
              <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
                <div className="text-[0.8rem] text-[#6B7280] font-bold tracking-wider mb-2">이번 달 목표</div>
                <div className="text-[0.88rem] font-bold text-[#1A1A2E]">{goal}</div>
              </div>
            )}

            {records.length >= 3 && userPlan !== "free" && (
              <div className="bg-white border border-[#E5E7EB] rounded-3xl p-4">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">주요 실패 이유</div>
                {Object.entries(
                  records.filter(r => !r.done && r.fail_reason).reduce((acc, r) => {
                    const k = r.fail_reason || "기타"; acc[k] = (acc[k] || 0) + 1; return acc;
                  }, {} as Record<string, number>)
                ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between py-2 border-b border-[#E5E7EB]/50 last:border-0">
                    <div className="text-[0.78rem] text-[#6B7280]">{reason}</div>
                    <div className="text-[0.78rem] text-[#FCA5A5] font-bold">{count}회</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 설정 탭 ── */}
        {activeTab === "settings" && (
          <div className="tab-content">
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[1.1rem] font-black text-[#1A1A2E]">{nickname || "게스트"}</div>
                  <div className="text-[0.8rem] text-[#9CA3AF] mt-0.5">{streak}일 연속</div>
                </div>
                <div className={`text-[0.7rem] font-bold px-3 py-1 rounded-full ${
                  userPlan === "ultra" ? "bg-[#7C3AED]/20 text-[#7C3AED]" :
                  userPlan === "pro" ? "bg-white/10 text-[#1A1A2E]" :
                  "bg-white/5 text-[#9CA3AF]"
                }`}>{userPlan === "free" ? "FREE" : userPlan.toUpperCase()}</div>
              </div>
              {userPlan === "free" && (
                <div className="bg-white border border-[#E5E7EB] rounded-2xl p-3">
                  <div className="text-[0.75rem] text-[#9CA3AF] font-bold tracking-wider mb-1">무료 플랜</div>
                  <div className="text-[0.85rem] text-[#9CA3AF]">Pro로 업그레이드하면 패턴 분석이 시작됩니다.</div>
                </div>
              )}
              {userPlan === "pro" && (
                <div className="bg-[#0D1A2E] border border-[#3B82F6]/20 rounded-2xl p-3">
                  <div className="text-[0.75rem] text-[#60A5FA] font-bold tracking-wider mb-1">Pro 플랜 활성</div>
                  <div className="text-[0.85rem] text-[#6B7280]">패턴 분석과 주간 리뷰가 작동 중입니다.</div>
                </div>
              )}
              {userPlan === "ultra" && (
                <div className="bg-[#F5F3FF] border border-[#EDE9FE] rounded-2xl p-3">
                  <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-wider mb-1">Ultra 플랜 활성</div>
                  <div className="text-[0.85rem] text-[#6B7280]">AI가 당신의 실행을 전체 관리하고 있습니다.</div>
                </div>
              )}
            </div>

            {/* 메뉴 블록 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl mb-3">
              <button onClick={() => setShowGoalModal(true)} className="w-full flex items-center justify-between px-4 py-3.5 border-b border-[#E5E7EB]/50">
                <span className="text-[0.85rem] text-[#1A1A2E] font-medium">이번 달 목표</span>
                <div className="flex items-center gap-2">
                  <span className="text-[0.85rem] text-[#9CA3AF]">{goal || "미설정"}</span>
                  <span className="text-[#9CA3AF]">›</span>
                </div>
              </button>
              <button onClick={() => setShowNicknameModal(true)} className="w-full flex items-center justify-between px-4 py-3.5 border-b border-[#E5E7EB]/50">
                <span className="text-[0.85rem] text-[#1A1A2E] font-medium">닉네임</span>
                <div className="flex items-center gap-2">
                  <span className="text-[0.85rem] text-[#9CA3AF]">{nickname}</span>
                  <span className="text-[#9CA3AF]">›</span>
                </div>
              </button>
              <div className="w-full flex items-center justify-between px-4 py-3.5">
                <span className="text-[0.85rem] text-[#1A1A2E] font-medium">실행 점수</span>
                <span className="text-[0.85rem] text-[#9CA3AF]">{records.reduce((s, r) => s + (r.done ? 20 : -10), 0)}점</span>
              </div>
            </div>

            {/* 코칭 스타일 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl mb-3">
              <div className="px-4 py-3 border-b border-[#E5E7EB]/50">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-wider uppercase">코칭 스타일</div>
              </div>
              <div className="grid grid-cols-3 gap-0">
                {([
                  { mode: "strong" as const, label: "강하게", desc: "거침없는 압박" },
                  { mode: "normal" as const, label: "보통", desc: "균형잡힌 코칭" },
                  { mode: "gentle" as const, label: "부드럽게", desc: "격려 중심" },
                ]).map(opt => (
                  <button key={opt.mode} onClick={() => { setPressureMode(opt.mode); localStorage.setItem("vanguard_pressure", opt.mode); }}
                    className={`flex flex-col items-center py-3 press-effect ${pressureMode === opt.mode ? "bg-white/5" : ""}`}>
                    <span className={`text-[0.75rem] font-bold ${pressureMode === opt.mode ? "text-[#1A1A2E]" : "text-[#9CA3AF]"}`}>{opt.label}</span>
                    <span className="text-[0.85rem] text-[#9CA3AF] mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 플랜 관리 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl mb-3">
              <div className="px-4 py-3 border-b border-[#E5E7EB]/50">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-wider uppercase">플랜 관리</div>
              </div>
              {userPlan === "free" && (
                <div>
                  <button onClick={() => window.open(`https://qr.kakaopay.com/FGVf0Mmo6?amount=9900&memo=Vanguard_Pro_${nickname}`, "_blank")}
                    className="w-full flex items-center justify-between px-4 py-3.5 border-b border-[#E5E7EB]/50">
                    <span className="text-[0.85rem] text-[#1A1A2E] font-medium">Pro 시작하기</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.85rem] text-[#9CA3AF]">₩9,900/월</span>
                      <span className="text-[#9CA3AF]">›</span>
                    </div>
                  </button>
                  <button onClick={() => window.open(`https://qr.kakaopay.com/FGVf0Mmo6?amount=49000&memo=Vanguard_Ultra_${nickname}`, "_blank")}
                    className="w-full flex items-center justify-between px-4 py-3.5">
                    <span className="text-[0.85rem] text-[#1A1A2E] font-medium">Ultra 시작하기</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.85rem] text-[#9CA3AF]">₩49,000/월</span>
                      <span className="text-[#9CA3AF]">›</span>
                    </div>
                  </button>
                </div>
              )}
              {userPlan === "pro" && (
                <button onClick={() => window.open(`https://qr.kakaopay.com/FGVf0Mmo6?amount=49000&memo=Vanguard_Ultra_${nickname}`, "_blank")}
                  className="w-full flex items-center justify-between px-4 py-3.5">
                  <span className="text-[0.85rem] text-[#1A1A2E] font-medium">Ultra로 업그레이드</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.85rem] text-[#9CA3AF]">₩49,000/월</span>
                    <span className="text-[#9CA3AF]">›</span>
                  </div>
                </button>
              )}
              {userPlan === "ultra" && (
                <div className="px-4 py-3.5">
                  <div className="text-[0.78rem] text-[#7C3AED] font-medium">Ultra 플랜 사용 중 · ₩49,000/월</div>
                </div>
              )}
            </div>

            {/* 기타 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl mb-3">
              <button onClick={() => setShowInquiry(true)} className="w-full flex items-center justify-between px-4 py-3.5 border-b border-[#E5E7EB]/50">
                <span className="text-[0.85rem] text-[#1A1A2E] font-medium">문의하기</span>
                <span className="text-[#9CA3AF]">›</span>
              </button>
              <button onClick={async () => { await supabase.auth.signOut(); localStorage.removeItem("vanguard_nickname"); window.location.href = "/login"; }}
                className="w-full flex items-center justify-between px-4 py-3.5">
                <span className="text-[0.85rem] text-[#FCA5A5] font-medium">로그아웃</span>
              </button>
            </div>

            <div className="bg-white border border-[#E5E7EB]/50 rounded-2xl p-3 mt-1">
              <div className="text-[0.75rem] text-[#9CA3AF] text-center leading-relaxed">
                결제 후 카카오톡으로 닉네임과 플랜을 알려주시면<br />
                24시간 내 활성화됩니다. 환불은 7일 이내 전액 가능.
              </div>
            </div>
          </div>
        )}
        </div>

        {/* 하단 네비게이션 */}
        {!showSplash && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#FAFAFA]/95 backdrop-blur-xl border-t border-[#E5E7EB] pb-safe z-50">
            <div className="max-w-[420px] mx-auto grid grid-cols-4 px-4 pt-3 pb-2">
              {[
                { id: "home" as Tab, label: "홈" },
                { id: "briefing" as Tab, label: "브리핑" },
                { id: "analysis" as Tab, label: "분석" },
                { id: "settings" as Tab, label: "설정" },
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`py-3 rounded-2xl transition-all press-effect ${activeTab === tab.id ? "bg-white/10" : ""}`}>
                  <span className={`text-[0.85rem] font-bold ${activeTab === tab.id ? "text-[#1A1A2E]" : "text-[#9CA3AF]"}`}>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}