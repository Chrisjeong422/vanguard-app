import html
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Tuple
from collections import defaultdict

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

# =========================================================
# SETTINGS
# =========================================================
PREMIUM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdcmuSW_54mjUdVxG9xyuiq2KnoCe5OK9hu38y2e4LGMsBnsg/viewform?usp=dialog"
NEXUS_SHEET_URL = "https://docs.google.com/spreadsheets/d/1MPJ94HeiRs_xjZfkBCWKQNhKHf45H9YhZgoZ2M_tNSI/edit?usp=sharing"
SHEET_NAME = "NexusMemory"
GOOGLE_SERVICE_ACCOUNT_FILE = "google_service_account.json"
SHEETS_SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

# =========================================================
# SAFE SECRETS LOAD
# =========================================================
def get_secret(key: str, default: str = "") -> str:
    try:
        if key in st.secrets:
            return st.secrets[key]
    except Exception:
        pass
    return os.getenv(key, default)

GEMINI_API_KEY = get_secret("GEMINI_API_KEY", "")

# =========================================================
# THEME / STYLE
# =========================================================
st.markdown(
    """
<style>
#MainMenu {visibility: hidden;}
header {visibility: hidden;}
footer {visibility: hidden;}

html, body, [class*="css"] {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
}

.stApp {
    background: linear-gradient(180deg, #0B1020 0%, #111827 100%);
    color: #F8FAFC;
}

.block-container {
    max-width: 620px;
    padding-top: 0.18rem !important;
    padding-bottom: 1.1rem;
}

.topbar {
    padding: 14px 16px;
    border-radius: 20px;
    background: rgba(8,12,24,0.58);
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 8px 30px rgba(0,0,0,0.20);
    backdrop-filter: blur(12px);
    margin-bottom: 10px;
}

.topbar-title {
    font-size: 1.3rem;
    font-weight: 900;
    letter-spacing: -0.03em;
    color: #F8FAFC;
    line-height: 1.15;
    word-break: keep-all;
}

.topbar-sub {
    font-size: 0.82rem;
    font-weight: 700;
    color: #38BDF8;
    margin-top: 5px;
}

.topbar-meta {
    font-size: 0.76rem;
    color: #94A3B8;
    margin-top: 8px;
}

.card {
    padding: 18px;
    border-radius: 22px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 8px 30px rgba(0,0,0,0.18);
    margin-bottom: 12px;
}

.command-card {
    padding: 22px;
    border-radius: 24px;
    background: linear-gradient(135deg, rgba(14,165,233,0.20), rgba(59,130,246,0.10));
    border: 1px solid rgba(56,189,248,0.35);
    box-shadow: 0 12px 40px rgba(2,132,199,0.14);
    margin-bottom: 12px;
}

.warning-card {
    padding: 18px;
    border-radius: 20px;
    background: rgba(239,68,68,0.10);
    border: 1px solid rgba(239,68,68,0.35);
    margin-bottom: 12px;
}

.success-card {
    padding: 18px;
    border-radius: 20px;
    background: rgba(34,197,94,0.10);
    border: 1px solid rgba(34,197,94,0.30);
    margin-bottom: 12px;
}

.muted {
    color: #94A3B8;
    font-size: 0.84rem;
}

.strong-title {
    font-size: 1.2rem;
    font-weight: 900;
    line-height: 1.32;
    margin-top: 10px;
    color: #FFFFFF;
}

.body-small {
    color: #CBD5E1;
    font-size: 0.88rem;
    line-height: 1.5;
    margin-top: 8px;
}

.metric-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
}

.metric {
    padding: 14px 10px;
    border-radius: 16px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    text-align: center;
}

.metric-label {
    color: #94A3B8;
    font-size: 0.75rem;
}

.metric-value {
    color: #FFFFFF;
    font-size: 1.08rem;
    font-weight: 900;
    margin-top: 6px;
}

.premium-pill {
    display: inline-block;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    font-size: 0.76rem;
    color: #E2E8F0;
    margin-right: 6px;
    margin-bottom: 6px;
}

.section-title {
    color: #E2E8F0;
    font-size: 1rem;
    font-weight: 800;
    margin-bottom: 6px;
}

.stButton > button {
    width: 100%;
    min-height: 58px;
    border-radius: 18px;
    font-size: 1rem;
    font-weight: 900;
    border: 1px solid rgba(255,255,255,0.10);
}

a[data-testid="stLinkButton"] {
    display: block;
    border-radius: 18px;
    text-align: center;
    font-weight: 900;
}

div[data-baseweb="tab-list"] {
    gap: 6px;
    flex-wrap: wrap;
}

button[data-baseweb="tab"] {
    border-radius: 14px !important;
    background: rgba(255,255,255,0.04) !important;
    padding: 10px 14px !important;
}

@media (max-width: 640px) {
    .block-container {
        max-width: 100%;
        padding-top: 0.1rem !important;
    }

    .topbar-title {
        font-size: 1.18rem;
    }

    .topbar-sub {
        font-size: 0.78rem;
    }

    .card, .command-card, .warning-card, .success-card {
        padding: 16px;
    }
}
</style>
""",
    unsafe_allow_html=True,
)

# =========================================================
# TEXT
# =========================================================
TXT = {
    "title": "⚡ Vanguard",
    "tagline": "Break the Loop",
    "goal_label": "이번 달 가장 중요한 목표 1개",
    "goal_placeholder": "예: 4월 안에 앱 출시",
    "start_now": "🚀 지금 시작",
    "refresh": "↻ 새 명령",
    "complete": "✅ 완료",
    "fail": "❌ 실패",
    "running": "실행 중",
    "today_none": "오늘 아직 기록 없음",
    "today_success": "오늘 성공 기록 있음",
    "today_fail": "오늘 실패 기록 있음",
    "streak_warning": "오늘 실행하지 않으면 연속 기록이 끊긴다.",
    "history_title": "📜 최근 기록",
    "policy_title": "ℹ 운영 안내",
    "policy_text": "베타 버전입니다. 기록과 Premium 신청 정보는 기능 개선과 응답 확인 용도로 사용됩니다.",
    "fallback_sheet_notice": "Google Sheets 연결이 없어도 앱은 계속 동작합니다. 현재는 로컬 세션 기록으로 저장 중입니다.",
    "fallback_ai_notice": "Gemini 기능 일부가 비활성화되어 기본 응답으로 동작합니다.",
    "analysis_closed": "상세 분석은 아래에서 필요할 때만 열립니다.",
    "pain_line": "너는 지금 중요한 걸 미루고 있다.",
    "pain_sub": "이 상태로 하루가 끝나면 오늘도 또 같은 패턴이 반복된다.",
    "premium_title": "🔒 Premium",
    "premium_body": "무료는 시작만 시킨다. Premium은 반복 실패 원인을 분석하고, 다시 무너지는 패턴을 끊는 데 집중한다.",
    "premium_button": "👉 Premium 신청하기",
    "premium_urgency": "초기 사용자 가격과 혜택은 이후 조정될 수 있습니다.",
    "premium_benefit_1": "반복 실패 패턴 분석",
    "premium_benefit_2": "맞춤 실행 전략 제공",
    "premium_benefit_3": "무너지는 시간대 교정",
    "premium_benefit_4": "베타 우선 적용",
    "premium_fail_title": "반복 실패를 끊고 싶다면",
    "premium_fail_body": "의지가 약한 게 아니라, 같은 패턴이 반복되는 중일 수 있습니다. Premium은 그 패턴을 찾아 끊는 데 초점을 둡니다.",
    "premium_flow_title": "이 흐름을 잃기 싫다면",
    "premium_flow_body": "좋은 흐름은 만들기보다 유지가 어렵습니다. Premium은 흐름이 꺾이는 지점을 미리 잡는 데 초점을 둡니다.",
    # 인라인 하드코딩 문자열을 TXT로 이동 (품질 개선)
    "action_motivate": "생각하지 말고 2분만 시작해라",
    "complete_message": "이건 의지가 아니라 실행이다. 오늘은 끊었다.",
    "fail_message": "같은 패턴 반복 중",
}

# =========================================================
# SESSION STATE
# =========================================================
DEFAULTS = {
    "running": False,
    "start_time": 0.0,
    "current_task": "",
    "records": [],
    "show_onboarding": True,
    "goal": "",
    "last_error": "",
    "lazy_command": "",
    "lazy_reason": "",
    "lazy_warning": "",
    "command_ready": False,
    # [FIX] 완료/실패 후 메시지를 rerun 이후에도 표시하기 위한 플래그
    "_show_complete_msg": False,
    "_show_fail_msg": False,
    # [FIX] ensure_sheet_header 중복 API 호출 방지 플래그
    "_header_ensured": False,
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

# =========================================================
# RECORD UTILS
# =========================================================
def set_error(msg: str) -> None:
    st.session_state.last_error = msg


def reset_error() -> None:
    st.session_state.last_error = ""


def parse_done(value: Any) -> bool:
    """[FIX] 'False' 문자열을 명시적으로 처리하여 조용한 True 반환 방지"""
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s in {"false", "0", "no", "n"}:
        return False
    return s in {"true", "1", "yes", "y"}


def record_to_bool_done(row: Dict[str, Any]) -> bool:
    return parse_done(row.get("done", False))


def get_recent_records(records: List[Dict[str, Any]], limit: int = 10) -> List[Dict[str, Any]]:
    return records[-limit:] if records else []


def get_daily_map(records: List[Dict[str, Any]]) -> Dict[str, List[bool]]:
    daily: Dict[str, List[bool]] = defaultdict(list)
    for row in records:
        date_str = str(row.get("date", "")).strip()
        if date_str:
            daily[date_str].append(record_to_bool_done(row))
    return daily


def calculate_streak(records: List[Dict[str, Any]]) -> int:
    """[FIX] 오늘 날짜 기준으로 streak 계산 (이전: 마지막 기록 날짜 기준)"""
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
    if any(record_to_bool_done(r) for r in rows):
        return "success"
    return "fail"


def get_success_fail_counts(records: List[Dict[str, Any]]) -> Tuple[int, int]:
    success = sum(1 for r in records if record_to_bool_done(r))
    fail = sum(1 for r in records if not record_to_bool_done(r))
    return success, fail


def get_success_rate(records: List[Dict[str, Any]]) -> int:
    success, fail = get_success_fail_counts(records)
    total = success + fail
    return int(success / total * 100) if total > 0 else 0


def get_top_fail_reason(records: List[Dict[str, Any]]) -> str:
    counts: Dict[str, int] = {}
    for r in records:
        if not record_to_bool_done(r):
            reason = str(r.get("fail_reason", "")).strip()
            if reason:
                counts[reason] = counts.get(reason, 0) + 1
    return max(counts, key=counts.get) if counts else ""


def get_weekly_stats(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not records:
        return {"success_rate": 0, "success_count": 0, "fail_count": 0, "top_fail_reason": ""}
    today = korea_now().date()
    week_start = today - timedelta(days=6)
    weekly_rows: List[Dict[str, Any]] = []
    for r in records:
        try:
            d = datetime.strptime(str(r.get("date")), "%Y-%m-%d").date()
            if week_start <= d <= today:
                weekly_rows.append(r)
        except Exception:
            continue
    success, fail = get_success_fail_counts(weekly_rows)
    total = success + fail
    success_rate = int(success / total * 100) if total > 0 else 0
    return {
        "success_rate": success_rate,
        "success_count": success,
        "fail_count": fail,
        "top_fail_reason": get_top_fail_reason(weekly_rows),
    }


def fast_command(goal: str) -> Tuple[str, str, str]:
    command = f"지금 '{goal or '핵심 작업'}'을 2분만 시작해."
    reason = "처음 2분만 넘기면 시작 장벽이 크게 줄어든다."
    warning = "지금 미루면 오늘도 바쁜 척만 하다가 끝난다."
    return command, reason, warning

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
    """Gemini 응답 파싱 공통 유틸. 파싱 실패 시 set_error로 경고."""
    parsed = {k: "" for k in keys}
    for line in text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            key = k.strip().upper()
            if key in parsed:
                parsed[key] = v.strip()
    # [FIX] 파싱 결과가 모두 비어있으면 경고 기록
    if not any(parsed.values()):
        set_error(f"Gemini 응답 파싱 실패 (처음 100자): {text[:100]}")
    return parsed


@st.cache_data(ttl=60)
def generate_command(goal: str, streak: int, success_rate: int) -> Tuple[str, str, str]:
    """[FIX] TTL을 120→60초로 단축하여 목표 변경 시 캐시 오염 최소화"""
    fallback_command, fallback_reason, fallback_warning = fast_command(goal)
    client = get_genai_client()
    if client is None:
        return fallback_command, fallback_reason, fallback_warning
    prompt = f"""
너는 행동 통제 AI 'Vanguard'다.
위로가 아니라 실행 강제가 목적이다.

목표: {goal or '핵심 목표 미입력'}
현재 streak: {streak}
최근 성공률: {success_rate}%

다음 형식만 출력:
COMMAND: 지금 해야 할 행동 1개
REASON: 왜 지금 해야 하는지
WARNING: 지금 안 하면 어떻게 되는지
"""
    try:
        res = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        text = (res.text or "").strip()
        parsed = _parse_gemini_response(text, ["COMMAND", "REASON", "WARNING"])
        return (
            parsed["COMMAND"] or fallback_command,
            parsed["REASON"] or fallback_reason,
            parsed["WARNING"] or fallback_warning,
        )
    except Exception:
        return fallback_command, fallback_reason, fallback_warning


@st.cache_data(ttl=180)
def generate_weekly_report(goal: str, success_rate: int, success_count: int, fail_count: int, top_fail_reason: str) -> Tuple[str, str]:
    fallback_focus = "최근 7일 동안 성공과 실패가 섞여 있으며, 반복 실패 이유가 존재한다."
    fallback_action = "내일은 가장 중요한 작업을 2분짜리 시작 블록으로 먼저 시작해라."
    client = get_genai_client()
    if client is None:
        return fallback_focus, fallback_action
    prompt = f"""
너는 실행 리포트 분석가다.

목표: {goal or '목표 미입력'}
최근 7일 성공률: {success_rate}%
최근 7일 성공 수: {success_count}
최근 7일 실패 수: {fail_count}
가장 흔한 실패 이유: {top_fail_reason or '없음'}

다음 형식만 출력:
FOCUS: 최근 7일 핵심 패턴 1개
ACTION: 다음 7일 추천 행동 1개
"""
    try:
        res = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        text = (res.text or "").strip()
        parsed = _parse_gemini_response(text, ["FOCUS", "ACTION"])
        return parsed["FOCUS"] or fallback_focus, parsed["ACTION"] or fallback_action
    except Exception:
        return fallback_focus, fallback_action


@st.cache_data(ttl=180)
def generate_premium_insight(goal: str, recent_records_repr: str) -> Tuple[str, str]:
    fallback_weakness = "반복 실패 이유가 쌓이고 있다."
    fallback_fix = "실패가 많은 이유를 줄이고 시작 단위를 더 작게 만들어라."
    client = get_genai_client()
    if client is None:
        return fallback_weakness, fallback_fix
    prompt = f"""
너는 Premium 행동 분석가다.

목표: {goal or '목표 미입력'}
최근 기록: {recent_records_repr}

다음 형식만 출력:
WEAKNESS: 반복 약점 1개
FIX: 지금 적용할 교정 전략 1개
"""
    try:
        res = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        text = (res.text or "").strip()
        parsed = _parse_gemini_response(text, ["WEAKNESS", "FIX"])
        return parsed["WEAKNESS"] or fallback_weakness, parsed["FIX"] or fallback_fix
    except Exception:
        return fallback_weakness, fallback_fix

# =========================================================
# GOOGLE SHEETS
# =========================================================
def _normalize_service_account_dict(raw: Dict[str, Any]) -> Dict[str, Any]:
    creds_dict = dict(raw)
    private_key = creds_dict.get("private_key", "")
    if isinstance(private_key, str):
        creds_dict["private_key"] = private_key.replace("\\n", "\n")
    return creds_dict


@st.cache_resource
def get_gspread_client():
    if gspread is None or ServiceAccountCredentials is None:
        raise RuntimeError("gspread unavailable")

    # Streamlit Cloud secrets 우선
    try:
        if "gcp_service_account" in st.secrets:
            creds_dict = _normalize_service_account_dict(st.secrets["gcp_service_account"])
            creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, SHEETS_SCOPES)
            return gspread.authorize(creds)
    except Exception:
        pass

    # 로컬 파일 fallback
    if os.path.exists(GOOGLE_SERVICE_ACCOUNT_FILE):
        creds = ServiceAccountCredentials.from_json_keyfile_name(GOOGLE_SERVICE_ACCOUNT_FILE, SHEETS_SCOPES)
        return gspread.authorize(creds)

    raise FileNotFoundError(GOOGLE_SERVICE_ACCOUNT_FILE)


@st.cache_resource
def get_sheet():
    client = get_gspread_client()
    if NEXUS_SHEET_URL and "docs.google.com/spreadsheets" in NEXUS_SHEET_URL:
        spreadsheet = client.open_by_url(NEXUS_SHEET_URL)
    else:
        spreadsheet = client.open(SHEET_NAME)
    worksheet = spreadsheet.get_worksheet(0)
    if worksheet is None:
        raise RuntimeError("worksheet not found")
    return worksheet


def ensure_sheet_header():
    """[FIX] 세션당 1회만 헤더 체크 — 매 save_record 호출마다 API 요청하던 문제 개선"""
    if st.session_state.get("_header_ensured"):
        return
    sheet = get_sheet()
    values = sheet.get_all_values()
    if not values:
        sheet.append_row(["time", "date", "task", "done", "fail_reason", "source"])
    st.session_state["_header_ensured"] = True


@st.cache_data(ttl=20)
def load_sheet_records() -> List[Dict[str, Any]]:
    ensure_sheet_header()
    sheet = get_sheet()
    rows = sheet.get_all_records()
    return rows if rows else []


def load_records() -> Tuple[List[Dict[str, Any]], bool]:
    try:
        rows = load_sheet_records()
        return rows, True
    except Exception as e:
        set_error(f"Sheet load failed: {e}")
        return st.session_state.records, False


def save_record(task: str, done: bool, fail_reason: str = "", source: str = "control") -> bool:
    row = {
        "time": korea_now().strftime("%Y-%m-%d %H:%M"),
        "date": today_str(),
        "task": task,
        "done": str(done),
        "fail_reason": fail_reason,
        "source": source,
    }
    st.session_state.records.append(row)
    try:
        ensure_sheet_header()
        sheet = get_sheet()
        sheet.append_row([
            row["time"],
            row["date"],
            row["task"],
            row["done"],
            row["fail_reason"],
            row["source"],
        ])
        load_sheet_records.clear()
        return True
    except Exception as e:
        set_error(f"Sheet save failed: {e}")
        return False

# =========================================================
# LIGHT FIRST LOAD
# [FIX] load_records()를 상단에서 1회만 호출 — expander/tab 중복 호출 제거
# =========================================================
reset_error()
records, using_sheet = load_records()

streak = calculate_streak(records)
today_status = get_today_status(records)
success_count, fail_count = get_success_fail_counts(records)
success_rate = get_success_rate(records)
recent_records = get_recent_records(records, 10)

fast_cmd, fast_reason, fast_warning = fast_command(st.session_state.goal)
command = fast_cmd
reason = fast_reason
warning = fast_warning

if st.session_state.command_ready:
    with st.spinner("AI 명령 생성 중..."):
        command, reason, warning = generate_command(
            goal=st.session_state.goal,
            streak=streak,
            success_rate=success_rate,
        )
        st.session_state.lazy_command = command
        st.session_state.lazy_reason = reason
        st.session_state.lazy_warning = warning
        st.session_state.command_ready = False
elif st.session_state.lazy_command:
    command = st.session_state.lazy_command
    reason = st.session_state.lazy_reason
    warning = st.session_state.lazy_warning

# =========================================================
# HEADER
# =========================================================
st.markdown(
    f"""
<div class="topbar">
    <div class="topbar-title">{TXT['title']}</div>
    <div class="topbar-sub">{TXT['tagline']}</div>
    <div class="topbar-meta">🔥 {streak} · {now_time()}</div>
</div>
""",
    unsafe_allow_html=True,
)

if st.session_state.show_onboarding:
    with st.expander("앱처럼 쓰기 / Quick start", expanded=False):
        st.write(
            "iPhone/Safari: 공유 → 홈 화면에 추가\n\n"
            "Android/Chrome: 메뉴 → 홈 화면에 추가\n\n"
            "홈 화면에 추가하면 주소창 없이 더 앱처럼 사용할 수 있습니다."
        )
        if st.button("온보딩 닫기", use_container_width=True):
            st.session_state.show_onboarding = False
            st.rerun()

st.info("📱 Safari에서 홈 화면에 추가하면 앱처럼 사용할 수 있습니다")

if GENAI_IMPORT_ERROR:
    st.info(TXT["fallback_ai_notice"])

st.info("데이터는 현재 임시 저장됩니다 (베타 버전)")

if st.session_state.last_error:
    with st.expander("System message", expanded=False):
        st.code(st.session_state.last_error)

# =========================================================
# GOAL INPUT
# =========================================================
st.session_state.goal = st.text_input(
    TXT["goal_label"],
    value=st.session_state.goal,
    placeholder=TXT["goal_placeholder"],
)

# =========================================================
# MAIN COMMAND CARD
# [FIX] 사용자 입력(command 등)을 html.escape()로 이스케이프하여 XSS 방지
# =========================================================
safe_command = html.escape(command)
safe_reason = html.escape(reason)
safe_warning = html.escape(warning)

st.markdown(
    f"""
<div class="warning-card">
    <div class="muted">현실 점검</div>
    <div class="strong-title">{TXT['pain_line']}</div>
    <div class="body-small">{TXT['pain_sub']}</div>
</div>
""",
    unsafe_allow_html=True,
)

st.markdown(
    f"""
<div class="command-card">
    <div class="muted">지금 해야 할 것</div>
    <div class="strong-title">{safe_command}</div>
    <div class="body-small">{safe_reason}</div>
    <div class="body-small" style="color:#FCA5A5;">{safe_warning}</div>
</div>
""",
    unsafe_allow_html=True,
)

# =========================================================
# PREMIUM CTA ALWAYS VISIBLE
# =========================================================
premium_pills_top = f"""
<span class=\"premium-pill\">{TXT['premium_benefit_1']}</span>
<span class=\"premium-pill\">{TXT['premium_benefit_2']}</span>
<span class=\"premium-pill\">{TXT['premium_benefit_3']}</span>
<span class=\"premium-pill\">{TXT['premium_benefit_4']}</span>
"""

st.markdown(
    f"""
<div class="card">
    <div class="section-title">{TXT['premium_title']}</div>
    <div class="body-small">{TXT['premium_body']}</div>
    <div style="margin-top:10px;">{premium_pills_top}</div>
    <div class="body-small" style="color:#FDE68A;">{TXT['premium_urgency']}</div>
</div>
""",
    unsafe_allow_html=True,
)
st.link_button(TXT["premium_button"], PREMIUM_URL, use_container_width=True)

# =========================================================
# STATUS CARD
# =========================================================
today_label = (
    TXT["today_success"] if today_status == "success"
    else TXT["today_fail"] if today_status == "fail"
    else TXT["today_none"]
)

st.markdown(
    f"""
<div class="card">
    <div class="section-title">현재 상태</div>
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
            <div class="metric-value" style="font-size:0.82rem;">{today_label}</div>
        </div>
    </div>
</div>
""",
    unsafe_allow_html=True,
)

if today_status == "none" and streak > 0:
    st.markdown(
        f"""
<div class="warning-card">
    <div class="muted">경고</div>
    <div class="strong-title" style="font-size:1.02rem;">{TXT['streak_warning']}</div>
</div>
""",
        unsafe_allow_html=True,
    )

# =========================================================
# ACTIONS
# [FIX] rerun 이후에도 완료/실패 메시지가 표시되도록 세션 플래그 방식으로 변경
# [FIX] fail_reason selectbox를 버튼보다 먼저 렌더링 + 완료 시 fail_reason 미포함
# =========================================================

# rerun 이후 메시지 표시
if st.session_state.pop("_show_complete_msg", False):
    st.success(TXT["complete_message"])
if st.session_state.pop("_show_fail_msg", False):
    st.error(TXT["fail_message"])

col_start, col_refresh = st.columns([2, 1])
st.markdown(f"""
<div style="text-align:center; margin-bottom:10px;">
    <div style="font-size:0.9rem; color:#FCA5A5; font-weight:700;">
    {TXT['action_motivate']}
    </div>
</div>
""", unsafe_allow_html=True)

with col_start:
    if not st.session_state.running:
        if st.button(TXT["start_now"], use_container_width=True):
            st.session_state.running = True
            st.session_state.start_time = time.time()
            st.session_state.current_task = command
            st.rerun()
with col_refresh:
    if st.button(TXT["refresh"], use_container_width=True):
        st.session_state.command_ready = True
        st.rerun()

if not st.session_state.running:
    st.caption(TXT["analysis_closed"])
else:
    elapsed = int(time.time() - st.session_state.start_time)
    safe_current_task = html.escape(st.session_state.current_task)
    st.markdown(
        f"""
<div class="success-card">
    <div class="muted">{TXT['running']}</div>
    <div class="strong-title" style="font-size:1.05rem;">{elapsed}초 진행 중</div>
    <div class="body-small">{safe_current_task}</div>
</div>
""",
        unsafe_allow_html=True,
    )

    # [FIX] fail_reason selectbox를 버튼보다 먼저 렌더링
    fail_reason = st.selectbox("왜 실패했냐", ["집중 안됨", "피곤함", "딴짓", "시간 부족", "기타"])

    col1, col2 = st.columns(2)
    with col1:
        if st.button(TXT["complete"], use_container_width=True):
            # [FIX] 완료 시 fail_reason 미포함
            save_record(st.session_state.current_task, True, "")
            st.session_state.running = False
            st.session_state.current_task = ""
            st.session_state["_show_complete_msg"] = True
            st.rerun()
    with col2:
        if st.button(TXT["fail"], use_container_width=True):
            save_record(st.session_state.current_task, False, fail_reason)
            st.session_state.running = False
            st.session_state.current_task = ""
            st.session_state["_show_fail_msg"] = True
            st.rerun()

# =========================================================
# LAZY ANALYSIS
# [FIX] load_records() 재호출 제거 — 상단에서 로드한 records/using_sheet 재사용
# [FIX] generate_weekly_report + generate_premium_insight 병렬 호출로 대기 시간 단축
# =========================================================
with st.expander("📊 상세 분석", expanded=False):
    with st.spinner("상세 분석 로딩 중..."):
        records_for_analysis = records
        if not using_sheet:
            st.info(TXT["fallback_sheet_notice"])

        weekly_stats = get_weekly_stats(records_for_analysis)

        # [FIX] 두 Gemini 호출을 ThreadPoolExecutor로 병렬 실행
        with ThreadPoolExecutor(max_workers=2) as ex:
            f_weekly = ex.submit(
                generate_weekly_report,
                st.session_state.goal,
                weekly_stats["success_rate"],
                weekly_stats["success_count"],
                weekly_stats["fail_count"],
                weekly_stats["top_fail_reason"],
            )
            f_premium = ex.submit(
                generate_premium_insight,
                st.session_state.goal,
                str(records_for_analysis[-5:]),
            )
        weekly_focus, weekly_action = f_weekly.result()
        premium_weakness, premium_fix = f_premium.result()

    st.markdown(
        f"""
<div class="card">
    <div class="section-title">최근 7일 리포트</div>
    <div class="body-small"><b>주간 성공률:</b> {weekly_stats['success_rate']}%</div>
    <div class="body-small"><b>핵심 패턴:</b> {html.escape(weekly_focus)}</div>
    <div class="body-small"><b>추천 행동:</b> {html.escape(weekly_action)}</div>
</div>
""",
        unsafe_allow_html=True,
    )

    premium_pills = """
<span class="premium-pill">반복 실패 분석</span>
<span class="premium-pill">실패 원인 해부</span>
<span class="premium-pill">맞춤 교정 전략</span>
<span class="premium-pill">심화 리포트</span>
"""
    st.markdown(
        f"""
<div class="card">
    <div class="section-title">Premium 상세 분석</div>
    <div class="body-small">무료는 시작하게 만들고, Premium은 반복 실패를 끊게 만든다.</div>
    <div style="margin-top:10px;">{premium_pills}</div>
</div>
""",
        unsafe_allow_html=True,
    )

    if len(records_for_analysis) >= 3:
        fail_count_analysis = get_success_fail_counts(records_for_analysis)[1]
        if fail_count_analysis >= 2:
            st.markdown(
                f"""
<div class="warning-card">
    <div class="muted">PREMIUM</div>
    <div class="strong-title" style="font-size:1.02rem;">{TXT['premium_fail_title']}</div>
    <div class="body-small">{TXT['premium_fail_body']}</div>
    <div class="body-small"><b>약점:</b> {html.escape(premium_weakness)}</div>
    <div class="body-small"><b>교정:</b> {html.escape(premium_fix)}</div>
</div>
""",
                unsafe_allow_html=True,
            )
            st.link_button(TXT["premium_button"], PREMIUM_URL, use_container_width=True)
        else:
            st.markdown(
                f"""
<div class="success-card">
    <div class="muted">PREMIUM</div>
    <div class="strong-title" style="font-size:1.02rem;">{TXT['premium_flow_title']}</div>
    <div class="body-small">{TXT['premium_flow_body']}</div>
</div>
""",
                unsafe_allow_html=True,
            )
            st.link_button(TXT["premium_button"], PREMIUM_URL, use_container_width=True)
    else:
        st.info("데이터 수집 중 (최소 3개 기록 필요)")

# =========================================================
# TABS
# [FIX] load_records() 재호출 제거 — 상단에서 로드한 records/using_sheet 재사용
# =========================================================
tab1, tab2 = st.tabs([TXT["history_title"], TXT["policy_title"]])

with tab1:
    if not using_sheet:
        st.info(TXT["fallback_sheet_notice"])
    recent_records_tab = get_recent_records(records, 10)
    if not recent_records_tab:
        st.info("아직 기록이 없습니다. 첫 실행부터 시작하세요.")
    else:
        for row in reversed(recent_records_tab):
            is_done = record_to_bool_done(row)
            emoji = "✅" if is_done else "❌"
            status = "성공" if is_done else "실패"
            fail_text = f" | 이유: {html.escape(str(row.get('fail_reason', '')))}" if (not is_done and row.get('fail_reason')) else ""
            safe_task = html.escape(str(row.get('task', '-')))
            safe_time = html.escape(str(row.get('time', '-')))
            st.markdown(
                f"""
<div class="card">
    <div class="muted">{safe_time}</div>
    <div class="strong-title" style="font-size:1rem;">{emoji} {safe_task}</div>
    <div class="body-small">상태: {status}{fail_text}</div>
</div>
""",
                unsafe_allow_html=True,
            )

with tab2:
    st.markdown(
        f"""
<div class="card">
    <div class="section-title">{TXT['policy_title']}</div>
    <div class="body-small">{TXT['policy_text']}</div>
</div>
""",
        unsafe_allow_html=True,
    )

st.caption("Deploy Ready")