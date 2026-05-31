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

    return {
        "topic": data["topic"],
        "source": data["source"],
        "question": data["question"],
        "national": national,
        "by_gender": data["by_gender"].get(gender, national),
        "by_age": data["by_age_group"].get(age_group, national),
        "by_region": data["by_region"].get(region_key, national),
    }
