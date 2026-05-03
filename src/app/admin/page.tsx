"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";



type User = {
  id: string;
  nickname: string;
  goal?: string;
  plan: string;
  plan_expires_at?: string;
  created_at: string;
  memo?: string;
  email?: string;
};

type Record_ = {
  nickname: string;
  date: string;
  task: string;
  done: boolean;
  fail_reason?: string;
  hour_of_day?: number;
  created_at: string;
};

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [inquiries, setInquiries] = useState<{id: string, nickname: string, message: string, created_at: string}[]>([]);
  const [records, setRecords] = useState<Record_[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (authed) loadData();
  }, [authed]);
  function handleLogin() {
    if (pw === process.env.NEXT_PUBLIC_ADMIN_PW || pw === "vanguard2024!") {
      setAuthed(true);
    }
  }

  async function loadData() {
    setLoading(true);
    const { data: u } = await supabase.from("users").select("*").order("created_at", { ascending: false });
    const { data: r } = await supabase.from("execution_records").select("*").order("created_at", { ascending: false }).limit(200);
    setUsers(u || []);
    setRecords(r || []);
    const { data: inq } = await supabase.from("inquiries").select("*").order("created_at", { ascending: false }).limit(20);
    setInquiries(inq || []);
    setLoading(false);
  }

  async function updatePlan(nickname: string, plan: string) {
    setUpdatingPlan(nickname);
    const expires = plan !== "free" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
    await supabase.from("users").update({ plan, plan_expires_at: expires }).eq("nickname", nickname);
    await loadData();
    setUpdatingPlan(null);
  }

  async function saveMemo(nickname: string) {
    await supabase.from("users").update({ memo }).eq("nickname", nickname);
    await loadData();
    setMemo("");
    setSelectedUser(null);
  }

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const totalUsers = users.length;
  const paidUsers = users.filter(u => u.plan !== "free").length;
  const todayActive = new Set(records.filter(r => r.date === today).map(r => r.nickname)).size;
  const todayRecs = records.filter(r => r.date === today);
  const completeCount = todayRecs.filter(r => r.done).length;
  const completeRate = todayRecs.length > 0 ? Math.round(completeCount / todayRecs.length * 100) : 0;
  const failRecs = records.filter(r => !r.done);
  const recoveryCount = records.filter(r => r.done && new Set(failRecs.map(f => `${f.nickname}_${f.date}`)).has(`${r.nickname}_${r.date}`)).length;
  const recoveryRate = failRecs.length > 0 ? Math.round(recoveryCount / failRecs.length * 100) : 0;
  const paidRate = totalUsers > 0 ? Math.round(paidUsers / totalUsers * 100) : 0;
  const todaySuccess = todayRecs.filter(r => r.done).length;
  const yestSuccess = records.filter(r => r.date === yesterday && r.done).length;
  const diff = todaySuccess - yestSuccess;

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#050A12] text-white flex items-center justify-center px-6">
        <div className="w-full max-w-[340px] text-center">
          <div className="text-2xl font-black mb-2 uppercase" style={{letterSpacing: "0.15em"}}>Vanguard</div>
          <div className="text-[0.72rem] text-[#334155] mb-8">관리자 페이지</div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
            placeholder="비밀번호"
            className="w-full bg-[#0D1117] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 focus:outline-none focus:border-white/30 mb-3"
            onKeyDown={e => e.key === "Enter" && handleLogin()} />
          <button onClick={handleLogin}
            className="w-full bg-white text-[#050A12] font-bold rounded-xl py-3">
            로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050A12] text-white px-4 pb-8">
      <div className="max-w-[480px] mx-auto">
        <div className="pt-10 pb-4 border-b border-white/5 mb-4 flex items-center justify-between">
          <div>
            <div className="text-[1.2rem] font-black uppercase" style={{letterSpacing: "0.1em"}}>관리자</div>
            <div className="text-[0.62rem] text-[#334155]">Vanguard Admin</div>
          </div>
          <button onClick={loadData} className="text-[0.72rem] text-white border border-white/20 rounded-lg px-3 py-1.5">
            🔄 새로고침
          </button>
        </div>

        {loading && <div className="text-center text-[#334155] py-8">로딩 중...</div>}

        {/* 핵심 지표 */}
        <div className="text-[0.65rem] text-[#334155] font-bold tracking-widest uppercase mb-2">매일 봐야 할 숫자</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-white">{totalUsers}</div>
            <div className="text-[0.6rem] text-[#334155] mt-1">전체 유저</div>
          </div>
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-[#4ADE80]">{todayActive}</div>
            <div className="text-[0.6rem] text-[#334155] mt-1">오늘 진입</div>
          </div>
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-[#A78BFA]">{paidUsers}</div>
            <div className="text-[0.6rem] text-[#334155] mt-1">유료 유저</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="bg-[#0A160D] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-white">{completeRate}%</div>
            <div className="text-[0.6rem] text-[#334155] mt-1">오늘 완료율</div>
            <div className="text-[0.58rem] text-[#334155]">{completeCount}/{todayRecs.length}명</div>
          </div>
          <div className="bg-[#160A0A] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-[#FCA5A5]">{recoveryRate}%</div>
            <div className="text-[0.6rem] text-[#334155] mt-1">실패 후 복귀율</div>
            <div className="text-[0.58rem] text-[#334155]">{recoveryCount}/{failRecs.length}명</div>
          </div>
        </div>
        <div className={`rounded-xl p-3 mb-4 ${diff >= 0 ? "bg-[#0A160D] border border-white/[0.06]" : "bg-[#160A0A] border border-white/[0.06]"}`}>
          <div className="text-[0.62rem] text-[#334155] font-bold mb-1">오늘 vs 어제 · 유료 전환율 {paidRate}%</div>
          <div className={`text-[0.85rem] font-black ${diff >= 0 ? "text-white" : "text-[#FCA5A5]"}`}>
            오늘 완료 {todaySuccess}개 {diff >= 0 ? `▲ ${diff}` : `▼ ${Math.abs(diff)}`} (어제 {yestSuccess}개)
          </div>
        </div>

        {/* 재방문율 */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(() => {
            const userLastDates: Record<string, Set<string>> = {};
            records.forEach(r => {
              if (!userLastDates[r.nickname]) userLastDates[r.nickname] = new Set();
              userLastDates[r.nickname].add(r.date);
            });
            const usersWithMultipleDays = Object.values(userLastDates).filter(dates => dates.size >= 2).length;
            const returnRate = totalUsers > 0 ? Math.round(usersWithMultipleDays / totalUsers * 100) : 0;
            const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
            const weekActive = new Set(records.filter(r => r.date >= weekAgo).map(r => r.nickname)).size;
            return (
              <>
                <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 text-center">
                  <div className="text-2xl font-black text-white">{returnRate}%</div>
                  <div className="text-[0.6rem] text-[#334155] mt-1">재방문율</div>
                  <div className="text-[0.58rem] text-[#334155]">2일 이상 접속 유저</div>
                </div>
                <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 text-center">
                  <div className="text-2xl font-black text-white">{weekActive}</div>
                  <div className="text-[0.6rem] text-[#334155] mt-1">주간 활성</div>
                  <div className="text-[0.58rem] text-[#334155]">최근 7일 접속</div>
                </div>
              </>
            );
          })()}
        </div>

        {/* 유저 목록 */}
        <div className="text-[0.65rem] text-[#334155] font-bold tracking-widest uppercase mb-2">유저 목록</div>
        {users.map(user => {
          const ur = records.filter(r => r.nickname === user.nickname);
          const uc = ur.filter(r => r.done).length;
          const uf = ur.filter(r => !r.done).length;
          const ur_rate = ur.length > 0 ? Math.round(uc / ur.length * 100) : 0;
          return (
            <div key={user.id} className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-4 mb-2">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[0.9rem] font-black text-white">{user.nickname}</div>
                  {user.goal && <div className="text-[0.68rem] text-[#64748B] mt-0.5">목표: {user.goal}</div>}
                  {user.memo && <div className="text-[0.68rem] text-[#FCD34D] mt-0.5">📝 {user.memo}</div>}
                </div>
                <div className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full ${
                  user.plan === "ultra" ? "bg-white/10 text-[#A78BFA]" :
                  user.plan === "pro" ? "bg-white/10 text-white" :
                  "bg-white/5 text-[#334155]"
                }`}>{user.plan.toUpperCase()}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center">
                  <div className="text-[0.88rem] font-black text-white">{uc}</div>
                  <div className="text-[0.55rem] text-[#334155]">성공</div>
                </div>
                <div className="text-center">
                  <div className="text-[0.88rem] font-black text-[#FCA5A5]">{uf}</div>
                  <div className="text-[0.55rem] text-[#334155]">실패</div>
                </div>
                <div className="text-center">
                  <div className="text-[0.88rem] font-black text-white">{ur_rate}%</div>
                  <div className="text-[0.55rem] text-[#334155]">성공률</div>
                </div>
              </div>
              <div className="text-[0.62rem] text-[#334155] mb-3">
                가입: {user.created_at?.slice(0, 10)} · 마지막: {ur[0]?.date || "-"}
                {user.plan_expires_at && ` · 만료: ${user.plan_expires_at.slice(0, 10)}`}
              </div>
              <div className="flex gap-1.5 mb-2">
                {["free", "pro", "ultra"].map(plan => (
                  <button key={plan} onClick={() => updatePlan(user.nickname, plan)}
                    disabled={updatingPlan === user.nickname}
                    className={`flex-1 py-1.5 rounded-lg text-[0.68rem] font-bold transition-all ${
                      user.plan === plan ? "bg-white text-[#050A12]" : "bg-[#0D1117] border border-white/10 text-[#475569]"
                    }`}>
                    {updatingPlan === user.nickname ? "..." : plan.toUpperCase()}
                  </button>
                ))}
              </div>
              {selectedUser === user.nickname ? (
                <div className="flex gap-1.5">
                  <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                    placeholder="메모 입력"
                    className="flex-1 bg-[#050A12] border border-white/10 rounded-lg px-3 py-1.5 text-[0.78rem] text-white placeholder-white/25 focus:outline-none" />
                  <button onClick={() => saveMemo(user.nickname)} className="bg-white text-[#050A12] rounded-lg px-3 text-[0.72rem] font-bold">저장</button>
                  <button onClick={() => setSelectedUser(null)} className="bg-[#0D1117] border border-white/10 text-[#475569] rounded-lg px-3 text-[0.72rem]">취소</button>
                </div>
              ) : (
                <button onClick={() => { setSelectedUser(user.nickname); setMemo(user.memo || ""); }}
                  className="w-full text-[0.68rem] text-[#334155] border border-white/[0.04] rounded-lg py-1.5">
                  📝 메모 {user.memo ? "수정" : "추가"}
                </button>
              )}
            </div>
          );
        })}

{/* 문의 목록 */}
        <div className="text-[0.65rem] text-[#334155] font-bold tracking-widest uppercase mb-2 mt-4">유저 문의</div>
        {inquiries.length === 0 ? (
          <div className="text-[0.78rem] text-[#334155] mb-4">문의 없음</div>
        ) : (
          <div className="mb-4">
            {inquiries.map((inq, i) => (
              <div key={i} className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-3 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[0.78rem] font-bold text-white">{inq.nickname}</div>
                  <div className="text-[0.6rem] text-[#334155]">{inq.created_at?.slice(0, 10)}</div>
                </div>
                <div className="text-[0.75rem] text-[#94A3B8]">{inq.message}</div>
              </div>
            ))}
          </div>
        )}

        {/* 최근 기록 */}
        <div className="text-[0.65rem] text-[#334155] font-bold tracking-widest uppercase mb-2 mt-4">최근 실행 기록</div>
        {records.slice(0, 20).map((r, i) => (
          <div key={i} className="flex items-center justify-between py-2.5 border-b border-white/[0.04]">
            <div>
              <div className="text-[0.78rem] text-[#94A3B8]">
                <span className="font-bold text-white">{r.nickname}</span> · {r.task.slice(0, 20)}
              </div>
              {r.fail_reason && <div className="text-[0.65rem] text-[#FCA5A5]">실패: {r.fail_reason}</div>}
            </div>
            <div className="text-right">
              <div className={`text-[0.72rem] font-bold ${r.done ? "text-white" : "text-[#FCA5A5]"}`}>{r.done ? "✅" : "❌"}</div>
              <div className="text-[0.6rem] text-[#334155]">{r.date} {r.hour_of_day ? `${r.hour_of_day}시` : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
