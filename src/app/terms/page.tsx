export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-[#1A1A2E]">
      <div className="max-w-[680px] mx-auto px-5 py-12">
        <a href="/landing" className="text-[0.78rem] text-[#9CA3AF] hover:text-[#4F46E5]">← 돌아가기</a>
        <h1 className="text-[1.5rem] font-black mt-4 mb-2">이용약관</h1>
        <p className="text-[0.72rem] text-[#9CA3AF] mb-8">시행일: 2026년 6월 1일</p>

        <div className="space-y-6 text-[0.85rem] leading-relaxed text-[#374151]">
          <section>
            <h2 className="font-bold text-[1rem] mb-2">제1조 (목적)</h2>
            <p>본 약관은 에스엠제이(SMJ)(이하 "회사")가 제공하는 Vanguard 서비스(이하 "서비스")의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제2조 (정의)</h2>
            <p>1. "서비스"란 회사가 제공하는 AI 기반 실행 관리 애플리케이션 및 관련 제반 서비스를 말합니다.<br />
            2. "이용자"란 본 약관에 따라 회사가 제공하는 서비스를 이용하는 회원을 말합니다.<br />
            3. "유료 서비스"란 회사가 유료로 제공하는 Pro, Ultra 등의 구독 서비스를 말합니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제3조 (약관의 효력 및 변경)</h2>
            <p>1. 본 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력이 발생합니다.<br />
            2. 회사는 관련 법령을 위배하지 않는 범위에서 본 약관을 변경할 수 있으며, 변경 시 적용일자 및 변경사유를 명시하여 사전에 공지합니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제4조 (서비스의 제공)</h2>
            <p>1. 회사는 다음과 같은 서비스를 제공합니다: AI 일정 생성, 실행 관리, 패턴 분석, AI 코치 대화 등.<br />
            2. 회사는 서비스의 내용을 변경할 수 있으며, 이 경우 변경 내용을 사전에 공지합니다.<br />
            3. 무료 서비스와 유료 서비스의 구체적인 내용은 서비스 내 안내에 따릅니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제5조 (유료 서비스 및 결제)</h2>
            <p>1. 유료 서비스는 월 단위 구독 형태로 제공됩니다.<br />
            2. Pro는 월 9,900원, Ultra는 월 49,000원입니다 (부가세 포함).<br />
            3. 결제는 신용카드 등 회사가 제공하는 결제수단으로 이루어집니다.<br />
            4. 구독은 해지 시까지 매월 자동 갱신됩니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제6조 (청약철회 및 환불)</h2>
            <p>환불 및 청약철회에 관한 사항은 별도의 환불정책에 따르며, 관련 법령(전자상거래 등에서의 소비자보호에 관한 법률)을 준수합니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제7조 (이용자의 의무)</h2>
            <p>이용자는 서비스 이용 시 관련 법령과 본 약관을 준수해야 하며, 타인의 권리를 침해하거나 서비스 운영을 방해하는 행위를 해서는 안 됩니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제8조 (회사의 책임 제한)</h2>
            <p>1. 회사는 천재지변, 불가항력 등으로 서비스를 제공할 수 없는 경우 책임이 면제됩니다.<br />
            2. 서비스는 실행 관리를 돕는 도구이며, 이용자의 목표 달성을 보장하지 않습니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">제9조 (문의)</h2>
            <p>서비스 이용 관련 문의: minjaej581@gmail.com / 010-8793-7522</p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-[#F3F4F6] text-[0.6rem] text-[#9CA3AF] leading-relaxed">
          상호: 에스엠제이(SMJ) · 대표: 정민재 · 사업자등록번호: 587-01-04330<br />
          서울특별시 용산구 녹사평대로 66, 205동 1102호(동빙고동, 용산푸르지오파크타운)
        </div>
      </div>
    </div>
  );
}
