export default function RefundPage() {
  return (
    <div className="min-h-screen bg-white text-[#1A1A2E]">
      <div className="max-w-[680px] mx-auto px-5 py-12">
        <a href="/landing" className="text-[0.78rem] text-[#9CA3AF] hover:text-[#4F46E5]">← 돌아가기</a>
        <h1 className="text-[1.5rem] font-black mt-4 mb-2">환불 및 취소 정책</h1>
        <p className="text-[0.72rem] text-[#9CA3AF] mb-8">시행일: 2026년 6월 1일</p>

        <div className="space-y-6 text-[0.85rem] leading-relaxed text-[#374151]">
          <section>
            <h2 className="font-bold text-[1rem] mb-2">1. 청약철회</h2>
            <p>이용자는 유료 서비스 결제일로부터 7일 이내에 서비스를 이용하지 않은 경우 전액 환불을 요청할 수 있습니다. 단, 결제 후 유료 기능을 이용한 경우에는 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 환불이 제한될 수 있습니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">2. 구독 취소</h2>
            <p>1. 이용자는 언제든지 구독을 취소할 수 있습니다.<br />
            2. 구독 취소 시 다음 결제일부터 자동 갱신이 중단되며, 이미 결제된 기간 동안은 서비스를 계속 이용할 수 있습니다.<br />
            3. 구독 취소는 앱 내 설정 또는 고객센터를 통해 가능합니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">3. 환불 기준</h2>
            <p>1. 결제 후 7일 이내 + 유료 기능 미사용: 전액 환불<br />
            2. 결제 후 7일 이내 + 유료 기능 사용: 이용 일수를 제외한 잔여 금액 환불<br />
            3. 결제 후 7일 경과: 월 구독의 경우 해당 월 환불 불가, 다음 결제 중단 처리<br />
            4. 회사의 귀책사유로 서비스를 이용하지 못한 경우: 전액 환불</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">4. 환불 방법</h2>
            <p>1. 환불은 원결제수단으로 처리됩니다.<br />
            2. 환불 요청 후 영업일 기준 3~7일 이내에 처리됩니다.<br />
            3. 카드 결제의 경우 카드사 사정에 따라 환불 시점이 달라질 수 있습니다.</p>
          </section>

          <section>
            <h2 className="font-bold text-[1rem] mb-2">5. 환불 신청</h2>
            <p>환불 신청은 아래 고객센터로 연락 주시기 바랍니다.<br />
            이메일: minjaej581@gmail.com<br />
            연락처: 010-8793-7522<br />
            처리 시간: 평일 10:00 ~ 18:00</p>
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
