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
NEXUS_SHEET_URL = get_secret(
    "NEXUS_SHEET_URL",
    "https://docs.google.com/spreadsheets/d/1MPJ94HeiRs_xjZfkBCWKQNhKHf45H9YhZgoZ2M_tNSI/edit?usp=sharing"
)

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
    "premium_tagline": "왜 계속 실패하는지 — 이제 알 수 있다",
    "premium_applied_title": "신청 완료 ✓",
    "premium_applied_body": "신청서 확인 후 1~3시간 내에 Premium이 활성화됩니다.\\n입금 확인까지 완료되면 닉네임 기준으로 수동 승인됩니다.",
    "premium_active_title": "⚡ Premium 활성화됨",
    "premium_active_body": "패턴 교정 명령 · 실패 원인 분석 · 위험 시간대 · 복귀 프로토콜이 모두 활성화됐습니다.",
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
    "_show_complete_msg": False,
    "_show_fail_msg": False,
    "_show_fail_select": False,
    "_header_ensured": False,
    "_users_header_ensured": False,
    "_prev_goal": "",
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
}
for k, v in DEFAULTS.items():
    if k not in st.session_state:
        st.session_state[k] = v

# =========================================================
# TIME UTILS
# =========================================================
def korea_now() -> datetime:
    return datetime.now(ZoneInfo("Asia/Seoul"))

def now_time() -> str:
    return korea_now().strftime("%H:%M")

def today_str() -> str:
    return korea_now().strftime("%Y-%m-%d")

def yesterday_str() -> str:
    return (korea_now().date() - timedelta(days=1)).strftime("%Y-%m-%d")

def elapsed_to_text(elapsed: int) -> str:
    """경과 시간을 사람이 읽기 쉬운 텍스트로"""
    if elapsed < 60:
        return f"{elapsed}초"
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
      fail_hours      — 실패로 날린 추정 시간 (회당 2시간 기준)
      goal_loss_pct   — 목표 대비 손실 (%)
      fail_prob       — 이 속도면 이번 달 목표 달성 실패 확률 (%)
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
    fail_hours   = fail_c * 2  # 실패 1회 = 낭비 추정 2시간

    # 이번 달 남은 일수
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_left     = days_in_month - today.day

    # 실패 확률 — 현재 실패율 기반
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
    """
    g = goal.lower()
    student_kw = {"시험", "수능", "공부", "학교", "수업", "과제", "토익", "토플",
                  "학점", "입시", "고시", "자격증", "시험공부"}
    fitness_kw = {"운동", "헬스", "다이어트", "살", "몸무게", "체중", "근육",
                  "러닝", "조깅", "수영", "요가", "필라테스", "PT"}
    founder_kw = {"매출", "런칭", "클라이언트", "창업", "사업", "스타트업",
                  "고객", "마케팅", "개발", "제품", "서비스", "투자", "미팅"}

    if any(kw in g for kw in student_kw):
        return "student"
    if any(kw in g for kw in fitness_kw):
        return "fitness"
    if any(kw in g for kw in founder_kw):
        return "founder"
    return "founder"  # 기본값

def get_target_config() -> dict:
    """현재 세션의 타겟 설정 반환"""
    t = st.session_state.get("target_type", "founder")
    return TARGET_CONFIG.get(t, TARGET_CONFIG["founder"])

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

def fast_command(goal: str) -> Tuple[str, str, str]:
    return (
        f"지금 '{goal or '핵심 작업'}' 2분만 해라. 지금 당장.",
        "2분만 넘기면 흐름이 붙는다. 시작이 전부다.",
        "지금 안 하면 오늘은 끝이다. 내일도 똑같이 미룬다.",
    )

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
) -> Tuple[str, str, str]:
    fallback = fast_command(goal)
    client = get_genai_client()
    if client is None:
        return fallback
    target_label = TARGET_CONFIG.get(target_type, TARGET_CONFIG["founder"])["label"]

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

def ensure_sheet_header() -> None:
    if st.session_state.get("_header_ensured"):
        return
    sheet = get_sheet()
    if not sheet.get_all_values():
        sheet.append_row(["time", "date", "nickname", "task", "done", "fail_reason", "source"])
    st.session_state["_header_ensured"] = True

USERS_HEADER = ["time", "nickname", "email", "goal", "type", "is_premium"]

def ensure_users_header() -> None:
    if st.session_state.get("_users_header_ensured"):
        return
    spreadsheet = get_spreadsheet()
    ws = spreadsheet.get_worksheet(1)
    if ws is None:
        ws = spreadsheet.add_worksheet(title="Users", rows=1000, cols=len(USERS_HEADER))
    values = ws.get_all_values()
    if not values:
        # 빈 시트 — 헤더 추가
        ws.append_row(USERS_HEADER)
    else:
        header = values[0]
        if len(header) < len(USERS_HEADER):
            # 이전 5컬럼 시트 → 6컬럼으로 헤더 보정
            ws.update("A1:F1", [USERS_HEADER])
    st.session_state["_users_header_ensured"] = True

def _get_users_ws():
    """
    Users 워크시트 반환
    인덱스(1) 대신 이름("Users")으로 찾아서
    탭 순서와 무관하게 안전하게 작동
    """
    spreadsheet = get_spreadsheet()
    try:
        ws = spreadsheet.worksheet("Users")
    except Exception:
        # Users 탭 없으면 자동 생성
        ws = spreadsheet.add_worksheet(title="Users", rows=1000, cols=6)
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
    - 시트가 단일 진실 원천
    - load_records() → session_state.records 동기화 → save_record() → append → 반환
    - 이 순서로 항상 누적 기록 전체 기준으로 판단 가능
    - 시트 저장 실패 시: 세션에만 저장 (데이터 유실 방지 fallback)

    [나중에 할 것]
    - DAU 30명+ 시: 시트 기반 카운트로 전환
    - DAU 100명+ 시: Supabase로 이전 (시트 병목 발생 시)
    """
    nickname = st.session_state.get("nickname", "anonymous")
    row = {
        "time": korea_now().strftime("%Y-%m-%d %H:%M"),
        "date": today_str(),
        "nickname": nickname,
        "task": task,
        "done": str(done),
        "fail_reason": fail_reason,
        "source": source,
        "synced": False,
    }

    # 게스트는 세션에만 저장
    if nickname == "guest":
        st.session_state.records.append(row)
        return True, list(st.session_state.records)

    # 닉네임 유저: 시트 먼저 저장
    try:
        ensure_sheet_header()
        sheet = get_sheet()
        sheet.append_row([
            row["time"], row["date"], row["nickname"],
            row["task"], row["done"], row["fail_reason"], row["source"],
        ])
        row["synced"] = True
        load_sheet_records.clear()
        get_today_complete_count.clear()
        st.session_state.records.append(row)
        # 저장 성공: session_state.records가 시트 + 신규 row = 최신 상태
        return True, list(st.session_state.records)
    except Exception as e:
        set_error(f"Sheet save failed: {e}")
        # 시트 실패 fallback: 세션에만 저장
        st.session_state.records.append(row)
        return False, list(st.session_state.records)

def save_nickname_signup(nickname: str) -> bool:
    try:
        ensure_users_header()
        ws = _get_users_ws()
        ws.append_row([
            korea_now().strftime("%Y-%m-%d %H:%M"),
            nickname, "", "", "signup", "False",
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
    """
    try:
        ws = _get_users_ws()
        rows = ws.get_all_records()
        updated = False
        for idx, row in enumerate(rows, start=2):
            if (str(row.get("nickname","")).strip() == nickname.strip()
                    and row.get("type") == "premium_apply"):
                ws.update_cell(idx, 6, "True")
                updated = True
        if updated:
            get_user_premium_status.clear()
            get_premium_nicknames.clear()
        return updated
    except Exception as e:
        set_error(f"Premium activate failed: {e}")
        return False

def save_premium_apply(nickname: str, email: str, goal: str) -> bool:
    """Premium 신청 정보 저장 (입금 전 신청 단계)"""
    try:
        ensure_users_header()
        ws = _get_users_ws()
        ws.append_row([
            korea_now().strftime("%Y-%m-%d %H:%M"),
            nickname, email, goal, "premium_apply", "False",
        ])
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
        if not rows:
            return {"total": 0, "today": 0, "users": 0, "complete_rate": 0, "top_fail": "", "emails": 0}
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
    st.markdown("**Premium 신청자 목록**")
    apply_list = stats.get("apply_list", [])
    if not apply_list:
        st.caption("신청자 없음")
    else:
        for item in apply_list:
            nick    = item["nickname"]
            email   = item["email"]
            t       = item["time"]
            active  = item["active"].strip().lower() in {"true","1","yes"}
            status  = "✅ 활성" if active else "⏳ 대기 중"
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
                                st.error("활성화 실패. 시트를 확인하세요.")
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

    st.markdown(f"""
<div class="card" style="margin-top:4px;">
    <div class="section-label">{TXT['nickname_label']}</div>
    <div class="body-small" style="margin-top:3px;">{TXT['nickname_desc']}</div>
</div>
""", unsafe_allow_html=True)

    nickname_input = st.text_input(
        "닉네임",
        placeholder=TXT["nickname_placeholder"],
        label_visibility="collapsed",
    )
    if st.button(TXT["nickname_confirm"], use_container_width=True):
        name = nickname_input.strip()
        if not name:
            st.warning("닉네임을 입력해주세요.")
        elif len(name) < 2:
            st.warning("닉네임은 2자 이상이어야 합니다.")
        elif is_nickname_taken(name):
            st.error("이미 사용 중인 닉네임입니다.")
        else:
            st.session_state.nickname = name
            st.session_state.nickname_confirmed = True
            st.session_state["_show_target_select"] = True  # 타겟 선택으로 이동
            save_nickname_signup(name)
            get_taken_nicknames.clear()
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

    # 목표 기반 자동 추론
    inferred = infer_target(goal)
    cfg      = TARGET_CONFIG[inferred]

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

    # 추천 타겟 표시 — 목표가 있으면 분석 결과, 없으면 기본값 안내
    if goal.strip():
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

                st.session_state.nickname = name
                st.session_state.nickname_confirmed = True
                st.session_state["_guest_mode"] = False
                st.session_state["_show_nickname_collect"] = False
                st.session_state["_show_target_select"] = True  # 타겟 선택으로 이동
                save_nickname_signup(name)
                get_taken_nicknames.clear()

                # synced=False인 기록만 시트에 저장 → 중복 저장 방지
                # ensure_sheet_header() 먼저 호출 — 빈 시트에서 헤더 누락 방지
                try:
                    ensure_sheet_header()
                    sheet = get_sheet()
                    for row in st.session_state.records:
                        if (row.get("nickname") == name
                                and not row.get("synced", True)):
                            sheet.append_row([
                                row["time"], row["date"], row["nickname"],
                                row["task"], row["done"],
                                row.get("fail_reason", ""),
                                row.get("source", "control"),
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
            # 활성 탭: 이름 앞에 점(·) 추가로 추가 CSS 없이 구분
            display = f"· {label}" if is_active else label
            btn_type = "primary" if is_active else "secondary"
            if st.button(display, key=f"tab_{tab_id}",
                         use_container_width=True,
                         type=btn_type):
                st.session_state["_active_tab"] = tab_id
                st.rerun()

# =========================================================
# 컴포넌트: 집중 상태 카드
# - 타이머가 아니라 "집중 상태 카드"
# - 자동 갱신 없음 (rerun/sleep 없음) → 서버 부담 0
# - 페이지에 진입할 때만 경과 시간 업데이트
# - 사용자에게 "집중 중" 상태를 보여주는 것이 목적
# =========================================================
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

if st.query_params.get(ADMIN_PARAM) == "1":
    render_admin_page()
    # [진입 차단] 관리자 페이지 렌더링 후 나머지 앱 실행 중단
    st.stop()

# ── 닉네임 수집 화면 (게스트 1회 실행 후) ──
if st.session_state.get("_show_nickname_collect"):
    render_nickname_collect()
    # [진입 차단] 게스트 → 닉네임 수집 화면 (1회 실행 후)
    st.stop()

# ── 타겟 선택 화면 (닉네임 입력 후) ──
if st.session_state.get("_show_target_select"):
    render_target_select()
    # [진입 차단] 닉네임 설정 후 타겟 선택 화면
    st.stop()

# ── 닉네임 미확정 + 게스트 모드 아닌 경우에만 온보딩 표시 ──
# 게스트 모드: nickname_confirmed=False지만 앱 진입 허용
if not st.session_state.nickname_confirmed and not st.session_state.get("_guest_mode"):
    render_nickname_setup()
    # [진입 차단] 닉네임 미설정 + 비게스트 → 온보딩
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
st.session_state["_is_premium"]      = is_premium
st.session_state["_premium_applied"] = is_applied
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
nick_color = "#FCD34D" if is_guest else "#334155"
st.markdown(f"""
<div style="display:flex; align-items:center; justify-content:space-between;
            padding:10px 2px 12px;
            border-bottom:1px solid rgba(255,255,255,0.05);
            margin-bottom:12px;">
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

# ── 탭 네비게이션 (단일 레이어) ──
render_tab_nav(active_tab)

# =========================================================
# 탭 콘텐츠
# =========================================================

# ──────────────────────── 홈 ────────────────────────
if active_tab == "home":

    if GENAI_IMPORT_ERROR:
        st.info(TXT["fallback_ai"])

    # 시간대별 긴급도 배너 — 하루 3회 트리거 구조
    time_ctx = get_time_context()
    st.markdown(f"""
<div style="padding:8px 14px; border-radius:11px; margin-bottom:10px;
            background:rgba(239,68,68,0.07); border:1px solid rgba(239,68,68,0.18);">
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:3px;">
        <span style="font-size:0.68rem; color:#64748B; font-weight:600;">
            {time_ctx["label"]}
        </span>
    </div>
    <span style="font-size:0.78rem; color:#FCA5A5; font-weight:700; line-height:1.5;">
        {html.escape(time_ctx["pressure"])}
    </span>
</div>
""", unsafe_allow_html=True)

    # Premium 활성 배지
    if is_premium:
        st.markdown("""
<div style="padding:6px 14px; border-radius:10px; margin-bottom:10px;
            background:linear-gradient(90deg,rgba(99,102,241,0.20),rgba(56,189,248,0.12));
            border:1px solid rgba(99,102,241,0.35);
            font-size:0.75rem; color:#C7D2FE; font-weight:700; text-align:center;">
    ⚡ Premium 활성 · 패턴 교정 모드
</div>
""", unsafe_allow_html=True)

    # 사회적 증거 — 10명 이상일 때만
    if today_complete >= SOCIAL_PROOF_MIN:
        st.markdown(f"""
<div class="social-proof">
    오늘 <b>{today_complete}명</b>이 목표를 실행했습니다
</div>
""", unsafe_allow_html=True)

    # Streak 위기 — tcfg를 먼저 로드 후 전달 (NameError 방지)
    tcfg = get_target_config()
    if today_status == "none" and streak >= 3 and not st.session_state.running:
        render_streak_crisis(streak, tcfg)

    # Streak 공유
    if today_status == "success" and streak > 0:
        render_streak_share(streak, st.session_state.goal, success_rate)

    # 목표 입력
    st.session_state.goal = st.text_input(
        TXT["goal_label"],
        value=st.session_state.goal,
        placeholder=TXT["goal_placeholder"],
    )
    if st.session_state.goal != st.session_state["_prev_goal"]:
        st.session_state.lazy_command = ""
        st.session_state.lazy_reason  = ""
        st.session_state.lazy_warning = ""
        st.session_state["_prev_goal"] = st.session_state.goal

    # 어제 vs 오늘
    render_yesterday_vs_today(records, today_status)

    # 현실 점검 — fail_count에 따라 강도 달라짐
    # tcfg는 이미 위 streak 위기 배너에서 정의됨 (재사용)
    loss = get_loss_stats(records)

    if fail_count >= 3:
        pain_extra = f'<div class="body-small" style="color:#FCA5A5; margin-top:6px; font-weight:700;">이번 달 실패 {fail_count}회. 패턴이 굳어지고 있다.</div>'
    elif fail_count >= 1:
        pain_extra = f'<div class="body-small" style="color:#FCD34D; margin-top:6px;">이번 달 실패 {fail_count}회. 두 번째부터가 패턴이다.</div>'
    else:
        pain_extra = ""

    # 손실 지표 인라인 추가
    if loss["total_count"] >= 1:
        rate_color = "#86EFAC" if loss["success_rate"] >= 80 else                      "#FCD34D" if loss["success_rate"] >= 50 else "#FCA5A5"
        loss_inline = f"""
<div style="display:flex; gap:12px; margin-top:10px; padding-top:10px;
            border-top:1px solid rgba(255,255,255,0.06);">
    <div style="text-align:center; flex:1;">
        <div style="font-size:1.1rem; font-weight:900; color:{rate_color};">
            {loss["success_rate"]}%
        </div>
        <div style="font-size:0.65rem; color:#475569;">이달 성공률</div>
    </div>
    <div style="text-align:center; flex:1;">
        <div style="font-size:1.1rem; font-weight:900; color:#FCA5A5;">
            {loss["fail_hours"]}h
        </div>
        <div style="font-size:0.65rem; color:#475569;">날린 시간</div>
    </div>
    <div style="text-align:center; flex:1;">
        <div style="font-size:1.1rem; font-weight:900; color:#FCA5A5;">
            {loss["fail_prob"]}%
        </div>
        <div style="font-size:0.65rem; color:#475569;">목표 실패 확률</div>
    </div>
</div>"""
    else:
        loss_inline = ""

    st.markdown(f"""
<div class="warning-card">
    <div style="font-size:1rem; font-weight:900; color:#FCA5A5;">
        {html.escape(tcfg["pain"])}
    </div>
    <div class="body-small" style="margin-top:6px;">
        {html.escape(tcfg["pain_sub"])}
    </div>
    {pain_extra}
    {loss_inline}
</div>
""", unsafe_allow_html=True)

    # Premium 전용 — 오늘 위험도 배지
    if is_premium and records:
        hour = korea_now().hour
        # 가장 자주 실패하는 시간대를 간단히 추정 (오전/오후/저녁)
        fail_times = [
            str(r.get("time","")) for r in records
            if not record_to_bool_done(r) and r.get("time")
        ]
        if fail_times:
            # 시간대별 실패 분포
            morning = sum(1 for t in fail_times if t[11:13].isdigit() and int(t[11:13]) < 12)
            afternoon = sum(1 for t in fail_times if t[11:13].isdigit() and 12 <= int(t[11:13]) < 18)
            evening = sum(1 for t in fail_times if t[11:13].isdigit() and int(t[11:13]) >= 18)
            peak_zone = max(
                [("오전", morning), ("오후", afternoon), ("저녁", evening)],
                key=lambda x: x[1]
            )
            in_danger = (
                (peak_zone[0] == "오전"   and hour < 12) or
                (peak_zone[0] == "오후"   and 12 <= hour < 18) or
                (peak_zone[0] == "저녁"   and hour >= 18)
            )
            danger_color = "#FCA5A5" if in_danger else "#86EFAC"
            danger_text  = f"⚠️ 지금이 네가 가장 자주 무너지는 시간대다" if in_danger else f"✓ 지금은 상대적으로 안전한 시간대"
            st.markdown(f"""
<div style="padding:8px 14px; border-radius:10px; margin-bottom:8px;
            background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07);
            display:flex; align-items:center; gap:8px;">
    <span style="font-size:0.75rem; color:{danger_color}; font-weight:700;">
        ⚡ PREMIUM · {danger_text}
    </span>
</div>
""", unsafe_allow_html=True)

    # 명령 카드 — Premium이면 라벨 다르게
    cmd_label = "⚡ 패턴 교정 명령" if is_premium else "지금 해야 할 것"
    st.markdown(f"""
<div class="command-card">
    <div class="section-label">{cmd_label}</div>
    <div class="strong-title">{html.escape(command)}</div>
    <div class="body-small">{html.escape(reason)}</div>
    <div class="body-small" style="color:#FCA5A5;">{html.escape(warning)}</div>
</div>
""", unsafe_allow_html=True)

    # 상태 카드
    today_label = {
        "success": TXT["today_success"],
        "fail":    TXT["today_fail"],
        "none":    TXT["today_none"],
    }[today_status]

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
            <div class="metric-value" style="font-size:0.76rem;">{today_label}</div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)

    if today_status == "none" and 0 < streak < 3:
        st.markdown(f"""
<div class="warning-card">
    <div class="body-small" style="color:#FCA5A5;font-weight:700;">{TXT['streak_warning']}</div>
</div>
""", unsafe_allow_html=True)

    # 완료 메시지 → 다음 행동 유도
    if st.session_state.pop("_show_complete_msg", False):
        current_sc = get_success_fail_counts(records)[0]
        loss       = get_loss_stats(records)
        hour       = korea_now().hour

        # 시간대별 다음 행동 메시지
        if hour < 12:
            next_action = "오후에 한 번 더 열어봐라. 하루 2번이 패턴을 만든다."
        elif hour < 18:
            next_action = "저녁 전에 한 번 더 확인해라. 오늘 마무리가 내일을 결정한다."
        else:
            next_action = "내일 오전에 다시 열어라. 같은 시간에 오는 게 streak을 만든다."

        st.markdown(f"""
<div class="success-card" style="padding:16px;">
    <div style="font-size:1rem; font-weight:900; color:#86EFAC;">
        {html.escape(tcfg["complete"])}
    </div>
    <div style="font-size:0.78rem; color:#475569; margin-top:8px; line-height:1.6;">
        이번 달 성공 {current_sc}회 · 성공률 {loss["success_rate"]}%<br>
        <span style="color:#94A3B8;">{next_action}</span>
    </div>
</div>
""", unsafe_allow_html=True)

    # 실패 메시지 — fail_count 1회만 (2회 이상은 Premium 탭으로 이동)
    if st.session_state.pop("_show_fail_msg", False):
        current_fc = get_success_fail_counts(records)[1]
        loss       = get_loss_stats(records)

        st.markdown(f"""
<div style="padding:14px 16px; border-radius:16px; margin-bottom:10px;
            background:rgba(239,68,68,0.10); border:1px solid rgba(239,68,68,0.25);">
    <div style="font-size:0.9rem; font-weight:700; color:#FCA5A5;">
        또 같은 이유로 무너졌다. 이번 달 실패 {current_fc}회째다.
    </div>
    <div style="font-size:0.78rem; color:#94A3B8; margin-top:6px; line-height:1.6;">
        지금 날린 추정 시간: <b style="color:#FCA5A5;">{loss["fail_hours"]}시간</b><br>
        {"한 번은 괜찮다. 두 번째부터가 패턴이다." if current_fc == 1
          else "지금 30초짜리 1개라도 시작하면 오늘은 살릴 수 있다."}
    </div>
</div>
""", unsafe_allow_html=True)

        # 30초 복구 미션 버튼
        if current_fc >= 1:
            if st.button("⚡ 30초 복구 미션 시작", use_container_width=True,
                         key="btn_recovery_mission", type="primary"):
                st.session_state.running      = True
                st.session_state.start_time   = time.time()
                st.session_state.current_task = "30초만 시작해라. 딱 30초."
                st.session_state["_show_fail_select"]  = False
                st.session_state["_crisis_dismissed"]  = True
                st.rerun()

    # 액션
    st.markdown(f"""
<div style="text-align:center; margin:10px 0 8px;">
    <div style="font-size:0.8rem; color:#FCA5A5; font-weight:700;">{TXT['action_motivate']}</div>
</div>
""", unsafe_allow_html=True)

    if not st.session_state.running:
        # 단일 CTA — 시작 버튼 하나만 전면에
        start_label = time_ctx["cta"]
        if st.button(f"🚀 {start_label}", use_container_width=True,
                     key="btn_start", type="primary"):
            st.session_state.running      = True
            st.session_state.start_time   = time.time()
            st.session_state.current_task = command
            st.session_state["_show_fail_select"] = False
            st.session_state["_crisis_dismissed"] = True
            st.rerun()

        # refresh — 무료 제한 표시
        remaining_cmd = FREE_DAILY_CMD_LIMIT - get_daily_cmd_count()
        if is_premium:
            refresh_label = TXT["refresh"]
        elif remaining_cmd > 0:
            refresh_label = "↻ 새 명령 (오늘 추가 가능)"
        else:
            refresh_label = "🔒 오늘 무료 명령 종료"

        if st.button(refresh_label, use_container_width=True,
                     key="btn_refresh", type="secondary"):
            if not is_premium and remaining_cmd <= 0:
                # 제한 도달 — 강한 메시지 후 Premium 탭 이동
                st.session_state["_fail_reason_for_premium"] = "AI 명령 일일 제한 도달"
                st.session_state["_active_tab"] = "premium"
            else:
                st.session_state.command_ready = True
            st.rerun()

        # 명령 소진 시 배너 표시
        if not is_premium and remaining_cmd <= 0:
            st.markdown("""
<div class="warning-card" style="text-align:center; padding:12px 16px; margin-top:6px;">
    <div style="font-size:0.82rem; color:#FCA5A5; font-weight:700;">
        오늘 무료 명령이 모두 사용됐습니다<br>
        <span style="color:#94A3B8; font-weight:400;">
            Premium은 무제한 개인화 명령을 제공합니다
        </span>
    </div>
</div>
""", unsafe_allow_html=True)
    else:
        # 타이머: 페이지 진입 시 경과 시간 계산만. rerun/sleep 없음.
        elapsed = int(time.time() - st.session_state.start_time)
        render_focus_card(elapsed, st.session_state.current_task)

        col1, col2 = st.columns(2)
        with col1:
            if st.button(TXT["complete"], use_container_width=True, key="btn_complete"):
                # 게스트: 세션 records에만 저장 (시트 저장은 닉네임 설정 후)
                if is_guest:
                    st.session_state.records.append({
                        "time": korea_now().strftime("%Y-%m-%d %H:%M"),
                        "date": today_str(),
                        "nickname": "guest",
                        "task": st.session_state.current_task,
                        "done": "True",
                        "fail_reason": "",
                        "source": "control",
                        "synced": False,   # 시트 저장 전 플래그
                    })
                    st.session_state.running      = False
                    st.session_state.current_task = ""
                    st.session_state["_show_nickname_collect"] = True
                    st.rerun()
                else:
                    _ok, _updated = save_record(st.session_state.current_task, True)
                    st.session_state.running      = False
                    st.session_state.current_task = ""
                    st.session_state["_show_fail_select"]  = False
                    st.session_state["_crisis_dismissed"]  = False
                    st.session_state["_show_complete_msg"] = True
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
                    # 게스트: 세션에만 저장 후 닉네임 수집
                    st.session_state.records.append({
                        "time": korea_now().strftime("%Y-%m-%d %H:%M"),
                        "date": today_str(),
                        "nickname": "guest",
                        "task": st.session_state.current_task,
                        "done": "False",
                        "fail_reason": fail_reason,
                        "source": "control",
                        "synced": False,   # 시트 저장 전 플래그
                    })
                    st.session_state.running      = False
                    st.session_state.current_task = ""
                    st.session_state["_show_fail_select"]  = False
                    st.session_state["_show_nickname_collect"] = True
                    st.rerun()
                else:
                    _ok, updated_records = save_record(
                        st.session_state.current_task, False, fail_reason
                    )
                    st.session_state.running      = False
                    st.session_state.current_task = ""
                    st.session_state["_show_fail_select"]  = False
                    st.session_state["_crisis_dismissed"]  = False

                    # 실패 2회 이상 & 비 Premium → 즉시 Premium 탭으로 강제 이동
                    # save_record()가 반환한 updated_records 기준으로 판단
                    # → API 재호출 없이 세션 버퍼 / 시트 불일치 없는 정확한 카운트
                    updated_fail_count = get_success_fail_counts(updated_records)[1]
                    if updated_fail_count >= 2 and not is_premium:
                        st.session_state["_fail_reason_for_premium"] = fail_reason
                        st.session_state["_fail_count_for_premium"]  = updated_fail_count
                        st.session_state["_active_tab"] = "premium"
                    else:
                        st.session_state["_show_fail_msg"] = True
                    st.rerun()

# ──────────────────────── 기록 ────────────────────────
elif active_tab == "record":
    st.markdown('<div class="section-label" style="margin-bottom:10px;">최근 기록</div>',
                unsafe_allow_html=True)

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
        if st.button("전체 기록 보기 → Premium", use_container_width=True,
                     key="btn_record_premium"):
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
            <div style="font-size:0.7rem; color:#475569; margin-top:2px;">이달 목표 실패 확률</div>
        </div>
    </div>
    <div style="font-size:0.82rem; color:#94A3B8; font-weight:600;
                padding-top:10px; border-top:1px solid rgba(255,255,255,0.06);">
        {html.escape(loss["danger_msg"])}
    </div>
</div>
""", unsafe_allow_html=True)

        # 복구 비용 표시 (실패가 있을 때)
        if loss["fail_count"] > 0:
            if loss["recovery_days"] > 0:
                recovery_msg = f"지금 streak이 끊겼다. 복구까지 최소 {loss['recovery_days']}일 필요하다."
            else:
                recovery_msg = f"이번 달 실패 {loss['fail_count']}회 → 오늘 성공률 {loss['success_rate']}%. 남은 {loss['days_left']}일이 전부다."

            st.markdown(f"""
<div style="padding:10px 14px; border-radius:12px; margin-bottom:10px;
            background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.20);">
    <div style="font-size:0.8rem; color:#FCA5A5; font-weight:700;">
        ⚠️ 복구 비용
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
            if st.button("🔒 원인 분석 열기 → Premium 신청",
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
        # [진입 차단] 게스트는 Premium 탭 이후 내용 렌더링 중단
        st.stop()

    # ── 이미 Premium 활성화된 사용자 ──
    if is_premium:
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
<div class="card" style="text-align:center; padding:24px 16px;">
    <div style="font-size:1.8rem; margin-bottom:8px;">⏳</div>
    <div class="strong-title" style="margin-top:0;">{TXT['premium_applied_title']}</div>
    <div class="body-small" style="margin-top:8px; white-space:pre-line;">
        {TXT['premium_applied_body']}
    </div>
</div>
""", unsafe_allow_html=True)

        # 결제 미완료 시 다시 결제 버튼 제공
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

    # ── 신규 신청 화면 ──
    else:
        # ── Premium 탭 최상단 손실 지표 — 항상 표시 ──
        loss = get_loss_stats(records)
        if loss["total_count"] >= 1:
            rate_color = "#86EFAC" if loss["success_rate"] >= 80 else                          "#FCD34D" if loss["success_rate"] >= 50 else "#FCA5A5"
            st.markdown(f"""
<div style="padding:16px; border-radius:16px; margin-bottom:12px;
            background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.20);">
    <div style="font-size:0.72rem; color:#FCA5A5; font-weight:700;
                letter-spacing:0.06em; margin-bottom:10px;">
        지금 내 현실
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; text-align:center;">
        <div>
            <div style="font-size:1.4rem; font-weight:900; color:{rate_color};">
                {loss["success_rate"]}%
            </div>
            <div style="font-size:0.65rem; color:#475569; margin-top:2px;">이달 성공률</div>
        </div>
        <div>
            <div style="font-size:1.4rem; font-weight:900; color:#FCA5A5;">
                {loss["fail_hours"]}h
            </div>
            <div style="font-size:0.65rem; color:#475569; margin-top:2px;">날린 시간</div>
        </div>
        <div>
            <div style="font-size:1.4rem; font-weight:900; color:#FCA5A5;">
                {loss["fail_prob"]}%
            </div>
            <div style="font-size:0.65rem; color:#475569; margin-top:2px;">목표 실패 확률</div>
        </div>
    </div>
    <div style="font-size:0.78rem; color:#94A3B8; margin-top:10px;
                padding-top:10px; border-top:1px solid rgba(255,255,255,0.06);">
        {html.escape(loss["danger_msg"])}
    </div>
</div>
""", unsafe_allow_html=True)

        # ── 실패 직후 진입 시 팩트폭행 카드 ──
        fail_reason_trigger = st.session_state.pop("_fail_reason_for_premium", None)
        fail_count_trigger  = st.session_state.pop("_fail_count_for_premium", None)

        if fail_reason_trigger and fail_count_trigger:
            st.markdown(f"""
<div class="warning-card" style="text-align:center; padding:20px 16px;">
    <div style="font-size:1.6rem; margin-bottom:8px;">📉</div>
    <div class="strong-title" style="font-size:1rem; color:#FCA5A5;">
        '{fail_reason_trigger}'으로 이번 달 {fail_count_trigger}번째 실패다
    </div>
    <div class="body-small" style="margin-top:8px; color:#94A3B8;">
        이건 의지 문제가 아니다.<br>
        같은 이유로 반복되는 패턴은 혼자 끊기 어렵다.<br>
        <span style="color:#FCA5A5; font-weight:700;">
            지금이 그 패턴을 끊을 수 있는 시점이다.
        </span>
    </div>
</div>
""", unsafe_allow_html=True)

        # 헤더
        st.markdown(f"""
<div style="text-align:center; padding:16px 0 12px;">
    <div style="font-size:0.68rem; color:#38BDF8; font-weight:700;
                letter-spacing:0.08em;">VANGUARD PREMIUM</div>
    <div class="strong-title" style="font-size:1.1rem;">{TXT['premium_page_title']}</div>
    <div class="body-small">{TXT['premium_tagline']}</div>
</div>
""", unsafe_allow_html=True)

        # 결과 차이표 — 기능이 아니라 결과로 비교
        st.markdown("""
<div class="card">
    <div class="section-label">지금 무료로 못 하는 것</div>
    <table class="compare-table">
        <tr>
            <td class="ct-label"></td>
            <td class="ct-free">무료</td>
            <td class="ct-prem">Premium</td>
        </tr>
        <tr>
            <td class="ct-label">왜 계속 실패하는지</td>
            <td class="ct-free">🔒 모름</td>
            <td class="ct-prem">✓ 원인 분석</td>
        </tr>
        <tr>
            <td class="ct-label">가장 위험한 시간대</td>
            <td class="ct-free">🔒 모름</td>
            <td class="ct-prem">✓ 실시간 감지</td>
        </tr>
        <tr>
            <td class="ct-label">AI 명령</td>
            <td class="ct-free">일일 제한 있음</td>
            <td class="ct-prem">✓ 무제한 · 개인화</td>
        </tr>
        <tr>
            <td class="ct-label">전체 기록 열람</td>
            <td class="ct-free">최근 7일</td>
            <td class="ct-prem">✓ 전체 기간</td>
        </tr>
        <tr>
            <td class="ct-label">실패 전 미리 개입</td>
            <td class="ct-free">🔒 없음</td>
            <td class="ct-prem">✓ 복귀 프로토콜</td>
        </tr>
        <tr>
            <td class="ct-label">이메일 리마인드</td>
            <td class="ct-free">🔒 없음</td>
            <td class="ct-prem">✓ 매일 발송</td>
        </tr>
    </table>
</div>
""", unsafe_allow_html=True)

        # 가격 카드
        st.markdown(f"""
<div class="card" style="text-align:center; padding:20px 16px;">
    <div class="body-small">월 구독</div>
    <div style="font-size:2rem; font-weight:900; color:#86EFAC; margin:6px 0;">
        ₩{PREMIUM_PRICE:,}
    </div>
    <div class="body-small" style="color:#475569;">초기 사용자 가격 · 이후 조정 예정</div>
</div>
""", unsafe_allow_html=True)

        # 결제 버튼 + 이메일 (선택)
        st.markdown("""
<div class="card">
    <div class="section-label">신청 방법</div>
    <div class="body-small">
        ① 신청하기 버튼 → 구글폼 작성 + 계좌 입금<br>
        ② 입금 확인 후 <b style="color:#86EFAC;">1~3시간 내</b> 수동 활성화<br>
        ③ 앱 새로고침 → Premium 즉시 열림
    </div>
    <div class="body-small" style="color:#475569; margin-top:6px;">
        이메일을 남기면 활성화 알림을 드립니다 (선택)
    </div>
</div>
""", unsafe_allow_html=True)

        # 이메일 (선택 입력 — 알림용)
        email_input = st.text_input(
            "이메일 (선택)",
            placeholder="활성화 알림을 받을 이메일 (선택사항)",
            label_visibility="collapsed",
        )

        # 결제 링크 버튼 — 클릭 시 Stripe/Toss로 이동
        st.link_button(
            f"📋 Premium 신청하기  ₩{PREMIUM_PRICE:,}/월",
            url=PREMIUM_PAYMENT_URL,
            use_container_width=True,
        )

        # 결제 후 "신청 완료" 버튼 — 결제 완료 후 눌러달라고 안내
        st.caption("신청서 제출 + 입금 완료 후 아래 버튼을 눌러주세요.")
        if st.button("✅ 신청 및 입금 완료했습니다", use_container_width=True,
                     key="btn_premium_apply"):
            # 단계별 디버그 — 실패 지점 정확히 표시
            try:
                # 1단계: 시트 연결 확인
                spreadsheet = get_spreadsheet()
                st.caption(f"✓ 시트 연결 OK")

                # 2단계: Users 탭 확인
                ws = spreadsheet.get_worksheet(1)
                if ws is None:
                    ws = spreadsheet.add_worksheet(title="Users", rows=1000, cols=6)
                    st.caption(f"✓ Users 탭 자동 생성")
                else:
                    st.caption(f"✓ Users 탭 OK: {ws.title}")

                # 3단계: 저장
                if has_premium_apply(nickname):
                    get_user_premium_status.clear()
                    st.rerun()
                else:
                    ok = save_premium_apply(
                        nickname=nickname,
                        email=email_input.strip() if email_input.strip() and "@" in email_input else "",
                        goal=st.session_state.goal,
                    )
                    if ok:
                        get_user_premium_status.clear()
                        st.rerun()
                    else:
                        err = st.session_state.get("last_error", "알 수 없는 오류")
                        st.error(f"저장 실패: {err}")
            except Exception as e:
                st.error(f"연결 실패: {type(e).__name__}: {str(e)}")
                st.caption("위 에러 내용을 캡처해서 알려주세요.")

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