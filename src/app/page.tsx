"use client";
function toKST(date?: Date | number): Date {
  const d = date ? new Date(date) : new Date();
  return new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}
function kstDateStr(date?: Date | number): string {
  const k = toKST(date);
  return `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`;
}

import { useState, useEffect, useCallback } from "react";
import { supabase,
  getUser,
  createUser,
  updateUserProfile,
  saveRecord,
  getRecords,
  calcStreak,
  getWeeklyLeaderboard,
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
  comebackToday: boolean;
  weeklyComebacks: number;
  gapDays: number;
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
  const today = (() => { const k = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })); return `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`; })();


  const yesterday = kstDateStr(Date.now() - 86400000);

  const byDate: Record<string, boolean> = {};
  records.forEach(r => {
    if (byDate[r.date] === undefined) byDate[r.date] = r.done;
    else if (r.done) byDate[r.date] = true;
  });

  const todayCompleted = byDate[today] === true;
  const lastSuccess = byDate[yesterday] === true;

  let consecutiveFails = 0;
  for (let i = 1; i <= 7; i++) {
    const d = kstDateStr(Date.now() - 86400000 * i);
    if (byDate[d] === false) consecutiveFails++;
    else break;
  }

  const weekAgo = kstDateStr(Date.now() - 86400000 * 7);
  const thisWeekFails = records.filter(r => !r.done && r.date >= weekAgo).length;
  const failStreak = records.filter(r => !r.done).length;

  const allDates = records.map(r => r.date).sort();
  const firstActiveDate = allDates.length > 0 ? allDates[0] : today;
  let lastSuccessDate = "";
  for (let i = 1; i <= 60; i++) {
    const d = kstDateStr(Date.now() - 86400000 * i);
    if (d < firstActiveDate) break;
    if (byDate[d] === true) { lastSuccessDate = d; break; }
  }
  let gapDays = 0;
  if (lastSuccessDate) {
    const lastMs = new Date(lastSuccessDate + "T00:00:00+09:00").getTime();
    const todayMs = new Date(today + "T00:00:00+09:00").getTime();
    gapDays = Math.round((todayMs - lastMs) / 86400000) - 1;
    if (gapDays < 0) gapDays = 0;
  }
  const comebackToday = todayCompleted && gapDays >= 1;
  let weeklyComebacks = 0;
  for (let i = 0; i <= 6; i++) {
    const d = kstDateStr(Date.now() - 86400000 * i);
    if (d < firstActiveDate) break;
    const prevD = kstDateStr(Date.now() - 86400000 * (i + 1));
    if (byDate[d] === true && prevD >= firstActiveDate && (byDate[prevD] === false || byDate[prevD] === undefined)) {
      weeklyComebacks++;
    }
  }
  return { lastSuccess, failStreak, currentHour: hour, todayCompleted, consecutiveFails, thisWeekFails, comebackToday, weeklyComebacks, gapDays };
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
  const [planAnalysis, setPlanAnalysis] = useState("");
  const [planAnalyzing, setPlanAnalyzing] = useState(false);

  const [aiCommand, setAiCommand] = useState("");
  const [aiUsedCount, setAiUsedCount] = useState(0);
  const [tomorrowLetter, setTomorrowLetter] = useState("");
  const [missionFeedback, setMissionFeedback] = useState("");
  const [dailyAiInsight, setDailyAiInsight] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const [showInquiry, setShowInquiry] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCoachChat, setShowCoachChat] = useState(false);
  const [coachMessages, setCoachMessages] = useState<{role: string; text: string}[]>([]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [onboardAiResult, setOnboardAiResult] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<{ nickname: string; xp: number }[]>([]);
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null);
  const [onboardStep, setOnboardStep] = useState(0);
  const [profileOccupation, setProfileOccupation] = useState("");
  const [profileFocusTime, setProfileFocusTime] = useState("");
  const [profileObstacle, setProfileObstacle] = useState("");
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

  const hour = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getHours();
  const urgency = getUrgencyMessage(hour, failCount, goal);
  const today = (() => { const k = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })); return `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`; })();

  // AI 오늘의 분석 생성
  useEffect(() => {
    if (records.length >= 3 && nickname && !dailyAiInsight) {
      const cached = localStorage.getItem("vanguard_daily_insight_" + today);
      if (cached) { setDailyAiInsight(cached); return; }
      const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
      const avgFailHour = failsByHour.length > 0 ? Math.round(failsByHour.reduce((s, r) => s + (r.hour_of_day || 0), 0) / failsByHour.length) : 0;
      const topReason = Object.entries(records.filter(r => !r.done && r.fail_reason).reduce((a, r) => { a[r.fail_reason || "기타"] = (a[r.fail_reason || "기타"] || 0) + 1; return a; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0];
      const yesterdayRecords = records.filter(r => r.date === kstDateStr(Date.now() - 86400000));
      const yesterdaySuccess = yesterdayRecords.filter(r => r.done).length;
      const yesterdayFail = yesterdayRecords.filter(r => !r.done).length;
      const timeLabel = avgFailHour >= 20 ? "밤" : avgFailHour >= 16 ? "저녁" : avgFailHour >= 12 ? "오후" : "오전";

      let insight = "";
      if (yesterdayFail > 0 && yesterdaySuccess === 0) {
        insight = "어제 멈췄다. 오늘 3분만 시작하면 흐름이 돌아온다.";
      } else if (yesterdaySuccess > 0 && yesterdayFail === 0) {
        insight = "어제 " + yesterdaySuccess + "개 완료했다. " + streak + "일 연속이다. 오늘도 이어가라.";
      } else if (yesterdaySuccess > 0 && yesterdayFail > 0) {
        insight = "어제 " + yesterdaySuccess + "개 성공, " + yesterdayFail + "개 실패. " + timeLabel + " " + avgFailHour + "시가 위험하다.";
      } else if (failsByHour.length >= 3) {
        insight = timeLabel + " " + avgFailHour + "시에 자주 무너진다. 그 전에 시작해라.";
      } else {
        insight = "오늘 하나만 시작해라. 시작하면 끝낼 수 있다.";
      }
      setDailyAiInsight(insight);
      localStorage.setItem("vanguard_daily_insight_" + today, insight);
    }
  }, [records, nickname, today, dailyAiInsight, streak]);

  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        const savedNick = localStorage.getItem("vanguard_nickname");
        if (savedNick) {
          return;
        }
        const trial = localStorage.getItem("vanguard_guest_trial");
        if (!trial) {
          router.replace("/login");
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

  // 유저 맥락 통합 시스템 — 모든 AI 호출에 사용
  async function getUserContext(nick: string) {
    const recs = records.length > 0 ? records : await getRecords(nick);
    const kstToday = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const todayStr = `${kstToday.getFullYear()}-${String(kstToday.getMonth()+1).padStart(2,"0")}-${String(kstToday.getDate()).padStart(2,"0")}`;
    const todayRecs = recs.filter(r => r.date === todayStr);
    const weekAgo = kstDateStr(Date.now() - 7 * 86400000);
    const weekRecs = recs.filter(r => r.date >= weekAgo);
    
    // 실패 패턴 분석
    const failRecs = recs.filter(r => !r.done);
    const failHours: Record<number, number> = {};
    failRecs.forEach(r => { if (r.hour_of_day !== undefined) failHours[r.hour_of_day] = (failHours[r.hour_of_day] || 0) + 1; });
    const peakFailHour = Object.entries(failHours).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    
    const failReasons: Record<string, number> = {};
    failRecs.forEach(r => { const reason = r.fail_reason || "기타"; failReasons[reason] = (failReasons[reason] || 0) + 1; });
    const topFailReason = Object.entries(failReasons).sort((a, b) => b[1] - a[1])[0];
    
    // 요일별 분석
    const dayNames = ["일","월","화","수","목","금","토"];
    const dayStats: Record<number, {done: number, fail: number}> = {};
    recs.forEach(r => { const d = new Date(r.date).getDay(); if (!dayStats[d]) dayStats[d] = {done:0,fail:0}; if (r.done) dayStats[d].done++; else dayStats[d].fail++; });
    const worstDay = Object.entries(dayStats).filter(([,v]) => v.fail > 0).sort((a, b) => b[1].fail - a[1].fail)[0];
    const bestDay = Object.entries(dayStats).filter(([,v]) => v.done > 0).sort((a, b) => (b[1].done/(b[1].done+b[1].fail)) - (a[1].done/(a[1].done+a[1].fail)))[0];
    
    // 프로필 정보
    const occ = localStorage.getItem("vanguard_occupation") || "";
    const focus = localStorage.getItem("vanguard_focus_time") || "";
    const obs = localStorage.getItem("vanguard_obstacle") || "";
    
    const ctx = {
      nickname: nick,
      goal: goal || "미설정",
      plan: userPlan,
      streak: streak,
      totalDone: recs.filter(r => r.done).length,
      totalFail: failRecs.length,
      totalRate: recs.length > 0 ? Math.round((recs.filter(r => r.done).length / recs.length) * 100) : 0,
      todayDone: todayRecs.filter(r => r.done).length,
      todayFail: todayRecs.filter(r => !r.done).length,
      weekDone: weekRecs.filter(r => r.done).length,
      weekFail: weekRecs.filter(r => !r.done).length,
      peakFailHour: peakFailHour ? `${peakFailHour[0]}시(${peakFailHour[1]}회)` : "없음",
      topFailReason: topFailReason ? `${topFailReason[0]}(${topFailReason[1]}회)` : "없음",
      worstDay: worstDay ? `${dayNames[Number(worstDay[0])]}요일` : "없음",
      bestDay: bestDay ? `${dayNames[Number(bestDay[0])]}요일` : "없음",
      occupation: occ,
      focusTime: focus,
      obstacle: obs,
    };
    return ctx;
  }
  
  function contextToPrompt(ctx: any) {
    return `[유저 맥락] 닉네임: ${ctx.nickname}. 목표: ${ctx.goal}. 직업: ${ctx.occupation || "미설정"}. 집중시간: ${ctx.focusTime || "미설정"}. 장애물: ${ctx.obstacle || "미설정"}. 스트릭: ${ctx.streak}일. 전체 실행률: ${ctx.totalRate}%. 오늘 완료: ${ctx.todayDone}개, 실패: ${ctx.todayFail}개. 이번 주 완료: ${ctx.weekDone}개, 실패: ${ctx.weekFail}개. 가장 많이 무너지는 시간: ${ctx.peakFailHour}. 무너지는 이유 1위: ${ctx.topFailReason}. 최약 요일: ${ctx.worstDay}. 최강 요일: ${ctx.bestDay}.`;
  }
  
  // AI 로그 저장 — 미래 자체 AI 학습용
  async function saveAiLog(nick: string, logType: string, input: any, output: any, context: any) {
    try {
      const { error } = await supabase.from("ai_logs").insert([{
        nickname: nick,
        log_type: logType,
        input_data: input,
        output_data: output,
        context: context,
      }]);
      if (error) console.error("ai_logs 저장 실패:", error.message);
    } catch (e) { console.error("ai_logs 예외:", e); }
  }

  const loadUserData = useCallback(async (nick: string) => {
    const recs = await getRecords(nick);
    setRecords(recs);
    setStreak(calcStreak(recs));
fetch("/api/leaderboard").then(r => r.json()).then(d => setLeaderboard(d.leaderboard || [])).catch(() => {});
    fetch(`/api/coach-chat?nickname=${encodeURIComponent(nick)}`).then(r => r.json()).then(d => {
      if (d.messages && d.messages.length > 0) {
        setCoachMessages(d.messages.map((m: any) => ({ role: m.role, text: m.text })));
      }
    }).catch(() => {});
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

    const savedType = localStorage.getItem("vanguard_user_type");
    if (recs.length === 0 && !g && !savedType) {
      setIsNewUser(true);
    } else {
      setIsNewUser(false);
      if (savedType) setUserType(savedType as "planner" | "starter" | "repeater");
    }

    try {
      const kstNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
      const today = `${kstNow.getFullYear()}-${String(kstNow.getMonth()+1).padStart(2,"0")}-${String(kstNow.getDate()).padStart(2,"0")}`;
      const currentHour = kstNow.getHours();
      const currentTime = `${String(currentHour).padStart(2,"0")}:${String(kstNow.getMinutes()).padStart(2,"0")}`;
      
      const schedRes = await fetch(`/api/schedule?nickname=${nick}&date=${today}`);
      const schedData = await schedRes.json();
      
      if (schedData.schedule) {
        // 현재 시간 이후 블록만 필터링
        const futureBlocks = (schedData.schedule.blocks || []).filter((b: any) => b.start >= currentTime || b.is_completed);
        
        if (futureBlocks.length > 0) {
          setDailySchedule({ ...schedData.schedule, blocks: futureBlocks, total_blocks: futureBlocks.length });
        } else {
          // 모든 블록이 지났으면 새로 생성
          const genRes = await fetch("/api/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: nick }),
          });
          const genData = await genRes.json();
          if (genData.schedule) setDailySchedule(genData.schedule);
        }
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
    const yesterday = kstDateStr(Date.now() - 86400000);
    if (letter && letterDate === yesterday) setYesterdayLetter(letter);
    if (saved) {
      setNickname(saved);
      setIsGuest(false);
      loadUserData(saved);
      // 프로필도 DB에서 로드
      (async () => {
        try {
          const { data } = await supabase.from("users").select("occupation, focus_time, obstacle").eq("nickname", saved).single();
          if (data) {
            if (data.occupation) localStorage.setItem("vanguard_occupation", data.occupation);
            if (data.focus_time) localStorage.setItem("vanguard_focus_time", data.focus_time);
            if (data.obstacle) localStorage.setItem("vanguard_obstacle", data.obstacle);
          }
        } catch {}
      })();
    }
  }, [loadUserData]);

  // 알림 설정
  useEffect(() => {
    if (isGuest || !nickname) return;
    
    // 알림 권한 요청
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    
    // 매 시간 체크 — 오늘 미션을 안 했으면 알림
    const notifTimer = setInterval(() => {
      if ("Notification" in window && Notification.permission === "granted") {
        const kstNow = toKST();
        const h = kstNow.getHours();
        const todayStr = kstDateStr();
        const todayDone = records.filter(r => r.date === todayStr && r.done).length;
        
        // 오전 9시, 오후 2시, 저녁 7시에 체크
        if ((h === 9 || h === 14 || h === 19) && todayDone === 0) {
          new Notification("Vanguard", {
            body: h === 9 ? "좋은 아침. 오늘 첫 미션을 시작하자." 
              : h === 14 ? "오후가 지나고 있다. 아직 하나도 안 했다." 
              : "저녁이다. 오늘 0개 완료. 3분이라도 시작해라.",
            icon: "/icon-192x192.png",
            tag: "vanguard-reminder",
          });
        }
        
        // 스트릭 끊기 직전 경고 (밤 10시)
        if (h === 22 && todayDone === 0 && streak > 0) {
          new Notification("Vanguard", {
            body: `${streak}일 스트릭이 끊기려고 한다. 지금 3분만 하면 살릴 수 있다.`,
            icon: "/icon-192x192.png",
            tag: "vanguard-streak-warning",
          });
        }
      }
    }, 60 * 60 * 1000); // 1시간마다 체크
    
    return () => clearInterval(notifTimer);
  }, [isGuest, nickname, records, streak]);

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
      setShowOnboarding(true);
      setShowNicknameModal(false);
      trackEvent("signup", { nickname: nick });
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
    const kstTmr = new Date(new Date(Date.now() + 86400000).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const tomorrow = `${kstTmr.getFullYear()}-${String(kstTmr.getMonth()+1).padStart(2,"0")}-${String(kstTmr.getDate()).padStart(2,"0")}`;
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
      const { error } = await supabase.from("user_events").insert([{
        nickname,
        event_type: eventType,
        event_data: data,
      }]);
      if (error) console.error("user_events 저장 실패:", error.message);
    } catch (e) { console.error("user_events 예외:", e); }
  }
  async function saveCoachChat(role: string, text: string) {
    if (isGuest || !nickname) return;
    try {
      await fetch("/api/coach-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, role, text }),
      });
    } catch {}
  }
  async function sendCoachMessage() {
    if (!coachInput.trim() || coachLoading) return;
    const userMsg = coachInput.trim();
    setCoachInput("");
    setCoachMessages(prev => [...prev, { role: "user", text: userMsg }]);
    saveCoachChat("user", userMsg);
    setCoachLoading(true);
    try {
      const ctx = await getUserContext(nickname);
      const chatHistory = coachMessages.slice(-8).map(m => `${m.role === "user" ? "유저" : "코치"}: ${m.text}`).join("\n");
      // AI가 한 번에 판단: 답변 + 계획 변경 필요 여부 + 목표
      const prompt = `너는 Vanguard AI 실행 코치다. 유저를 다시 움직이게 만드는 게 너의 일이다.

${contextToPrompt(ctx)}

최근 대화:
${chatHistory}

유저 메시지: "${userMsg}"

유저의 메시지를 분석해서 아래 JSON 형식으로만 답해라. 다른 텍스트 절대 쓰지 마라.
{
  "reply": "유저에게 할 답변. 공감만 하지 말고 반드시 지금 할 수 있는 구체적 행동 1가지를 포함. 유저 데이터를 인용. 단호하고 구체적으로. 길이는 질문에 맞게 조절(간단한 질문 1~2줄, 복잡하면 5~7줄). 이모지 쓰지마.",
  "action": "none 또는 set_goal 또는 regen_schedule 중 하나. 유저가 새로운 하고싶은 것/목표를 말했으면 set_goal. 일정이 바뀌었거나 계획을 다시 짜달라고 하면 regen_schedule. 단순 질문/잡담/불평이면 none.",
  "goal": "action이 set_goal일 때만 추출한 목표를 한 문장으로. 아니면 빈 문자열."
}

reply 작성 규칙 (너는 자비스 같은 능동적 실행 비서다):
1. 유저가 뭔가 하고 싶다는 신호를 보이면, 세워달라고 할 때까지 기다리지 말고 네가 먼저 구체적 계획과 첫 행동을 제시해라.
2. 절대 "직접 세우세요", "스스로 정리하세요"라고 떠넘기지 마라. 유저는 혼자 못 해서 온 거다. 떠넘기면 실패다.
3. 큰 목표는 작은 단계로 쪼개라: 큰 그림 → 이번 달 → 이번 주 → 오늘 당장 할 것 하나(구체적으로, 숫자와 함께).
4. 항상 "오늘 당장 할 행동 1개"로 끝내라. 공감은 한 줄이면 충분.
5. 유저 데이터를 인용해 그 사람만의 계획으로.

action 판단:
- 새 목표/하고싶은 것 → set_goal
- 일정 변경/계획 다시 → regen_schedule
- 그 외 → none (단 reply엔 항상 구체적 계획 제시)`;

      const res = await fetch("/api/gemini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      let parsed: any = null;
      try {
        const clean = (data.text || "").replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        // JSON 파싱 실패 시 그냥 텍스트로 답변
        parsed = { reply: data.text || "응답을 불러올 수 없습니다.", action: "none", goal: "" };
      }

      const reply = parsed.reply || "응답을 불러올 수 없습니다.";
      setCoachMessages(prev => [...prev, { role: "ai", text: reply }]);
      saveCoachChat("ai", reply);
      await saveAiLog(nickname, "coach_chat", { question: userMsg }, { answer: reply, action: parsed.action }, ctx);

      // 액션 처리
      if (parsed.action === "set_goal" && parsed.goal && parsed.goal.length > 1) {
        const planMsg = `"${parsed.goal}"에 맞춰 계획을 짜고 있습니다...`;
        setCoachMessages(prev => [...prev, { role: "ai", text: planMsg }]);
        try {
          await updateGoal(nickname, parsed.goal);
          setGoal(parsed.goal);
          const regenRes = await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }) });
          const regenData = await regenRes.json();
          if (regenData.schedule) setDailySchedule(regenData.schedule);
          const doneMsg = `홈에 오늘 할 일을 만들어뒀습니다. 거창하게 말고 딱 하나부터 시작하세요.`;
          setCoachMessages(prev => { const f = prev.filter(m => m.text !== planMsg); return [...f, { role: "ai", text: doneMsg }]; });
          saveCoachChat("ai", doneMsg);
        } catch {
          setCoachMessages(prev => prev.filter(m => m.text !== planMsg));
        }
      } else if (parsed.action === "regen_schedule") {
        const regenMsg = "스케줄을 다시 짜고 있습니다...";
        setCoachMessages(prev => [...prev, { role: "ai", text: regenMsg }]);
        try {
          const regenRes = await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }) });
          const regenData = await regenRes.json();
          if (regenData.schedule) setDailySchedule(regenData.schedule);
          const doneMsg = "스케줄을 다시 짰습니다. 홈에서 확인하세요.";
          setCoachMessages(prev => { const f = prev.filter(m => m.text !== regenMsg); return [...f, { role: "ai", text: doneMsg }]; });
          saveCoachChat("ai", doneMsg);
        } catch {
          setCoachMessages(prev => prev.filter(m => m.text !== regenMsg));
        }
      }
    } catch {
      setCoachMessages(prev => [...prev, { role: "ai", text: "연결 오류. 다시 시도해주세요." }]);
    }
    setCoachLoading(false);
  }

  async function handleComplete() {
    const xpEarned = elapsedSeconds >= 900 ? 25 : elapsedSeconds >= 180 ? 10 : 5;
    if (!isGuest && nickname) {
      await saveRecord({ nickname, date: today, task: currentMission, done: true, hour_of_day: hour, xp_earned: xpEarned });
      if (currentBlockId) { await toggleScheduleBlock(currentBlockId, "complete"); setCurrentBlockId(null); }
      await loadUserData(nickname);
    }
    setFailTime(null);
    // 내일 스케줄 미리 생성
    if (userPlan !== "free") {
      const tomorrow = kstDateStr(Date.now() + 86400000);
      fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, date: tomorrow }),
      }).catch(() => {});
    }
    trackEvent("mission_complete", { task: currentMission, hour, elapsed_seconds: elapsedSeconds });
    setMissionFeedback("");
    setHomeMode("done");
    
    // AI 피드백 비동기 생성 — 화면 전환은 바로, 피드백은 백그라운드
    setTimeout(async () => {
    setFeedbackLoading(true);
    try {
      const todayRecords = records.filter(r => r.date === today);
      const doneCount = todayRecords.filter(r => r.done).length + 1;
      const failCount = todayRecords.filter(r => !r.done).length;
      const feedbackPrompt = userPlan === "free"
        ? `너는 실행 코치다. 유저가 "${currentMission}"을 완료했다. 오늘 ${doneCount}개 완료, ${failCount}개 실패. 스트릭 ${streak}일. 한 줄로 강하게 인정하고 다음 행동을 촉구해라. 이모지 쓰지마.`
        : `너는 전문 실행 코치다. 유저가 "${currentMission}"을 ${Math.floor(elapsedSeconds/60)}분 동안 실행해서 완료했다. 오늘 ${doneCount}개 완료, ${failCount}개 실패. 스트릭 ${streak}일. 유저 직업: ${localStorage.getItem("vanguard_occupation") || "미설정"}. 목표: ${goal || "미설정"}.
질문에 맞는 적절한 길이로 피드백해라:
1줄: 이 미션에서 잘한 점을 구체적으로 인정해라.
2줄: 이 미션의 결과물을 더 발전시킬 구체적 방법 1가지를 제안해라.
3줄: 다음에 해야 할 구체적 행동 1가지를 제시해라.
이모지 쓰지마. 단호하고 구체적으로.`;
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: feedbackPrompt }),
      });
      const data = await res.json();
      setMissionFeedback(data.text || "피드백 생성 실패");
    } catch {
      setMissionFeedback("피드백을 불러올 수 없습니다.");
    }
    setFeedbackLoading(false);
    }, 100);
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
      // Pro/Ultra: 성공/실패 패턴을 AI에게 전달하여 난이도 자동 조절
      const recentRecords = records.slice(-14);
      const consecutiveSuccess = recentRecords.filter(r => r.done).length;
      const consecutiveFail = recentRecords.filter(r => !r.done).length;
      const avgDuration = 15; // 기본 15분
      const difficultyHint = userPlan !== "free" ? (
        consecutiveSuccess >= 5 ? "high" :
        consecutiveFail >= 3 ? "low" :
        "normal"
      ) : "normal";

      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          difficulty: difficultyHint,
          recentSuccess: consecutiveSuccess,
          recentFail: consecutiveFail,
          avgDuration: avgDuration || 15,
        }),
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

  async function moveScheduleBlock(blockId: string, direction: "up" | "down") {
    if (!dailySchedule) return;
    const blocks = [...dailySchedule.blocks];
    const idx = blocks.findIndex((b: any) => b.id === blockId);
    if (idx < 0) return;
    if (direction === "up" && idx > 0) {
      const temp = blocks[idx - 1].start;
      blocks[idx - 1].start = blocks[idx].start;
      blocks[idx].start = temp;
      const tempEnd = blocks[idx - 1].end;
      blocks[idx - 1].end = blocks[idx].end;
      blocks[idx].end = tempEnd;
      [blocks[idx - 1], blocks[idx]] = [blocks[idx], blocks[idx - 1]];
    } else if (direction === "down" && idx < blocks.length - 1) {
      const temp = blocks[idx + 1].start;
      blocks[idx + 1].start = blocks[idx].start;
      blocks[idx].start = temp;
      const tempEnd = blocks[idx + 1].end;
      blocks[idx + 1].end = blocks[idx].end;
      blocks[idx].end = tempEnd;
      [blocks[idx], blocks[idx + 1]] = [blocks[idx + 1], blocks[idx]];
    }
    const updated = { ...dailySchedule, blocks };
    setDailySchedule(updated);
    try {
      await supabase.from("daily_schedules").update({ schedule_data: updated }).eq("id", dailySchedule.id);
    } catch {}
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
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 w-full max-w-[380px] max-h-[80vh] overflow-y-auto">
              <div className="text-[1rem] font-black mb-1">이번 달 목표</div>
              <div className="text-[0.85rem] text-[#9CA3AF] mb-4">목표를 입력하면 AI가 분석하고 더 나은 방향을 제안합니다</div>
              <textarea value={goalInput} onChange={e => setGoalInput(e.target.value)}
                placeholder={"예: 다이어트 - 하루 2끼, 러닝 30분, 단백질 위주 식단\n예: 앱 개발 - 매일 2시간 코딩, 주 1회 배포"}
                rows={3}
                className="w-full bg-[#FAFAFA] border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.88rem] text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#4F46E5] mb-3 resize-none" />
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button onClick={handleSaveGoal} disabled={goalSaving}
                  className="bg-[#4F46E5] text-white font-bold rounded-2xl py-3 text-[0.85rem] press-effect">
                  {goalSaving ? "저장 중..." : "목표 저장"}
                </button>
                <button onClick={async () => {
                  if (!goalInput.trim()) return;
                  setPlanAnalyzing(true);
                  setPlanAnalysis("");
                  try {
                    const prompt = userPlan === "ultra"
                      ? "너는 전문 실행 코치다. 유저가 이런 계획을 세웠다: " + goalInput + ". 아래 5가지를 각각 1~2줄로 답해라. 1) 안전점검: 이 계획에서 건강이나 지속 가능성에 위험한 부분. 2) 좋은 점: 이 계획에서 잘한 부분. 3) 개선할 점: 이 계획에서 바꾸면 더 좋은 부분. 4) 추천 플랜: 이 계획을 개선한 구체적인 대안. 5) 성공 확률: 이 계획대로 했을 때 예상 성공 확률과 이유. 존댓말 쓰지 마. 해라 체로. 이모지 쓰지 마."
                      : userPlan !== "free"
                      ? "너는 실행 코치다. 유저가 이런 계획을 세웠다: " + goalInput + ". 아래 4가지를 각각 1줄로 답해라. 1) 안전점검: 위험한 부분. 2) 좋은 점. 3) 개선할 점. 4) 추천 플랜: 개선된 대안 1개. 존댓말 쓰지 마. 해라 체로. 이모지 쓰지 마."
                      : "너는 실행 코치다. 유저가 이런 계획을 세웠다: " + goalInput + ". 이 계획에 대해 한 줄로 핵심 조언 1개만 해라. 존댓말 쓰지 마. 이모지 쓰지 마.";
                    const res = await fetch("/api/gemini", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({prompt}) });
                    const data = await res.json();
                    if (data.text) setPlanAnalysis(data.text);
                  } catch {}
                  setPlanAnalyzing(false);
                }} disabled={planAnalyzing || !goalInput.trim()}
                  className="bg-[#F3F4F6] text-[#1A1A2E] font-bold rounded-2xl py-3 text-[0.85rem] press-effect disabled:opacity-40">
                  {planAnalyzing ? "분석 중..." : "AI 분석"}
                </button>
              </div>
              {planAnalysis && (
                <div className={`rounded-2xl p-4 mb-3 ${userPlan === "ultra" ? "bg-[#F5F3FF] border border-[#DDD6FE]" : userPlan !== "free" ? "bg-[#EEF2FF] border border-[#C7D2FE]" : "bg-[#F9FAFB]"}`}>
                  <div className="text-[0.75rem] font-bold tracking-wider mb-2" style={{color: userPlan === "ultra" ? "#7C3AED" : userPlan !== "free" ? "#4F46E5" : "#9CA3AF"}}>
                    {userPlan === "ultra" ? "ULTRA AI 분석" : userPlan !== "free" ? "PRO AI 분석" : "AI 조언"}
                  </div>
                  <div className="text-[0.85rem] text-[#1A1A2E] leading-relaxed whitespace-pre-line">{planAnalysis}</div>
                </div>
              )}
              {userPlan === "free" && planAnalysis && (
                <div className="bg-[#EEF2FF] rounded-2xl p-3 mb-3">
                  <div className="text-[0.82rem] text-[#4F46E5] font-medium">Pro에서는 안전점검, 개선점, 추천 플랜까지 분석해줍니다</div>
                </div>
              )}
              <button onClick={() => { setShowGoalModal(false); setPlanAnalysis(""); }} className="w-full text-[#9CA3AF] text-[0.78rem] py-2">닫기</button>
            </div>
          </div>
        )}

        {/* 문의 모달 */}
        {showCoachChat && (
          <div className="fixed inset-0 bg-[#0A0A0A] z-[250] flex flex-col">
            <div className="flex items-center justify-between px-4 pt-12 pb-3">
              <div className="text-[1rem] font-black text-white">AI 코치</div>
              <button onClick={() => setShowCoachChat(false)} className="text-[#9CA3AF] text-[0.85rem]">닫기</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {coachMessages.length === 0 && (
                <div className="text-center mt-8">
                  <div className="text-[1.5rem] mb-2">🎯</div>
                  <div className="text-[0.92rem] text-white font-bold mb-2">무엇이든 물어보세요</div>
                  <div className="text-[0.8rem] text-[#9CA3AF] leading-relaxed mb-4">
                    AI가 당신의 목표, 패턴, 기록을 기반으로 답합니다.
                  </div>
                  <div className="space-y-2">
                    {["오늘 뭐 해야 해?", "왜 자꾸 저녁에 무너질까?", "동기부여 해줘", "이번 주 어땠어?"].map(q => (
                      <button key={q} onClick={() => { setCoachInput(q); }} 
                        className="w-full bg-white/10 rounded-2xl py-3 text-[0.82rem] text-white/80 press-effect">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {coachMessages.map((msg, i) => (
                <div key={i} className={`mb-3 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                  <div className={`inline-block max-w-[85%] rounded-2xl px-4 py-3 text-[0.85rem] leading-relaxed ${
                    msg.role === "user" 
                      ? "bg-[#4F46E5] text-white" 
                      : "bg-white/10 text-white"
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {coachLoading && (
                <div className="text-left mb-3">
                  <div className="inline-block bg-white/10 rounded-2xl px-4 py-3 text-[0.85rem] text-[#9CA3AF]">
                    생각하는 중...
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 pb-8 pt-2">
              <div className="flex gap-2">
                <input type="text" value={coachInput} onChange={e => setCoachInput(e.target.value)}
                  placeholder="질문을 입력하세요..."
                  className="flex-1 bg-white/10 rounded-2xl px-4 py-3 text-[0.85rem] text-white placeholder-white/30 focus:outline-none"
                  onKeyDown={e => { if (e.key === "Enter") sendCoachMessage(); }} />
                <button onClick={() => sendCoachMessage()}
                  className="bg-[#4F46E5] rounded-2xl px-5 py-3 text-white text-[0.85rem] font-bold press-effect">
                  전송
                </button>
              </div>
            </div>
          </div>
        )}

        {showOnboarding && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[300] px-6">
            <div className="bg-white rounded-3xl p-6 w-full max-w-[340px]">
              {onboardStep === 0 && (
                <div>
                  <div className="text-[1.1rem] font-black text-[#1A1A2E] mb-1">반가워요! 🎯</div>
                  <div className="text-[0.85rem] text-[#6B7280] mb-4">AI가 당신에게 맞는 미션을 만들기 위해 3가지만 알려주세요.</div>
                  <div className="text-[0.8rem] font-bold text-[#1A1A2E] mb-2">당신은 어떤 유형인가요?</div>
                  <div className="grid grid-cols-1 gap-2">
                    {["계획은 세우는데 실행을 못 함", "시작은 하는데 중간에 포기함", "아예 시작을 못 함", "매일 미루다가 하루가 끝남"].map(opt => (
                      <button key={opt} onClick={() => { setProfileOccupation(opt); setOnboardStep(1); }}
                        className={`py-3 rounded-2xl text-[0.85rem] font-medium press-effect ${profileOccupation === opt ? "bg-[#4F46E5] text-white" : "bg-[#F3F4F6] text-[#1A1A2E]"}`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {onboardStep === 1 && (
                <div>
                  <div className="text-[1.1rem] font-black text-[#1A1A2E] mb-1">집중이 잘 되는 시간은?</div>
                  <div className="text-[0.85rem] text-[#6B7280] mb-4">AI가 이 시간에 중요한 미션을 배치합니다.</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[{label: "아침 (6~9시)", val: "morning"}, {label: "오전 (9~12시)", val: "forenoon"}, {label: "오후 (12~18시)", val: "afternoon"}, {label: "저녁/밤 (18시~)", val: "evening"}].map(opt => (
                      <button key={opt.val} onClick={() => { setProfileFocusTime(opt.val); setOnboardStep(2); }}
                        className={`py-3 rounded-2xl text-[0.85rem] font-medium press-effect ${profileFocusTime === opt.val ? "bg-[#4F46E5] text-white" : "bg-[#F3F4F6] text-[#1A1A2E]"}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {onboardStep === 2 && (
                <div>
                  <div className="text-[1.1rem] font-black text-[#1A1A2E] mb-1">지금 가장 하고 싶은 건?</div>
                  <div className="text-[0.85rem] text-[#6B7280] mb-4">AI가 여기에 맞춰 미션을 만들어줍니다.</div>
                  <div className="grid grid-cols-1 gap-2">
                    {["운동/다이어트", "공부/시험", "일/프로젝트", "아직 모르겠는데 뭐라도 시작하고 싶음"].map(opt => (
                      <button key={opt} onClick={async () => {
                        setProfileObstacle(opt);
                        await updateUserProfile(nickname, { occupation: profileOccupation, focus_time: profileFocusTime, obstacle: opt });
                        localStorage.setItem("vanguard_occupation", profileOccupation);
                        localStorage.setItem("vanguard_focus_time", profileFocusTime);
                        localStorage.setItem("vanguard_obstacle", opt);
                        setOnboardAiResult(null);
                        setOnboardStep(3);
                        // AI 분석 호출
                        (async () => {
                          try {
                            const prompt = `너는 실행 심리 전문가다. 유저 프로필을 분석해서 JSON만 출력해라.
유저 정보: 실행 유형="${profileOccupation}", 집중 시간="${profileFocusTime === "morning" ? "아침" : profileFocusTime === "forenoon" ? "오전" : profileFocusTime === "afternoon" ? "오후" : "저녁"}", 목표="${opt}"
반드시 이 JSON 형식만 출력: {"type":"2~4글자 실행 유형 이름","description":"이 유형의 특징 1줄","risk":"이 유형이 가장 무너지기 쉬운 시간과 상황 1줄","strategy":"AI가 이 유형에게 적용할 전략 1줄","firstMission":"오늘 당장 할 수 있는 구체적 미션 1개 (10글자 이내)"}`;
                            const res = await fetch("/api/gemini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
                            const data = await res.json();
                            const text = (data.text || "").replace(/```json|```/g, "").trim();
                            const parsed = JSON.parse(text);
                            setOnboardAiResult(parsed);
                          } catch {
                            setOnboardAiResult({
                              type: (profileFocusTime === "morning" ? "아침형 " : profileFocusTime === "forenoon" ? "오전형 " : profileFocusTime === "afternoon" ? "오후형 " : "저녁형 ") + (profileOccupation === "계획은 세우는데 실행을 못 함" ? "계획가" : profileOccupation === "시작은 하는데 중간에 포기함" ? "중단자" : profileOccupation === "아예 시작을 못 함" ? "회피자" : "미루기 전문가"),
                              description: "AI가 당신의 패턴을 학습하고 맞춤 전략을 적용합니다.",
                              risk: "집중 시간 외에 무너질 확률이 높습니다.",
                              strategy: "AI가 미션을 극단적으로 작게 줄여서 시작하게 만듭니다.",
                              firstMission: "3분 집중하기"
                            });
                          }
                        })();
                      }}
                        className={`py-3 rounded-2xl text-[0.85rem] font-medium press-effect ${profileObstacle === opt ? "bg-[#4F46E5] text-white" : "bg-[#F3F4F6] text-[#1A1A2E]"}`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {onboardStep === 3 && (
                <div>
                  {!onboardAiResult ? (
                    <div className="text-center py-8">
                      <div className="text-[1.1rem] font-black text-[#1A1A2E] mb-3">AI가 분석하고 있습니다...</div>
                      <div className="text-[0.85rem] text-[#6B7280]">당신만을 위한 실행 전략을 만들고 있어요</div>
                      <div className="mt-4 w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full animate-spin mx-auto"></div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-[1.1rem] font-black text-[#1A1A2E] mb-3">AI 분석 완료</div>
                      <div className="bg-[#F5F3FF] rounded-2xl p-4 mb-3">
                        <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-wider mb-2">당신의 실행 유형</div>
                        <div className="text-[0.95rem] font-black text-[#1A1A2E] mb-1">{onboardAiResult.type}</div>
                        <div className="text-[0.8rem] text-[#6B7280] leading-relaxed">{onboardAiResult.description}</div>
                      </div>
                      <div className="bg-[#FEF2F2] rounded-2xl p-4 mb-3">
                        <div className="text-[0.75rem] text-[#EF4444] font-bold tracking-wider mb-1">위험 예측</div>
                        <div className="text-[0.8rem] text-[#1A1A2E] font-medium">{onboardAiResult.risk}</div>
                      </div>
                      <div className="bg-[#F0FDF4] rounded-2xl p-4 mb-3">
                        <div className="text-[0.75rem] text-[#4ADE80] font-bold tracking-wider mb-1">AI 전략</div>
                        <div className="text-[0.8rem] text-[#1A1A2E] font-medium">{onboardAiResult.strategy}</div>
                      </div>
                      <div className="bg-[#EEF2FF] rounded-2xl p-4 mb-4">
                        <div className="text-[0.75rem] text-[#4F46E5] font-bold tracking-wider mb-1">오늘 첫 미션</div>
                        <div className="text-[0.88rem] font-black text-[#1A1A2E]">{onboardAiResult.firstMission}</div>
                      </div>
                      <button onClick={() => { setShowOnboarding(false); setOnboardStep(0); }}
                        className="w-full bg-[#4F46E5] text-white font-bold rounded-2xl py-3.5 text-[0.88rem] press-effect">
                        시작하기
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {showDeleteAccount && (
          <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 w-full max-w-[340px]">
              <div className="text-[1.1rem] font-black text-[#1A1A2E] mb-2">계정 삭제</div>
              <div className="text-[0.85rem] text-[#6B7280] mb-4 leading-relaxed">
                계정을 삭제하면 모든 미션, 기록, 분석 데이터가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
              </div>
              <div className="text-[0.8rem] text-[#9CA3AF] mb-2">삭제하려면 "삭제"를 입력하세요.</div>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="삭제"
                className="w-full border border-[#E5E7EB] rounded-xl px-3 py-2.5 text-[0.85rem] mb-4 outline-none focus:border-[#EF4444]"
              />
              <div className="flex gap-2">
                <button onClick={() => { setShowDeleteAccount(false); setDeleteConfirmText(""); }}
                  className="flex-1 py-2.5 rounded-xl bg-[#F3F4F6] text-[0.85rem] font-medium text-[#6B7280]">
                  취소
                </button>
                <button
                  disabled={deleteConfirmText !== "삭제" || deleteLoading}
                  onClick={async () => {
                    setDeleteLoading(true);
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) { alert("로그인 정보를 찾을 수 없습니다."); return; }
                      const res = await fetch("/api/delete-account", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userId: user.id }),
                      });
                      const result = await res.json();
                      if (result.success) {
                        await supabase.auth.signOut();
                        localStorage.clear();
                        alert("계정이 삭제되었습니다.");
                        window.location.href = "/login";
                      } else {
                        alert("삭제 중 오류가 발생했습니다: " + (result.error || ""));
                      }
                    } catch (e: any) {
                      alert("삭제 중 오류가 발생했습니다.");
                    } finally {
                      setDeleteLoading(false);
                    }
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-[0.85rem] font-medium ${
                    deleteConfirmText === "삭제" && !deleteLoading
                      ? "bg-[#EF4444] text-white"
                      : "bg-[#FEE2E2] text-[#FCA5A5]"
                  }`}>
                  {deleteLoading ? "삭제 중..." : "삭제하기"}
                </button>
              </div>
            </div>
          </div>
        )}

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
                      {/* === 핵심: 지금 할 것 먼저 === */}
                      <div className="pt-2 pb-2">
                        {/* 복귀 메시지 */}
                        {userState.gapDays >= 1 && !userState.todayCompleted ? (
                          <div className="text-center mb-4">
                            <div className="text-[0.78rem] text-[#9CA3AF] mb-1">{userState.gapDays}일 쉬었습니다</div>
                            <div className="text-[1rem] font-black text-[#1A1A2E]">하지만 지금 돌아왔습니다</div>
                          </div>
                        ) : userState.comebackToday ? (
                          <div className="text-center mb-4">
                            <div className="text-[1rem] font-black text-[#4F46E5]">돌아온 걸 환영합니다</div>
                          </div>
                        ) : (
                          <div className="text-[0.85rem] text-[#6B7280] text-center mb-4">
                            {statusLine}
                          </div>
                        )}

                        {/* 진행률 바 */}
                        <div className="mb-4">
                          <div className="flex justify-between text-[0.75rem] text-[#9CA3AF] mb-1">
                            <span>{completedCount}/{totalCount} 완료</span>
                            <span>{streak}일 연속 · +{records.filter(r => r.date === today && r.done).reduce((s, r) => s + (r.xp_earned ?? 10), 0)}XP</span>
                          </div>
                          <div className="w-full h-2 bg-[#F3F4F6] rounded-full">
                            <div className="h-2 rounded-full transition-all duration-500" 
                              style={{width: `${totalCount > 0 ? (completedCount/totalCount)*100 : 0}%`, background: completedCount === totalCount && totalCount > 0 ? "#22C55E" : "#4F46E5"}} />
                          </div>
                        </div>
                        {/* 복귀 횟수 - Vanguard 정체성 */}
                        {userState.weeklyComebacks >= 1 && (
                          <div className="bg-[#EEF2FF] rounded-2xl p-3 mb-4 text-center">
                            <div className="text-[0.85rem] font-bold text-[#4F46E5]">당신은 이번 주 포기하지 않고 {userState.weeklyComebacks}번 다시 시작했습니다</div>
                          </div>
                        )}
                      </div>

                      {/* === 알림 영역 (있을 때만) === */}
                      {userState.consecutiveFails >= 2 && (
                        <div className="bg-[#FEF2F2] rounded-3xl p-5 mb-5" style={{animation: "fadeIn 0.3s ease-out"}}>
                          <div className="text-[0.95rem] font-bold text-[#DC2626] mb-1">{userState.consecutiveFails}일째 멈춰있습니다</div>
                          <div className="text-[0.85rem] text-[#6B7280]">지금 3분만 시작하면 흐름이 돌아옵니다.</div>
                        </div>
                      )}









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
                        <div className="space-y-2 mb-4">
                          <button onClick={() => {
                            setMission(nextBlock.title);
                            setCurrentMission(nextBlock.title);
                            setCurrentBlockId(nextBlock.id);
                            setStartTime(new Date());
                            setRunningMessage("");
                            setShowRunningMessage(false);
                            setHomeMode("running");
                          }}
                            className="w-full bg-[#4F46E5] text-white font-bold rounded-3xl py-5 text-[1.1rem] press-effect shadow-lg shadow-[#4F46E5]/20">
                            시작하기
                          </button>
                          <button onClick={async () => {
                            setMission(nextBlock.title);
                            setCurrentMission(nextBlock.title);
                            if (!isGuest && nickname) {
                              await saveRecord({ nickname, date: today, task: nextBlock.title, done: true, hour_of_day: hour, xp_earned: 5 });
                              await toggleScheduleBlock(nextBlock.id, "complete");
                              await loadUserData(nickname);
                            }
                            trackEvent("quick_complete", { task: nextBlock.title, hour });
                            setMissionFeedback("");
                            setHomeMode("done");
                            try {
                              setFeedbackLoading(true);
                              const fbPrompt = userPlan === "free"
                                ? `너는 실행 코치다. 유저가 "${nextBlock.title}"을 완료했다. 스트릭 ${streak}일. 한 줄로 강하게 인정하고 다음 행동을 촉구해라. 이모지 쓰지마.`
                                : `너는 전문 실행 코치다. 유저가 "${nextBlock.title}"을 바로 완료했다. 스트릭 ${streak}일. 목표: ${goal || "미설정"}. 2줄로: 1줄 인정, 2줄 다음 구체적 행동 제시. 이모지 쓰지마.`;
                              const fbRes = await fetch("/api/gemini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: fbPrompt }) });
                              const fbData = await fbRes.json();
                              setMissionFeedback(fbData.text || "해냈다. 계속 가자.");
                            } catch { setMissionFeedback("해냈다. 계속 가자."); }
                            setFeedbackLoading(false);
                          }}
                            className="w-full bg-[#F3F4F6] text-[#6B7280] font-medium rounded-3xl py-3.5 text-[0.88rem] press-effect">
                            바로 완료 (체크만)
                          </button>
                        </div>
                      )}

                      {/* 직접 입력 */}
                      <div className="mt-4">
                        <input type="text" value={mission} onChange={e => setMission(e.target.value)}
                          placeholder="또는 직접 입력"
                          className="w-full bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.85rem] text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#D1D5DB]"
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
                      className="w-full bg-[#4F46E5] text-white font-bold rounded-3xl py-5 text-[1.1rem] press-effect mb-4 shadow-lg shadow-[#4F46E5]/20">
                      {scheduleGenerating ? "AI가 설계 중..." : "오늘 시작하기"}
                    </button>
                    <div className="mt-4">
                      <input type="text" value={mission} onChange={e => setMission(e.target.value)}
                        placeholder="또는 직접 입력"
                        className="w-full bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 text-[0.85rem] text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#D1D5DB]"
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


                {/* AI 미션 피드백 */}
                {feedbackLoading && (
                  <div className="bg-[#F9FAFB] rounded-3xl p-5 mb-4">
                    <div className="text-[0.85rem] text-[#9CA3AF] text-center">AI가 피드백을 준비하고 있습니다...</div>
                  </div>
                )}
                {missionFeedback && !feedbackLoading && (
                  <div className={`rounded-3xl p-5 mb-4 ${userPlan === "free" ? "bg-[#F9FAFB]" : userPlan === "ultra" ? "bg-[#F5F3FF] border border-[#DDD6FE]" : "bg-[#EEF2FF] border border-[#C7D2FE]"}`}>
                    <div className="text-[0.75rem] font-bold tracking-wider mb-2" style={{color: userPlan === "ultra" ? "#7C3AED" : userPlan === "free" ? "#9CA3AF" : "#4F46E5"}}>
                      {userPlan === "ultra" ? "ULTRA AI 코치" : userPlan === "free" ? "AI 응원" : "PRO AI 피드백"}
                    </div>
                    <div className="text-[0.88rem] text-[#1A1A2E] leading-relaxed whitespace-pre-line">{missionFeedback}</div>
                  </div>
                )}
                {userPlan === "free" && missionFeedback && (
                  <div className="bg-[#EEF2FF] rounded-3xl p-4 mb-4">
                    <div className="text-[0.85rem] text-[#4F46E5] font-medium mb-1">Pro에서는 AI가 전문가급 피드백을 줍니다</div>
                    <div className="text-[0.8rem] text-[#6B7280]">미션 내용을 분석하고, 다음에 할 행동까지 제안합니다</div>
                  </div>
                )}

                {/* 실행 점수 공유 카드 */}
                <div className="bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] rounded-3xl p-6 mb-4 text-white">
                  <div className="text-center mb-4">
                    <div className="text-[0.75rem] opacity-70 mb-1">오늘의 실행 기록</div>
                    <div className="text-[2.5rem] font-bold leading-none">+{records.filter(r => r.date === today && r.done).reduce((s, r) => s + (r.xp_earned ?? 10), 0)}</div>
                    <div className="text-[0.85rem] opacity-80 mt-1">XP 획득</div>
                  </div>
                  <div className="flex justify-center gap-6 mb-4">
                    <div className="text-center">
                      <div className="text-[1.2rem] font-bold">{Math.floor(elapsedSeconds / 60)}분</div>
                      <div className="text-[0.72rem] opacity-70">집중</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[1.2rem] font-bold">{streak}일</div>
                      <div className="text-[0.72rem] opacity-70">연속</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[1.2rem] font-bold">{records.reduce((s, r) => s + (r.done ? (r.xp_earned ?? 10) : 0), 0)}</div>
                      <div className="text-[0.72rem] opacity-70">총 XP</div>
                    </div>
                  </div>
                  <div className="text-center text-[0.72rem] opacity-50 mb-3">VANGUARD · AI 실행 코치</div>
                  <button onClick={() => {
                    const todayXP = records.filter(r => r.date === today && r.done).reduce((s, r) => s + (r.xp_earned ?? 10), 0);
                    const totalXP = records.reduce((s, r) => s + (r.done ? (r.xp_earned ?? 10) : 0), 0);
                    const text = `오늘 +${todayXP}XP 획득! ${Math.floor(elapsedSeconds / 60)}분 집중, ${streak}일 연속 실행 중. 총 ${totalXP}XP. Vanguard가 실행을 관리해주고 있다.`;
                    const url = "https://vanguard-five-ecru.vercel.app/landing";
                    if (navigator.share) { navigator.share({ title: "Vanguard 실행 기록", text, url }).catch(() => {}); }
                    else { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text + " " + url)}`, "_blank"); }
                  }}
                    className="w-full bg-white/20 backdrop-blur text-white font-medium rounded-2xl py-3 text-[0.85rem] press-effect">
                    공유하기
                  </button>
                </div>

                {/* 내일의 편지 */}
                {!tomorrowLetter && (
                  <button onClick={async () => {
                    const prompt = `너는 행동 코치다. 유저가 오늘 미션을 완료했다. 내일의 유저한테 보내는 짧은 메시지를 써라. 2줄 이내. 첫줄은 오늘 해낸것 인정. 둘째줄은 내일도 이어가라는 단호한 말. streak: ${streak}일. 절대 이모지 쓰지마.`;
                    try {
                      const res = await fetch("/api/gemini", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({prompt}) });
                      const data = await res.json();
                      setTomorrowLetter(data.text || "");
                      localStorage.setItem("vanguard_letter", data.text || "");
                      localStorage.setItem("vanguard_letter_date", (() => { const k = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })); return `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`; })());
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
                      Pro 베타 신청 →
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
                      {failCount >= 3 ? "지금 바로 패턴 끊기 — Pro 베타 신청 가능" :
                       failCount >= 2 ? "패턴 분석 시작하기 — Pro 베타 신청 가능" :
                       "Pro 베타 신청 — 베타 신청 가능"}
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
                      {!block.is_completed && !block.skipped && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => moveScheduleBlock(block.id, "up")}
                            className="text-[0.7rem] text-[#9CA3AF] hover:text-[#1A1A2E] px-1">↑</button>
                          <button onClick={() => moveScheduleBlock(block.id, "down")}
                            className="text-[0.7rem] text-[#9CA3AF] hover:text-[#1A1A2E] px-1">↓</button>
                          {userPlan !== "free" && (
                            <button onClick={() => deleteScheduleBlock(block.id)}
                              className="text-[0.75rem] text-[#FCA5A5]/40 hover:text-[#FCA5A5] px-1">✕</button>
                          )}
                        </div>
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
                          className="w-full bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 text-[0.82rem] text-[#1A1A2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#D1D5DB]" />
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
                          {s.due_date === today ? "오늘" : s.due_date === kstDateStr(Date.now() + 86400000) ? "내일" : s.due_date}
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
                    const dateStr = kstDateStr(d);
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

            {/* AI 패턴 인사이트 */}
            {records.length >= 3 && (
              <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">AI 패턴 인사이트</div>
                {(() => {
                  const allFails = records.filter(r => !r.done);
                  const allDone = records.filter(r => r.done);
                  const totalRate = records.length > 0 ? Math.round((allDone.length / records.length) * 100) : 0;
                  
                  // 요일별 분석
                  const dayNames = ["일","월","화","수","목","금","토"];
                  const dayStats: Record<number, {done: number, fail: number}> = {};
                  records.forEach(r => {
                    const d = new Date(r.date).getDay();
                    if (!dayStats[d]) dayStats[d] = {done: 0, fail: 0};
                    if (r.done) dayStats[d].done++;
                    else dayStats[d].fail++;
                  });
                  const worstDay = Object.entries(dayStats)
                    .filter(([,v]) => v.fail > 0)
                    .sort((a, b) => b[1].fail - a[1].fail)[0];
                  const bestDay = Object.entries(dayStats)
                    .filter(([,v]) => v.done > 0)
                    .sort((a, b) => (b[1].done/(b[1].done+b[1].fail)) - (a[1].done/(a[1].done+a[1].fail)))[0];
                  
                  // 실패 이유 분석
                  const failReasons: Record<string, number> = {};
                  allFails.forEach(r => {
                    const reason = r.fail_reason || "기타";
                    failReasons[reason] = (failReasons[reason] || 0) + 1;
                  });
                  const topReason = Object.entries(failReasons).sort((a, b) => b[1] - a[1])[0];
                  
                  // 연속 성공/실패 최고 기록
                  let maxStreak = 0, curStreak = 0;
                  const sortedRecs = [...records].sort((a, b) => a.date.localeCompare(b.date));
                  sortedRecs.forEach(r => {
                    if (r.done) { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
                    else { curStreak = 0; }
                  });

                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-[#F0FDF4] rounded-2xl p-3 text-center">
                          <div className="text-[1.2rem] font-black text-[#4ADE80]">{totalRate}%</div>
                          <div className="text-[0.75rem] text-[#6B7280]">전체 실행률</div>
                        </div>
                        <div className="bg-[#EEF2FF] rounded-2xl p-3 text-center">
                          <div className="text-[1.2rem] font-black text-[#4F46E5]">{maxStreak}일</div>
                          <div className="text-[0.75rem] text-[#6B7280]">최고 연속 기록</div>
                        </div>
                      </div>
                      
                      {worstDay && (
                        <div className="bg-[#FEF2F2] rounded-2xl p-3">
                          <div className="text-[0.78rem] font-bold text-[#1A1A2E]">⚠ {dayNames[Number(worstDay[0])]}요일에 가장 많이 무너집니다</div>
                          <div className="text-[0.75rem] text-[#6B7280] mt-0.5">실패 {worstDay[1].fail}회 — 이 요일에 미션을 줄이는 게 좋습니다</div>
                        </div>
                      )}
                      
                      {bestDay && (
                        <div className="bg-[#F0FDF4] rounded-2xl p-3">
                          <div className="text-[0.78rem] font-bold text-[#1A1A2E]">✦ {dayNames[Number(bestDay[0])]}요일이 가장 강합니다</div>
                          <div className="text-[0.75rem] text-[#6B7280] mt-0.5">성공률 {Math.round((bestDay[1].done/(bestDay[1].done+bestDay[1].fail))*100)}% — 이 요일에 중요한 미션을 넣으세요</div>
                        </div>
                      )}
                      
                      {topReason && (
                        <div className="bg-[#FFFBEB] rounded-2xl p-3">
                          <div className="text-[0.78rem] font-bold text-[#1A1A2E]">무너지는 이유 1위: "{topReason[0]}"</div>
                          <div className="text-[0.75rem] text-[#6B7280] mt-0.5">{topReason[1]}회 반복 — AI가 이 패턴을 먼저 잡아줍니다</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 주간 리더보드 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase">주간 리더보드</div>
                <div className="text-[0.75rem] text-[#4F46E5] font-medium">이번 주</div>
              </div>
              {(() => {
                let fullBoard = [...leaderboard];
                if (nickname && !fullBoard.find(u => u.nickname === nickname)) {
                  const weekAgo = kstDateStr(Date.now() - 7 * 86400000);
                  const myWeekXP = records.filter(r => r.date >= weekAgo && r.done).reduce((s, r) => s + (r.xp_earned ?? 10), 0);
                  fullBoard.push({ nickname, xp: myWeekXP });
                }
                fullBoard = fullBoard.sort((a, b) => b.xp - a.xp);
                const myIndex = fullBoard.findIndex(u => u.nickname === nickname);
                const myRank = myIndex + 1;
                const top10 = fullBoard.slice(0, 10);
                const medals = ["🥇", "🥈", "🥉"];
                if (fullBoard.length === 0) {
                  return <div className="text-center py-6 text-[0.85rem] text-[#9CA3AF]">아직 이번 주 기록이 없습니다. 첫 미션을 완료하면 순위가 생깁니다.</div>;
                }
                const iAmInTop10 = myIndex >= 0 && myIndex < 10;
                return (
                  <div>
                    {top10.map((user, i) => {
                      const isMe = user.nickname === nickname;
                      return (
                        <div key={user.nickname} className={`flex items-center gap-3 py-3 border-b border-[#F3F4F6] ${isMe ? "bg-[#EEF2FF] -mx-5 px-5 rounded-2xl" : ""}`}>
                          <div className="w-8 text-center text-[1rem]">{i < 3 ? medals[i] : <span className="text-[0.85rem] text-[#9CA3AF] font-medium">{i + 1}</span>}</div>
                          <div className="flex-1">
                            <div className={`text-[0.88rem] ${isMe ? "font-bold text-[#4F46E5]" : "font-medium text-[#1A1A2E]"}`}>
                              {user.nickname} {isMe && "← 나"}
                            </div>
                          </div>
                          <div className={`text-[0.88rem] font-bold ${isMe ? "text-[#4F46E5]" : "text-[#1A1A2E]"}`}>{user.xp} XP</div>
                        </div>
                      );
                    })}
                    {!iAmInTop10 && myIndex >= 0 && (
                      <div className="flex items-center gap-3 py-3 bg-[#EEF2FF] -mx-5 px-5 rounded-2xl mt-1">
                        <div className="w-8 text-center text-[0.85rem] text-[#4F46E5] font-bold">{myRank}</div>
                        <div className="flex-1">
                          <div className="text-[0.88rem] font-bold text-[#4F46E5]">{nickname} ← 나</div>
                        </div>
                        <div className="text-[0.88rem] font-bold text-[#4F46E5]">{fullBoard[myIndex].xp} XP</div>
                      </div>
                    )}
                    <div className="text-center mt-3 pt-3 border-t border-[#F3F4F6]">
                      <div className="text-[0.8rem] text-[#9CA3AF]">전체 {fullBoard.length}명 · 매주 월요일 리셋</div>
                    </div>
                  </div>
                );
              })()}
            </div>

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

            {/* Ultra 실패 예측 + 목표 달성 확률 */}
            {userPlan === "ultra" && records.length >= 5 && (
              <div className="bg-[#F5F3FF] border border-[#DDD6FE] rounded-3xl p-5 mb-4">
                <div className="text-[0.75rem] text-[#7C3AED] font-bold tracking-widest uppercase mb-3">ULTRA AI 예측</div>
                {(() => {
                  const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
                  const hourCounts: Record<number, number> = {};
                  failsByHour.forEach(r => { hourCounts[r.hour_of_day!] = (hourCounts[r.hour_of_day!] || 0) + 1; });
                  const sorted = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]));
                  const peakHour = sorted.length > 0 ? Number(sorted[0][0]) : 0;
                  const peakCount = sorted.length > 0 ? Number(sorted[0][1]) : 0;
                  const totalFails = failsByHour.length;
                  const failProb = totalFails > 0 ? Math.min(95, Math.round((peakCount / Math.max(totalFails, 1)) * 100 + 15)) : 0;
                  const timeLabel = peakHour >= 20 ? "밤" : peakHour >= 16 ? "저녁" : peakHour >= 12 ? "오후" : "오전";
                  const topReason = Object.entries(records.filter(r => !r.done && r.fail_reason).reduce((a, r) => { a[r.fail_reason || "기타"] = (a[r.fail_reason || "기타"] || 0) + 1; return a; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1])[0];

                  const totalDays = new Set(records.map(r => r.date)).size;
                  const successDays = new Set(records.filter(r => r.done).map(r => r.date)).size;
                  const goalProb = totalDays > 0 ? Math.min(99, Math.round((successDays / totalDays) * 100 + streak * 2)) : 50;

                  return (
                    <div>
                      {/* 실패 예측 */}
                      <div className="mb-5">
                        <div className="text-[0.85rem] font-medium text-[#1A1A2E] mb-3">내일 실패 예측</div>
                        <div className="flex items-center gap-4 mb-3">
                          <div className="relative w-20 h-20">
                            <svg width="80" height="80" viewBox="0 0 80 80">
                              <circle cx="40" cy="40" r="32" fill="none" stroke="#EDE9FE" strokeWidth="6" />
                              <circle cx="40" cy="40" r="32" fill="none" stroke={failProb >= 60 ? "#DC2626" : failProb >= 40 ? "#F59E0B" : "#22C55E"} strokeWidth="6"
                                strokeLinecap="round"
                                strokeDasharray={`${(failProb / 100) * 2 * Math.PI * 32} ${2 * Math.PI * 32}`}
                                transform="rotate(-90 40 40)" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-[1.2rem] font-bold" style={{color: failProb >= 60 ? "#DC2626" : failProb >= 40 ? "#F59E0B" : "#22C55E"}}>{failProb}%</span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="text-[0.88rem] font-bold text-[#1A1A2E] mb-1">
                              {timeLabel} {peakHour}시에 무너질 확률 {failProb}%
                            </div>
                            <div className="text-[0.8rem] text-[#6B7280]">
                              {topReason ? `주요 원인: ${topReason[0]} (${topReason[1]}회)` : "데이터 수집 중"}
                            </div>
                            <div className="text-[0.8rem] text-[#7C3AED] mt-1">
                              {peakHour > 0 ? `${peakHour - 1}시에 미리 시작하면 확률이 절반으로 줄어듭니다` : ""}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 목표 달성 확률 */}
                      <div className="pt-4 border-t border-[#EDE9FE]">
                        <div className="text-[0.85rem] font-medium text-[#1A1A2E] mb-3">목표 달성 확률</div>
                        <div className="flex items-center gap-4">
                          <div className="relative w-20 h-20">
                            <svg width="80" height="80" viewBox="0 0 80 80">
                              <circle cx="40" cy="40" r="32" fill="none" stroke="#EDE9FE" strokeWidth="6" />
                              <circle cx="40" cy="40" r="32" fill="none" stroke={goalProb >= 70 ? "#22C55E" : goalProb >= 40 ? "#F59E0B" : "#DC2626"} strokeWidth="6"
                                strokeLinecap="round"
                                strokeDasharray={`${(goalProb / 100) * 2 * Math.PI * 32} ${2 * Math.PI * 32}`}
                                transform="rotate(-90 40 40)" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-[1.2rem] font-bold" style={{color: goalProb >= 70 ? "#22C55E" : goalProb >= 40 ? "#F59E0B" : "#DC2626"}}>{goalProb}%</span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="text-[0.88rem] font-bold text-[#1A1A2E] mb-1">
                              이번 달 목표 달성 확률 {goalProb}%
                            </div>
                            <div className="text-[0.8rem] text-[#6B7280]">
                              {goalProb >= 70 ? "좋은 페이스입니다. 이대로 유지하세요." :
                               goalProb >= 40 ? `이번 주 ${Math.ceil((70 - goalProb) / 10)}회 더 실행하면 70%를 넘깁니다.` :
                               "위험합니다. 오늘부터 매일 1개씩 실행하면 회복됩니다."}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Pro가 아닌 유저에게 예측 미리보기 */}
            {userPlan !== "ultra" && records.length >= 5 && (
              <div className="relative mb-4">
                <div className="bg-[#F5F3FF] border border-[#DDD6FE] rounded-3xl p-5 blur-[4px]">
                  <div className="text-[0.75rem] text-[#7C3AED] font-bold mb-2">ULTRA AI 예측</div>
                  <div className="text-[0.88rem] text-[#1A1A2E]">내일 오후 실패 확률: ??% · 목표 달성 확률: ??%</div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <button onClick={() => setActiveTab("settings")}
                    className="bg-[#7C3AED] text-white font-bold rounded-2xl px-6 py-3 text-[0.85rem] press-effect shadow-lg shadow-[#7C3AED]/20">
                    Ultra에서 AI 예측 보기
                  </button>
                </div>
              </div>
            )}

            {/* 실행 점수 XP */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mb-4">
              <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">실행 점수</div>
              {(() => {
                const score = Math.max(0, records.reduce((s, r) => s + (r.done ? (r.xp_earned ?? 10) : 0), 0));
                const level = score >= 1000 ? "마스터" : score >= 500 ? "다이아몬드" : score >= 200 ? "골드" : score >= 80 ? "실버" : "브론즈";
                const levelColor = score >= 1000 ? "#DC2626" : score >= 500 ? "#4F46E5" : score >= 200 ? "#F59E0B" : score >= 80 ? "#6B7280" : "#B45309";
                const levelEmoji = score >= 1000 ? "👑" : score >= 500 ? "💎" : score >= 200 ? "🥇" : score >= 80 ? "🥈" : "🥉";
                const levels = [
                  { name: "브론즈", min: 0, max: 80 },
                  { name: "실버", min: 80, max: 200 },
                  { name: "골드", min: 200, max: 500 },
                  { name: "다이아몬드", min: 500, max: 1000 },
                  { name: "마스터", min: 1000, max: 2000 },
                ];
                const currentLevel = levels.find(l => score >= l.min && score < l.max) || levels[levels.length - 1];
                const progressInLevel = ((score - currentLevel.min) / (currentLevel.max - currentLevel.min)) * 100;
                const todayXP = records.filter(r => r.date === today && r.done).reduce((s, r) => s + (r.xp_earned ?? 10), 0);
                const weekAgo = kstDateStr(Date.now() - 7 * 86400000);
                const weekXP = records.filter(r => r.date >= weekAgo && r.done).reduce((s, r) => s + (r.xp_earned ?? 10), 0);
                return (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="text-3xl">{levelEmoji}</div>
                        <div>
                          <div className="text-[1.5rem] font-bold text-[#1A1A2E]">{score} XP</div>
                          <div className="text-[0.85rem] font-medium" style={{color: levelColor}}>{level}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[0.88rem] font-bold text-[#4F46E5]">+{todayXP} 오늘</div>
                        <div className="text-[0.8rem] text-[#9CA3AF]">+{weekXP} 이번주</div>
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="flex justify-between text-[0.75rem] text-[#9CA3AF] mb-1">
                        <span>{currentLevel.name}</span>
                        <span>{Math.round(progressInLevel)}%</span>
                      </div>
                      <div className="w-full bg-[#F3F4F6] rounded-full h-3">
                        <div className="h-3 rounded-full transition-all" style={{width: `${Math.min(100, progressInLevel)}%`, background: `linear-gradient(90deg, ${levelColor}, ${levelColor}dd)`}}></div>
                      </div>
                      <div className="text-[0.75rem] text-[#9CA3AF] mt-1">다음 등급까지 {currentLevel.max - score} XP</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#F3F4F6]">
                      <div className="text-center">
                        <div className="text-[1rem] font-bold text-[#22C55E]">{records.filter(r => r.done).length}</div>
                        <div className="text-[0.72rem] text-[#9CA3AF]">총 성공</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[1rem] font-bold text-[#1A1A2E]">{streak}일</div>
                        <div className="text-[0.72rem] text-[#9CA3AF]">연속</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[1rem] font-bold text-[#1A1A2E]">{successRate}%</div>
                        <div className="text-[0.72rem] text-[#9CA3AF]">성공률</div>
                      </div>
                    </div>
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

            {/* 실패 유형 카드 */}
            {records.filter(r => !r.done).length >= 2 && (
              <div className="mb-4">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-widest uppercase mb-3">나의 실패 패턴</div>
                {(() => {
                  const failsByHour = records.filter(r => !r.done && r.hour_of_day !== undefined);
                  const failReasons = records.filter(r => !r.done && r.fail_reason).reduce((acc, r) => {
                    const k = r.fail_reason || "기타"; acc[k] = (acc[k] || 0) + 1; return acc;
                  }, {} as Record<string, number>);
                  const topReasons = Object.entries(failReasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
                  const avgHour = failsByHour.length > 0 ? Math.round(failsByHour.reduce((s, r) => s + (r.hour_of_day || 0), 0) / failsByHour.length) : 0;
                  const timeLabel = avgHour >= 20 ? "밤" : avgHour >= 16 ? "저녁" : avgHour >= 12 ? "오후" : "오전";
                  const totalFails = records.filter(r => !r.done).length;
                  const isLocked = userPlan === "free";

                  const cards = [
                    { title: `${timeLabel} ${avgHour}시`, sub: "가장 자주 무너지는 시간", icon: "⏰", color: "#DC2626" },
                    ...(topReasons.length > 0 ? [{ title: topReasons[0][0], sub: `${topReasons[0][1]}번 반복된 원인`, icon: "🔥", color: "#F59E0B" }] : []),
                    { title: `${totalFails}회`, sub: "이번 달 총 실패", icon: "📊", color: "#6B7280" },
                  ];

                  return (
                    <div>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {cards.map((card, i) => (
                          <div key={i} className="relative">
                            <div className={`bg-white border border-[#E5E7EB] rounded-3xl p-4 text-center ${isLocked ? "blur-[4px]" : ""}`}>
                              <div className="text-2xl mb-2">{card.icon}</div>
                              <div className="text-[1rem] font-bold text-[#1A1A2E]">{card.title}</div>
                              <div className="text-[0.72rem] text-[#9CA3AF] mt-1">{card.sub}</div>
                            </div>
                            {isLocked && i > 0 && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-white/90 rounded-2xl px-3 py-1.5 shadow-sm">
                                  <div className="text-[0.72rem] text-[#4F46E5] font-bold">Pro</div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {!isLocked && failsByHour.length >= 3 && (
                        <div className="bg-[#FEF2F2] rounded-3xl p-5 mb-3">
                          <div className="text-[0.95rem] font-bold text-[#1A1A2E] mb-2">
                            {topReasons.length > 0
                              ? `당신은 ${timeLabel}에 "${topReasons[0][0]}" 때문에 무너집니다.`
                              : `당신은 ${timeLabel}에 무너집니다.`}
                          </div>
                          <div className="text-[0.85rem] text-[#6B7280] mb-3">이건 의지가 아니라 반복되는 패턴입니다.</div>
                          <button onClick={() => {
                            const text = `나의 실패 패턴: ${timeLabel} ${avgHour}시에 "${topReasons[0]?.[0] || "집중력 부족"}" 때문에 무너짐. Vanguard가 패턴을 잡아주고 있다.`;
                            const url = "https://vanguard-five-ecru.vercel.app/landing";
                            if (navigator.share) { navigator.share({ title: "Vanguard 실패 패턴", text, url }).catch(() => {}); }
                            else { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text + " " + url)}`, "_blank"); }
                          }}
                            className="w-full bg-[#F3F4F6] text-[#6B7280] font-medium rounded-2xl py-2.5 text-[0.82rem] press-effect">
                            패턴 카드 공유하기
                          </button>
                        </div>
                      )}
                      {isLocked && (
                        <button onClick={() => setActiveTab("settings")}
                          className="w-full bg-[#4F46E5] text-white font-bold rounded-3xl py-3.5 text-[0.88rem] press-effect shadow-lg shadow-[#4F46E5]/20">
                          패턴 전체 분석 보기 — Pro
                        </button>
                      )}
                    </div>
                  );
                })()}
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
                <span className="text-[0.85rem] text-[#9CA3AF]">{records.reduce((s, r) => s + (r.done ? (r.xp_earned ?? 10) : 0), 0)}점</span>
              </div>
            </div>

            {/* 알림 설정 */}
            <div className="bg-white border border-[#E5E7EB] rounded-3xl mb-3">
              <div className="px-4 py-3 border-b border-[#E5E7EB]/50">
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-wider uppercase">알림</div>
              </div>
              <button onClick={async () => {
                if ("Notification" in window) {
                  const perm = await Notification.requestPermission();
                  if (perm === "granted") {
                    new Notification("Vanguard", { body: "알림이 설정되었습니다. 매일 미션을 놓치지 않게 알려드리겠습니다.", icon: "/icon-192x192.png" });
                    alert("알림이 활성화되었습니다!");
                  } else {
                    alert("알림 권한을 허용해주세요. 브라우저 설정에서 변경할 수 있습니다.");
                  }
                } else {
                  alert("이 브라우저는 알림을 지원하지 않습니다.");
                }
              }} className="w-full flex items-center justify-between px-4 py-3.5">
                <span className="text-[0.85rem] text-[#1A1A2E] font-medium">알림 허용하기</span>
                <span className="text-[0.75rem] text-[#9CA3AF]">{"Notification" in window && Notification.permission === "granted" ? "✓ 활성" : "비활성"}</span>
              </button>
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
                <div className="text-[0.8rem] text-[#9CA3AF] font-bold tracking-wider uppercase">플랜 비교</div>
              </div>
              <div className="p-4 space-y-3">
                {/* Free */}
                <div className={`rounded-2xl p-3 ${userPlan === "free" ? "bg-[#F3F4F6] border-2 border-[#4F46E5]" : "bg-[#F9FAFB]"}`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[0.85rem] font-bold text-[#1A1A2E]">Free</div>
                    {userPlan === "free" && <div className="text-[0.7rem] bg-[#4F46E5] text-white px-2 py-0.5 rounded-full">현재</div>}
                  </div>
                  <div className="text-[0.75rem] text-[#6B7280] leading-relaxed">AI 스케줄 · 미션 실행 · 3분 복귀 · AI 코치 하루 4회</div>
                </div>
                {/* Pro */}
                <div className={`rounded-2xl p-3 ${userPlan === "pro" ? "bg-[#EEF2FF] border-2 border-[#4F46E5]" : "bg-[#F9FAFB]"}`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[0.85rem] font-bold text-[#4F46E5]">Pro</div>
                    {userPlan === "pro" ? <div className="text-[0.7rem] bg-[#4F46E5] text-white px-2 py-0.5 rounded-full">현재</div> : <div className="text-[0.7rem] text-[#9CA3AF]">출시 예정</div>}
                  </div>
                  <div className="text-[0.75rem] text-[#6B7280] leading-relaxed">Free 전체 + AI 패턴 분석 · 맞춤 피드백 · 주간 리포트 · AI 코치 무제한</div>
                  {userPlan === "free" && (
                    <button onClick={() => (async () => { await supabase.from("beta_requests").insert([{ nickname, plan: "pro" }]); trackEvent("beta_request", { plan: "pro" }); alert("Pro 베타 신청 완료! 정식 출시 시 가장 먼저 안내드립니다."); })()}
                      className="mt-2 w-full bg-[#4F46E5] text-white text-[0.78rem] font-bold rounded-xl py-2 press-effect">
                      Pro 베타 신청
                    </button>
                  )}
                </div>
                {/* Ultra */}
                <div className={`rounded-2xl p-3 ${userPlan === "ultra" ? "bg-[#F5F3FF] border-2 border-[#7C3AED]" : "bg-[#F9FAFB]"}`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[0.85rem] font-bold text-[#7C3AED]">Ultra</div>
                    {userPlan === "ultra" ? <div className="text-[0.7rem] bg-[#7C3AED] text-white px-2 py-0.5 rounded-full">현재</div> : <div className="text-[0.7rem] text-[#9CA3AF]">출시 예정</div>}
                  </div>
                  <div className="text-[0.75rem] text-[#6B7280] leading-relaxed">Pro 전체 + 실패 예측 · 미접속 개입 · 전체 실행 관리 · 월간 성장 리포트</div>
                  {userPlan !== "ultra" && (
                    <button onClick={() => (async () => { await supabase.from("beta_requests").insert([{ nickname, plan: "ultra" }]); trackEvent("beta_request", { plan: "ultra" }); alert("Ultra 베타 신청 완료! 정식 출시 시 가장 먼저 안내드립니다."); })()}
                      className="mt-2 w-full bg-[#7C3AED] text-white text-[0.78rem] font-bold rounded-xl py-2 press-effect">
                      Ultra 베타 신청
                    </button>
                  )}
                </div>
              </div>
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
              <button onClick={() => setShowDeleteAccount(true)}
                className="w-full flex items-center justify-between px-4 py-3.5 border-t border-[#E5E7EB]/50">
                <span className="text-[0.85rem] text-[#EF4444] font-medium">계정 삭제</span>
                <span className="text-[#9CA3AF]">›</span>
              </button>
            </div>

            <div className="bg-white border border-[#E5E7EB]/50 rounded-2xl p-3 mt-1">
              <div className="text-[0.75rem] text-[#9CA3AF] text-center leading-relaxed">
                Pro/Ultra는 현재 베타 신청을 받고 있습니다.<br />
                정식 출시 시 안내드리겠습니다.
              </div>
            </div>
          </div>
        )}
        </div>

        {/* AI 코치 플로팅 버튼 */}
        {!showSplash && !showCoachChat && !isGuest && (
          <button onClick={() => setShowCoachChat(true)}
            className="fixed bottom-24 right-4 bg-[#4F46E5] text-white w-14 h-14 rounded-full shadow-lg shadow-[#4F46E5]/30 flex items-center justify-center z-40 press-effect"
            style={{fontSize: "1.3rem"}}>
            AI
          </button>
        )}

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