"""
Vanguard MVP — Stable Edition
- JS 완전 없음
- 타이머: time.sleep/rerun 없음, 진입 시 경과 시간 텍스트만 표시
- 탭: st.columns + st.button 단일 레이어, HTML 이중 표시 없음
- 깨지지 않는 구조 우선
"""
import html
import os
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Tuple
from collections import defaultdict

import calendar
import uuid
import streamlit as st

# =========================================================
# Optional Gemini
# =========================================================
GENAI_IMPORT_ERROR = None
try:
    from google import genai
except Exception as e:
    genai = None
    GENAI_IMPORT_ERROR = e

# =========================================================
# Optional Google Sheets
# =========================================================
GSPREAD_IMPORT_ERROR = None
try:
    import gspread
    from oauth2client.service_account import ServiceAccountCredentials
except Exception as e:
    gspread = None
    ServiceAccountCredentials = None
    GSPREAD_IMPORT_ERROR = e

# =========================================================
# PAGE CONFIG
# =========================================================
st.set_page_config(
    page_title="Vanguard",
    page_icon="⚡",
    layout="centered",
    initial_sidebar_state="collapsed",
)

# PWA/OG 메타태그 주석:
# Streamlit에서 st.markdown()으로 <head> 주입 시 실제 브라우저 head에
# 안정적으로 들어가지 않음. 모바일 최적화는 CSS(max-width:480px)로 처리.
# 진짜 PWA/OG는 추후 별도 프론트엔드 전환 시 구현.

# =========================================================
# 기술 로드맵 — 언제 무엇을 바꿔야 하는지
# =========================================================
# [지금] 세션 기반 AI 명령 제한, Google Sheets, 수동 승인
#
# [결제 자동화] 유료 전환 실제 10명 달성 시
#   → 사업자 등록 후 토스페이먼츠 또는 Stripe 연동
#
# [제한 정책 고도화] DAU 30명 이상 체감 시
#   → 닉네임/시트 기반 AI 명령 카운트로 전환
#   → 세션 우회가 실질적 문제가 되는 시점
#
# [Supabase 이전] Google Sheets 부하 체감 시
#   → 관리자 페이지 로딩 3초 이상
#   → 시트 API 에러 하루 1회 이상
#   → 기록 저장 지연 체감
#   → 숫자 기준 아닌 실제 부하 기준으로 판단
# =========================================================

# =========================================================
# SAFE SECRETS LOAD — 반드시 SETTINGS보다 먼저 정의
# =========================================================
def get_secret(key: str, default: str = "") -> str:
    try:
        if key in st.secrets:
            return st.secrets[key]
    except Exception:
        pass
    return os.getenv(key, default)

GEMINI_API_KEY = get_secret("GEMINI_API_KEY", "")
ADMIN_PASSWORD = get_secret("ADMIN_PASSWORD", "")

# =========================================================
# SETTINGS — get_secret() 호출은 반드시 위 함수 정의 이후에
# =========================================================
SHEET_NAME    = "NexusMemory"
GOOGLE_SERVICE_ACCOUNT_FILE = "google_service_account.json"
SHEETS_SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]
ADMIN_PARAM      = "admin"
SOCIAL_PROOF_MIN = 10
FREE_DAILY_CMD_LIMIT = 3   # 무료 사용자 하루 AI 명령 생성 횟수 제한
FREE_RECORD_DAYS     = 7   # 무료 사용자 기록 열람 일수 제한

# ── 시트 URL — secrets 우선, fallback으로 하드코딩 ──
# Streamlit secrets에 NEXUS_SHEET_URL 등록 권장 (코드 노출 방지)
# 운영 배포용: fallback 하드코딩 제거 — Secrets 미등록 시 명확한 에러 발생
# 로컬 개발 시엔 .streamlit/secrets.toml에 직접 등록할 것
NEXUS_SHEET_URL = get_secret("NEXUS_SHEET_URL", "")
if not NEXUS_SHEET_URL:
    st.error("⚠️ NEXUS_SHEET_URL이 Secrets에 등록되지 않았습니다. Streamlit Cloud → Settings → Secrets를 확인하세요.")
    st.stop()

# ── Premium 신청 ──
PREMIUM_PRICE       = 9900
PREMIUM_PAYMENT_URL = get_secret(
    "PREMIUM_PAYMENT_URL",
    "https://docs.google.com/forms/d/e/1FAIpQLSdcmuSW_54mjUdVxG9xyuiq2KnoCe5OK9hu38y2e4LGMsBnsg/viewform?usp=dialog"
)
# 신청 후 관리자가 입금 확인 → 수동 승인 (1~3시간 내)

# =========================================================
# THEME — CSS only, no JS
# =========================================================
st.markdown("""
<style>
#MainMenu {visibility: hidden;}
header {visibility: hidden;}
footer {visibility: hidden;}

html, body, [class*="css"] {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
                 "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
}

.stApp { background: #080E1C; color: #F8FAFC; }

.block-container {
    max-width: 480px !important;
    padding-top: 0.5rem !important;
    padding-bottom: 1rem !important;
    padding-left: 1rem !important;
    padding-right: 1rem !important;
}

/* ── 카드 ── */
.card {
    padding: 16px; border-radius: 20px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.07);
    margin-bottom: 10px;
}
.command-card {
    padding: 20px; border-radius: 22px;
    background: linear-gradient(145deg,rgba(14,165,233,0.18),rgba(59,130,246,0.08));
    border: 1px solid rgba(56,189,248,0.28);
    margin-bottom: 10px;
}
.warning-card {
    padding: 16px; border-radius: 18px;
    background: rgba(239,68,68,0.09);
    border: 1px solid rgba(239,68,68,0.28);
    margin-bottom: 10px;
}
.success-card {
    padding: 16px; border-radius: 18px;
    background: rgba(34,197,94,0.09);
    border: 1px solid rgba(34,197,94,0.26);
    margin-bottom: 10px;
}

/* ── streak 위기 ── */
.streak-crisis {
    padding: 20px 16px; border-radius: 20px; text-align: center;
    background: linear-gradient(145deg,rgba(239,68,68,0.14),rgba(220,38,38,0.07));
    border: 1.5px solid rgba(239,68,68,0.42);
    margin-bottom: 12px;
}
.streak-crisis-num  { font-size:2.4rem; font-weight:900; color:#FCA5A5; line-height:1; }
.streak-crisis-title{ font-size:0.95rem; font-weight:900; color:#FCA5A5; margin-top:4px; }
.streak-crisis-sub  { font-size:0.78rem; color:#94A3B8; margin-top:4px; line-height:1.5; }

/* ── 어제 vs 오늘 ── */
.compare-card {
    padding: 13px 15px; border-radius: 17px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.05);
    margin-bottom: 10px;
}
.compare-row {
    display:flex; align-items:center; gap:9px;
    padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.04);
}
.compare-row:last-of-type { border-bottom:none; }
.compare-day  { font-size:0.7rem; color:#475569; width:26px; flex-shrink:0; }
.compare-emoji{ font-size:0.9rem; flex-shrink:0; width:18px; }
.compare-text { font-size:0.8rem; color:#94A3B8; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.compare-time { font-size:0.68rem; color:#334155; flex-shrink:0; }
.compare-msg  { font-size:0.8rem; margin-top:9px; font-weight:700; }

/* ── 공유 배너 ── */
.share-banner {
    padding: 16px; border-radius: 18px; text-align: center;
    background: linear-gradient(145deg,rgba(99,102,241,0.16),rgba(59,130,246,0.09));
    border: 1.5px solid rgba(99,102,241,0.35);
    margin-bottom: 10px;
}
.share-milestone{ font-size:1.4rem; font-weight:900; color:#FFFFFF; }
.share-sub      { font-size:0.78rem; color:#A5B4FC; margin-top:3px; }

/* ── 사회적 증거 ── */
.social-proof {
    padding: 8px 13px; border-radius: 11px;
    background: rgba(56,189,248,0.07);
    border: 1px solid rgba(56,189,248,0.13);
    margin-bottom: 10px;
    font-size:0.77rem; color:#7DD3FC; text-align:center;
}

/* ── 집중 중 카드 ── */
.focus-card {
    padding: 20px 16px; border-radius: 20px;
    background: linear-gradient(145deg,rgba(34,197,94,0.12),rgba(16,185,129,0.07));
    border: 1.5px solid rgba(34,197,94,0.30);
    margin-bottom: 10px; text-align: center;
}
.focus-elapsed {
    font-size: 2.4rem; font-weight: 900; color: #86EFAC;
    font-variant-numeric: tabular-nums; line-height: 1;
}
.focus-label { font-size: 0.78rem; color: #6EE7B7; margin-top: 4px; }
.focus-task  { font-size: 0.86rem; color: #94A3B8; margin-top: 10px; line-height: 1.5; }
.focus-phase { font-size: 0.78rem; color: #6EE7B7; font-weight: 700; margin-top: 6px; }

/* ── 타이포 ── */
.muted { color:#475569; font-size:0.76rem; }
.section-label {
    font-size:0.7rem; font-weight:700; color:#475569;
    letter-spacing:0.06em; text-transform:uppercase; margin-bottom:5px;
}
.strong-title { font-size:1.08rem; font-weight:900; line-height:1.35; color:#FFFFFF; margin-top:7px; }
.body-small   { color:#94A3B8; font-size:0.82rem; line-height:1.55; margin-top:5px; }

/* ── 상태 메트릭 ── */
.metric-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
.metric {
    padding:11px 7px; border-radius:13px;
    background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.06);
    text-align:center;
}
.metric-label { color:#475569; font-size:0.68rem; }
.metric-value { color:#FFFFFF; font-size:1.02rem; font-weight:900; margin-top:3px; }

/* ── 월간 캘린더 ── */
.cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-top:7px; }
.cal-day { aspect-ratio:1; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:0.63rem; font-weight:700; }
.cal-success { background:rgba(34,197,94,0.26); color:#86EFAC; }
.cal-fail    { background:rgba(239,68,68,0.17); color:#FCA5A5; }
.cal-empty   { background:rgba(255,255,255,0.04); color:#334155; }
.cal-future  { background:transparent; }
.cal-locked  { background:rgba(99,102,241,0.12); color:#6366F1; font-size:0.55rem; }
.cal-header  { color:#334155; font-size:0.62rem; text-align:center; padding-bottom:2px; }

/* ── 프리미엄 pill ── */
.premium-pill {
    display:inline-block; padding:4px 8px; border-radius:999px;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.07);
    font-size:0.71rem; color:#CBD5E1; margin-right:4px; margin-bottom:4px;
}

/* ── Premium 잠금 카드 ── */
.lock-card {
    padding: 20px 16px; border-radius: 20px; text-align: center;
    background: linear-gradient(145deg,rgba(99,102,241,0.14),rgba(59,130,246,0.08));
    border: 1.5px solid rgba(99,102,241,0.32);
    margin-bottom: 10px;
}
.lock-icon  { font-size:2rem; margin-bottom:8px; }
.lock-title { font-size:1rem; font-weight:900; color:#C7D2FE; }
.lock-sub   { font-size:0.8rem; color:#6B7280; margin-top:5px; line-height:1.55; }

/* 계좌 안내 카드 제거됨 — 결제 링크 방식으로 전환 */

/* ── Premium 혜택 비교표 ── */
.compare-table { width:100%; margin-top:8px; border-collapse:collapse; }
.compare-table td { padding:7px 4px; font-size:0.8rem; vertical-align:middle; }
.compare-table tr { border-bottom:1px solid rgba(255,255,255,0.04); }
.compare-table tr:last-child { border-bottom:none; }
.ct-label { color:#94A3B8; width:55%; }
.ct-free  { text-align:center; color:#475569; width:22%; font-size:0.75rem; }
.ct-prem  { text-align:center; color:#86EFAC; width:23%; font-size:0.75rem; font-weight:700; }

/* ── 버튼 — Streamlit 기본 클래스만 사용 (버전 안전) ── */
.stButton > button {
    width:100%; min-height:50px; border-radius:15px;
    font-size:0.93rem; font-weight:800;
    border: 1px solid rgba(255,255,255,0.15) !important;
    background: rgba(255,255,255,0.07) !important;
    color: #F8FAFC !important;
}
.stButton > button:hover {
    background: rgba(255,255,255,0.13) !important;
    border-color: rgba(255,255,255,0.25) !important;
}
/* link_button — stLinkButton은 비교적 안정적인 클래스 */
.stLinkButton > a {
    width:100%; min-height:50px; border-radius:15px;
    font-size:0.93rem; font-weight:800;
    display:flex; align-items:center; justify-content:center;
    background: rgba(59,130,246,0.85) !important;
    color: #ffffff !important;
    border: none !important;
    text-decoration: none !important;
}
.stLinkButton > a:hover {
    background: rgba(59,130,246,1) !important;
}

/* ── 탭 버튼은 Streamlit 기본 스타일 사용 — 추가 CSS 없음 ── */

/* ── 입력 필드 — 안정적인 선택자만 사용 ── */
.stTextInput input,
input[type="text"],
input[type="password"],
input[type="email"] {
    background: #1E293B !important;
    border: 1px solid rgba(255,255,255,0.20) !important;
    border-radius: 13px !important;
    color: #F8FAFC !important;
    -webkit-text-fill-color: #F8FAFC !important;
    font-size: 0.93rem !important;
    padding: 11px 15px !important;
    caret-color: #38BDF8 !important;
}
.stTextInput input::placeholder,
input[type="text"]::placeholder,
input[type="password"]::placeholder {
    color: rgba(248,250,252,0.40) !important;
    -webkit-text-fill-color: rgba(248,250,252,0.40) !important;
}
.stTextInput input:focus,
input[type="text"]:focus {
    border-color: #38BDF8 !important;
    box-shadow: 0 0 0 3px rgba(56,189,248,0.15) !important;
    background: #1E293B !important;
    -webkit-text-fill-color: #F8FAFC !important;
}
.stTextInput label, .stTextInput p {
    color: #94A3B8 !important;
}
/* 셀렉트박스 — data-baseweb은 Streamlit 내부 구현에 의존하므로 제거
   Streamlit 기본 스타일로 fallback */
.stCaption, .stMarkdown small {
    color: #475569 !important;
}

/* streak 불꽃 */
@keyframes flicker { 0%,100%{opacity:1;} 50%{opacity:0.72;} }
.flame { display:inline-block; animation:flicker 1.5s ease-in-out infinite; }

@media (max-width:480px) {
    .block-container { padding-left:0.7rem !important; padding-right:0.7rem !important; }
    .focus-elapsed { font-size:2rem; }
}
</style>
""", unsafe_allow_html=True)

# =========================================================
# TEXT
# =========================================================
TXT = {
    "title": "⚡ Vanguard",
    "tagline": "Break the Loop",
    "goal_label": "이번 달 목표",
    "goal_placeholder": "예: 4월 안에 앱 출시",
    "start_now": "🚀 지금 시작",
    "refresh": "↻ 새 명령",
    "complete": "✅ 완료",
    "fail": "❌ 실패",
    "today_none": "아직 기록 없음",
    "today_success": "오늘 성공 ✓",
    "today_fail": "오늘 실패",
    "streak_warning": "여기서 끊기면 다시 3일 걸린다. 오늘 안 하면 내일도 안 한다.",
    "policy_text": "베타 버전입니다. 기록과 Premium 신청 정보는 기능 개선과 응답 확인 용도로 사용됩니다.",
    "fallback_ai": "AI 연결 없음 — 기본 명령으로 동작 중입니다. (개인화 명령은 Gemini API 연결 후 활성화)",
    "pain_line": "지금 안 하면 오늘은 끝이다.",
    "pain_sub": "이건 의지 문제가 아니다. 같은 패턴이 반복되고 있는 거다. 지금 이 순간이 그 패턴을 끊을 유일한 기회다.",
    "premium_title": "🔒 Premium",
    "premium_body": "무료는 오늘 시작만 시킨다. Premium은 왜 계속 무너지는지 찾아서 그 패턴을 끊는다.",
    "premium_urgency": "베타 초기 가격 · 이후 인상 예정",
    "premium_b1": "패턴 분석", "premium_b2": "맞춤 전략",
    "premium_b3": "시간대 교정", "premium_b4": "베타 우선",
    "premium_fail_title": "같은 이유로 계속 무너지고 있다",
    "premium_fail_body": "이건 의지 문제가 아니다. 패턴이다. Premium은 그 패턴의 원인을 찾아서 끊는다.",
    "premium_flow_title": "지금 흐름이 끊기기 전에",
    "premium_flow_body": "좋은 흐름은 언제 끊기는지 모른다. Premium은 그 지점을 미리 잡는다.",
    "action_motivate": "2분만 해라. 생각은 나중에.",
    "complete_msg": "해냈다. 오늘 패턴을 끊었다. 내일도 이 시간에 다시 와라. 🔥",
    # "fail_msg" — 현재 인라인 f-string으로 대체됨
    "progress_start": ("시작 구간", "생각을 줄이고 흐름을 유지해라."),
    "progress_mid":   ("집중 유지 구간", "지금 필요한 건 속도가 아니라 유지다."),
    "progress_deep":  ("흐름 고정 구간", "여기서 멈추면 아깝다. 끝까지 밀어붙여라."),
    "nickname_label": "닉네임을 설정하세요",
    "nickname_placeholder": "예: 철수, vanguard123",
    "nickname_confirm": "시작하기 →",
    "nickname_desc": "나만의 기록을 유지합니다. 다음에 와도 streak이 살아있어요.",
    "email_cta_title": "Premium 대기자 등록",
    "email_cta_body": "출시 즉시 알림 + 초기 가격 혜택",
    "email_placeholder": "이메일 주소",
    "email_confirm": "등록하기",
    "email_done": "등록 완료 ✓ 출시 시 가장 먼저 연락드릴게요.",
    # 게스트 온보딩
    "guest_save_title": "기록을 저장하려면 닉네임이 필요합니다",
    "guest_save_desc": "닉네임을 설정하면 streak과 기록이 유지됩니다. 다음에 와도 이어서 할 수 있어요.",
    "guest_save_btn": "저장하고 계속하기 →",
    "guest_skip": "나중에",
    # 시간대별 긴급도
    "time_morning": "오전",
    "time_afternoon": "오후",
    "time_evening": "저녁",
    # Premium
    "premium_page_title": "🔒 Vanguard Premium",
    "premium_tagline": "무너질 때 끌어올리는 개입 장치",
    "premium_applied_title": "신청 완료 ✓",
    "premium_applied_body": "신청서 확인 후 1~3시간 내에 Premium이 활성화됩니다.\\n입금 확인까지 완료되면 닉네임 기준으로 수동 승인됩니다.",
    "premium_active_title": "⚡ Premium 활성화됨",
    "premium_active_body": "무너질 때 끌어올리는 개입이 활성화됐습니다. 실패 원인 · 위험 시간대 · 복귀 프로토콜 모두 열림.",
}

# =========================================================
# SESSION STATE
# =========================================================
DEFAULTS: Dict[str, Any] = {
    "running": False,
    "start_time": 0.0,
    "current_task": "",
    "records": [],
    "goal": "",
    "last_error": "",
    "lazy_command": "",
    "lazy_reason": "",
    "lazy_warning": "",
    "command_ready": False,
    "_show_fail_select": False,
    "_header_ensured": False,
    "_users_header_ensured": False,
    "nickname": "",
    "nickname_confirmed": False,
    "_admin_authed": False,
    "_crisis_dismissed": False,
    "_active_tab": "home",
    "_premium_applied": False,         # 입금 안내까지 완료한 상태
    "_is_premium": False,              # 실제 Premium 활성화 여부 (시트에서 로드)
    "_fail_reason_for_premium": None,  # 실패 직후 Premium 탭 이동 시 이유
    "_fail_count_for_premium": None,   # 실패 직후 Premium 탭 이동 시 횟수
    "_daily_cmd_count": 0,             # 오늘 AI 명령 생성 횟수 (무료 제한용)
    "_daily_cmd_date": "",             # 날짜가 바뀌면 카운트 초기화
    # 게스트 온보딩 — 1회 실행 후 닉네임 받기
    "_guest_mode": True,               # 닉네임 없이 먼저 경험
    "_show_nickname_collect": False,   # 실행 후 닉네임 수집 화면 표시
    "_show_target_select": False,      # 닉네임 입력 후 타겟 선택 화면
    "target_type": "founder",          # 기본값: founder / student / fitness
    "_last_fail_reason": "",           # 마지막 실패 이유 — Premium 트리거에서 참조
    "_show_gave_up_msg": False,        # 포기 버튼 누른 후 안내 메시지
    # ── 미션 시스템 ──
    "today_mission": "",               # 오늘의 핵심 미션 1개
    "today_mission_date": "",          # 미션 설정 날짜 (날짜 변경 시 자동 초기화)
    "_show_completion_insight": False, # 완료 후 인사이트 화면
    "_show_fail_insight": False,       # 실패 후 인사이트 화면
    "_save_failed": False,             # 시트 저장 실패 플래그 — UI 안내용
    "_return_visit_logged": False,     # 재방문 체크 중복 방지
    "_entered_logged": False,          # enter_home 세션당 1번
    "_first_action_marked": False,     # first_action_done 업데이트 중복 방지
}
for k, v in DEFAULTS.items():
    if k not in st.session_state:
        st.session_state[k] = v

# =========================================================
# TIME UTILS
# =========================================================
def korea_now() -> datetime:
    return datetime.now(ZoneInfo("Asia/Seoul"))

def today_str() -> str:
    return korea_now().strftime("%Y-%m-%d")

def yesterday_str() -> str:
    return (korea_now().date() - timedelta(days=1)).strftime("%Y-%m-%d")

def elapsed_to_text(elapsed: int) -> str:
    """
    경과 시간 표시 — 실시간 갱신 없으므로 초 단위 제거
    0초가 멈춰 보이는 UX 문제 해결
    """
    if elapsed < 60:
        return "집중 시작"
    mins = elapsed // 60
    secs = elapsed % 60
    return f"{mins}분 {secs}초" if secs else f"{mins}분"

# =========================================================
# ERROR UTILS
# =========================================================
def set_error(msg: str) -> None:
    st.session_state.last_error = msg

def reset_error() -> None:
    st.session_state.last_error = ""

# =========================================================
# RECORD UTILS
# =========================================================
def parse_done(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s in {"false", "0", "no", "n"}:
        return False
    return s in {"true", "1", "yes", "y"}

def record_to_bool_done(row: Dict[str, Any]) -> bool:
    return parse_done(row.get("done", False))

def get_recent_records(records: List[Dict[str, Any]], limit: int = 15) -> List[Dict[str, Any]]:
    return records[-limit:] if records else []

def get_daily_map(records: List[Dict[str, Any]]) -> Dict[str, List[bool]]:
    daily: Dict[str, List[bool]] = defaultdict(list)
    for row in records:
        date_str = str(row.get("date", "")).strip()
        if date_str:
            daily[date_str].append(record_to_bool_done(row))
    return daily

def calculate_streak(records: List[Dict[str, Any]]) -> int:
    daily = get_daily_map(records)
    if not daily:
        return 0
    today = korea_now().date()
    streak = 0
    current = today
    while True:
        key = current.strftime("%Y-%m-%d")
        if key not in daily or not any(daily[key]):
            break
        streak += 1
        current -= timedelta(days=1)
    return streak

def get_today_status(records: List[Dict[str, Any]]) -> str:
    today = today_str()
    rows = [r for r in records if r.get("date") == today]
    if not rows:
        return "none"
    return "success" if any(record_to_bool_done(r) for r in rows) else "fail"

def get_yesterday_record(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    yesterday = yesterday_str()
    rows = [r for r in records if r.get("date") == yesterday]
    return rows[-1] if rows else {}

def get_success_fail_counts(records: List[Dict[str, Any]]) -> Tuple[int, int]:
    success = sum(1 for r in records if record_to_bool_done(r))
    fail    = sum(1 for r in records if not record_to_bool_done(r))
    return success, fail

def get_success_rate(records: List[Dict[str, Any]]) -> int:
    success, fail = get_success_fail_counts(records)
    total = success + fail
    return int(success / total * 100) if total > 0 else 0

# =========================================================
# 손실 시각화 계산 함수
# =========================================================
def get_loss_stats(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    이번 달 누적 손실 지표 계산
    반환:
      fail_count      — 이번 달 실패 횟수
      success_count   — 이번 달 성공 횟수
      success_rate    — 성공률 (%)
      fail_hours      — 실패로 날린 추정 시간 (회당 2시간 기준, heuristic)
      fail_prob       — 현재 패턴 위험도 (%, heuristic — 정확한 예측값 아님)
      recovery_days   — 지금 streak 회복에 필요한 일수
      danger_msg      — 현재 상태 압박 메시지
    """
    today      = korea_now().date()
    month_start = today.replace(day=1).strftime("%Y-%m-%d")

    month_records = [r for r in records
                     if str(r.get("date","")) >= month_start]

    fail_c    = sum(1 for r in month_records if not record_to_bool_done(r))
    success_c = sum(1 for r in month_records if record_to_bool_done(r))
    total_c   = fail_c + success_c

    success_rate = int(success_c / total_c * 100) if total_c > 0 else 0

    # ⚠️ 아래 수치는 정확한 분석 모델이 아닌 행동 유도용 heuristic
    # fail_hours: 실패 1회당 2시간 낭비로 추정 (실제 측정값 아님)
    # fail_prob: 현재 실패율 기반 심리적 압박용 수치 (통계적 예측 아님)
    # 나중에 실제 사용 데이터가 쌓이면 보정 가능
    fail_hours   = fail_c * 2

    # 이번 달 남은 일수
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_left     = days_in_month - today.day

    # 실패 확률 — 현재 실패율 기반 heuristic (정확한 예측값 아님)
    if total_c > 0:
        fail_prob = min(99, max(1, int((fail_c / total_c) * 100 * 1.2))) if fail_c > 0 else 5
    else:
        fail_prob = 50  # 데이터 없음 = 50/50

    # 복구에 필요한 일수 (streak이 끊긴 경우)
    streak = calculate_streak(records)
    recovery_days = max(0, 3 - streak) if streak < 3 else 0

    # 현재 상태 압박 메시지
    if success_rate >= 80:
        danger_msg = "이 흐름을 유지하면 이번 달 목표 달성 가능하다."
    elif success_rate >= 50:
        danger_msg = f"성공률이 {success_rate}%다. 지금 페이스면 이번 달 위태롭다."
    elif total_c == 0:
        danger_msg = "아직 이번 달 기록이 없다. 지금 시작하지 않으면 이번 달도 그냥 지나간다."
    else:
        danger_msg = f"이번 달 실패 {fail_c}회. 이 패턴이 계속되면 이번 달 목표는 없다."

    return {
        "fail_count":    fail_c,
        "success_count": success_c,
        "success_rate":  success_rate,
        "fail_hours":    fail_hours,
        "fail_prob":     fail_prob,
        "recovery_days": recovery_days,
        "danger_msg":    danger_msg,
        "days_left":     days_left,
        "total_count":   total_c,
    }

def get_top_fail_reason(records: List[Dict[str, Any]]) -> str:
    counts: Dict[str, int] = {}
    for r in records:
        if not record_to_bool_done(r):
            reason = str(r.get("fail_reason", "")).strip()
            if reason:
                counts[reason] = counts.get(reason, 0) + 1
    return max(counts, key=lambda k: counts[k]) if counts else ""

def get_weekly_stats(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not records:
        return {"success_rate": 0, "success_count": 0, "fail_count": 0, "top_fail_reason": ""}
    today = korea_now().date()
    week_start = today - timedelta(days=6)
    weekly_rows = []
    for r in records:
        try:
            d = datetime.strptime(str(r.get("date")), "%Y-%m-%d").date()
            if week_start <= d <= today:
                weekly_rows.append(r)
        except Exception:
            continue
    success, fail = get_success_fail_counts(weekly_rows)
    total = success + fail
    return {
        "success_rate": int(success / total * 100) if total > 0 else 0,
        "success_count": success,
        "fail_count": fail,
        "top_fail_reason": get_top_fail_reason(weekly_rows),
    }

def get_monthly_calendar(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    today = korea_now().date()
    first_day = today.replace(day=1)
    daily = get_daily_map(records)
    result = []
    current = first_day
    while current <= today:
        key = current.strftime("%Y-%m-%d")
        status = ("success" if key in daily and any(daily[key])
                  else "fail" if key in daily else "empty")
        result.append({"date": current, "status": status})
        current += timedelta(days=1)
    return result

# =========================================================
# 타겟별 메시지 세트
# =========================================================
TARGET_CONFIG = {
    "founder": {
        "label":      "1인 창업자",
        "emoji":      "🚀",
        "pain":       "오늘 안 하면 오늘 매출이 없다.",
        "pain_sub":   "미루는 하루가 쌓이면 이번 달 결과가 된다. 지금 이 순간이 유일한 기회다.",
        "streak_warn": "여기서 끊기면 다시 3일 걸린다. 오늘 안 하면 내일도 안 한다.",
        "complete":   "해냈다. 오늘 패턴을 끊었다. 내일도 이 시간에 다시 와라. 🔥",
    },
    "student": {
        "label":      "수험생",
        "emoji":      "📚",
        "pain":       "시험은 기다려주지 않는다.",
        "pain_sub":   "오늘 안 한 내용이 시험장에서 나온다. 지금이 마지막 기회다.",
        "streak_warn": "여기서 끊기면 다시 리듬 잡는 데 3일 걸린다.",
        "complete":   "오늘 공부 했다. 내일도 같은 시간에 와라. 습관이 점수를 만든다. 🔥",
    },
    "fitness": {
        "label":      "운동·다이어트",
        "emoji":      "💪",
        "pain":       "오늘 안 하면 내일 몸이 말해준다.",
        "pain_sub":   "빠진 하루가 쌓이면 몸이 보여준다. 지금 시작하지 않으면 오늘은 끝이다.",
        "streak_warn": "여기서 끊기면 다시 몸 만드는 데 2배 걸린다.",
        "complete":   "했다. 오늘 몸에 투자했다. 내일도 같은 시간에 다시 와라. 🔥",
    },
}

def infer_target(goal: str) -> str:
    """
    목표 텍스트 기반 타겟 자동 추론
    기본값: founder (메시지 톤이 가장 잘 맞고 지불 의향 높음)
    일반적인 목표(밥먹기 등)는 founder로 분류되지만
    pain 메시지는 타겟 톤 대신 중립적으로 표시
    """
    g = goal.lower()
    student_kw = {"시험", "수능", "공부", "학교", "수업", "과제", "토익", "토플",
                  "학점", "입시", "고시", "자격증", "시험공부", "강의", "숙제"}
    fitness_kw = {"운동", "헬스", "다이어트", "살", "몸무게", "체중", "근육",
                  "러닝", "조깅", "수영", "요가", "필라테스", "pt", "홈트", "스트레칭"}
    founder_kw = {"매출", "런칭", "클라이언트", "창업", "사업", "스타트업",
                  "고객", "마케팅", "개발", "제품", "서비스", "투자", "미팅",
                  "프로젝트", "작업", "업무", "일"}

    if any(kw in g for kw in student_kw):
        return "student"
    if any(kw in g for kw in fitness_kw):
        return "fitness"
    if any(kw in g for kw in founder_kw):
        return "founder"
    return "general"  # 키워드 매칭 실패 — 일반 목표

def get_target_config() -> dict:
    """현재 세션의 타겟 설정 반환"""
    t = st.session_state.get("target_type", "founder")
    return TARGET_CONFIG.get(t, TARGET_CONFIG["founder"])

def get_goal_matched_pain(goal: str) -> tuple:
    """
    목표 텍스트 기반으로 압박 문구 반환
    — 세션 target_type이 아닌 실제 목표 내용에 맞게 즉시 반영
    — tcfg["pain"]과 분리된 별도 함수

    infer_target()이 "general"을 반환하면
    목표 텍스트를 직접 활용한 문구로 fallback
    """
    g = goal.strip()
    if not g:
        return (
            "지금 안 하면 오늘은 끝이다.",
            "생각만 하면 아무것도 안 바뀐다. 지금 시작해야 오늘이 살아난다."
        )
    t = infer_target(g)
    if t == "student":
        return (
            "오늘 안 하면 점수는 안 오른다.",
            "작은 공부 1개라도 오늘 해야 흐름이 이어진다."
        )
    if t == "fitness":
        return (
            "오늘 안 하면 몸은 그대로다.",
            "짧게라도 움직여야 패턴이 유지된다."
        )
    if t == "founder":
        return (
            "오늘 안 하면 결과는 안 나온다.",
            "미루는 하루가 쌓이면 이번 달 결과가 된다."
        )
    # general — 키워드 매칭 실패한 일반 목표 (밥먹기, 방청소 등)
    # 목표 텍스트를 직접 반영해서 관련성 있는 문구 생성
    return (
        f"오늘 '{g}' 안 하면 또 미뤄진다.",
        "지금 이 순간 시작하지 않으면 오늘도 생각만 하다 끝난다."
    )

def get_daily_cmd_count() -> int:
    """오늘 AI 명령 생성 횟수 반환 — 날짜 바뀌면 자동 초기화"""
    today = today_str()
    if st.session_state.get("_daily_cmd_date") != today:
        st.session_state["_daily_cmd_date"] = today
        st.session_state["_daily_cmd_count"] = 0
    return st.session_state.get("_daily_cmd_count", 0)

def increment_daily_cmd_count() -> None:
    get_daily_cmd_count()  # 날짜 체크 후
    st.session_state["_daily_cmd_count"] = st.session_state.get("_daily_cmd_count", 0) + 1

def can_generate_command(is_premium: bool) -> bool:
    """무료 사용자는 하루 FREE_DAILY_CMD_LIMIT회 제한"""
    if is_premium:
        return True
    return get_daily_cmd_count() < FREE_DAILY_CMD_LIMIT

# =========================================================
# PREMIUM CTA 헬퍼 — 실패 횟수 기반 메시지 (13번 정리)
# =========================================================
def get_premium_cta(fail_count: int) -> Tuple[str, str, str]:
    """실패 횟수 기반 Premium 유도 메시지 반환 (title, body, color)"""
    if fail_count >= 5:
        return (
            f"이번 달 {fail_count}번째다. 혼자로는 안 된다.",
            "같은 이유로 계속 무너지는 건 의지 문제가 아니다. 패턴이다. 지금 분석 안 하면 다음 달도 똑같이 끝난다.",
            "#FCA5A5",
        )
    elif fail_count >= 3:
        return (
            f"이번 달 {fail_count}번 같은 패턴이다.",
            "두 번은 우연, 세 번은 패턴이다. Premium으로 원인 찾아야 한다.",
            "#FCD34D",
        )
    else:
        return (
            "같은 이유로 또 실패했다.",
            "분석 안 하면 계속 반복된다. Premium으로 패턴 끊어.",
            "#A5B4FC",
        )

def fast_command(goal: str) -> Tuple[str, str, str]:
    return (
        f"지금 '{goal or '핵심 작업'}' 2분만 해라. 지금 당장.",
        "2분만 넘기면 흐름이 붙는다. 시작이 전부다.",
        "지금 안 하면 오늘은 끝이다. 내일도 똑같이 미룬다.",
    )

# =========================================================
# 미션 시스템 헬퍼
# =========================================================
def get_today_mission() -> str:
    """오늘 미션 반환 (날짜 변경 시 자동 초기화)"""
    today = today_str()
    if st.session_state.get("today_mission_date", "") != today:
        st.session_state["today_mission"] = ""
        st.session_state["today_mission_date"] = today
        return ""
    return st.session_state.get("today_mission", "")

def set_today_mission(mission: str) -> None:
    """오늘 미션 설정"""
    st.session_state["today_mission"] = mission.strip()
    st.session_state["today_mission_date"] = today_str()

def get_completion_insight(records: List[Dict[str, Any]], streak: int, mission: str) -> Dict[str, str]:
    """완료 인사이트 — 스토리 기반, 숫자가 아닌 서사로 오늘을 기억하게"""
    today = korea_now().date()
    weekday_name = ["월", "화", "수", "목", "금", "토", "일"][today.weekday()]

    # 같은 요일 실패 횟수
    same_weekday_fails = 0
    for r in records:
        try:
            d = datetime.strptime(str(r.get("date", "")), "%Y-%m-%d").date()
            if d.weekday() == today.weekday() and not record_to_bool_done(r):
                same_weekday_fails += 1
        except Exception:
            pass

    # 이번 달 성공 횟수
    month_start = today.replace(day=1).strftime("%Y-%m-%d")
    month_success = sum(
        1 for r in records
        if str(r.get("date", "")) >= month_start and record_to_bool_done(r)
    )

    # 오늘 시간대
    hour = korea_now().hour
    time_zone = "오전" if hour < 12 else "오후" if hour < 18 else "저녁"

    # 스토리 생성 — 단정형, 서사형
    if same_weekday_fails >= 3:
        headline = f"{weekday_name}요일을 처음으로 이겨냈다."
        sub = f"지난 {same_weekday_fails}번 모두 이 요일에 무너졌다. 오늘 패턴이 깨졌다."
        story = f"오늘 이후 {weekday_name}요일이 달라진다."
    elif same_weekday_fails >= 1:
        headline = f"{weekday_name}요일에 해냈다. 항상 무너지던 날이었다."
        sub = f"같은 요일에 {same_weekday_fails}번 실패했는데 오늘은 끊었다."
        story = "패턴이 바뀌기 시작했다."
    elif streak >= 7:
        headline = f"{streak}일 연속이다. 이건 습관이다."
        sub = "7일을 넘긴 사람은 계속한다. 넌 그 안에 들어왔다."
        story = f"이번 달 {month_success}번 성공."
    elif streak >= 3:
        headline = f"{streak}일 연속이다. 패턴이 굳어지고 있다."
        sub = "3일을 넘기면 뇌가 기억한다. 내일도 이 시간에 와라."
        story = f"이번 달 {month_success}번 성공."
    else:
        headline = f"오늘 {time_zone}을 살렸다."
        sub = f"내일도 같은 시간에 오면 {streak + 1}일이 된다."
        story = f"이번 달 {month_success}번 성공."

    return {
        "headline": headline,
        "sub": sub,
        "streak": str(streak),
        "story": story,
        "time_label": f"{time_zone} 완료",
    }

def get_fail_pattern_insight(records: List[Dict[str, Any]], fail_reason: str, mission: str) -> Dict[str, str]:
    """
    패턴 폭로 엔진 — 구체적 시간대 + 요일 + 반복 횟수로 단정형 선언
    "같은 이유로 실패했다" ❌
    "너는 화요일 저녁에 3번 무너졌다" ✅
    """
    today = korea_now().date()
    month_start = today.replace(day=1).strftime("%Y-%m-%d")
    weekday_names = ["월", "화", "수", "목", "금", "토", "일"]

    # 이번 달 같은 이유 실패 기록
    same_reason_records = [
        r for r in records
        if str(r.get("date", "")) >= month_start
        and not record_to_bool_done(r)
        and str(r.get("fail_reason", "")).strip() == fail_reason.strip()
    ]
    same_reason_count = len(same_reason_records)

    # 실패 시간대 분석 — 전체 실패 기록 기준
    fail_hours = []
    fail_weekdays = []
    for r in records:
        if not record_to_bool_done(r) and r.get("time"):
            try:
                t = str(r.get("time", ""))
                h = int(t[11:13])
                fail_hours.append(h)
                # 요일 분석
                date_str = str(r.get("date", ""))
                if date_str:
                    d = datetime.strptime(date_str, "%Y-%m-%d").date()
                    fail_weekdays.append(d.weekday())
            except Exception:
                pass

    # 가장 많이 무너지는 시간대 — 최소 3회 이상일 때만 선언
    peak_zone = ""
    peak_count = 0
    safe_zone = "오전 중에 시작해보자"
    if len(fail_hours) >= 3:  # 데이터 부족 시 억지 선언 방지
        morning = sum(1 for h in fail_hours if h < 12)
        afternoon = sum(1 for h in fail_hours if 12 <= h < 18)
        evening = sum(1 for h in fail_hours if h >= 18)
        peak_data = max([("오전", morning, "저녁에 시도해보자"),
                         ("오후", afternoon, "아침 일찍 해보자"),
                         ("저녁", evening, "오전 중에 시작해보자")],
                        key=lambda x: x[1])
        peak_zone, peak_count, safe_zone = peak_data

    # 가장 많이 무너지는 요일 — 최소 3회 이상 + 같은 요일 2회 이상
    peak_weekday_name = ""
    if len(fail_weekdays) >= 3:  # 데이터 부족 시 억지 선언 방지
        from collections import Counter
        weekday_counts = Counter(fail_weekdays)
        peak_wd, peak_wd_count = weekday_counts.most_common(1)[0]
        if peak_wd_count >= 2:  # 같은 요일 최소 2회
            peak_weekday_name = weekday_names[peak_wd]

    # ── 패턴 선언 — 데이터 충분할 때만 단정형, 부족하면 관찰형 ──
    if same_reason_count >= 3 and peak_weekday_name and peak_zone:
        # 최고 강도: 요일 + 시간대 + 횟수 전부 (데이터 충분)
        pattern_msg = (
            f"너는 {peak_weekday_name}요일 {peak_zone}에 무너진다.\n"
            f"'{fail_reason}'으로 이번 달만 {same_reason_count}번째다."
        )
        fix_msg = f"{peak_weekday_name}요일 {peak_zone}이 너의 취약 구간이다. {safe_zone}."
        warning = f"이 패턴 그대로면 다음 {peak_weekday_name}요일도 똑같이 끝난다."
    elif same_reason_count >= 3 and peak_weekday_name:
        # 요일만 있는 경우
        pattern_msg = (
            f"너는 {peak_weekday_name}요일에 자주 무너진다.\n"
            f"'{fail_reason}'으로 이번 달 {same_reason_count}번째다."
        )
        fix_msg = f"{peak_weekday_name}요일이 취약 구간이다. {safe_zone}."
        warning = f"이 패턴 그대로면 다음 {peak_weekday_name}요일도 똑같이 끝난다."
    elif same_reason_count >= 3:
        # 횟수 강조
        pattern_msg = (
            f"'{fail_reason}' — 이번 달 {same_reason_count}번 반복됐다.\n"
            f"{peak_zone}이 가장 위험한 시간대다."
        )
        fix_msg = f"같은 패턴이 굳어지고 있다. {safe_zone}."
        warning = "지금 끊지 않으면 다음 달도 똑같이 반복된다."
    elif same_reason_count == 2:
        # 두 번째 — 패턴 시작 경고
        pattern_msg = (
            f"'{fail_reason}' — 두 번은 우연이 아니다.\n"
            f"패턴이 시작되고 있다."
        )
        fix_msg = f"세 번째 전에 끊어야 한다. {safe_zone}."
        warning = "두 번이 세 번 되는 건 순식간이다."
    else:
        # 첫 번째
        pattern_msg = f"'{fail_reason}' — 이 패턴이 시작되고 있다."
        fix_msg = f"한 번에서 끊어야 한다. {safe_zone}."
        warning = "한 번은 실수다. 두 번부터는 패턴이다."

    return {
        "pattern_msg": pattern_msg,
        "fix_msg": fix_msg,
        "warning": warning,
        "same_reason_count": str(same_reason_count),
        "peak_zone": peak_zone,
        "peak_weekday": peak_weekday_name,
    }

# =========================================================
# GEMINI
# =========================================================
def get_genai_client():
    if genai is None or not GEMINI_API_KEY:
        return None
    try:
        return genai.Client(api_key=GEMINI_API_KEY)
    except Exception:
        return None

def _parse_gemini_response(text: str, keys: List[str]) -> Dict[str, str]:
    parsed = {k: "" for k in keys}
    for line in text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            key = k.strip().upper()
            if key in parsed:
                parsed[key] = v.strip()
    return parsed

@st.cache_data(ttl=60)
def generate_premium_command(
    goal: str, streak: int, success_rate: int, top_fail: str, fail_count: int
) -> Tuple[str, str, str]:
    """
    Premium 전용 명령 — 실패 패턴 기반 개인화
    무료 명령과 체감 차이를 홈 화면에서 바로 느끼게
    """
    fallback = (
        f"'{top_fail or '집중 저하'}' 패턴이 반복되고 있다. 지금 30초만 시작해.",
        f"실패 {fail_count}회가 쌓였다. 지금이 패턴을 끊을 마지막 기회다.",
        "지금 또 미루면 이 패턴은 다음 주도 반복된다.",
    )
    client = get_genai_client()
    if client is None:
        return fallback
    prompt = f"""
너는 개인화 행동 교정 AI 'Vanguard Premium'이다.
이 사람의 실패 데이터를 기반으로 지금 이 순간 해야 할 명령을 만들어라.

목표: {goal or "미입력"}
streak: {streak}일 / 성공률: {success_rate}%
반복 실패 이유: {top_fail or "없음"}
누적 실패 횟수: {fail_count}회

규칙:
- 반복 실패 이유를 명시적으로 언급해라
- "또 {top_fail}로 실패할 것 같다면" 같은 패턴 교정 관점으로
- 위로 금지. 실행 강제만.

다음 형식만 출력:
COMMAND: 지금 당장 할 행동 1개 (패턴 교정 관점, 구체적으로)
REASON: 왜 지금 이 방식으로 해야 하는지
WARNING: 지금 또 같은 패턴으로 실패하면 어떻게 되는지
"""
    try:
        res = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        parsed = _parse_gemini_response((res.text or "").strip(),
                                        ["COMMAND", "REASON", "WARNING"])
        return (
            parsed["COMMAND"] or fallback[0],
            parsed["REASON"]  or fallback[1],
            parsed["WARNING"] or fallback[2],
        )
    except Exception:
        return fallback

@st.cache_data(ttl=60)
def generate_command(
    goal: str, streak: int, success_rate: int,
    target_type: str = "founder",  # 캐시 키에 포함 — session_state 직접 참조 금지
    is_premium: bool = False,       # 무료/유료 톤 분기용
) -> Tuple[str, str, str]:
    fallback = fast_command(goal)
    client = get_genai_client()
    if client is None:
        return fallback
    target_label = TARGET_CONFIG.get(target_type, TARGET_CONFIG["founder"])["label"]

    # Premium 여부에 따라 프롬프트 톤 분리
    # 무료: 설명형 / 유료: 감독형 (첫날부터 체감 차이)
    if is_premium:
        # 유료 — 감독형. "AI가 아니라 감독" 느낌
        prompt = f"""
너는 행동 강제 감독 AI 'Vanguard'다.
유저의 실패 패턴을 알고 있다. 위로 없음. 설명 없음. 명령만.
지금 이 순간 행동하지 않으면 오늘도 무너진다는 걸 유저가 체감하게 만들어라.

유저 유형: {target_label}
목표: {goal or '미입력'}
streak: {streak}일 / 성공률: {success_rate}%

다음 형식만 출력 (명령형, 직접적, 유저를 "너"로 호칭):
COMMAND: 너가 지금 당장 해야 할 행동 1개 (강하게, 구체적으로)
REASON: 지금 안 하면 생기는 손실 (팩트로)
WARNING: 너 지금 또 같은 패턴 반복하고 있다 (직접적으로)
"""
    else:
        # 무료 — 설명형. 부드럽지만 실행 유도
        prompt = f"""
너는 행동 통제 AI 'Vanguard'다.
위로 금지. 공감 금지. 오직 실행 강제.
사용자가 지금 이 순간 행동하게 만드는 것이 유일한 목표다.

사용자 유형: {target_label}
목표: {goal or '핵심 목표 미입력'}
streak: {streak}일 / 성공률: {success_rate}%

다음 형식만 출력 (각 1문장, {target_label} 관점으로 직접적이고 강하게):
COMMAND: 지금 당장 할 수 있는 행동 1개 (동사로 시작, 구체적으로)
REASON: 지금 안 하면 안 되는 이유 (손실 관점으로)
WARNING: 오늘 이걸 안 하면 어떻게 되는지 (팩트, 강하게)
"""
    try:
        res = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        parsed = _parse_gemini_response((res.text or "").strip(), ["COMMAND", "REASON", "WARNING"])
        return (
            parsed["COMMAND"] or fallback[0],
            parsed["REASON"] or fallback[1],
            parsed["WARNING"] or fallback[2],
        )
    except Exception:
        return fallback

@st.cache_data(ttl=180)
def generate_weekly_report(
    goal: str, success_rate: int, success_count: int,
    fail_count: int, top_fail_reason: str,
) -> Tuple[str, str]:
    fb_f = "최근 7일 동안 반복 실패 이유가 존재한다."
    fb_a = "가장 중요한 작업을 2분짜리 시작 블록으로 먼저 시작해라."
    client = get_genai_client()
    if client is None:
        return fb_f, fb_a
    prompt = f"""
목표: {goal or '미입력'}
7일 성공률: {success_rate}% (성공 {success_count} / 실패 {fail_count})
주요 실패 이유: {top_fail_reason or '없음'}
다음 형식만 출력:
FOCUS: 핵심 패턴 1개
ACTION: 추천 행동 1개
"""
    try:
        res = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        parsed = _parse_gemini_response((res.text or "").strip(), ["FOCUS", "ACTION"])
        return parsed["FOCUS"] or fb_f, parsed["ACTION"] or fb_a
    except Exception:
        return fb_f, fb_a

@st.cache_data(ttl=180)
def generate_premium_insight(goal: str, recent_repr: str) -> Dict[str, str]:
    """
    Premium 전용 심층 분석
    무료와의 차별점: 5개 항목으로 결과 강도를 높임
    """
    fallback = {
        "root_cause":  "반복 실패의 핵심 원인이 누적되고 있다.",
        "danger_zone": "가장 자주 무너지는 시간대가 있다.",
        "predict":     "지금 패턴이 유지되면 이번 주 실패 가능성이 높다.",
        "protocol":    "오늘은 목표를 30초짜리 단위로 쪼개서 시작하라.",
        "warning":     "지금 멈추면 이 흐름을 되찾는 데 3일 이상 걸린다.",
    }
    client = get_genai_client()
    if client is None:
        return fallback
    prompt = f"""
너는 행동 분석 AI다. 아래 데이터를 기반으로 이 사람의 실패 패턴을 해부하라.
위로 금지. 분석과 교정만.

목표: {goal or "미입력"}
최근 기록: {recent_repr}

다음 형식만 출력 (각 1~2문장, 구체적으로):
ROOT_CAUSE: 반복 실패의 핵심 원인 1개 (왜 계속 같은 패턴인지)
DANGER_ZONE: 가장 자주 무너지는 상황/시간대 1개
PREDICT: 지금 이 패턴이 지속되면 어떻게 되는지 (구체적 예측)
PROTOCOL: 지금 당장 적용할 3단계 복귀 행동 (번호 없이 한 줄로)
WARNING: 지금 안 바꾸면 어떻게 되는지 (강하게 1문장)
"""
    try:
        res = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        keys = ["ROOT_CAUSE", "DANGER_ZONE", "PREDICT", "PROTOCOL", "WARNING"]
        parsed = _parse_gemini_response((res.text or "").strip(), keys)
        return {
            "root_cause":  parsed["ROOT_CAUSE"]  or fallback["root_cause"],
            "danger_zone": parsed["DANGER_ZONE"] or fallback["danger_zone"],
            "predict":     parsed["PREDICT"]     or fallback["predict"],
            "protocol":    parsed["PROTOCOL"]    or fallback["protocol"],
            "warning":     parsed["WARNING"]     or fallback["warning"],
        }
    except Exception:
        return fallback

# =========================================================
# GOOGLE SHEETS
# =========================================================
def _normalize_sa_dict(raw: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(raw)
    pk = d.get("private_key", "")
    if isinstance(pk, str):
        d["private_key"] = pk.replace("\\n", "\n")
    return d

@st.cache_resource
def get_gspread_client():
    if gspread is None or ServiceAccountCredentials is None:
        raise RuntimeError("gspread unavailable")
    try:
        if "gcp_service_account" in st.secrets:
            creds = ServiceAccountCredentials.from_json_keyfile_dict(
                _normalize_sa_dict(st.secrets["gcp_service_account"]), SHEETS_SCOPES
            )
            return gspread.authorize(creds)
    except Exception:
        pass
    if os.path.exists(GOOGLE_SERVICE_ACCOUNT_FILE):
        creds = ServiceAccountCredentials.from_json_keyfile_name(
            GOOGLE_SERVICE_ACCOUNT_FILE, SHEETS_SCOPES
        )
        return gspread.authorize(creds)
    raise FileNotFoundError(GOOGLE_SERVICE_ACCOUNT_FILE)

@st.cache_resource
def get_sheet():
    client = get_gspread_client()
    spreadsheet = (
        client.open_by_url(NEXUS_SHEET_URL)
        if NEXUS_SHEET_URL and "docs.google.com/spreadsheets" in NEXUS_SHEET_URL
        else client.open(SHEET_NAME)
    )
    ws = spreadsheet.get_worksheet(0)
    if ws is None:
        raise RuntimeError("worksheet not found")
    return ws

@st.cache_resource
def get_spreadsheet():
    client = get_gspread_client()
    return (
        client.open_by_url(NEXUS_SHEET_URL)
        if NEXUS_SHEET_URL and "docs.google.com/spreadsheets" in NEXUS_SHEET_URL
        else client.open(SHEET_NAME)
    )

SHEET_HEADER = ["time", "date", "nickname", "task", "done", "fail_reason", "source", "record_id"]

def ensure_sheet_header() -> None:
    """헤더 보장 — 빈 시트는 생성, 기존 7컬럼 시트는 8컬럼으로 마이그레이션"""
    if st.session_state.get("_header_ensured"):
        return
    sheet = get_sheet()
    values = sheet.get_all_values()
    if not values:
        # 빈 시트 — 헤더 생성
        sheet.append_row(SHEET_HEADER)
    else:
        header = values[0]
        if len(header) < len(SHEET_HEADER):
            # 기존 7컬럼 → 8컬럼 마이그레이션 (record_id 추가)
            sheet.update("A1:H1", [SHEET_HEADER])
    st.session_state["_header_ensured"] = True

USERS_HEADER = [
    "time", "nickname", "email", "goal", "type", "is_premium",
    "last_visit", "first_action_done",
]

# =========================================================
# ANALYTICS — 이탈 지점 로그 + 재방문 체크 + 퍼널 카운터
# 별도 "Analytics" 시트에 저장 — MVP 운영 핵심 지표
# =========================================================
ANALYTICS_HEADER = ["time", "date", "nickname", "event", "value"]

def _get_analytics_ws():
    """Analytics 워크시트 반환 — 없으면 자동 생성"""
    spreadsheet = get_spreadsheet()
    try:
        ws = spreadsheet.worksheet("Analytics")
        return ws
    except Exception:
        ws = spreadsheet.add_worksheet(title="Analytics", rows=5000, cols=10)
        ws.append_row(ANALYTICS_HEADER)
        return ws

def log_event(nickname: str, event: str, value: str = "") -> None:
    """
    이벤트 로그 — 이탈 지점 추적용
    event 종류:
      enter_home       — 홈 진입
      start_mission    — 미션 입력 시작
      complete         — 완료
      fail             — 실패
      click_premium    — Premium 탭 클릭
      apply_premium    — Premium 신청
      guest_signup     — 게스트 닉네임 생성
      return_visit     — 재방문 (Day2+)
    """
    # 게스트 or 익명 — 로깅은 하되 nickname 마스킹
    try:
        ws = _get_analytics_ws()
        ws.append_row([
            korea_now().strftime("%Y-%m-%d %H:%M"),
            today_str(),
            nickname or "guest",
            event,
            str(value),
        ])
    except Exception:
        pass  # 로그 실패는 조용히 넘김 — 앱 흐름에 영향 없음

@st.cache_data(ttl=300)
def get_funnel_stats() -> dict:
    """퍼널 카운터 — 관리자 페이지용"""
    try:
        ws = _get_analytics_ws()
        rows = ws.get_all_records()
        from collections import Counter
        event_counts = Counter(r.get("event", "") for r in rows)
        # 재방문율 계산 (return_visit / enter_home)
        enter = event_counts.get("enter_home", 0)
        ret   = event_counts.get("return_visit", 0)
        return_rate = round(ret / enter * 100, 1) if enter > 0 else 0
        return {
            "visit":         enter,
            "start":         event_counts.get("start_mission", 0),
            "complete":      event_counts.get("complete", 0),
            "premium_click": event_counts.get("click_premium", 0),
            "payment":       event_counts.get("apply_premium", 0),
            "return_visit":  ret,
            "return_rate":   return_rate,
        }
    except Exception:
        return {"visit":0,"start":0,"complete":0,"premium_click":0,"payment":0,"return_visit":0,"return_rate":0}

def ensure_users_header() -> None:
    if st.session_state.get("_users_header_ensured"):
        return
    ws = _get_users_ws()  # 인덱스 대신 이름 기반 조회로 통일
    values = ws.get_all_values()
    if not values:
        # 빈 시트 — 헤더 추가
        ws.append_row(USERS_HEADER)
    else:
        header = values[0]
        if len(header) < len(USERS_HEADER):
            # 헤더 마이그레이션 — last_visit, first_action_done 추가
            ws.update("A1:H1", [USERS_HEADER])
    st.session_state["_users_header_ensured"] = True

def _get_users_ws():
    """
    Users 워크시트 반환 — 없으면 헤더 포함해서 자동 생성
    인덱스(1) 대신 이름("Users")으로 찾아서 탭 순서와 무관하게 안전하게 작동
    """
    spreadsheet = get_spreadsheet()
    try:
        ws = spreadsheet.worksheet("Users")
        return ws
    except Exception:
        # Users 탭 없으면 헤더 포함해서 자동 생성
        ws = spreadsheet.add_worksheet(title="Users", rows=1000, cols=8)
        ws.append_row(USERS_HEADER)  # 생성 즉시 헤더 삽입
        st.session_state["_users_header_ensured"] = True  # 헤더 중복 방지
        return ws

@st.cache_data(ttl=20)
def load_sheet_records() -> List[Dict[str, Any]]:
    sheet = get_sheet()
    return sheet.get_all_records() or []

def load_records(nickname: str = "") -> Tuple[List[Dict[str, Any]], bool]:
    """
    시트에서 기록 로드 후 session_state.records도 동기화 (방법 A)
    → session_state.records가 항상 시트 기준 전체 기록을 포함하게 됨
    → save_record() 반환값과 fail_count 계산이 누적 기준으로 정확해짐
    """
    try:
        ensure_sheet_header()
        rows = load_sheet_records()
        if nickname:
            rows = [r for r in rows if str(r.get("nickname", "")).strip() == nickname.strip()]
        # 방법 A: 로드 성공 시 세션 버퍼를 시트 기준으로 동기화
        st.session_state.records = list(rows)
        return rows, True
    except Exception as e:
        set_error(f"Sheet load failed: {e}")
        return st.session_state.records, False

def save_record(
    task: str, done: bool, fail_reason: str = "", source: str = "control"
) -> Tuple[bool, List[Dict[str, Any]]]:
    """
    데이터 저장 전략 — 진실 원천(Source of Truth) 명확히 구분

    반환값: (성공여부, 저장 후 최신 records 리스트)
    → load_records()가 session_state.records를 시트 기준으로 동기화한 뒤
      save_record()가 row를 append하므로 반환값은 누적 전체 기록 기준으로 정확함
    → 엄밀히는 시트 + 세션 캐시 혼합 구조 (MVP 단계에서는 충분)
    → 사용자 증가 시 DB 기준 단일 원천으로 전환 예정

    [게스트]
    - session_state.records에만 저장
    - 닉네임 확정 후 시트로 이전 (synced 플래그로 중복 방지)

    [닉네임 유저]
    - 시트가 단일 진실 원천 (엄밀히는 시트 + 세션 캐시 혼합 구조)
    - 보통 진입 시 load_records()로 session_state.records 동기화됨
    - 저장 시 시트 append → session_state.records에도 append (즉시 반영용)
    - 단, load_records()가 항상 save 직전에 보장되는 건 아님 — 주의
    - 시트 저장 실패 시: 세션에만 저장 (데이터 유실 방지 fallback)
    - 완전한 단일 원천은 DB 전환 시점에 달성 (DAU 100명+ 기준)

    [나중에 할 것]
    - DAU 30명+ 시: 시트 기반 카운트로 전환
    - DAU 100명+ 시: Supabase로 이전 (시트 병목 발생 시)
    """
    nickname = st.session_state.get("nickname", "anonymous")
    record_id = uuid.uuid4().hex  # 충돌 없는 고유 ID — 중복 저장 방지용
    row = {
        "time": korea_now().strftime("%Y-%m-%d %H:%M"),
        "date": today_str(),
        "nickname": nickname,
        "task": task,
        "done": str(done),
        "fail_reason": fail_reason,
        "source": source,
        "record_id": record_id,   # 중복 저장 방지용 식별자
        "synced": False,
    }

    # 게스트 판별 — 닉네임 문자열이 아닌 세션 상태로 판단 (일관성)
    # nickname == "guest" 단독 조건은 빈 닉네임 케이스를 놓칠 수 있음
    is_guest_mode = (
        st.session_state.get("_guest_mode", False)
        and not st.session_state.get("nickname_confirmed", False)
    )
    if is_guest_mode:
        st.session_state.records.append(row)
        return True, list(st.session_state.records)

    # 닉네임 유저: 시트 먼저 저장
    try:
        ensure_sheet_header()
        sheet = get_sheet()
        sheet.append_row([
            row["time"], row["date"], row["nickname"],
            row["task"], row["done"], row["fail_reason"], row["source"],
            row.get("record_id", ""),   # 중복 방지용 — 시트 H열
        ])
        row["synced"] = True
        load_sheet_records.clear()
        get_today_complete_count.clear()
        # 저장 성공 후 시트 기준 재동기화 — 세션+시트 혼합 원천 해소
        updated, _ = load_records(nickname=nickname)
        return True, updated
    except Exception as e:
        set_error(f"Sheet save failed: {e}")
        # 시트 실패 fallback: 세션에만 저장
        st.session_state.records.append(row)
        st.session_state["_save_failed"] = True   # 저장 실패 플래그 — UI에서 안내
        return False, list(st.session_state.records)

def mark_first_action_done(nickname: str) -> None:
    """첫 완료/실패 시 Users 시트 first_action_done = True 업데이트"""
    if not nickname or not st.session_state.get("nickname_confirmed"):
        return
    if st.session_state.get("_first_action_marked"):
        return
    try:
        ws = _get_users_ws()
        rows = ws.get_all_records()
        for i, row in enumerate(rows, start=2):
            if str(row.get("nickname", "")).strip() == nickname:
                if str(row.get("first_action_done", "")) != "True":
                    ws.update(f"H{i}", [["True"]])  # H열 = first_action_done
                st.session_state["_first_action_marked"] = True
                break
    except Exception:
        pass

def check_and_log_return_visit(nickname: str) -> None:
    """
    재방문 체크 — Day1 → Day2 재방문율 측정
    Users 시트의 last_visit 컬럼 업데이트
    """
    if not nickname or not st.session_state.get("nickname_confirmed"):
        return
    # 세션 내 중복 체크 방지
    if st.session_state.get("_return_visit_logged"):
        return
    try:
        ws = _get_users_ws()
        rows = ws.get_all_records()
        today = today_str()
        for i, row in enumerate(rows, start=2):
            if str(row.get("nickname", "")).strip() == nickname:
                last_visit = str(row.get("last_visit", ""))
                first_done = str(row.get("first_action_done", ""))
                # last_visit 컬럼 업데이트 (G열 기준)
                ws.update(f"G{i}", [[today]])
                # 재방문 감지 — 어제 이전 방문 + first_action_done
                if last_visit and last_visit < today and first_done == "True":
                    log_event(nickname, "return_visit", f"from:{last_visit}")
                break
        st.session_state["_return_visit_logged"] = True
    except Exception:
        pass

def save_nickname_signup(nickname: str) -> bool:
    try:
        st.session_state["_users_header_ensured"] = False  # 강제 재확인
        ensure_users_header()
        # 저장 직전 중복 체크 — 레이스 컨디션 방어
        get_taken_nicknames.clear()  # 최신 목록으로 확인
        if is_nickname_taken(nickname):
            return False
        ws = _get_users_ws()
        ws.append_row([
            korea_now().strftime("%Y-%m-%d %H:%M"),
            nickname, "", "", "signup", "False",
            "",       # last_visit 초기값
            "False",  # first_action_done 초기값
        ])
        return True
    except Exception:
        return False

@st.cache_data(ttl=30)
def get_taken_nicknames() -> set:
    try:
        ensure_users_header()
        ws = _get_users_ws()
        rows = ws.get_all_records()
        return {str(r.get("nickname", "")).strip() for r in rows if r.get("type") == "signup"}
    except Exception:
        return set()

def is_nickname_taken(nickname: str) -> bool:
    return nickname.strip() in get_taken_nicknames()

@st.cache_data(ttl=60)
def get_premium_nicknames() -> set:
    """is_premium=True인 닉네임 목록 반환"""
    try:
        ensure_users_header()
        ws = _get_users_ws()
        rows = ws.get_all_records()
        return {
            str(r.get("nickname", "")).strip()
            for r in rows
            if str(r.get("is_premium", "")).strip().lower() in {"true", "1", "yes"}
        }
    except Exception:
        return set()

@st.cache_data(ttl=60)
def get_user_premium_status(nickname: str) -> str:
    """
    시트 기반 Premium 상태 반환 (세션 무관)
    반환값:
      "active"  — is_premium=True
      "applied" — premium_apply 신청 있음
      "none"    — 해당 없음
    """
    try:
        ws = _get_users_ws()
        rows = ws.get_all_records() or []
        nick = nickname.strip()
        is_active = any(
            str(r.get("nickname","")).strip() == nick
            and str(r.get("is_premium","")).strip().lower() in {"true","1","yes"}
            for r in rows
        )
        if is_active:
            return "active"
        is_applied = any(
            str(r.get("nickname","")).strip() == nick
            and r.get("type") == "premium_apply"
            for r in rows
        )
        return "applied" if is_applied else "none"
    except Exception:
        return "none"

def has_premium_apply(nickname: str) -> bool:
    """해당 닉네임의 premium_apply 신청이 이미 있는지 확인 (중복 방지)"""
    try:
        ws = _get_users_ws()
        rows = ws.get_all_records() or []
        return any(
            str(r.get("nickname","")).strip() == nickname.strip()
            and r.get("type") == "premium_apply"
            for r in rows
        )
    except Exception:
        return False

def activate_premium(nickname: str) -> bool:
    """
    관리자용: 닉네임의 모든 premium_apply 행을 is_premium=True로 업데이트
    중복 신청이 있어도 전부 처리해서 상태 꼬임 방지

    batch_update 사용으로 API 호출 1회로 처리
    — update_cell 반복 대비 신청자 수에 무관하게 빠름
    """
    try:
        ws = _get_users_ws()
        rows = ws.get_all_records()

        # 업데이트 대상 셀 좌표 수집
        updates = []
        for idx, row in enumerate(rows, start=2):
            if (str(row.get("nickname","")).strip() == nickname.strip()
                    and row.get("type") == "premium_apply"):
                # is_premium 컬럼(6번째) 셀 주소
                updates.append({
                    "range": f"F{idx}",
                    "values": [["True"]],
                })

        if not updates:
            return False

        # batch_update — API 1회 호출로 전체 처리
        ws.batch_update(updates)
        get_user_premium_status.clear()
        get_premium_nicknames.clear()
        return True
    except Exception as e:
        set_error(f"Premium activate failed: {e}")
        return False

def save_premium_apply(nickname: str, email: str, goal: str) -> bool:
    """
    Premium 신청 정보 저장 — MVP 수준 자기신고형
    ⚠️ 현재: 신청 접수 시스템 (실제 자동 결제 검증 아님)
    관리자가 입금 확인 후 수동 승인 → activate_premium() 호출
    나중에: 토스페이먼츠/Stripe 웹훅으로 자동 검증 전환 예정
    """
    try:
        # Users 시트 헤더 먼저 보장
        st.session_state["_users_header_ensured"] = False  # 강제 재확인
        ensure_users_header()
        ws = _get_users_ws()
        row_data = [
            korea_now().strftime("%Y-%m-%d %H:%M"),
            nickname, email, goal, "premium_apply", "False",
            "",       # last_visit 초기값
            "False",  # first_action_done 초기값
        ]
        ws.append_row(row_data)
        return True
    except Exception as e:
        set_error(f"Premium apply save failed: {e}")
        return False

@st.cache_data(ttl=60)
def get_today_complete_count() -> int:
    try:
        rows = load_sheet_records()
        today = today_str()
        return sum(
            1 for r in rows
            if str(r.get("date", "")) == today and parse_done(r.get("done", False))
        )
    except Exception:
        return 0

@st.cache_data(ttl=30)
def load_admin_stats() -> Dict[str, Any]:
    try:
        rows = load_sheet_records()
        # Records 없어도 Users는 반드시 읽음 — early return 제거
        today = today_str()
        today_rows = [r for r in rows if str(r.get("date", "")) == today]
        nicknames = {str(r.get("nickname", "")) for r in rows if r.get("nickname")}
        success = sum(1 for r in rows if parse_done(r.get("done", False)))
        total = len(rows)
        try:
            ws = _get_users_ws()
            user_rows = ws.get_all_records() or []
            signups  = sum(1 for r in user_rows if r.get("type") == "signup")
            applies  = sum(1 for r in user_rows if r.get("type") == "premium_apply")
            actives  = sum(
                1 for r in user_rows
                if str(r.get("is_premium","")).strip().lower() in {"true","1","yes"}
            )
            # premium_apply 신청자 상세 목록 (관리자 승인용)
            apply_list = [
                {
                    "nickname": str(r.get("nickname","")),
                    "email":    str(r.get("email","")),
                    "time":     str(r.get("time","")),
                    "active":   str(r.get("is_premium","False")),
                }
                for r in user_rows if r.get("type") == "premium_apply"
            ]
        except Exception:
            signups = applies = actives = 0
            apply_list = []
        return {
            "total":        total,
            "today":        len(today_rows),
            "users":        len(nicknames),
            "complete_rate": int(success / total * 100) if total > 0 else 0,
            "top_fail":     get_top_fail_reason(rows),
            "signups":      signups,
            "applies":      applies,
            "actives":      actives,
            "apply_list":   apply_list,
        }
    except Exception:
        return {
            "total":0,"today":0,"users":0,"complete_rate":0,
            "top_fail":"","signups":0,"applies":0,"actives":0,"apply_list":[],
        }

# =========================================================
# 관리자 페이지
# =========================================================
def render_admin_page() -> None:
    st.markdown("## ⚙️ Vanguard 관리자")

    # ADMIN_PASSWORD 미설정 시 완전 차단 — secrets 등록 필수
    if not ADMIN_PASSWORD:
        st.error("⚠️ 관리자 비밀번호가 설정되지 않았습니다. Streamlit secrets에 ADMIN_PASSWORD를 등록하세요.")
        st.stop()

    if not st.session_state._admin_authed:
        pw = st.text_input("비밀번호", type="password")
        if st.button("확인"):
            if pw == ADMIN_PASSWORD:
                st.session_state._admin_authed = True
                st.rerun()
            else:
                st.error("틀렸습니다.")
        st.stop()
    stats = load_admin_stats()

    # ── 디버그: Users 시트 원본 확인 ──
    with st.expander("🔍 Users 시트 원본 데이터 (디버그)", expanded=False):
        try:
            ws_debug = _get_users_ws()
            raw = ws_debug.get_all_values()
            st.write(f"총 {len(raw)}행 (헤더 포함)")
            if raw:
                st.write("헤더:", raw[0])
                st.write(f"데이터 {len(raw)-1}행:")
                for row in raw[1:]:
                    st.write(row)
            else:
                st.warning("Users 시트가 완전히 비어 있습니다")
        except Exception as e:
            st.error(f"Users 시트 읽기 실패: {e}")

    # ── 핵심 지표 ──
    c1, c2, c3 = st.columns(3)
    c1.metric("전체 실행", stats["total"])
    c2.metric("오늘 실행", stats["today"])
    c3.metric("유저 수",   stats["users"])

    st.markdown("---")
    st.markdown("**Premium 퍼널**")
    c1, c2, c3 = st.columns(3)
    c1.metric("가입자",      stats["signups"],  help="signup")
    c2.metric("결제 신청",   stats["applies"],  help="premium_apply")
    c3.metric("Premium 활성", stats["actives"], help="is_premium=True")

    apply_rate = int(stats["applies"] / stats["signups"] * 100) if stats["signups"] else 0
    active_rate = int(stats["actives"] / stats["applies"] * 100) if stats["applies"] else 0
    st.caption(f"신청 전환율 {apply_rate}% · 결제 완료율 {active_rate}%")

    st.markdown("---")
    st.markdown(f"완료율: **{stats['complete_rate']}%**")
    if stats["top_fail"]:
        st.info(f"주요 실패 이유: **{stats['top_fail']}**")

    # ── Premium 신청자 목록 + 1클릭 승인 ──
    st.markdown("---")
    # ── 퍼널 통계 ──
    try:
        funnel = get_funnel_stats()
        st.markdown(f"""
<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:16px;">
    <div style="text-align:center; padding:10px; background:rgba(255,255,255,0.04); border-radius:10px;">
        <div style="font-size:1.2rem; font-weight:900; color:#F8FAFC;">{funnel["visit"]}</div>
        <div style="font-size:0.65rem; color:#475569;">홈 진입</div>
    </div>
    <div style="text-align:center; padding:10px; background:rgba(255,255,255,0.04); border-radius:10px;">
        <div style="font-size:1.2rem; font-weight:900; color:#86EFAC;">{funnel["complete"]}</div>
        <div style="font-size:0.65rem; color:#475569;">완료</div>
    </div>
    <div style="text-align:center; padding:10px; background:rgba(255,255,255,0.04); border-radius:10px;">
        <div style="font-size:1.2rem; font-weight:900; color:#A5B4FC;">{funnel["premium_click"]}</div>
        <div style="font-size:0.65rem; color:#475569;">Premium 클릭</div>
    </div>
    <div style="text-align:center; padding:10px; background:rgba(255,255,255,0.04); border-radius:10px;">
        <div style="font-size:1.2rem; font-weight:900; color:#FCD34D;">{funnel["return_rate"]}%</div>
        <div style="font-size:0.65rem; color:#475569;">재방문율</div>
    </div>
</div>
""", unsafe_allow_html=True)
        st.caption(f"퍼널: 진입 {funnel['visit']} → 미션시작 {funnel['start']} → 완료 {funnel['complete']} → Premium클릭 {funnel['premium_click']} → 신청 {funnel['payment']}")
    except Exception:
        pass

    # Users 시트 원본 디버그 패널
    if st.checkbox("🔍 Users 시트 원본 보기 (디버그)", value=False):
        try:
            ws_debug = _get_users_ws()
            raw = ws_debug.get_all_values()
            st.write(f"총 {len(raw)}행 (헤더 포함)")
            if raw:
                st.write("헤더:", raw[0])
                for idx, row in enumerate(raw[1:], 1):
                    st.write(f"행 {idx}:", row)
            else:
                st.warning("Users 탭이 완전히 비어 있습니다.")
        except Exception as e:
            st.error(f"Users 탭 읽기 실패: {e}")

    st.markdown("**Premium 신청자 목록**")
    apply_list = stats.get("apply_list", [])
    if not apply_list:
        st.caption("신청자 없음")
    else:
        # 필터 + 닉네임 검색
        f_col1, f_col2 = st.columns([1, 1])
        with f_col1:
            filter_opt = st.radio(
                "필터", ["전체", "대기 중만", "활성만"],
                horizontal=True, label_visibility="collapsed",
            )
        with f_col2:
            search_nick = st.text_input(
                "닉네임 검색", placeholder="검색...",
                label_visibility="collapsed",
            )

        filtered = [
            (item, item["active"].strip().lower() in {"true","1","yes"})
            for item in apply_list
            if not (filter_opt == "대기 중만" and item["active"].strip().lower() in {"true","1","yes"})
            and not (filter_opt == "활성만" and item["active"].strip().lower() not in {"true","1","yes"})
            and (not search_nick.strip() or search_nick.strip().lower() in item["nickname"].lower())
        ]
        st.caption(f"총 {len(apply_list)}명 · 표시 {len(filtered)}명")

        for item, active in filtered:
            nick   = item["nickname"]
            email  = item["email"]
            t      = item["time"]
            status = "✅ 활성" if active else "⏳ 대기 중"
            with st.container():
                col_info, col_btn = st.columns([3, 1])
                with col_info:
                    st.markdown(f"**{nick}** `{email}`  \n{t} · {status}")
                with col_btn:
                    if not active:
                        if st.button("승인", key=f"approve_{nick}",
                                     type="primary", use_container_width=True):
                            if activate_premium(nick):
                                load_admin_stats.clear()
                                st.success(f"{nick} Premium 활성화 완료")
                                st.rerun()
                            else:
                                st.error("활성화 실패.")
                st.divider()

    st.caption("30초 캐시 · 새로고침하면 최신 데이터")

# =========================================================
# 닉네임 온보딩
# =========================================================
def render_nickname_setup() -> None:
    st.markdown("""
<div style="text-align:center; padding:44px 0 20px;">
    <div style="font-size:2.8rem;">⚡</div>
    <div style="font-size:1.65rem; font-weight:900; color:#F8FAFC;
                letter-spacing:-0.04em; margin-top:10px;">Vanguard</div>
    <div style="font-size:0.82rem; color:#38BDF8; font-weight:700;
                margin-top:4px; letter-spacing:0.08em;">BREAK THE LOOP</div>
    <div style="font-size:0.82rem; color:#475569; margin-top:16px; line-height:1.75;">
        생각하는 시간을 제거한다<br>
        고민 없음 · 선택 없음 · 그냥 실행
    </div>
</div>
""", unsafe_allow_html=True)

    # ── 기존 닉네임으로 로그인 ──
    st.markdown("""
<div class="card" style="margin-top:4px;">
    <div class="section-label">기존에 쓰던 닉네임이 있나요?</div>
    <div class="body-small" style="margin-top:3px; color:#475569;">
        닉네임이 비밀번호 없는 로그인이에요.<br>
        전에 쓰던 닉네임을 그대로 입력하면 기록이 이어집니다.
    </div>
</div>
""", unsafe_allow_html=True)

    login_input = st.text_input(
        "기존 닉네임으로 로그인",
        placeholder="기존 닉네임 입력",
        label_visibility="collapsed",
        key="login_input",
    )
    if st.button("기존 닉네임으로 계속하기 →", use_container_width=True,
                 key="btn_login", type="secondary"):
        name = login_input.strip()
        if not name:
            st.warning("닉네임을 입력해주세요.")
        elif is_nickname_taken(name):
            st.session_state.nickname           = name
            st.session_state.nickname_confirmed = True
            st.session_state["_guest_mode"]     = False
            st.query_params["n"] = name
            st.rerun()
        else:
            st.error("등록된 닉네임이 없어요. 아래에서 새로 만들어주세요.")

    st.markdown("""
<div style="display:flex; align-items:center; gap:10px; margin:14px 0;">
    <div style="flex:1; height:1px; background:rgba(255,255,255,0.08);"></div>
    <div style="font-size:0.72rem; color:#334155;">처음이라면</div>
    <div style="flex:1; height:1px; background:rgba(255,255,255,0.08);"></div>
</div>
""", unsafe_allow_html=True)

    # ── 새 닉네임 만들기 ──
    st.markdown(f"""
<div class="card">
    <div class="section-label">새 닉네임 만들기</div>
    <div class="body-small" style="margin-top:3px; color:#475569;">
        나만의 이름을 정하면 기록이 저장되고 다음에 와도 이어집니다.
    </div>
</div>
""", unsafe_allow_html=True)

    nickname_input = st.text_input(
        "닉네임",
        placeholder=TXT["nickname_placeholder"],
        label_visibility="collapsed",
    )
    if st.button(TXT["nickname_confirm"], use_container_width=True, type="primary"):
        name = nickname_input.strip()
        if not name:
            st.warning("닉네임을 입력해주세요.")
        elif len(name) < 2:
            st.warning("닉네임은 2자 이상이어야 합니다.")
        elif is_nickname_taken(name):
            st.error("이미 사용 중인 닉네임입니다. 위에서 기존 닉네임으로 로그인해보세요.")
        else:
            ok = save_nickname_signup(name)
            if not ok:
                st.error("닉네임 저장에 실패했습니다. 잠시 후 다시 시도해주세요.")
            else:
                st.session_state.nickname = name
                st.session_state.nickname_confirmed = True
                st.session_state["_show_target_select"] = True
                get_taken_nicknames.clear()
                st.query_params["n"] = name
                st.rerun()

    # ── 뒤로가기 — 게스트로 돌아가기 ──
    st.markdown("<div style='margin-top:8px;'></div>", unsafe_allow_html=True)
    if st.button("← 게스트로 계속하기", use_container_width=True,
                 key="btn_back_to_guest"):
        st.session_state["_guest_mode"] = True
        st.session_state.nickname_confirmed = False
        st.rerun()

# =========================================================
# 타겟 선택 컴포넌트
# =========================================================
def render_target_select() -> None:
    """
    닉네임 입력 후 타겟 선택 화면
    [1] 앱 진입 → [2] 실행 → [3] 닉네임 → [4] 타겟 선택 → 시작
    """
    nickname = st.session_state.get("nickname", "")
    goal     = st.session_state.get("goal", "")

    # 목표 기반 자동 추론 — general은 TARGET_CONFIG에 없으므로 founder fallback
    inferred = infer_target(goal)
    cfg      = TARGET_CONFIG.get(inferred, TARGET_CONFIG["founder"])

    st.markdown(f"""
<div style="text-align:center; padding:20px 0 14px;">
    <div style="font-size:1.6rem; margin-bottom:8px;">🎯</div>
    <div class="strong-title" style="font-size:1rem; margin-top:0;">
        {nickname}님, 어떤 상황인가요?
    </div>
    <div class="body-small" style="margin-top:6px; color:#475569;">
        선택하면 메시지와 명령이 맞춤으로 바뀝니다
    </div>
</div>
""", unsafe_allow_html=True)

    # 추천 타겟 표시 — general이면 직접 선택 유도
    if inferred == "general":
        rec_text = "💡 일반 목표입니다 · 아래에서 가장 가까운 유형을 선택하세요"
    elif goal.strip():
        rec_text = f'💡 목표 분석 → <b>{cfg["emoji"]} {cfg["label"]}</b> 로 설정됩니다'
    else:
        rec_text = f'💡 기본값: <b>{cfg["emoji"]} {cfg["label"]}</b> (아래에서 변경 가능)'

    st.markdown(f"""
<div style="padding:10px 14px; border-radius:12px; margin-bottom:10px;
            background:rgba(99,102,241,0.10); border:1px solid rgba(99,102,241,0.25);
            font-size:0.8rem; color:#C7D2FE; text-align:center;">
    {rec_text}
</div>
""", unsafe_allow_html=True)

    # 타겟 선택 버튼 3개
    for key, config in TARGET_CONFIG.items():
        is_recommended = (key == inferred)
        btn_label = f"{config['emoji']} {config['label']}"
        if is_recommended:
            btn_label += "  ✓ 추천"
        if st.button(btn_label, use_container_width=True,
                     key=f"target_{key}",
                     type="primary" if is_recommended else "secondary"):
            st.session_state["target_type"]       = key
            st.session_state["_show_target_select"] = False
            st.rerun()

    st.caption("나중에 설정에서 변경할 수 있습니다")

# =========================================================
# 시간대별 긴급도 — 하루 3회 트리거 구조
# =========================================================
def get_time_context() -> Dict[str, str]:
    """
    오전/점심/오후/저녁 시간대별 다른 압박 메시지 반환
    앱을 열 때마다 시간대에 맞는 긴장감을 줌
    """
    hour = korea_now().hour
    if 6 <= hour < 10:
        return {
            "zone": "morning",
            "label": "🌅 오전",
            "pressure": "오전을 날리면 오늘 하루가 간다. 지금이 오늘 유일한 기회다.",
            "cta": "지금 시작",
        }
    elif 10 <= hour < 14:
        return {
            "zone": "midday",
            "label": "⚡ 정오",
            "pressure": "오전에 못 했다. 지금이 마지막 기회다. 안 하면 오늘도 끝이다.",
            "cta": "지금 시작",
        }
    elif 14 <= hour < 18:
        return {
            "zone": "afternoon",
            "label": "📉 오후",
            "pressure": "지금 안 하면 저녁까지 미룬다. 저녁까지 미루면 오늘은 끝이다.",
            "cta": "지금 시작",
        }
    elif 18 <= hour < 22:
        return {
            "zone": "evening",
            "label": "🚨 저녁",
            "pressure": f"자정까지 {24-hour}시간도 안 남았다. 지금 안 하면 오늘은 없다.",
            "cta": "지금 시작",
        }
    else:
        return {
            "zone": "night",
            "label": "🌙 야간",
            "pressure": "오늘은 거의 끝났다. 지금 1개 안 끝내면 오늘은 0이다.",
            "cta": "지금 시작",
        }

# =========================================================
# 닉네임 수집 컴포넌트 — 1회 실행 후 표시
# =========================================================
def render_nickname_collect() -> None:
    """
    게스트 1회 실행 후 표시되는 닉네임 수집 화면
    "기록을 저장하시겠습니까?" 형태 — 이미 경험한 후라 동기가 생김
    """
    st.markdown(f"""
<div class="success-card" style="text-align:center; padding:22px 16px;">
    <div style="font-size:1.6rem; margin-bottom:8px;">✅</div>
    <div class="strong-title" style="margin-top:0; font-size:1rem;">
        방금 실행했다. 이 기록을 저장하려면?
    </div>
    <div class="body-small" style="margin-top:6px;">
        닉네임을 설정하면 오늘 기록과 streak이 유지됩니다.<br>
        다음에 다시 열면 이어서 할 수 있어요.
    </div>
</div>
""", unsafe_allow_html=True)

    nickname_input = st.text_input(
        "닉네임",
        placeholder=TXT["nickname_placeholder"],
        label_visibility="collapsed",
    )

    col1, col2 = st.columns([3, 1])
    with col1:
        if st.button(TXT["guest_save_btn"], use_container_width=True,
                     type="primary", key="guest_nickname_save"):
            name = nickname_input.strip()
            if not name:
                st.warning("닉네임을 입력해주세요.")
            elif len(name) < 2:
                st.warning("닉네임은 2자 이상이어야 합니다.")
            elif is_nickname_taken(name):
                st.error("이미 사용 중인 닉네임입니다.")
            else:
                # 게스트 기록 닉네임 이전 + synced 플래그로 중복 저장 방지
                for row in st.session_state.records:
                    if row.get("nickname") == "guest":
                        row["nickname"] = name

                ok = save_nickname_signup(name)
                if not ok:
                    st.error("닉네임 저장에 실패했습니다. 잠시 후 다시 시도해주세요.")
                    return  # early exit zone 외부 — st.stop() 대신 return
                st.session_state.nickname = name
                st.session_state.nickname_confirmed = True
                st.session_state["_guest_mode"] = False
                st.session_state["_show_nickname_collect"] = False
                st.session_state["_show_target_select"] = True
                get_taken_nicknames.clear()
                st.query_params["n"] = name  # 새로고침해도 닉네임 유지

                # synced=False인 기록만 시트에 저장 → 중복 저장 방지
                try:
                    ensure_sheet_header()
                    sheet = get_sheet()
                    for row in st.session_state.records:
                        if (row.get("nickname") == name
                                and not row.get("synced", True)):
                            # row에 record_id 없으면 확정 후 저장
                            if not row.get("record_id"):
                                row["record_id"] = uuid.uuid4().hex
                            sheet.append_row([
                                row["time"], row["date"], row["nickname"],
                                row["task"], row["done"],
                                row.get("fail_reason", ""),
                                row.get("source", "control"),
                                row["record_id"],
                            ])
                            row["synced"] = True  # 저장 완료 표시
                    load_sheet_records.clear()
                except Exception:
                    pass
                st.rerun()
    with col2:
        if st.button(TXT["guest_skip"], use_container_width=True,
                     key="guest_nickname_skip"):
            # 건너뛰어도 일단 진행 — 다음 방문에 다시 요청
            st.session_state["_show_nickname_collect"] = False
            st.rerun()

# =========================================================
# 탭 네비게이션
# - st.columns + st.button 단일 레이어
# - HTML/CSS 꾸미기 없음 → Streamlit 버전 변경에 안전
# - 활성 탭: label 앞에 "· " 표시 + type="primary" (Streamlit 기본 스타일)
# - 비활성 탭: type="secondary" (Streamlit 기본 스타일)
# =========================================================
def render_tab_nav(active: str) -> None:
    tabs = [
        ("home",     "홈"),
        ("record",   "기록"),
        ("analysis", "분석"),
        ("premium",  "Premium"),
    ]
    cols = st.columns(4)
    for col, (tab_id, label) in zip(cols, tabs):
        with col:
            is_active = active == tab_id
            display = f"· {label}" if is_active else label
            btn_type = "primary" if is_active else "secondary"
            if st.button(display, key=f"tab_{tab_id}",
                         use_container_width=True,
                         type=btn_type):
                # Premium 탭 실제 클릭 시에만 기록 (렌더 시마다 ❌)
                if tab_id == "premium":
                    log_event(st.session_state.get("nickname", "guest"), "click_premium")
                st.session_state["_active_tab"] = tab_id
                st.rerun()

# =========================================================
# 컴포넌트: 집중 상태 카드
# - 타이머가 아니라 "집중 상태 카드"
# - 자동 갱신 없음 (rerun/sleep 없음) → 서버 부담 0
# - 페이지에 진입할 때만 경과 시간 업데이트
# - 사용자에게 "집중 중" 상태를 보여주는 것이 목적
# =========================================================
# =========================================================
# 미션 화면 렌더 함수
# =========================================================
def render_mission_input_screen() -> None:
    """미션 입력 화면 — 첫 화면처럼 강하게"""
    st.markdown("""
<div style="text-align:center; padding:32px 0 20px;">
    <div style="font-size:2.2rem; margin-bottom:12px;">⚡</div>
    <div style="font-size:1.4rem; font-weight:900; color:#F8FAFC; line-height:1.35;">
        오늘 뭘 끝낼 거야?
    </div>
    <div style="font-size:0.8rem; color:#475569; margin-top:8px; line-height:1.6;">
        1개만. 이것만 끝내면 오늘은 성공이다.<br>
        생각하지 말고 바로 써라.
    </div>
</div>
""", unsafe_allow_html=True)

    mission_input = st.text_input(
        "미션",
        placeholder="예: 앱 로그인 기능 구현",
        label_visibility="collapsed",
    )

    if st.button("🚀 이것이 오늘의 미션이다",
                 use_container_width=True, type="primary", key="btn_set_mission"):
        mission = mission_input.strip()
        if not mission:
            st.warning("미션을 입력해주세요.")
        elif len(mission) < 3:
            st.warning("좀 더 구체적으로 입력해주세요.")
        else:
            log_event(st.session_state.get("nickname", "guest"), "start_mission")
            set_today_mission(mission)
            st.rerun()

    st.caption("미션을 정하는 것 자체가 이미 시작이다.")

    # 이번 달 목표 — 한 줄 노출, 선택사항
    goal_input = st.text_input(
        "이번 달 목표도 있나요? (선택)",
        value=st.session_state.goal,
        placeholder="예: 4월 안에 앱 출시",
    )
    if goal_input.strip() != st.session_state.goal:
        st.session_state.goal = goal_input.strip()
        st.session_state.lazy_command = ""

def render_mission_ready_screen(mission: str, goal: str) -> None:
    """미션 확인 + 시작 대기 화면"""
    # tcfg 불필요 — goal_pain은 get_goal_matched_pain()으로 처리
    st.markdown(f"""
<div class="command-card">
    <div class="section-label">오늘의 미션</div>
    <div class="strong-title">{html.escape(mission)}</div>
    {f'<div class="body-small" style="margin-top:4px;">목표: {html.escape(goal)}</div>' if goal else ''}
</div>
""", unsafe_allow_html=True)

    goal_pain, goal_pain_sub = get_goal_matched_pain(goal)
    st.markdown(f"""
<div class="warning-card">
    <div style="font-size:0.9rem; font-weight:900; color:#FCA5A5;">
        {html.escape(goal_pain)}
    </div>
    <div class="body-small" style="margin-top:4px;">{html.escape(goal_pain_sub)}</div>
</div>
""", unsafe_allow_html=True)

def render_completion_screen(mission: str, insight: Dict[str, str], streak: int) -> None:
    """완료 인사이트 화면 — 스토리 기반"""
    st.markdown(f"""
<div class="success-card" style="padding:20px 16px;">
    <div style="font-size:0.7rem; color:#6EE7B7; font-weight:700; margin-bottom:8px;">
        {html.escape(insight.get("time_label", "오늘 완료"))}
    </div>
    <div style="font-size:1.05rem; font-weight:900; color:#F8FAFC; line-height:1.4;">
        {html.escape(insight["headline"])}
    </div>
    <div class="body-small" style="margin-top:8px; color:#86EFAC;">
        {html.escape(insight["sub"])}
    </div>
    <div style="display:flex; gap:12px; margin-top:12px; padding-top:10px;
                border-top:1px solid rgba(255,255,255,0.08);">
        <div style="text-align:center; flex:1;">
            <div style="font-size:1.4rem; font-weight:900; color:#86EFAC;">
                🔥 {insight["streak"]}일
            </div>
            <div style="font-size:0.65rem; color:#475569;">streak</div>
        </div>
        <div style="text-align:center; flex:2; padding-left:12px;
                    border-left:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:0.78rem; color:#6EE7B7; font-weight:700;">
                {html.escape(insight.get("story", ""))}
            </div>
            <div style="font-size:0.68rem; color:#334155; margin-top:2px;">
                {html.escape(mission[:28] + "..." if len(mission) > 28 else mission)}
            </div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)

def render_fail_insight_screen(mission: str, insight: Dict[str, str]) -> None:
    """실패 인사이트 화면 — 패턴 폭로 엔진 결과 표시"""
    # 패턴 메시지를 줄바꿈 기준으로 분리해서 강조
    pattern_lines = insight["pattern_msg"].split("\n")
    pattern_html = "".join(
        f'<div style="font-size:{"0.95" if i==0 else "0.82"}rem; '
        f'font-weight:{"900" if i==0 else "700"}; '
        f'color:#FCA5A5; {"margin-top:6px;" if i>0 else ""}">'
        f'{html.escape(line)}</div>'
        for i, line in enumerate(pattern_lines) if line.strip()
    )

    # 요일/시간대 뱃지 (데이터 있을 때만)
    badge_html = ""
    if insight.get("peak_weekday") and insight.get("peak_zone"):
        badge_html = f"""
<div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
    <span style="padding:3px 8px; border-radius:999px;
                 background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.30);
                 font-size:0.7rem; color:#FCA5A5;">
        📅 {html.escape(insight["peak_weekday"])}요일
    </span>
    <span style="padding:3px 8px; border-radius:999px;
                 background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.30);
                 font-size:0.7rem; color:#FCA5A5;">
        🕐 {html.escape(insight["peak_zone"])} 취약
    </span>
    <span style="padding:3px 8px; border-radius:999px;
                 background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.30);
                 font-size:0.7rem; color:#FCA5A5;">
        🔁 {insight["same_reason_count"]}회 반복
    </span>
</div>"""

    st.markdown(f"""
<div class="warning-card" style="padding:18px 16px;">
    {pattern_html}
    {badge_html}
    <div style="margin-top:10px; padding-top:8px;
                border-top:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:0.8rem; color:#86EFAC; font-weight:700;">
            💡 {html.escape(insight["fix_msg"])}
        </div>
        <div style="font-size:0.76rem; color:#94A3B8; margin-top:4px;">
            {html.escape(insight["warning"])}
        </div>
    </div>
    <div style="margin-top:8px; font-size:0.72rem; color:#334155;">
        미션: {html.escape(mission)}
    </div>
</div>
""", unsafe_allow_html=True)

def render_focus_card(elapsed: int, task: str) -> None:
    elapsed_text = elapsed_to_text(elapsed)

    if elapsed < 60:
        phase_label, phase_body = TXT["progress_start"]
        phase_color = "#6EE7B7"
    elif elapsed < 300:
        phase_label, phase_body = TXT["progress_mid"]
        phase_color = "#38BDF8"
    else:
        phase_label, phase_body = TXT["progress_deep"]
        phase_color = "#A5B4FC"

    st.markdown(f"""
<div class="focus-card">
    <div class="focus-elapsed">{elapsed_text}</div>
    <div class="focus-label">집중 시작 후 경과 시간</div>
    <div class="focus-task">{html.escape(task)}</div>
    <div class="focus-phase" style="color:{phase_color};">
        {html.escape(phase_label)} · {html.escape(phase_body)}
    </div>
</div>
""", unsafe_allow_html=True)

    st.caption("다 됐으면 완료 — 안 됐으면 실패를 기록하세요.")

# =========================================================
# 컴포넌트: Streak 위기 배너
# =========================================================
def render_streak_crisis(streak: int, tcfg: dict) -> None:
    """tcfg: get_target_config() 결과 — 함수 외부에서 주입받아야 NameError 방지"""
    if st.session_state.get("_crisis_dismissed"):
        return
    hour = korea_now().hour
    if hour >= 20:
        urgency = f"자정까지 {24-hour}시간 미만 남았습니다"
    elif hour >= 15:
        urgency = "오늘 오후가 지나가고 있습니다"
    else:
        urgency = "오늘 안 하면 내일 0으로 돌아갑니다"

    st.markdown(f"""
<div class="streak-crisis">
    <div class="streak-crisis-num">🔥 {streak}일</div>
    <div class="streak-crisis-title">{html.escape(tcfg["streak_warn"])}</div>
    <div class="streak-crisis-sub">
        {urgency}<br>
        <span style="color:#FCA5A5; font-weight:700;">
            지금 안 하면 오늘 쌓은 게 전부 날아간다.
        </span>
    </div>
</div>
""", unsafe_allow_html=True)

    col1, col2 = st.columns([4, 1])
    with col1:
        if st.button("🚀 지금 시작해서 streak 지키기",
                     use_container_width=True, key="crisis_start"):
            cmd = (st.session_state.get("lazy_command")
                   or fast_command(st.session_state.goal)[0])
            st.session_state.running = True
            st.session_state.start_time = time.time()
            st.session_state.current_task = cmd
            st.session_state["_show_fail_select"] = False
            st.session_state["_crisis_dismissed"] = True
            st.rerun()
    with col2:
        if st.button("✕", use_container_width=True, key="crisis_dismiss"):
            st.session_state["_crisis_dismissed"] = True
            st.rerun()

# =========================================================
# 컴포넌트: 어제 vs 오늘
# =========================================================
def render_yesterday_vs_today(records: List[Dict[str, Any]], today_status: str) -> None:
    yesterday_rec = get_yesterday_record(records)
    if not yesterday_rec:
        return

    y_done  = record_to_bool_done(yesterday_rec)
    y_emoji = "✅" if y_done else "❌"
    y_task  = str(yesterday_rec.get("task", ""))[:30]
    y_time  = str(yesterday_rec.get("time", ""))[-5:]
    y_fail  = str(yesterday_rec.get("fail_reason", ""))

    if today_status == "none":
        t_emoji, t_text = "⬜", "아직 기록 없음"
        if not y_done:
            msg = f"어제도 '{y_fail or '실패'}'였다. 오늘 또 같은 이유로 끝낼 거냐."
            msg_color = "#FCA5A5"
        else:
            msg = "어제 성공했다. 오늘 안 하면 그게 다 날아간다."
            msg_color = "#FCD34D"
    elif today_status == "success":
        t_emoji, t_text = "✅", "오늘 성공 완료"
        msg, msg_color = "오늘도 해냈다. 내일도 이 시간에 다시 오자.", "#86EFAC"
    else:
        t_emoji, t_text = "❌", "오늘 실패 기록"
        msg, msg_color = "아직 오늘이 끝나지 않았다. 다시 시작할 수 있다.", "#FCD34D"

    st.markdown(f"""
<div class="compare-card">
    <div class="section-label">어제 vs 오늘</div>
    <div class="compare-row">
        <div class="compare-day">어제</div>
        <div class="compare-emoji">{y_emoji}</div>
        <div class="compare-text">{html.escape(y_task)}</div>
        <div class="compare-time">{y_time}</div>
    </div>
    <div class="compare-row">
        <div class="compare-day">오늘</div>
        <div class="compare-emoji">{t_emoji}</div>
        <div class="compare-text">{t_text}</div>
        <div class="compare-time"></div>
    </div>
    <div class="compare-msg" style="color:{msg_color};">{msg}</div>
</div>
""", unsafe_allow_html=True)

# =========================================================
# 컴포넌트: Streak 공유 (JS 없음)
# =========================================================
def render_streak_share(streak: int, goal: str, success_rate: int) -> None:
    milestones = [3, 7, 14, 21, 30, 60, 100]
    if streak not in milestones:
        return

    share_text = (
        f"⚡ Vanguard — Break the Loop\n"
        f"{'━'*22}\n"
        f"🔥 {streak}일 연속 실행 달성\n\n"
        f"목표: {goal or '핵심 목표'}\n"
        f"성공률: {success_rate}%\n"
        f"{'━'*22}\n"
        f"미루는 습관을 끊고 싶다면\n"
        f"→ vanguard.streamlit.app"
    )

    st.markdown(f"""
<div class="share-banner">
    <div class="share-milestone">🔥 {streak}일 연속!</div>
    <div class="share-sub">이 순간을 공유하세요</div>
</div>
""", unsafe_allow_html=True)

    with st.expander("📋 공유 텍스트 (복사 후 SNS 붙여넣기)", expanded=False):
        st.code(share_text, language=None)
        st.caption("위 텍스트를 복사해서 인스타, 카톡, 트위터에 공유하세요.")

# =========================================================
# 컴포넌트: 월간 캘린더
# =========================================================
def render_monthly_calendar(
    records: List[Dict[str, Any]],
    lock_before: str = "",   # "YYYY-MM-DD" 이전 날짜는 잠금 표시
) -> None:
    """
    lock_before: 무료 사용자 잠금 기준일
      - "" (빈 값) → 전체 공개 (Premium / 게스트)
      - "2025-04-01" 같은 날짜 → 그 이전은 🔒로 표시
    이 방식으로 "데이터 없음"이 아니라 "잠김"임이 명확히 전달됨
    """
    cal = get_monthly_calendar(records)
    if not cal:
        return

    today = korea_now().date()
    first_weekday = cal[0]["date"].weekday()
    success_c = sum(1 for c in cal if c["status"] == "success")
    total_d   = len(cal)
    rate      = int(success_c / total_d * 100) if total_d > 0 else 0
    locked_count = 0

    headers    = ["월", "화", "수", "목", "금", "토", "일"]
    h_html     = "".join(f'<div class="cal-header">{h}</div>' for h in headers)
    empty_html = "".join('<div class="cal-day cal-future"></div>' for _ in range(first_weekday))

    day_html = ""
    for c in cal:
        date_str = c["date"].strftime("%Y-%m-%d")
        if lock_before and date_str < lock_before:
            # 잠금 구간 — 데이터 없음이 아니라 잠금으로 표시
            day_html += '<div class="cal-day cal-locked">🔒</div>'
            locked_count += 1
        elif c["status"] == "success":
            day_html += '<div class="cal-day cal-success">✓</div>'
        elif c["status"] == "fail":
            day_html += '<div class="cal-day cal-fail">✗</div>'
        else:
            day_html += f'<div class="cal-day cal-empty">{c["date"].day}</div>'

    month_str   = f"{today.month}월"
    lock_notice = (
        f' · <span style="color:#A5B4FC;">🔒 {locked_count}일 잠김</span>'
        if locked_count > 0 else ""
    )
    st.markdown(f"""
<div class="card">
    <div class="section-label">
        {month_str} 실행 기록 · {success_c}/{total_d}일 · {rate}%{lock_notice}
    </div>
    <div class="cal-grid">{h_html}{empty_html}{day_html}</div>
</div>
""", unsafe_allow_html=True)

# =========================================================
# ENTRY POINT
# =========================================================
reset_error()

# ── 저장 실패 레코드 재시도 — 홈 진입 시 자동 복구 ──
def retry_unsynced_records() -> None:
    """synced=False 레코드를 시트에 재전송 시도"""
    if not st.session_state.get("_save_failed"):
        return
    if st.session_state.get("_guest_mode") or not st.session_state.get("nickname_confirmed"):
        return
    try:
        ensure_sheet_header()
        sheet = get_sheet()
        # 기존 시트 record_id 목록 조회 — 중복 방지
        existing_ids: set = set()
        try:
            all_rows = load_sheet_records()
            existing_ids = {str(r.get("record_id", "")) for r in all_rows if r.get("record_id")}
        except Exception:
            pass

        retried = 0
        for row in st.session_state.records:
            if not row.get("synced", True):
                rid = row.get("record_id", "")
                if rid and rid in existing_ids:
                    # 이미 시트에 있음 — 중복 skip
                    row["synced"] = True
                    continue
                sheet.append_row([
                    row["time"], row["date"], row["nickname"],
                    row["task"], row["done"],
                    row.get("fail_reason", ""),
                    row.get("source", "control"),
                    rid,
                ])
                row["synced"] = True
                retried += 1
                if rid:
                    existing_ids.add(rid)  # 루프 내 중복 방지 갱신
        if retried > 0:
            load_sheet_records.clear()
        # unsynced row가 하나도 없으면 복구 완료 (중복 skip 포함)
        all_synced = not any(
            not row.get("synced", True)
            for row in st.session_state.records
        )
        if all_synced:
            st.session_state["_save_failed"] = False
    except Exception:
        pass  # 재시도 실패 시 조용히 넘김 — 다음 진입 시 다시 시도

retry_unsynced_records()

# 이탈 지점 추적 — 세션당 1번만 (rerun마다 찍히면 퍼널 왜곡)
_log_nickname = st.session_state.get("nickname", "guest")
if not st.session_state.get("_entered_logged"):
    log_event(_log_nickname, "enter_home")
    st.session_state["_entered_logged"] = True
# 재방문 체크 (닉네임 유저만)
if st.session_state.get("nickname_confirmed"):
    check_and_log_return_visit(_log_nickname)

if st.query_params.get(ADMIN_PARAM) == "1":
    render_admin_page()
    # [진입 차단] 관리자 페이지 완료 후 앱 나머지 실행 중단
    # 아래 코드는 ?admin=1 파라미터 없을 때만 실행됨
    st.stop()

# =============================================================
# ── URL 파라미터로 닉네임 자동 복원 ──
# 새로고침해도 닉네임 유지: ?n=닉네임 형태로 URL에 박아둠
_url_nickname = st.query_params.get("n", "").strip()
if _url_nickname and not st.session_state.nickname_confirmed:
    # 캐시 무시하고 직접 시트에서 닉네임 존재 여부 확인
    try:
        get_taken_nicknames.clear()  # 캐시 무효화
    except Exception:
        pass
    if is_nickname_taken(_url_nickname):
        st.session_state.nickname           = _url_nickname
        st.session_state.nickname_confirmed = True
        st.session_state["_guest_mode"]     = False
        st.session_state["_show_target_select"]    = False
        st.session_state["_show_nickname_collect"] = False

# EARLY EXIT ZONE — st.stop() 허용 구역
# 이 구역 외부에서 st.stop() 사용 금지
# 1. missing secrets gate  (line ~110)
# 2. admin gate            (render_admin_page 직후)
# 3. guest nickname gate   (render_nickname_collect 직후)
# 4. target select gate    (render_target_select 직후)
# 5. onboarding gate       (render_nickname_setup 직후)
# 6. guest premium gate    (Premium 탭 최상단)
# =============================================================

# ── 닉네임 수집 화면 (게스트 1회 실행 후) ──
if st.session_state.get("_show_nickname_collect"):
    render_nickname_collect()
    # [진입 차단] 게스트가 1회 실행 후 닉네임 입력 화면
    # 아래 코드는 _show_nickname_collect=False 일 때만 실행됨
    st.stop()

# ── 타겟 선택 화면 (닉네임 입력 후) ──
if st.session_state.get("_show_target_select"):
    render_target_select()
    # [진입 차단] 닉네임 확정 후 타겟(창업자/수험생/운동) 선택
    # 아래 코드는 _show_target_select=False 일 때만 실행됨
    st.stop()

# ── 닉네임 미확정 + 게스트 모드 아닌 경우에만 온보딩 표시 ──
# 게스트 모드: nickname_confirmed=False지만 앱 진입 허용
if not st.session_state.nickname_confirmed and not st.session_state.get("_guest_mode"):
    render_nickname_setup()
    # [진입 차단] 비게스트인데 닉네임 미설정 상태 → 온보딩
    # 아래 코드는 nickname_confirmed=True 일 때만 실행됨
    st.stop()

# ── 데이터 로드 ──
# 게스트면 시트 조회 없이 세션 records만 사용
is_guest = st.session_state.get("_guest_mode", False) and not st.session_state.nickname_confirmed
if is_guest:
    nickname = "guest"
    records, using_sheet = st.session_state.records, False
else:
    nickname = st.session_state.nickname
    records, using_sheet = load_records(nickname=nickname)

streak            = calculate_streak(records)
today_status      = get_today_status(records)

# Premium 상태 — 게스트는 시트 조회 없이 바로 none 처리
# 닉네임 유저만 시트 기반으로 확인 (ttl=60 캐시라 1분 내 반영)
if is_guest:
    premium_status = "none"
else:
    premium_status = get_user_premium_status(nickname)
is_premium = premium_status == "active"
is_applied = premium_status == "applied"
# is_premium, is_applied는 로컬 변수로 사용 (세션 캐시 불필요)
success_count, fail_count = get_success_fail_counts(records)
success_rate      = get_success_rate(records)
# 게스트는 시트 조회 없이 0 처리 — 사회적 증거 배너는 닉네임 유저 기준
today_complete    = 0 if is_guest else get_today_complete_count()

# ── AI 명령 ──
# 목표 없어도 기본 명령 바로 표시 — 생각할 시간을 주면 이탈
if not st.session_state.goal:
    command  = "지금 30초만 아무거나 시작해라. 생각하지 말고."
    reason   = "완벽한 계획보다 불완전한 시작이 낫다."
    warning  = "지금 안 하면 오늘도 준비만 하다 끝난다."
else:
    command, reason, warning = fast_command(st.session_state.goal)
if st.session_state.command_ready:
    if can_generate_command(is_premium):
        with st.spinner("AI 명령 생성 중..."):
            if is_premium:
                command, reason, warning = generate_premium_command(
                    goal=st.session_state.goal,
                    streak=streak,
                    success_rate=success_rate,
                    top_fail=get_top_fail_reason(records),
                    fail_count=fail_count,
                )
            else:
                command, reason, warning = generate_command(
                    goal=st.session_state.goal,
                    streak=streak,
                    success_rate=success_rate,
                    target_type=st.session_state.get("target_type", "founder"),
                    is_premium=is_premium,
                )
            increment_daily_cmd_count()
            st.session_state.lazy_command = command
            st.session_state.lazy_reason  = reason
            st.session_state.lazy_warning = warning
    else:
        # 무료 하루 제한 초과 — fallback 명령 사용
        command, reason, warning = fast_command(st.session_state.goal)
        st.session_state.lazy_command = command
        st.session_state.lazy_reason  = reason
        st.session_state.lazy_warning = warning
    st.session_state.command_ready = False
elif st.session_state.lazy_command:
    command = st.session_state.lazy_command
    reason  = st.session_state.lazy_reason
    warning = st.session_state.lazy_warning

active_tab = st.session_state.get("_active_tab", "home")

# =========================================================
# 헤더
# =========================================================
flame = '<span class="flame">🔥</span>' if streak >= 3 else "🔥"
nick_display = "게스트" if is_guest else html.escape(nickname)
nick_color = "#FCD34D" if is_guest else "#94A3B8"

# 헤더 + 로그아웃
header_col, logout_col = st.columns([4, 1])
with header_col:
    st.markdown(f"""
<div style="display:flex; align-items:center; justify-content:space-between;
            padding:10px 2px 12px;
            border-bottom:1px solid rgba(255,255,255,0.05);
            margin-bottom:4px;">
    <div>
        <div style="font-size:1.08rem; font-weight:900; color:#F8FAFC;
                    letter-spacing:-0.03em;">⚡ Vanguard</div>
        <div style="font-size:0.67rem; color:#38BDF8; font-weight:700;
                    letter-spacing:0.08em; margin-top:1px;">BREAK THE LOOP</div>
    </div>
    <div style="text-align:right; font-size:0.73rem; color:#475569; line-height:1.5;">
        {flame} {streak}일<br>
        <span style="color:{nick_color};">{nick_display}</span>
    </div>
</div>
""", unsafe_allow_html=True)
with logout_col:
    if not is_guest:
        st.markdown("<div style='padding-top:10px;'></div>", unsafe_allow_html=True)
        if st.button("로그아웃", key="btn_logout", use_container_width=True):
            # 세션 초기화 + URL 파라미터 제거
            for k in list(st.session_state.keys()):
                del st.session_state[k]
            st.query_params.clear()
            st.rerun()

# ── 탭 네비게이션 (단일 레이어) ──
render_tab_nav(active_tab)

# =========================================================
# 탭 콘텐츠
# =========================================================

# ──────────────────────── 홈 ────────────────────────
# =============================================================
# =============================================================
# ⚠️ 리팩토링 마지노선 주석
# 지금 파일이 3,500줄+. 기능 2~3개 더 추가 전에 반드시 분리할 것.
# 분리 순서: storage.py → ai.py → admin.py → components.py
# 분리 기준: "수정할 때 찾는 데 30초 이상 걸리면" 분리 타이밍
# =============================================================

# =============================================================
# HOME TAB — 완전한 상태 머신
# home_mode로 단독 화면 제어 — 화면 중첩 없음
# 수정 시 주의:
#   - 각 elif 블록은 독립적 화면. 아래로 fall-through 없음
#   - 신규 session_state 키는 DEFAULTS에 먼저 선언
#   - st.stop() 허용 구역:
#       1) ENTRY POINT (admin gate, nickname gate 등 early exit)
#       2) render_admin_page() 내부 (비밀번호 미인증 시)
#       3) Premium 게스트 차단 분기
#     위 3곳 외에는 st.stop() 사용 금지
# =============================================================
if active_tab == "home":

    if GENAI_IMPORT_ERROR:
        st.info(TXT["fallback_ai"])

    today_mission = get_today_mission()
    time_ctx      = get_time_context()
    tcfg          = get_target_config()
    loss          = get_loss_stats(records)

    # ── 저장 실패 안내 — 복구 전까지 플래그 유지 (pop 아닌 get)
    # retry_unsynced_records() 성공 시에만 False로 바뀜
    if st.session_state.get("_save_failed"):
        st.markdown("""
<div style="padding:8px 14px; border-radius:10px; margin-bottom:8px;
            background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.20);
            font-size:0.75rem; color:#FCD34D; text-align:center;">
    ⚠️ 임시 저장됨 — 네트워크 불안정. 자동 재시도 중이며 곧 반영됩니다.
</div>
""", unsafe_allow_html=True)

    # ── home_mode 결정 — 단 하나의 모드만 활성 ──
    # 플래그 읽기 → 모드 결정 → 렌더 후 명시적 초기화 순서로 분리
    _completion_flag = st.session_state.get("_show_completion_insight", False)
    _fail_flag       = st.session_state.get("_show_fail_insight", False)

    if _completion_flag:
        home_mode = "completion"
        st.session_state["_show_completion_insight"] = False  # 명시적 초기화
    elif _fail_flag:
        home_mode = "fail_insight"
        st.session_state["_show_fail_insight"] = False        # 명시적 초기화
    elif st.session_state.running:
        home_mode = "running"
    elif not today_mission:
        home_mode = "mission_input"
    else:
        home_mode = "mission_ready"

    # =========================================================
    # 모드 1: 완료 인사이트 (단독 화면)
    # =========================================================
    if home_mode == "completion":
        insight = get_completion_insight(records, streak, today_mission)
        render_completion_screen(today_mission, insight, streak)
        render_streak_share(streak, st.session_state.goal, success_rate)

        # streak별 인센티브 메시지
        if not is_premium:
            if streak == 0 or streak == 1:
                # 첫 완료 — 3일 도전 유도
                st.markdown(f"""
<div style="padding:12px 16px; border-radius:14px; margin-top:6px;
            background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.20);
            font-size:0.78rem; color:#A5B4FC; text-align:center; line-height:1.6;">
    🎯 <b>3일 연속 완료하면 Premium 첫 달 할인 혜택</b><br>
    <span style="color:#475569;">내일도 같은 시간에 와라. 2일 남았다.</span>
</div>
""", unsafe_allow_html=True)
            elif streak == 2:
                st.markdown(f"""
<div style="padding:12px 16px; border-radius:14px; margin-top:6px;
            background:rgba(99,102,241,0.10); border:1px solid rgba(99,102,241,0.28);
            font-size:0.78rem; color:#A5B4FC; text-align:center; line-height:1.6;">
    🎯 <b>내일 하면 Premium 첫 달 할인 대상</b><br>
    <span style="color:#C7D2FE;">딱 하루 남았다. 내일 오면 된다.</span>
</div>
""", unsafe_allow_html=True)
            elif streak == 3:
                st.markdown(f"""
<div style="padding:12px 16px; border-radius:14px; margin-top:6px;
            background:rgba(34,197,94,0.10); border:1px solid rgba(34,197,94,0.28);
            font-size:0.78rem; color:#86EFAC; text-align:center; line-height:1.6;">
    🔥 <b>3일 달성! Premium 첫 달 할인 대상입니다</b><br>
    <span style="color:#475569;">Premium 탭에서 신청 시 할인 혜택을 받으세요.</span>
</div>
""", unsafe_allow_html=True)

        st.markdown("---")
        if is_guest:
            st.markdown("""
<div style="padding:10px 14px; border-radius:12px; margin-bottom:8px;
            background:rgba(99,102,241,0.10); border:1px solid rgba(99,102,241,0.25);
            font-size:0.78rem; color:#A5B4FC; text-align:center;">
    이 streak은 저장 전까지 사라집니다.<br>
    <b style="color:#C7D2FE;">닉네임을 만들면 영구 보관됩니다.</b>
</div>
""", unsafe_allow_html=True)
            if st.button("⚡ 이 streak 저장하기 →", use_container_width=True,
                         key="btn_completion_home", type="primary"):
                st.session_state["_show_nickname_collect"] = True
                st.rerun()
            if st.button("나중에 저장", use_container_width=True,
                         key="btn_completion_skip"):
                st.session_state["today_mission"]      = ""
                st.session_state["today_mission_date"] = ""
                st.rerun()
        else:
            if st.button("홈으로", use_container_width=True, key="btn_completion_home"):
                st.session_state["today_mission"]      = ""
                st.session_state["today_mission_date"] = ""
                st.rerun()

    # =========================================================
    # 모드 2: 실패 인사이트 (단독 화면)
    # =========================================================
    elif home_mode == "fail_insight":
        fail_reason = st.session_state.get("_last_fail_reason", "")
        insight = get_fail_pattern_insight(records, fail_reason, today_mission)
        render_fail_insight_screen(today_mission, insight)
        st.markdown("---")

        # 실패 직후 복구 버튼
        current_fc = get_success_fail_counts(records)[1]
        col_r1, col_r2 = st.columns(2)
        with col_r1:
            if st.button("⚡ 지금 시작",
                         use_container_width=True,
                         key="btn_recovery_mission", type="primary"):
                st.session_state.running      = True
                st.session_state.start_time   = time.time()
                st.session_state.current_task = "3분만 해라. 딱 3분. 그것만 하면 오늘은 살아난다."
                st.session_state["_show_fail_select"]  = False
                st.session_state["_crisis_dismissed"]  = True
                st.rerun()
        with col_r2:
            if st.button("오늘은 포기",
                         use_container_width=True,
                         key="btn_give_up"):
                st.session_state["_crisis_dismissed"]  = True
                st.session_state["_show_gave_up_msg"]  = True
                if is_guest:
                    # 게스트: 포기 후 닉네임 수집으로 유도
                    st.session_state["_show_nickname_collect"] = True
                st.rerun()

        if st.session_state.pop("_show_gave_up_msg", False):
            st.markdown("""
<div style="padding:10px 14px; border-radius:12px; margin-bottom:8px;
            background:rgba(100,116,139,0.10); border:1px solid rgba(100,116,139,0.20);
            font-size:0.78rem; color:#64748B; text-align:center;">
    오늘 기록은 실패로 저장됐습니다.<br>
    <span style="color:#475569;">내일 다시 시작하면 됩니다.</span>
</div>
""", unsafe_allow_html=True)

        # Premium 유도 — get_premium_cta() 함수로 분리
        if not is_premium and current_fc >= 2:
            fail_cta_title, fail_cta_body, fail_cta_color = get_premium_cta(current_fc)

            st.markdown(f"""
<div style="padding:14px 16px; border-radius:16px; margin-top:10px;
            background:rgba(99,102,241,0.10); border:1.5px solid rgba(99,102,241,0.28);">
    <div style="font-size:0.88rem; font-weight:900; color:{fail_cta_color}; margin-bottom:6px;">
        {fail_cta_title}
    </div>
    <div style="font-size:0.78rem; color:#94A3B8; line-height:1.6;">
        {fail_cta_body}
    </div>
    <div style="font-size:0.72rem; color:#475569; margin-top:8px;">
        ₩{PREMIUM_PRICE:,}/월 · 지금 패턴 분석 시작
    </div>
</div>
""", unsafe_allow_html=True)
            if st.button("⚡ 지금 패턴 끊기 → Premium",
                         use_container_width=True,
                         key="btn_fail_to_premium", type="primary"):
                last_fail = st.session_state.get("_last_fail_reason", get_top_fail_reason(records))
                st.session_state["_fail_reason_for_premium"] = last_fail
                st.session_state["_fail_count_for_premium"]  = current_fc
                st.session_state["_active_tab"] = "premium"
                st.rerun()

    # =========================================================
    # 모드 3: 실행 중 (단독 화면)
    # =========================================================
    elif home_mode == "running":
        elapsed = int(time.time() - st.session_state.start_time)
        render_focus_card(elapsed, st.session_state.current_task)

        col1, col2 = st.columns(2)
        with col1:
            if st.button(TXT["complete"], use_container_width=True, key="btn_complete"):
                if is_guest:
                    st.session_state.records.append({
                        "time": korea_now().strftime("%Y-%m-%d %H:%M"),
                        "date": today_str(),
                        "nickname": "guest",
                        "task": st.session_state.current_task,
                        "done": "True",
                        "fail_reason": "",
                        "source": "control",
                        "record_id": uuid.uuid4().hex,
                        "synced": False,
                    })
                    st.session_state.running      = False
                    st.session_state.current_task = ""
                    # 게스트: 인사이트 먼저 보여준 뒤 닉네임 수집
                    st.session_state["_show_completion_insight"] = True
                    st.session_state["_show_nickname_collect"]   = False  # 인사이트 후 수집
                    st.rerun()
                else:
                    _ok, _updated = save_record(st.session_state.current_task, True)
                    log_event(st.session_state.get("nickname", "guest"), "complete")
                    mark_first_action_done(st.session_state.get("nickname", ""))
                    st.session_state.running      = False
                    st.session_state.current_task = ""
                    st.session_state["_show_fail_select"]        = False
                    st.session_state["_crisis_dismissed"]        = False
                    st.session_state["_show_completion_insight"] = True
                    st.rerun()
        with col2:
            if st.button(TXT["fail"], use_container_width=True, key="btn_fail"):
                st.session_state["_show_fail_select"] = True

        if st.session_state.get("_show_fail_select", False):
            fail_reason = st.selectbox(
                "실패 이유",
                [
                    "시작이 부담됨",
                    "어디서 시작할지 모르겠음",
                    "폰/유튜브 봄",
                    "너무 피곤함",
                    "일정이 밀림",
                    "다른 일에 끌림",
                    "목표가 너무 큼",
                    "기타",
                ],
                label_visibility="collapsed",
            )
            if st.button("실패 기록하기", use_container_width=True, key="btn_fail_confirm"):
                if is_guest:
                    st.session_state.records.append({
                        "time": korea_now().strftime("%Y-%m-%d %H:%M"),
                        "date": today_str(),
                        "nickname": "guest",
                        "task": st.session_state.current_task,
                        "done": "False",
                        "fail_reason": fail_reason,
                        "source": "control",
                        "record_id": uuid.uuid4().hex,
                        "synced": False,
                    })
                    st.session_state["_last_fail_reason"]      = fail_reason
                    st.session_state.running                    = False
                    st.session_state.current_task               = ""
                    st.session_state["_show_fail_select"]       = False
                    st.session_state["_show_fail_insight"]      = True
                    st.rerun()
                else:
                    _ok, updated_records = save_record(
                        st.session_state.current_task, False, fail_reason
                    )
                    log_event(st.session_state.get("nickname","guest"), "fail", fail_reason[:30])
                    mark_first_action_done(st.session_state.get("nickname", ""))
                    st.session_state["_last_fail_reason"] = fail_reason
                    st.session_state.running              = False
                    st.session_state.current_task         = ""
                    st.session_state["_show_fail_select"] = False
                    st.session_state["_show_fail_insight"]= True

                    updated_fail_count = get_success_fail_counts(updated_records)[1]
                    if updated_fail_count >= 2 and not is_premium:
                        st.session_state["_fail_reason_for_premium"] = fail_reason
                        st.session_state["_fail_count_for_premium"]  = updated_fail_count
                    st.rerun()

    # =========================================================
    # 모드 4: 미션 입력 (단독 화면)
    # =========================================================
    elif home_mode == "mission_input":
        render_mission_input_screen()

        # 하단 상태 카드만 추가 (정보 제공용)
        if records:
            st.divider()
            st.markdown(f"""
<div class="card">
    <div class="metric-grid">
        <div class="metric">
            <div class="metric-label">Streak</div>
            <div class="metric-value">{streak}</div>
        </div>
        <div class="metric">
            <div class="metric-label">성공률</div>
            <div class="metric-value">{success_rate}%</div>
        </div>
        <div class="metric">
            <div class="metric-label">오늘</div>
            <div class="metric-value" style="font-size:0.76rem;">
                {"✅" if today_status == "success" else "❌" if today_status == "fail" else "⬜"}
            </div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)

    # =========================================================
    # 모드 5: 미션 준비됨 (단독 화면)
    # =========================================================
    elif home_mode == "mission_ready":
        # streak 3일 달성 → Premium 첫 달 할인 배너
        if not is_premium and streak == 3:
            st.markdown(f"""
<div style="padding:10px 14px; border-radius:12px; margin-bottom:10px;
            background:rgba(34,197,94,0.10); border:1px solid rgba(34,197,94,0.28);
            font-size:0.78rem; color:#86EFAC; text-align:center;">
    🔥 3일 달성! Premium 첫 달 할인 혜택 대상<br>
    <span style="color:#475569; font-size:0.72rem;">Premium 탭 → 신청하기</span>
</div>
""", unsafe_allow_html=True)

        # Premium 배지
        if is_premium:
            st.markdown("""
<div style="padding:6px 14px; border-radius:10px; margin-bottom:10px;
            background:linear-gradient(90deg,rgba(99,102,241,0.20),rgba(56,189,248,0.12));
            border:1px solid rgba(99,102,241,0.35);
            font-size:0.75rem; color:#C7D2FE; font-weight:700; text-align:center;">
    ⚡ Premium 활성 · 패턴 교정 모드
</div>
""", unsafe_allow_html=True)

        # 사회적 증거
        if today_complete >= SOCIAL_PROOF_MIN:
            st.markdown(f"""
<div class="social-proof">
    오늘 <b>{today_complete}명</b>이 목표를 실행했습니다
</div>
""", unsafe_allow_html=True)

        # streak 위기
        if today_status == "none" and streak >= 3:
            render_streak_crisis(streak, tcfg)

        # 미션 준비 화면
        render_mission_ready_screen(today_mission, st.session_state.goal)

        # 시작 버튼
        if st.button(f"🚀 {time_ctx['cta']}",
                     use_container_width=True,
                     key="btn_start_top", type="primary"):
            st.session_state.running      = True
            st.session_state.start_time   = time.time()
            st.session_state.current_task = today_mission
            st.session_state["_show_fail_select"] = False
            st.session_state["_crisis_dismissed"] = True
            st.rerun()

        # 새 명령 생성 버튼 (미션이 있어도 AI 보조 명령 요청 가능)
        remaining_cmd = FREE_DAILY_CMD_LIMIT - get_daily_cmd_count()
        if is_premium:
            refresh_label = "↻ AI 보조 명령 생성"
        elif remaining_cmd > 0:
            refresh_label = f"↻ AI 보조 명령 ({remaining_cmd}회 남음)"
        else:
            refresh_label = "🔒 오늘 무료 명령 종료"

        if st.button(refresh_label, use_container_width=True,
                     key="btn_refresh", type="secondary"):
            if not is_premium and remaining_cmd <= 0:
                st.session_state["_active_tab"] = "premium"
            else:
                st.session_state.command_ready = True
            st.rerun()

        # AI 보조 명령 카드 — 생성된 경우에만 표시
        # 미션이 메인, AI 명령은 보조
        if st.session_state.lazy_command:
            st.markdown(f"""
<div class="command-card">
    <div class="section-label">AI 보조 명령</div>
    <div class="strong-title">{html.escape(command)}</div>
    <div class="body-small">{html.escape(reason)}</div>
    <div class="body-small" style="color:#FCA5A5;">{html.escape(warning)}</div>
</div>
""", unsafe_allow_html=True)

        render_yesterday_vs_today(records, today_status)

        # 손실 지표
        goal_pain, goal_pain_sub = get_goal_matched_pain(st.session_state.goal)
        if fail_count >= 3:
            pain_extra = f'<div class="body-small" style="color:#FCA5A5; margin-top:6px; font-weight:700;">이번 달 실패 {fail_count}회. 패턴이 굳어지고 있다.</div>'
        elif fail_count >= 1:
            pain_extra = f'<div class="body-small" style="color:#FCD34D; margin-top:6px;">이번 달 실패 {fail_count}회. 두 번째부터가 패턴이다.</div>'
        else:
            pain_extra = ""

        if loss["total_count"] >= 1:
            rate_color = "#86EFAC" if loss["success_rate"] >= 80 else "#FCD34D" if loss["success_rate"] >= 50 else "#FCA5A5"
            loss_inline = f"""
<div style="display:flex; gap:12px; margin-top:10px; padding-top:10px;
            border-top:1px solid rgba(255,255,255,0.06);">
    <div style="text-align:center; flex:1;">
        <div style="font-size:1.1rem; font-weight:900; color:{rate_color};">{loss["success_rate"]}%</div>
        <div style="font-size:0.65rem; color:#475569;">이달 실행률</div>
    </div>
    <div style="text-align:center; flex:1;">
        <div style="font-size:1.1rem; font-weight:900; color:#FCA5A5;">{loss["fail_hours"]}h</div>
        <div style="font-size:0.65rem; color:#475569;">추정 손실 시간</div>
    </div>
    <div style="text-align:center; flex:1;">
        <div style="font-size:1.1rem; font-weight:900; color:#FCA5A5;">{loss["fail_prob"]}%</div>
        <div style="font-size:0.65rem; color:#475569;">현재 패턴 위험도</div>
    </div>
</div>"""
        else:
            loss_inline = ""

        st.markdown(f"""
<div class="warning-card">
    <div style="font-size:1rem; font-weight:900; color:#FCA5A5;">
        {html.escape(goal_pain)}
    </div>
    <div class="body-small" style="margin-top:6px;">
        {html.escape(goal_pain_sub)}
    </div>
    {pain_extra}
    {loss_inline}
</div>
""", unsafe_allow_html=True)

        # 하단 상태 카드
        st.markdown(f"""
<div class="card">
    <div class="metric-grid">
        <div class="metric">
            <div class="metric-label">Streak</div>
            <div class="metric-value">{streak}</div>
        </div>
        <div class="metric">
            <div class="metric-label">성공률</div>
            <div class="metric-value">{success_rate}%</div>
        </div>
        <div class="metric">
            <div class="metric-label">오늘</div>
            <div class="metric-value" style="font-size:0.76rem;">
                {"✅" if today_status == "success" else "❌" if today_status == "fail" else "⬜"}
            </div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)
# ──────────────────────── 기록 ────────────────────────
elif active_tab == "record":
    st.markdown('<div class="section-label" style="margin-bottom:10px;">최근 기록</div>',
                unsafe_allow_html=True)

    # 저장 실패 안내 — get으로 읽기만 (홈 탭에서 pop으로 초기화)
    if st.session_state.get("_save_failed"):
        st.markdown("""
<div style="padding:8px 14px; border-radius:10px; margin-bottom:8px;
            background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.20);
            font-size:0.75rem; color:#FCD34D; text-align:center;">
    ⚠️ 일부 기록이 임시 저장됨 — 네트워크 불안정 시 발생. 새로고침하면 재시도합니다.
</div>
""", unsafe_allow_html=True)

    # 게스트 안내
    if is_guest:
        st.markdown("""
<div class="warning-card" style="text-align:center; padding:16px;">
    <div class="body-small" style="color:#FCD34D; font-weight:700;">
        지금은 게스트 모드입니다.<br>
        닉네임을 설정하면 기록이 저장됩니다.
    </div>
</div>
""", unsafe_allow_html=True)
        if st.button("닉네임 설정하기 →", use_container_width=True, type="primary"):
            st.session_state["_guest_mode"] = False
            st.session_state["_show_nickname_collect"] = False
            st.rerun()

    if not using_sheet and not is_guest:
        st.caption("세션 내 임시 저장 중")

    # 캘린더 — Premium/게스트는 전체, 무료는 lock_before로 이전 구간 잠금 표시
    # "데이터 없음"이 아니라 "잠김"으로 보여서 UX 오해 방지
    if is_premium or is_guest:
        render_monthly_calendar(records)
    else:
        cutoff_date = korea_now().date() - timedelta(days=FREE_RECORD_DAYS - 1)
        lock_before = cutoff_date.strftime("%Y-%m-%d")
        render_monthly_calendar(records, lock_before=lock_before)
        st.markdown("""
<div style="padding:5px 12px; border-radius:9px; margin-bottom:6px;
            background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.20);
            font-size:0.73rem; color:#A5B4FC; text-align:center;">
    🔒 표시된 구간은 Premium에서 열람 가능합니다
</div>
""", unsafe_allow_html=True)

    # 무료: 최근 7일 기록만 / Premium: 전체
    if is_premium or is_guest:
        visible_records = records
        record_limit_label = ""
    else:
        cutoff = (korea_now().date() - timedelta(days=FREE_RECORD_DAYS - 1)).strftime("%Y-%m-%d")
        visible_records = [r for r in records if str(r.get("date","")) >= cutoff]
        total_count = len(records)
        visible_count = len(visible_records)
        if total_count > visible_count:
            record_limit_label = f"최근 {FREE_RECORD_DAYS}일 기록만 표시 중 · 전체 {total_count}개는 Premium에서 열람 가능"
        else:
            record_limit_label = ""

    if record_limit_label:
        st.markdown(f"""
<div style="padding:8px 14px; border-radius:10px; margin-bottom:10px;
            background:rgba(99,102,241,0.10); border:1px solid rgba(99,102,241,0.25);
            font-size:0.77rem; color:#A5B4FC; text-align:center;">
    🔒 {record_limit_label}
</div>
""", unsafe_allow_html=True)
        if st.button("🔥 전체 기록 + 패턴 분석 열기 → Premium",
                     use_container_width=True,
                     key="btn_record_premium", type="primary"):
            st.session_state["_active_tab"] = "premium"
            st.rerun()

    recent = get_recent_records(visible_records, 50 if is_premium else 15)
    if not recent:
        st.markdown("""
<div class="card" style="text-align:center; padding:28px 14px;">
    <div style="font-size:1.8rem; margin-bottom:8px;">📭</div>
    <div class="body-small">아직 기록이 없습니다.<br>홈에서 첫 실행을 시작하세요.</div>
</div>
""", unsafe_allow_html=True)
    else:
        for row in reversed(recent):
            is_done = record_to_bool_done(row)
            emoji   = "✅" if is_done else "❌"
            status  = "성공" if is_done else "실패"
            fail_text = (
                f" · {html.escape(str(row.get('fail_reason', '')))}"
                if not is_done and row.get("fail_reason") else ""
            )
            st.markdown(f"""
<div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between;">
        <span>{emoji}</span>
        <span class="muted">{html.escape(str(row.get('time', '-')))}</span>
    </div>
    <div class="strong-title" style="font-size:0.9rem; margin-top:5px;">
        {html.escape(str(row.get('task', '-')))}
    </div>
    <div class="body-small">{status}{fail_text}</div>
</div>
""", unsafe_allow_html=True)

# ──────────────────────── 분석 ────────────────────────
elif active_tab == "analysis":
    st.markdown('<div class="section-label" style="margin-bottom:10px;">상세 분석</div>',
                unsafe_allow_html=True)

    # ── 누적 손실 대시보드 (데이터 3개 이상일 때) ──
    loss = get_loss_stats(records)

    if loss["total_count"] >= 1:
        # 손실 지표 카드
        rate_color = "#86EFAC" if loss["success_rate"] >= 80 else                      "#FCD34D" if loss["success_rate"] >= 50 else "#FCA5A5"
        prob_color = "#86EFAC" if loss["fail_prob"] <= 20 else                      "#FCD34D" if loss["fail_prob"] <= 50 else "#FCA5A5"

        st.markdown(f"""
<div class="warning-card" style="padding:18px 16px;">
    <div class="section-label" style="margin-bottom:12px;">
        📉 이번 달 현실 추적
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:14px;">
        <div style="text-align:center;">
            <div style="font-size:1.6rem; font-weight:900; color:{rate_color};">
                {loss["success_rate"]}%
            </div>
            <div style="font-size:0.7rem; color:#475569; margin-top:2px;">이번 달 성공률</div>
        </div>
        <div style="text-align:center;">
            <div style="font-size:1.6rem; font-weight:900; color:#FCA5A5;">
                {loss["fail_hours"]}h
            </div>
            <div style="font-size:0.7rem; color:#475569; margin-top:2px;">날린 추정 시간</div>
        </div>
        <div style="text-align:center;">
            <div style="font-size:1.6rem; font-weight:900; color:{prob_color};">
                {loss["fail_prob"]}%
            </div>
            <div style="font-size:0.7rem; color:#475569; margin-top:2px;">현재 패턴 위험도</div>
        </div>
    </div>
    <div style="font-size:0.82rem; color:#94A3B8; font-weight:600;
                padding-top:10px; border-top:1px solid rgba(255,255,255,0.06);">
        {html.escape(loss["danger_msg"])}
    </div>
</div>
""", unsafe_allow_html=True)
        st.caption("위 수치는 행동 기록 기반 단순 추정치입니다. 실측 예측이 아닙니다.")

        # 복귀 난이도 표시 (실패가 있을 때)
        if loss["fail_count"] > 0:
            if loss["recovery_days"] > 0:
                recovery_msg = f"지금 streak이 끊겼다. 복구까지 최소 {loss['recovery_days']}일 필요하다."
            else:
                recovery_msg = f"이번 달 실패 {loss['fail_count']}회 → 오늘 성공률 {loss['success_rate']}%. 남은 {loss['days_left']}일이 전부다."

            st.markdown(f"""
<div style="padding:10px 14px; border-radius:12px; margin-bottom:10px;
            background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.20);">
    <div style="font-size:0.8rem; color:#FCA5A5; font-weight:700;">
        ⚠️ 복귀 난이도
    </div>
    <div style="font-size:0.78rem; color:#94A3B8; margin-top:4px;">
        {html.escape(recovery_msg)}
    </div>
</div>
""", unsafe_allow_html=True)

    with st.spinner("분석 중..."):
        weekly_stats = get_weekly_stats(records)
        # 주간 리포트 — 무료/Premium 공통
        if records:
            wf, wa = generate_weekly_report(
                st.session_state.goal,
                weekly_stats["success_rate"],
                weekly_stats["success_count"],
                weekly_stats["fail_count"],
                weekly_stats["top_fail_reason"],
            )
        else:
            wf = "최근 7일 동안 반복 실패 이유가 존재한다."
            wa = "가장 중요한 작업을 2분짜리 시작 블록으로 먼저 시작해라."
        # Premium 인사이트는 is_premium 블록에서 별도 호출

    st.markdown(f"""
<div class="card">
    <div class="section-label">최근 7일 리포트</div>
    <div class="metric-grid" style="margin-top:8px;">
        <div class="metric"><div class="metric-label">성공률</div>
            <div class="metric-value">{weekly_stats['success_rate']}%</div></div>
        <div class="metric"><div class="metric-label">성공</div>
            <div class="metric-value">{weekly_stats['success_count']}</div></div>
        <div class="metric"><div class="metric-label">실패</div>
            <div class="metric-value">{weekly_stats['fail_count']}</div></div>
    </div>
    <div class="body-small" style="margin-top:10px;"><b>패턴:</b> {html.escape(wf)}</div>
    <div class="body-small"><b>추천:</b> {html.escape(wa)}</div>
</div>
""", unsafe_allow_html=True)

    if len(records) >= 3:
        if is_premium:
            # Premium 사용자 — 5개 항목 심층 분석
            insight = generate_premium_insight(
                st.session_state.goal,
                str(records[-10:]),
            )
            is_fail = get_success_fail_counts(records)[1] >= 2
            card_cls = "warning-card" if is_fail else "success-card"
            st.markdown(f"""
<div class="{card_cls}">
    <div class="section-label">⚡ Premium 심층 분석</div>
    <div class="strong-title" style="font-size:0.94rem;">
        {"반복 실패를 끊고 싶다면" if is_fail else "이 흐름을 유지하려면"}
    </div>
    <div class="body-small" style="margin-top:10px;">
        <b>🔍 반복 실패 원인</b><br>{html.escape(insight["root_cause"])}
    </div>
    <div class="body-small" style="margin-top:8px;">
        <b>⚠️ 위험 구간</b><br>{html.escape(insight["danger_zone"])}
    </div>
    <div class="body-small" style="margin-top:8px;">
        <b>📉 실패 예측</b><br>{html.escape(insight["predict"])}
    </div>
    <div class="body-small" style="margin-top:8px;">
        <b>🔄 복귀 프로토콜</b><br>{html.escape(insight["protocol"])}
    </div>
    <div class="body-small" style="margin-top:8px; color:#FCA5A5;">
        <b>🚨 경고</b><br>{html.escape(insight["warning"])}
    </div>
</div>
""", unsafe_allow_html=True)
        else:
            # 비 Premium — 맛보기 공개 후 핵심 잠금
            top_fail = get_top_fail_reason(records)
            fail_c   = get_success_fail_counts(records)[1]

            # 맛보기 — 패턴은 보이는데 원인은 막힘
            st.markdown(f"""
<div class="warning-card">
    <div class="section-label">⚠️ 패턴 감지 — 무료 미리보기</div>
    <div class="strong-title" style="font-size:0.96rem; color:#FCA5A5;">
        주요 실패 이유: '{html.escape(top_fail or "기록 부족")}'
    </div>
    <div class="body-small" style="margin-top:6px;">
        이번 달 <b style="color:#FCA5A5;">{fail_c}번</b> 무너졌다.
        이 패턴이 계속되면 이번 달도 같은 결과로 끝난다.
    </div>
    <div class="body-small" style="margin-top:8px; color:#475569;">
        🔍 왜 반복되는지 &nbsp;·&nbsp;
        ⚠️ 언제 가장 위험한지 &nbsp;·&nbsp;
        🔄 어떻게 끊는지
        <span style="color:#FCA5A5; font-weight:700;"> → Premium에서만 열림</span>
    </div>
</div>
""", unsafe_allow_html=True)

            # 잠금 카드
            st.markdown("""
<div class="lock-card">
    <div class="lock-icon">🔒</div>
    <div class="lock-title">반복 실패 원인 분석</div>
    <div class="lock-sub">
        반복 실패 원인 · 위험 시간대 · 실패 예측<br>
        복귀 프로토콜 · 맞춤 경고문<br><br>
        지금 패턴이 보인다. 왜인지는 아직 잠겨있다.
    </div>
</div>
""", unsafe_allow_html=True)
            if st.button("🔥 왜 계속 실패하는지 지금 열기 → Premium",
                         use_container_width=True, key="goto_premium",
                         type="primary"):
                st.session_state["_active_tab"] = "premium"
                st.rerun()
    else:
        st.info("최소 3개 기록 후 분석이 시작됩니다.")

# ──────────────────────── Premium ────────────────────────
elif active_tab == "premium":

    # ── 게스트 — 닉네임 먼저 설정하도록 유도 ──
    if is_guest:
        st.markdown("""
<div class="warning-card" style="text-align:center; padding:24px 16px;">
    <div style="font-size:1.6rem; margin-bottom:8px;">🔒</div>
    <div class="strong-title" style="margin-top:0; font-size:1rem;">
        Premium 신청은 닉네임 설정 후 가능합니다
    </div>
    <div class="body-small" style="margin-top:8px;">
        먼저 홈에서 1회 실행하고 닉네임을 설정하세요.<br>
        닉네임이 있어야 신청 내역을 추적할 수 있습니다.
    </div>
</div>
""", unsafe_allow_html=True)
        if st.button("🏠 홈으로 돌아가기", use_container_width=True,
                     key="guest_premium_home"):
            st.session_state["_active_tab"] = "home"
            st.rerun()
    # ── 이미 Premium 활성화된 사용자 ──
    elif is_premium:
        st.markdown(f"""
<div class="success-card" style="text-align:center; padding:24px 16px;">
    <div style="font-size:1.8rem; margin-bottom:8px;">⚡</div>
    <div class="strong-title" style="margin-top:0;">{TXT['premium_active_title']}</div>
    <div class="body-small">{TXT['premium_active_body']}</div>
</div>
""", unsafe_allow_html=True)

        st.markdown("""
<div class="card">
    <div class="section-label">활성화된 기능</div>
    <table class="compare-table">
        <tr>
            <td class="ct-label">실패 패턴 분석</td>
            <td class="ct-prem">✓ 활성</td>
        </tr>
        <tr>
            <td class="ct-label">개인화 행동 명령</td>
            <td class="ct-prem">✓ 활성</td>
        </tr>
        <tr>
            <td class="ct-label">실패 예측</td>
            <td class="ct-prem">✓ 활성</td>
        </tr>
        <tr>
            <td class="ct-label">흐름 유지 개입</td>
            <td class="ct-prem">✓ 활성</td>
        </tr>
    </table>
</div>
""", unsafe_allow_html=True)

    # ── 결제 진행 중 (신청 완료 후) ──
    elif is_applied:
        st.markdown(f"""
<div class="card" style="padding:20px 16px;">
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
        <div style="font-size:1.6rem;">⏳</div>
        <div>
            <div class="strong-title" style="margin-top:0; font-size:0.95rem;">
                신청 완료 · 활성화 대기 중
            </div>
            <div style="font-size:0.72rem; color:#475569; margin-top:2px;">
                입금 확인 후 수동 승인됩니다
            </div>
        </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; align-items:center; gap:8px; font-size:0.78rem; color:#86EFAC;">
            ✓ <span>신청서 제출 완료</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; font-size:0.78rem; color:#FCD34D;">
            ◎ <span>입금 확인 대기 중 (보통 1~3시간)</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; font-size:0.78rem; color:#475569;">
            ○ <span>Premium 활성화</span>
        </div>
    </div>
    <div style="font-size:0.72rem; color:#334155; margin-top:10px; padding-top:10px;
                border-top:1px solid rgba(255,255,255,0.05);">
        활성화 후 최대 1분 내 반영됩니다. 바로 안 보이면 새로고침해주세요.
    </div>
</div>
""", unsafe_allow_html=True)

        # 수동 새로고침 — 캐시 TTL 60초 UX 개선
        if st.button("🔄 활성화 확인하기", use_container_width=True,
                     key="btn_premium_refresh"):
            get_user_premium_status.clear()
            st.rerun()

        st.markdown(f"""
<div class="card" style="text-align:center; padding:16px;">
    <div class="body-small" style="color:#475569; margin-bottom:10px;">
        신청 및 입금을 아직 완료하지 않으셨나요?
    </div>
</div>
""", unsafe_allow_html=True)
        st.link_button(
            f"📋 신청하기 (₩{PREMIUM_PRICE:,}/월)",
            url=PREMIUM_PAYMENT_URL,
            use_container_width=True,
        )
        st.caption("결제 완료 후 1~3시간 내 활성화됩니다. 문의: 운영 안내 참고")

    # ── 신규 신청 화면 — 압박 → 탈출구 구조 ──
    else:
        fail_reason_trigger = st.session_state.pop("_fail_reason_for_premium", None)
        fail_count_trigger  = st.session_state.pop("_fail_count_for_premium", None)
        loss = get_loss_stats(records)

        # ── 1단계: 압박 (개인화 or 데이터 기반 or 일반) ──
        if fail_reason_trigger and fail_count_trigger:
            st.markdown(f"""
<div style="padding:20px 16px; border-radius:18px; margin-bottom:12px;
            background:rgba(239,68,68,0.10); border:1.5px solid rgba(239,68,68,0.30);">
    <div style="font-size:0.7rem; color:#FCA5A5; font-weight:700;
                letter-spacing:0.06em; margin-bottom:10px;">지금 네 패턴</div>
    <div style="font-size:1rem; font-weight:900; color:#FCA5A5; line-height:1.5;">
        '{html.escape(str(fail_reason_trigger))}'으로<br>
        이번 달 {fail_count_trigger}번 반복됐다
    </div>
    <div style="font-size:0.82rem; color:#94A3B8; margin-top:10px; line-height:1.6;">
        이건 의지 문제가 아니다.<br>
        같은 이유로 반복되는 건 <b style="color:#FCA5A5;">구조가 없어서</b>다.
    </div>
</div>
""", unsafe_allow_html=True)
        elif loss["total_count"] >= 3:
            rate_color = "#86EFAC" if loss["success_rate"] >= 80 else "#FCD34D" if loss["success_rate"] >= 50 else "#FCA5A5"
            st.markdown(f"""
<div style="padding:20px 16px; border-radius:18px; margin-bottom:12px;
            background:rgba(239,68,68,0.08); border:1.5px solid rgba(239,68,68,0.20);">
    <div style="font-size:0.7rem; color:#FCA5A5; font-weight:700;
                letter-spacing:0.06em; margin-bottom:10px;">지금 네 현실</div>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;
                text-align:center; margin-bottom:12px;">
        <div>
            <div style="font-size:1.4rem; font-weight:900; color:{rate_color};">{loss["success_rate"]}%</div>
            <div style="font-size:0.62rem; color:#475569;">이달 실행률</div>
        </div>
        <div>
            <div style="font-size:1.4rem; font-weight:900; color:#FCA5A5;">{loss["fail_hours"]}h</div>
            <div style="font-size:0.62rem; color:#475569;">추정 손실 시간</div>
        </div>
        <div>
            <div style="font-size:1.4rem; font-weight:900; color:#FCA5A5;">{loss["fail_prob"]}%</div>
            <div style="font-size:0.62rem; color:#475569;">현재 패턴 위험도</div>
        </div>
    </div>
    <div style="font-size:0.82rem; color:#94A3B8; line-height:1.6;
                padding-top:10px; border-top:1px solid rgba(255,255,255,0.06);">
        {html.escape(loss["danger_msg"])}
    </div>
</div>
""", unsafe_allow_html=True)
        else:
            st.markdown("""
<div style="padding:20px 16px; border-radius:18px; margin-bottom:12px;
            background:rgba(239,68,68,0.08); border:1.5px solid rgba(239,68,68,0.20);">
    <div style="font-size:1rem; font-weight:900; color:#FCA5A5; line-height:1.5;">
        대부분의 사람은<br>
        의지로 시작하고 3일 안에 무너진다
    </div>
    <div style="font-size:0.82rem; color:#94A3B8; margin-top:10px; line-height:1.6;">
        문제는 의지가 아니다.<br>
        <b style="color:#FCA5A5;">강제 개입 구조</b>가 없어서다.
    </div>
</div>
""", unsafe_allow_html=True)

        # ── 2단계: 전환 포인트 — 해결책 제시 ──
        st.markdown("""
<div style="padding:16px; border-radius:16px; margin-bottom:12px;
            background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.20);">
    <div style="font-size:0.88rem; font-weight:900; color:#C7D2FE; line-height:1.5;">
        Premium은 네 실패 패턴을 감시하고<br>
        무너지는 순간 개입한다
    </div>
    <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">
        <div style="font-size:0.78rem; color:#86EFAC;">✓ 왜 계속 실패하는지 — 원인 분석</div>
        <div style="font-size:0.78rem; color:#86EFAC;">✓ 가장 위험한 시간대 — 실시간 감지</div>
        <div style="font-size:0.78rem; color:#86EFAC;">✓ AI 명령 — 무제한 · 감독형</div>
        <div style="font-size:0.78rem; color:#86EFAC;">✓ 무너질 때 — 강제 개입</div>
    </div>
</div>
""", unsafe_allow_html=True)

        # ── 3단계: CTA — "결제"가 아닌 "탈출구" ──
        st.markdown(f"""
<div style="text-align:center; padding:6px 0 10px;">
    <div style="font-size:1.1rem; font-weight:900; color:#86EFAC;">
        ₩{PREMIUM_PRICE:,}<span style="font-size:0.75rem; color:#475569;">/월</span>
    </div>
    <div style="font-size:0.7rem; color:#475569; margin-top:2px;">
        초기 사용자 가격 · 이후 조정 예정
    </div>
</div>
""", unsafe_allow_html=True)

        email_input = st.text_input(
            "이메일 (선택)",
            placeholder="실패 직전 알림 받을 이메일 (선택사항)",
            label_visibility="collapsed",
        )

        st.link_button(
            f"⚡ 이 패턴에서 빠져나가기  ₩{PREMIUM_PRICE:,}/월",
            url=PREMIUM_PAYMENT_URL,
            use_container_width=True,
        )

        st.caption("신청서 + 입금 완료 후 아래 버튼을 눌러주세요.")
        if st.button("✅ 입금 완료했습니다", use_container_width=True,
                     key="btn_premium_apply"):
            try:
                # 캐시 무효화 후 신청 저장 시도
                get_user_premium_status.clear()
                ok = save_premium_apply(
                    nickname=nickname,
                    email=email_input.strip() if email_input.strip() and "@" in email_input else "",
                    goal=st.session_state.goal,
                )
                if ok:
                    log_event(nickname, "apply_premium")
                    st.success("신청이 완료됐습니다. 입금 확인 후 1~3시간 내 활성화됩니다.")
                    get_user_premium_status.clear()
                    st.rerun()
                else:
                    err = st.session_state.get("last_error", "")
                    st.error(f"저장 실패: {err if err else '잠시 후 다시 시도해주세요.'}")
            except Exception as e:
                st.error(f"오류 발생: {e}")

    # 운영 안내 (공통)
    st.markdown(f"""
<div class="card" style="margin-top:14px;">
    <div class="section-label">운영 안내</div>
    <div class="body-small">{TXT['policy_text']}</div>
    <div class="body-small" style="margin-top:8px; color:#475569;">
        신청 + 입금 확인 후 1~3시간 내 수동 활성화됩니다.<br>
        활성화 지연 시 닉네임과 함께 문의해주세요.
    </div>
</div>
""", unsafe_allow_html=True)

st.caption("Vanguard MVP · Deploy Ready")
