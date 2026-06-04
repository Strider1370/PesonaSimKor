import json
from functools import lru_cache
from pathlib import Path


OCCUPATION_CODES = ("1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "unemployed")
UNEMPLOYED_SUBSTRATA = ("노년은퇴", "청년취준", "전업돌봄", "구직중", "기타")

_UNEMPLOYED_PHRASES = {
    "노년은퇴": ("은퇴", "퇴직", "정년"),
    "전업돌봄": ("주부", "전업", "육아", "돌봄"),
    "청년취준": ("취업", "구직", "일자리", "취준", "학생", "학업"),
}


@lru_cache(maxsize=1)
def _occ_map() -> dict[str, str]:
    path = Path(__file__).parent.parent / "data" / "occupation_ksco_map.json"
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def _load_map(filename: str) -> dict[str, str]:
    path = Path(__file__).parent.parent / "data" / filename
    return json.loads(path.read_text(encoding="utf-8"))


def classify_occupation(raw: str) -> str:
    return _occ_map().get(str(raw).strip(), "etc")


def classify_unemployed(narr: dict, age, marital, family) -> str:
    substratum, _source = classify_unemployed_with_source(narr, age, marital, family)
    return substratum


def classify_unemployed_with_source(narr: dict, age, marital, family) -> tuple[str, str]:
    text = str(narr.get("professional_persona", "")) + " " + str(narr.get("persona", ""))
    for substratum, phrases in _UNEMPLOYED_PHRASES.items():
        if any(phrase in text for phrase in phrases):
            return substratum, "explicit"

    if age is None:
        return "기타", "fallback"

    age_int = int(age)
    marital_text = str(marital)
    family_text = str(family)
    if age_int >= 60:
        return "노년은퇴", "fallback"
    if age_int < 35 and "미혼" in marital_text and (
        "부모" in family_text or "1인" in family_text or "일자" in family_text
    ):
        return "청년취준", "fallback"
    if 35 <= age_int < 60 and (
        "배우자" in family_text or "자녀" in family_text or "아이" in family_text
    ):
        return "전업돌봄", "fallback"
    return "구직중", "fallback"


def _map_value(filename: str, raw) -> str:
    return _load_map(filename).get(str(raw).strip(), "etc")


def classify_persona(rec: dict) -> dict[str, str]:
    profile = rec["structured_profile"]
    narrative = rec["narrative_context"]
    occupation = classify_occupation(profile.get("occupation", ""))

    tags = {
        "age_band": rec["age_group"],
        "gender": rec["gender"],
        "region_group": rec["region_group"],
        "occupation_stratum": occupation,
        "household_stratum": _map_value("household_map.json", profile.get("family_type", "")),
        "housing_stratum": _map_value("housing_map.json", profile.get("housing_type", "")),
        "education_stratum": _map_value("education_map.json", profile.get("education_level", "")),
        "field_stratum": _map_value("field_map.json", profile.get("bachelors_field", "")),
    }

    if occupation == "unemployed":
        substratum, source = classify_unemployed_with_source(
            narrative,
            profile.get("age", rec.get("age")),
            profile.get("marital_status", ""),
            profile.get("family_type", ""),
        )
        tags["occupation_stratum"] = f"unemployed_{substratum}"
        tags["classification_source"] = source

    return tags
