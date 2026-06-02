from functools import lru_cache
import bisect
from pathlib import Path
import random
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

SEX_MAP = {
    "남자": "male",
    "여자": "female",
}

REGION_GROUP_MAP = {
    "서울": "capital",
    "경기": "capital",
    "인천": "capital",
    "부산": "yeongnam",
    "대구": "yeongnam",
    "울산": "yeongnam",
    "경상남": "yeongnam",
    "경상북": "yeongnam",
    "광주": "honam",
    "전라남": "honam",
    "전북": "honam",
    "대전": "chungcheong",
    "세종": "chungcheong",
    "충청남": "chungcheong",
    "충청북": "chungcheong",
    "강원": "gangwon",
    "제주": "jeju",
}

REQUIRED_COLUMNS = [
    "age",
    "sex",
    "province",
    "district",
    "occupation",
    "education_level",
    "marital_status",
    "military_status",
    "family_type",
    "housing_type",
    "bachelors_field",
    "country",
    "persona",
    "cultural_background",
    "career_goals_and_ambitions",
    "hobbies_and_interests",
    # Prose narrative columns are loaded; _list variants are intentionally excluded.
    "professional_persona",
    "family_persona",
    "skills_and_expertise",
    "arts_persona",
    "travel_persona",
    "culinary_persona",
    "sports_persona",
]


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def dataset_dir() -> Path:
    root = project_root()
    candidates = [
        root / "data" / "Nemotron-Personas-Korea" / "data",
        root.parent / "data" / "Nemotron-Personas-Korea" / "data",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def parquet_files() -> list[Path]:
    return sorted(dataset_dir().glob("train-*.parquet"))


@lru_cache(maxsize=1)
def parquet_row_groups() -> tuple[dict, ...]:
    groups = []
    start = 0
    for file_index, file in enumerate(parquet_files()):
        parquet_file = pq.ParquetFile(file)
        for row_group_index in range(parquet_file.metadata.num_row_groups):
            row_count = parquet_file.metadata.row_group(row_group_index).num_rows
            groups.append(
                {
                    "file_index": file_index,
                    "file": file,
                    "row_group_index": row_group_index,
                    "start": start,
                    "end": start + row_count,
                }
            )
            start += row_count
    return tuple(groups)


def dataset_row_count() -> int:
    groups = parquet_row_groups()
    return groups[-1]["end"] if groups else 0


def normalize_gender(value: Any) -> str:
    return SEX_MAP.get(str(value), "unknown")


def age_group_for(age: int) -> str:
    age = int(age)
    if age < 30:
        return "20s"
    if age < 40:
        return "30s"
    if age < 50:
        return "40s"
    if age < 60:
        return "50s"
    if age < 70:
        return "60s"
    return "70_plus"


def region_group_for(province: Any) -> str:
    return REGION_GROUP_MAP.get(str(province), "other")


def normalize_record(row_id: int, row: dict) -> dict:
    province = str(row["province"])
    district = str(row["district"])
    return {
        "row_id": str(row_id),
        "age": int(row["age"]),
        "gender": normalize_gender(row["sex"]),
        "region": district,
        "job": str(row["occupation"]),
        "education": str(row["education_level"]),
        "background": str(row["persona"]),
        "structured_profile": {
            "age": int(row["age"]),
            "gender": normalize_gender(row["sex"]),
            "province": province,
            "district": district,
            "occupation": str(row["occupation"]),
            "family_type": str(row.get("family_type", "")),
            "marital_status": str(row.get("marital_status", "")),
            "housing_type": str(row.get("housing_type", "")),
            "education_level": str(row["education_level"]),
            "bachelors_field": str(row.get("bachelors_field", "")),
        },
        "narrative_context": {
            "persona": str(row["persona"]),
            "professional_persona": str(row.get("professional_persona", "")),
            "family_persona": str(row.get("family_persona", "")),
            "career_goals_and_ambitions": str(row.get("career_goals_and_ambitions", "")),
            "cultural_background": str(row.get("cultural_background", "")),
            "skills_and_expertise": str(row.get("skills_and_expertise", "")),
            "arts_persona": str(row.get("arts_persona", "")),
            "travel_persona": str(row.get("travel_persona", "")),
            "culinary_persona": str(row.get("culinary_persona", "")),
            "sports_persona": str(row.get("sports_persona", "")),
            "hobbies_and_interests": str(row.get("hobbies_and_interests", "")),
        },
        "age_group": age_group_for(int(row["age"])),
        "region_group": region_group_for(province),
    }


def _row_group_for_global_row(global_row_id: int) -> dict:
    groups = parquet_row_groups()
    starts = [group["start"] for group in groups]
    index = bisect.bisect_right(starts, global_row_id) - 1
    if index < 0 or global_row_id >= groups[index]["end"]:
        raise IndexError(f"row id out of range: {global_row_id}")
    return groups[index]


def load_random_persona_records(n_agents: int, seed: int | None = None) -> tuple[dict, ...]:
    total_rows = dataset_row_count()
    if total_rows == 0:
        raise FileNotFoundError(f"No parquet files found under {dataset_dir()}")
    if n_agents > total_rows:
        raise ValueError("n_agents cannot exceed dataset row count")

    rng = random.Random(seed)
    selected_row_ids = rng.sample(range(total_rows), n_agents)
    rows_by_group: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for global_row_id in selected_row_ids:
        group = _row_group_for_global_row(global_row_id)
        key = (group["file_index"], group["row_group_index"])
        rows_by_group.setdefault(key, []).append((global_row_id, global_row_id - group["start"]))

    loaded: dict[int, dict] = {}
    files = parquet_files()
    for (file_index, row_group_index), row_ids in rows_by_group.items():
        parquet_file = pq.ParquetFile(files[file_index])
        offsets = [offset for _, offset in row_ids]
        table = parquet_file.read_row_group(row_group_index, columns=REQUIRED_COLUMNS)
        rows = table.take(pa.array(offsets)).to_pylist()
        for (global_row_id, _), row in zip(row_ids, rows):
            loaded[global_row_id] = normalize_record(global_row_id, row)

    return tuple(loaded[row_id] for row_id in selected_row_ids)


@lru_cache(maxsize=1)
def load_persona_records() -> tuple[dict, ...]:
    files = parquet_files()
    if not files:
        raise FileNotFoundError(f"No parquet files found under {dataset_dir()}")

    dataframe = pd.read_parquet(files, columns=REQUIRED_COLUMNS)
    records = [
        normalize_record(row_id, row)
        for row_id, row in enumerate(dataframe.to_dict(orient="records"))
    ]
    return tuple(records)


def dataset_status() -> dict:
    files = parquet_files()
    cached = load_persona_records.cache_info().currsize > 0
    metadata_loaded = parquet_row_groups.cache_info().currsize > 0
    rows = dataset_row_count() if metadata_loaded else None
    return {"available": bool(files), "loaded": cached or metadata_loaded, "rows": rows}
