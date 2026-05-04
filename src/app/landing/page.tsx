"use client";

import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#050A12] text-white">
      <div className="max-w-[480px] mx-auto px-5">

        {/* 히어로 */}
        <div className="pt-20 pb-16 text-center">
          <div className="text-[2.5rem] font-black uppercase leading-none mb-1" style={{letterSpacing: "0.15em"}}>VANGUARD</div>
          <div className="text-[0.65rem] text-[#999] mb-8" style={{letterSpacing: "0.35em", fontWeight: 700}}>Life OS</div>
          <div className="text-[1.3rem] font-black text-white leading-snug mb-4">
            계획은 AI가 세운다.<br />
            당신은 실행만 하면 된다.<br />
            <span className="text-[#FCA5A5]">안 하면 끌어온다.</span>
          </div>
          <div className="text-[0.85rem] text-[#94A3B8] leading-relaxed mb-8">
            기존 앱은 계획을 기록합니다.<br />
            Vanguard는 실패한 사람을 다시 실행하게 만듭니다.
          </div>
          <button onClick={() => router.push("/login")}
            className="bg-white text-[#050A12] font-black rounded-2xl py-4 px-12 text-[1rem] press-effect"
            style={{letterSpacing: "0.15em"}}>
            지금 시작하기
          </button>
          <button onClick={() => {
            localStorage.setItem("vanguard_guest_trial", "true");
            router.push("/");
          }}
            className="block mx-auto mt-3 text-[0.78rem] text-[#94A3B8] underline underline-offset-4 press-effect">
            회원가입 없이 바로 체험하기
          </button>
          <div className="text-[0.68rem] text-[#334155] mt-2">무료 · 3초면 시작</div>
        </div>

        {/* 문제 */}
        <div className="py-12 border-t border-white/5">
          <div className="text-[0.62rem] text-[#FCA5A5] font-bold tracking-widest uppercase mb-3">문제</div>
          <div className="text-[1.1rem] font-black text-white leading-snug mb-4">
            80%의 사람이 계획을 세우고<br />실행하지 못합니다.
          </div>
          <div className="text-[0.82rem] text-[#64748B] leading-relaxed">
            Todoist, Notion, Calendar — 기록과 알림은 해줍니다.<br />
            하지만 실패한 사람을 다시 실행하게 만들지는 못합니다.
          </div>
        </div>

        {/* 해결책 — 3단계 */}
        <div className="py-12 border-t border-white/5">
          <div className="text-[0.62rem] text-[#4ADE80] font-bold tracking-widest uppercase mb-6">해결책</div>

          <div className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-5 mb-3">
            <div className="text-[0.6rem] text-[#475569] font-bold tracking-wider mb-2">STEP 1</div>
            <div className="text-[1rem] font-black text-white mb-1">AI가 오늘 할 일을 정합니다</div>
            <div className="text-[0.78rem] text-[#64748B]">목표, 일정, 컨디션을 분석해서 오늘 가장 먼저 해야 할 1개를 정해줍니다. 당신은 고르기만 하면 됩니다.</div>
          </div>

          <div className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-5 mb-3">
            <div className="text-[0.6rem] text-[#475569] font-bold tracking-wider mb-2">STEP 2</div>
            <div className="text-[1rem] font-black text-white mb-1">실패하면 3분짜리로 줄여줍니다</div>
            <div className="text-[0.78rem] text-[#64748B]">포기하려는 순간, 원래 미션을 3분짜리로 줄여서 다시 시작하게 만듭니다. "오늘은 끝"이 아니라 "3분만 더".</div>
          </div>

          <div className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-5 mb-3">
            <div className="text-[0.6rem] text-[#475569] font-bold tracking-wider mb-2">STEP 3</div>
            <div className="text-[1rem] font-black text-white mb-1">반복 패턴을 잡아서 미리 개입합니다</div>
            <div className="text-[0.78rem] text-[#64748B]">매번 저녁 9시에 무너진다면, 다음부터 8시에 미리 끌어옵니다. 무너지기 전에 잡아주는 AI 코치.</div>
          </div>
        </div>

        {/* 차별화 비교표 */}
        <div className="py-12 border-t border-white/5">
          <div className="text-[0.62rem] text-[#94A3B8] font-bold tracking-widest uppercase mb-4">기존 앱 vs Vanguard</div>
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="grid grid-cols-3 text-[0.65rem] font-bold text-[#475569] border-b border-white/[0.04]">
              <div className="p-3"></div>
              <div className="p-3 text-center">기존 앱</div>
              <div className="p-3 text-center text-white">Vanguard</div>
            </div>
            {[
              { label: "역할", old: "기록/알림", now: "실행 개입" },
              { label: "실패 후", old: "기록으로 끝", now: "3분 복귀" },
              { label: "반복 실패", old: "직접 파악", now: "AI 패턴 감지" },
              { label: "미접속", old: "방치", now: "이메일 개입" },
              { label: "다음 주", old: "없음", now: "AI 방향 조정" },
            ].map((row, i) => (
              <div key={i} className="grid grid-cols-3 text-[0.72rem] border-b border-white/[0.04] last:border-0">
                <div className="p-3 text-[#64748B]">{row.label}</div>
                <div className="p-3 text-center text-[#475569]">{row.old}</div>
                <div className="p-3 text-center text-white font-bold">{row.now}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 가격 */}
        <div className="py-12 border-t border-white/5">
          <div className="text-[0.62rem] text-[#94A3B8] font-bold tracking-widest uppercase mb-4">플랜</div>
          <div className="space-y-3">
            <div className="bg-[#0D1117] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[0.88rem] font-black text-white">Free</div>
                <div className="text-[0.78rem] text-[#475569]">₩0</div>
              </div>
              <div className="text-[0.72rem] text-[#64748B]">AI 스케줄 생성 · 실행 타이머 · 3분 복귀 · 기본 분석</div>
            </div>
            <div className="bg-[#0D1117] border border-white/20 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[0.88rem] font-black text-white">Pro</div>
                <div className="text-[0.78rem] text-white">₩9,900/월</div>
              </div>
              <div className="text-[0.72rem] text-[#94A3B8]">AI 무제한 · 실패 패턴 분석 · 주간 AI 리포트 · AI 맞춤 복귀 · 블록 추가/삭제</div>
            </div>
            <div className="bg-[#0D0818] border border-[#8B5CF6]/30 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[0.88rem] font-black text-white">Ultra</div>
                <div className="text-[0.78rem] text-[#A78BFA]">₩49,000/월</div>
              </div>
              <div className="text-[0.72rem] text-[#94A3B8]">전체 관리 · 미접속 이메일 개입 · 위험 시간 선제 개입 · 다음 날 전략 자동 생성</div>
            </div>
          </div>
        </div>

        {/* 창업자 */}
        <div className="py-12 border-t border-white/5">
          <div className="text-[0.62rem] text-[#94A3B8] font-bold tracking-widest uppercase mb-3">만든 사람</div>
          <div className="text-[0.92rem] font-black text-white mb-2">23세, 1인 개발</div>
          <div className="text-[0.78rem] text-[#64748B] leading-relaxed">
            저도 계획만 세우고 실행 못 하는 사람이었습니다.<br />
            그래서 직접 만들었습니다.<br />
            기획, 디자인, 개발, 배포 — 혼자서 전부.<br />
            Vanguard는 제 문제에서 시작된 제품입니다.
          </div>
        </div>

        {/* CTA */}
        <div className="py-16 text-center border-t border-white/5">
          <div className="text-[1.1rem] font-black text-white mb-2">지금 시작하세요</div>
          <div className="text-[0.78rem] text-[#64748B] mb-6">계획은 AI가 세웁니다. 당신은 실행만 하면 됩니다.</div>
          <button onClick={() => router.push("/login")}
            className="bg-white text-[#050A12] font-black rounded-2xl py-4 px-12 text-[1rem] press-effect"
            style={{letterSpacing: "0.15em"}}>
            무료로 시작하기
          </button>
        </div>

        {/* 푸터 */}
        <div className="py-8 border-t border-white/5 text-center">
          <div className="text-[0.6rem] text-[#334155]">
            <a href="/privacy" className="hover:text-white">개인정보처리방침</a>
            <span className="mx-2">·</span>
            <a href="/terms" className="hover:text-white">이용약관</a>
            <span className="mx-2">·</span>
            <a href="mailto:minjaej581@gmail.com" className="hover:text-white">문의</a>
          </div>
          <div className="text-[0.55rem] text-[#1E293B] mt-2">© 2026 Vanguard Studio</div>
        </div>
      </div>
    </div>
  );
}
