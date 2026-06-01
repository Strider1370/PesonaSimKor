VALID_STANCES = ("support", "oppose", "neutral")
STANCE_ALIASES = {
    "찬성": "support",
    "지지": "support",
    "동의": "support",
    "반대": "oppose",
    "비판": "oppose",
    "부정": "oppose",
    "중립": "neutral",
    "유보": "neutral",
}


def empty_counts() -> dict[str, int]:
    return {stance: 0 for stance in VALID_STANCES}


def normalize_stance(stance: str | None) -> str:
    if stance in VALID_STANCES:
        return stance
    return STANCE_ALIASES.get(str(stance).strip(), "neutral")


def compute_aggregate(responses: list[dict]) -> dict:
    total = empty_counts()
    by_age: dict[str, dict[str, int]] = {}
    by_gender: dict[str, dict[str, int]] = {}
    by_region: dict[str, dict[str, int]] = {}

    for response in responses:
        stance = normalize_stance(response.get("stance"))
        total[stance] += 1
        for target, key in (
            (by_age, response.get("age_group", "unknown")),
            (by_gender, response.get("gender", "unknown")),
            (by_region, response.get("region_group", "unknown")),
        ):
            target.setdefault(str(key), empty_counts())
            target[str(key)][stance] += 1

    result = {
        "total": total,
        "by_age": by_age,
        "by_gender": by_gender,
        "by_region": by_region,
        "concern_clusters": [],
        "support_clusters": [],
        "complaint_clusters": [],
        "affected_group_clusters": [],
    }

    result["blind_spot_raw"] = [
        {
            "blind_spot": response["blind_spot"],
            "affected_group": response.get("affected_group", ""),
        }
        for response in responses
        if response.get("blind_spot")
    ]
    result["reframing_list"] = [
        {
            "text": response["reframing"],
            "age_group": response.get("age_group", ""),
            "gender": response.get("gender", ""),
            "region_group": response.get("region_group", ""),
        }
        for response in responses
        if response.get("reframing")
    ]
    result["blind_spot_clusters"] = []
    return result
