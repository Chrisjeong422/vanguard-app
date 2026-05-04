"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Mode = "splash" | "login" | "signup" | "verify";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("splash");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => setMode("login"), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  async function handleLogin() {
    if (!email || !password) { setError("이메일과 비밀번호를 입력하세요."); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes("Email not confirmed")) {
        setError("이메일 인증을 완료해주세요.");
      } else {
        setError("이메일 또는 비밀번호가 틀렸습니다.");
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const nickname = user.user_metadata?.nickname;
        if (nickname) {
          await supabase.from("users").update({ auth_id: user.id }).eq("nickname", nickname).is("auth_id", null);
        }
      }
      router.replace("/");
    }
    setLoading(false);
  }

  async function handleSignup() {
    if (!email || !password || !name) { setError("모든 항목을 입력하세요."); return; }
    if (password.length < 6) { setError("비밀번호는 6자 이상이어야 합니다."); return; }
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { nickname: name } }
    });
    if (error) {
      setError("회원가입 실패. 이미 사용 중인 이메일일 수 있습니다.");
      setLoading(false);
      return;
    }
    if (data.user) {
      await supabase.from("users").upsert([{
        nickname: name, goal: "", plan: "free", auth_id: data.user.id
      }], { onConflict: "nickname" });
      localStorage.setItem("vanguard_nickname", name);
    }
    setMode("verify");
    setLoading(false);
  }

  if (mode === "splash") {
    return (
      <div className="min-h-screen bg-[#050A12] flex flex-col items-center justify-center">
        <div className="text-[3.5rem] font-black uppercase text-white" style={{letterSpacing: "0.2em", animation: "fadeIn 0.8s ease-in"}}>
          VANGUARD
        </div>
        <div className="text-[0.5rem] text-[#666] mt-0.5" style={{letterSpacing: "0.35em", fontWeight: 300, animation: "fadeIn 1.2s ease-in"}}>
          Life OS
        </div>
        <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      </div>
    );
  }

  if (mode === "verify") {
    return (
      <div className="min-h-screen bg-[#050A12] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-[360px]">
          <div className="text-center mb-10">
            <div className="text-[2rem] font-black uppercase text-white" style={{letterSpacing: "0.15em"}}>VANGUARD</div>
          </div>
          <div className="bg-[#0D1117] border border-white/10 rounded-2xl p-8 text-center">
            <div className="text-[1.2rem] font-black text-white mb-3">이메일을 확인하세요</div>
            <div className="text-[0.82rem] text-[#64748B] leading-relaxed mb-6">
              <span className="text-white font-bold">{email}</span>으로<br />
              인증 링크를 보냈습니다.
            </div>
            <button onClick={() => setMode("login")}
              className="w-full bg-white text-[#050A12] font-black rounded-xl py-3.5 text-[0.92rem]">
              로그인으로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050A12] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[360px]">
        {/* 로고 */}
        <div className="text-center mb-12">
          <div className="text-[2.5rem] font-black uppercase text-white" style={{letterSpacing: "0.15em"}}>VANGUARD</div>
          <div className="text-[0.6rem] text-[#666] mt-1" style={{letterSpacing: "0.35em", fontWeight: 300}}>Life OS</div>
        </div>

        {/* 서브 카피 */}
        <div className="text-center mb-8">
          <div className="text-[0.88rem] text-[#94A3B8] font-medium">
            {mode === "login" ? "계속 실행하려면 로그인하세요" : "지금 시작하면 오늘이 달라집니다"}
          </div>
        </div>

        {/* 폼 */}
        <div className="space-y-3">
          {mode === "signup" && (
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="닉네임"
              className="w-full bg-[#0D1117] border border-white/10 rounded-xl px-4 py-3.5 text-[0.92rem] text-white placeholder-[#334155] focus:outline-none focus:border-white/30" />
          )}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="이메일"
            className="w-full bg-[#0D1117] border border-white/10 rounded-xl px-4 py-3.5 text-[0.92rem] text-white placeholder-[#334155] focus:outline-none focus:border-white/30"
            onKeyDown={e => e.key === "Enter" && mode === "login" && handleLogin()} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="w-full bg-[#0D1117] border border-white/10 rounded-xl px-4 py-3.5 text-[0.92rem] text-white placeholder-[#334155] focus:outline-none focus:border-white/30"
            onKeyDown={e => e.key === "Enter" && mode === "login" && handleLogin()} />
        </div>

        {error && <div className="text-[0.78rem] text-[#FCA5A5] text-center mt-3">{error}</div>}

        <button onClick={mode === "login" ? handleLogin : handleSignup} disabled={loading}
          className="w-full bg-white text-[#050A12] font-black rounded-xl py-3.5 mt-6 text-[0.95rem] press-effect"
          style={{letterSpacing: "0.3em", paddingLeft: "0.3em"}}>
          {loading ? "..." : mode === "login" ? "로그인" : "시작하기"}
        </button>

        <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
          className="w-full text-[#475569] text-[0.78rem] py-4 text-center">
          {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
        </button>
        <button onClick={() => {
          localStorage.setItem("vanguard_guest_trial", "true");
          router.replace("/");
        }}
          className="w-full text-[#334155] text-[0.68rem] py-2 text-center mt-2">
          가입 없이 체험하기
        </button>
      </div>
    </div>
  );
}
