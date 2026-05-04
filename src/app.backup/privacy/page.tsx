export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#050A12] text-white px-6 py-12">
      <div className="max-w-[600px] mx-auto">
        <h1 className="text-[1.5rem] font-black mb-6">개인정보처리방침</h1>
        <div className="text-[0.82rem] text-[#94A3B8] leading-relaxed space-y-4">
          <p>Vanguard(이하 "서비스")는 이용자의 개인정보를 중요시하며, 관련 법령에 따라 개인정보를 보호합니다.</p>
          <h2 className="text-white font-bold text-[0.92rem] mt-6">1. 수집하는 개인정보</h2>
          <p>이메일 주소, 닉네임, 실행 기록, 일정 데이터를 수집합니다.</p>
          <h2 className="text-white font-bold text-[0.92rem] mt-6">2. 수집 목적</h2>
          <p>서비스 제공, AI 분석, 이메일 리마인더 발송, 서비스 개선에 활용합니다.</p>
          <h2 className="text-white font-bold text-[0.92rem] mt-6">3. 보관 기간</h2>
          <p>회원 탈퇴 시까지 보관하며, 탈퇴 시 즉시 삭제합니다.</p>
          <h2 className="text-white font-bold text-[0.92rem] mt-6">4. 제3자 제공</h2>
          <p>이용자의 동의 없이 제3자에게 개인정보를 제공하지 않습니다. 단, AI 분석을 위해 Google Gemini API에 텍스트 데이터가 전송됩니다.</p>
          <h2 className="text-white font-bold text-[0.92rem] mt-6">5. 문의</h2>
          <p>개인정보 관련 문의: minjaej581@gmail.com</p>
          <p className="text-[#334155] mt-8">최종 수정: 2026년 4월</p>
        </div>
      </div>
    </div>
  );
}
