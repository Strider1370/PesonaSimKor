import math
import random
from collections import defaultdict
from functools import lru_cache
from typing import Iterable

from app.services.persona_repository import dataset_row_count, load_persona_records, load_random_persona_records

SAMPLING_AXES = ["age_group", "region_group", "gender"]


def build_sampling_population(records: Iterable[dict]) -> dict:
    records_tuple = tuple(records)
    available_counts: dict[tuple[str, ...], int] = defaultdict(int)
    by_cell: dict[tuple[str, ...], list[dict]] = defaultdict(list)

    for record in records_tuple:
        key = group_key(record)
        available_counts[key] += 1
        by_cell[key].append(record)

    total = len(records_tuple)
    proportions = {
        key: count / total
        for key, count in available_counts.items()
    } if total else {}

    return {
        "records": records_tuple,
        "by_cell": {key: tuple(rows) for key, rows in by_cell.items()},
        "available_counts": dict(available_counts),
        "proportions": proportions,
        "total_records": total,
    }


@lru_cache(maxsize=1)
def load_sampling_population() -> dict:
    return build_sampling_population(load_persona_records())


def group_key(record: dict) -> tuple[str, ...]:
    return tuple(record[field] for field in SAMPLING_AXES)


def empirical_proportions(records: Iterable[dict]) -> dict[tuple[str, ...], float]:
    counts: dict[tuple[str, ...], int] = defaultdict(int)
    total = 0
    for record in records:
        counts[group_key(record)] += 1
        total += 1
    if total == 0:
        return {}
    return {key: count / total for key, count in counts.items()}


def calculate_quotas(proportions: dict[tuple[str, ...], float], n_agents: int) -> dict[tuple[str, ...], int]:
    ideals = {key: proportion * n_agents for key, proportion in proportions.items()}
    quotas = {key: math.floor(value) for key, value in ideals.items()}
    remaining = n_agents - sum(quotas.values())
    remainders = sorted(
        ((key, ideals[key] - quotas[key]) for key in ideals),
        key=lambda item: item[1],
        reverse=True,
    )
    for key, _ in remainders[:remaining]:
        quotas[key] += 1
    return quotas


def sample_from_records(records: list[dict], quotas: dict[tuple[str, ...], int], n_agents: int, seed: int | None = None) -> list[dict]:
    rng = random.Random(seed)
    by_cell: dict[tuple[str, ...], list[dict]] = defaultdict(list)
    for record in records:
        by_cell[group_key(record)].append(record)
    for rows in by_cell.values():
        rng.shuffle(rows)

    selected: list[dict] = []
    selected_ids: set[str] = set()
    shortfall = 0

    for key, quota in quotas.items():
        available = by_cell.get(key, [])
        take = min(quota, len(available))
        for record in available[:take]:
            selected.append(record)
            selected_ids.add(record["row_id"])
        shortfall += quota - take

    if shortfall > 0 or len(selected) < n_agents:
        remaining_pool = [record for record in records if record["row_id"] not in selected_ids]
        rng.shuffle(remaining_pool)
        needed = n_agents - len(selected)
        selected.extend(remaining_pool[:needed])

    selected = selected[:n_agents]
    return [{**record, "agent_id": index} for index, record in enumerate(selected)]


def sample_from_population(population: dict, quotas: dict[tuple[str, ...], int], n_agents: int, seed: int | None = None) -> list[dict]:
    rng = random.Random(seed)
    by_cell = population["by_cell"]
    selected: list[dict] = []
    selected_ids: set[str] = set()

    for key, quota in quotas.items():
        available = by_cell.get(key, ())
        take = min(quota, len(available))
        if take <= 0:
            continue
        for record in rng.sample(available, take):
            selected.append(record)
            selected_ids.add(record["row_id"])

    if len(selected) < n_agents:
        records = population["records"]
        needed = min(n_agents, len(records)) - len(selected)
        attempts = 0
        max_attempts = max(needed * 100, 100)
        while needed > 0 and attempts < max_attempts:
            record = records[rng.randrange(len(records))]
            attempts += 1
            if record["row_id"] in selected_ids:
                continue
            selected.append(record)
            selected_ids.add(record["row_id"])
            needed -= 1

        if needed > 0:
            for record in records:
                if record["row_id"] in selected_ids:
                    continue
                selected.append(record)
                selected_ids.add(record["row_id"])
                needed -= 1
                if needed == 0:
                    break

    selected = selected[:n_agents]
    return [{**record, "agent_id": index} for index, record in enumerate(selected)]


def _cell_counts(records: Iterable[dict]) -> dict[tuple[str, ...], int]:
    counts: dict[tuple[str, ...], int] = defaultdict(int)
    for record in records:
        counts[group_key(record)] += 1
    return counts


def build_sampling_plan(
    records: list[dict],
    quotas: dict[tuple[str, ...], int],
    sampled: list[dict],
    n_agents: int,
) -> dict:
    available_counts = _cell_counts(records)
    sampled_counts = _cell_counts(sampled)
    total_records = len(records)
    cells = []
    for key in sorted(quotas.keys()):
        available = available_counts.get(key, 0)
        sampled_count = sampled_counts.get(key, 0)
        quota = quotas[key]
        cells.append(
            {
                "age_group": key[0],
                "region_group": key[1],
                "gender": key[2],
                "available": available,
                "quota": quota,
                "sampled": sampled_count,
                "shortfall": max(0, quota - available),
                "proportion": available / total_records if total_records else 0,
            }
        )
    return {
        "n_agents": n_agents,
        "axes": SAMPLING_AXES,
        "total_records": total_records,
        "cells": cells,
    }


def build_sampling_plan_from_population(
    population: dict,
    quotas: dict[tuple[str, ...], int],
    sampled: list[dict],
    n_agents: int,
) -> dict:
    available_counts = population["available_counts"]
    sampled_counts = _cell_counts(sampled)
    total_records = population["total_records"]
    cells = []
    for key in sorted(quotas.keys()):
        available = available_counts.get(key, 0)
        sampled_count = sampled_counts.get(key, 0)
        quota = quotas[key]
        cells.append(
            {
                "age_group": key[0],
                "region_group": key[1],
                "gender": key[2],
                "available": available,
                "quota": quota,
                "sampled": sampled_count,
                "shortfall": max(0, quota - available),
                "proportion": available / total_records if total_records else 0,
            }
        )
    return {
        "n_agents": n_agents,
        "axes": SAMPLING_AXES,
        "total_records": total_records,
        "cells": cells,
    }


def build_random_sampling_plan(sampled: list[dict], n_agents: int) -> dict:
    sampled_counts = _cell_counts(sampled)
    cells = []
    for key in sorted(sampled_counts.keys()):
        sampled_count = sampled_counts[key]
        cells.append(
            {
                "age_group": key[0],
                "region_group": key[1],
                "gender": key[2],
                "sampled": sampled_count,
                "proportion": sampled_count / len(sampled) if sampled else 0,
            }
        )
    return {
        "mode": "uniform_random",
        "n_agents": n_agents,
        "axes": SAMPLING_AXES,
        "total_records": dataset_row_count(),
        "cells": cells,
    }


def sample_personas_with_plan(n_agents: int) -> tuple[list[dict], dict]:
    records = load_random_persona_records(n_agents)
    sampled = [{**record, "agent_id": index} for index, record in enumerate(records)]
    return sampled, build_random_sampling_plan(sampled, n_agents)


def sample_personas(n_agents: int) -> list[dict]:
    sampled, _ = sample_personas_with_plan(n_agents)
    return sampled
