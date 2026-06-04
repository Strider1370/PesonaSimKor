from math import sqrt


DISCOVERY_AXES = (
    "age_band",
    "gender",
    "region_group",
    "occupation_stratum",
    "household_stratum",
    "housing_stratum",
    "education_stratum",
    "field_stratum",
)

MIN_POP = 3
REF_POP = 10
W_MAX = 4.0


def _agent_id(response: dict) -> int:
    return int(response.get("agent_id", 0))


def _has_blind_spot(response: dict) -> bool:
    return bool(str(response.get("blind_spot") or "").strip())


def _marginality_weight(population: int) -> float:
    return min(W_MAX, sqrt(REF_POP / max(population, MIN_POP)))


def _cell_score(cell: dict, responses_by_id: dict[int, dict]) -> float:
    if not cell["presence"]:
        return 0.0
    if cell["category_population"] < MIN_POP and cell["blind_spot_headcount"] < 2:
        return 0.0
    if cell["agent_ids"] and all(
        responses_by_id[agent_id].get("classification_source") == "fallback"
        and str(responses_by_id[agent_id].get("occupation_stratum", "")).startswith("unemployed_")
        for agent_id in cell["agent_ids"]
    ):
        return 0.0
    return cell["blind_spot_headcount"] * _marginality_weight(cell["category_population"])


def compute_discovery_aggregate(responses: list[dict]) -> dict:
    responses_by_id = {_agent_id(response): response for response in responses}
    axes: dict[str, dict[str, dict]] = {axis: {} for axis in DISCOVERY_AXES}

    for axis in DISCOVERY_AXES:
        populations: dict[str, int] = {}
        blind_agents: dict[str, set[int]] = {}
        for response in responses:
            category = str(response.get(axis) or "etc")
            populations[category] = populations.get(category, 0) + 1
            if _has_blind_spot(response):
                blind_agents.setdefault(category, set()).add(_agent_id(response))

        for category in sorted(populations):
            agent_ids = sorted(blind_agents.get(category, set()))
            axes[axis][category] = {
                "presence": bool(agent_ids),
                "blind_spot_headcount": len(agent_ids),
                "agent_ids": agent_ids,
                "category_population": populations[category],
            }

    scored_axes = []
    for axis in DISCOVERY_AXES:
        score = sum(_cell_score(cell, responses_by_id) for cell in axes[axis].values())
        scored_axes.append((score, axis))
    scored_axes.sort(key=lambda item: (-item[0], DISCOVERY_AXES.index(item[1])))
    primary = scored_axes[0][1] if scored_axes and scored_axes[0][0] > 0 else DISCOVERY_AXES[0]
    secondary = next((axis for score, axis in scored_axes[1:] if score > 0), None)

    return {
        "axes": axes,
        "featured_axis": {"primary": primary, "secondary": secondary},
    }
