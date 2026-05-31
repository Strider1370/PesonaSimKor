import json
from functools import lru_cache
from pathlib import Path

# Persona province (Nemotron `province` values) -> Gallup 권역 key used in priors/*.json
PROVINCE_TO_REGION = {
    "서울": "seoul",
    "인천": "incheon_gyeonggi",
    "경기": "incheon_gyeonggi",
    "대전": "daejeon_sejong_chungcheong",
    "세종": "daejeon_sejong_chungcheong",
    "충청남": "daejeon_sejong_chungcheong",
    "충청북": "daejeon_sejong_chungcheong",
    "광주": "gwangju_jeolla",
    "전라남": "gwangju_jeolla",
    "전북": "gwangju_jeolla",
    "대구": "daegu_gyeongbuk",
    "경상북": "daegu_gyeongbuk",
    "부산": "busan_ulsan_gyeongnam",
    "울산": "busan_ulsan_gyeongnam",
    "경상남": "busan_ulsan_gyeongnam",
    "강원": "gangwon",  # suppressed (n<50) in source -> not present in by_region -> national
    "제주": "jeju",     # suppressed (n<50) in source -> not present in by_region -> national
}

GENDER_LABELS = {"male": "남성", "female": "여성"}
AGE_LABELS = {
    "20s": "18~29세",
    "30s": "30대",
    "40s": "40대",
    "50s": "50대",
    "60s": "60대",
    "70_plus": "70대 이상",
}
REGION_LABELS = {
    "seoul": "서울",
    "incheon_gyeonggi": "인천·경기",
    "daejeon_sejong_chungcheong": "대전·세종·충청",
    "gwangju_jeolla": "광주·전라",
    "daegu_gyeongbuk": "대구·경북",
    "busan_ulsan_gyeongnam": "부산·울산·경남",
}


def priors_dir() -> Path:
    # this file: backend/app/services/prior_service.py ; parents[1] == backend/app
    return Path(__file__).resolve().parents[1] / "data" / "priors"


@lru_cache(maxsize=32)
def _load_topic(topic_id: str) -> dict | None:
    path = priors_dir() / f"{topic_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def get_prior(topic_id: str | None, persona_axes: dict[str, str]) -> dict | None:
    if not topic_id:
        return None
    data = _load_topic(topic_id)
    if data is None:
        return None

    national = data["national"]
    gender = persona_axes.get("gender")
    age_group = persona_axes.get("age_group")
    province = persona_axes.get("province")
    region_key = PROVINCE_TO_REGION.get(province)

    groups: list[dict] = []

    gender_bucket = data["by_gender"].get(gender)
    if gender_bucket is not None and gender in GENDER_LABELS:
        groups.append({"label": GENDER_LABELS[gender], **gender_bucket})

    age_bucket = data["by_age_group"].get(age_group)
    if age_bucket is not None and age_group in AGE_LABELS:
        groups.append({"label": AGE_LABELS[age_group], **age_bucket})

    # Region is omitted when the persona's province has no published bucket
    # (강원/제주 suppressed, or unmapped) — no redundant national fallback clause.
    region_bucket = data["by_region"].get(region_key) if region_key else None
    if region_bucket is not None and region_key in REGION_LABELS:
        groups.append({"label": REGION_LABELS[region_key], **region_bucket})

    return {
        "topic": data["topic"],
        "source": data["source"],
        "question": data["question"],
        "national": national,
        "groups": groups,
    }
