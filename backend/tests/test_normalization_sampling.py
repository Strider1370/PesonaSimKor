from app.services.aggregation import compute_aggregate
from app.services.persona_repository import age_group_for, normalize_gender, normalize_record, region_group_for
from app.services.persona_sampler import build_sampling_plan, build_sampling_population, calculate_quotas, sample_from_population, sample_from_records, sample_personas_with_plan


def test_normalizes_actual_dataset_gender_values():
    assert normalize_gender("남자") == "male"
    assert normalize_gender("여자") == "female"
    assert normalize_gender("unexpected") == "unknown"


def test_maps_actual_dataset_province_values():
    assert region_group_for("서울") == "capital"
    assert region_group_for("경상남") == "yeongnam"
    assert region_group_for("전라남") == "honam"
    assert region_group_for("충청북") == "chungcheong"
    assert region_group_for("제주") == "jeju"
    assert region_group_for("unknown") == "other"


def test_normalized_region_uses_district_only():
    row = {
        "age": 42,
        "sex": "여자",
        "province": "경기",
        "district": "경기-양주시",
        "occupation": "그 외 기능 관련 종사원",
        "education_level": "4년제 대학교",
        "marital_status": "기혼",
        "military_status": "비대상",
        "family_type": "부부와 자녀",
        "housing_type": "아파트",
        "bachelors_field": "사회복지",
        "country": "대한민국",
        "persona": "천윤정 씨는 양주시에서 일하는 40대 여성입니다.",
        "cultural_background": "지역 공동체 활동에 익숙합니다.",
        "career_goals_and_ambitions": "안정적인 복지 업무를 이어가고 싶어합니다.",
        "hobbies_and_interests": "산책과 독서를 즐깁니다.",
    }

    normalized = normalize_record(0, row)

    assert normalized["region"] == "경기-양주시"
    assert normalized["region_group"] == "capital"
    assert normalized["structured_profile"]["marital_status"] == "기혼"
    assert normalized["structured_profile"]["housing_type"] == "아파트"
    assert normalized["narrative_context"]["cultural_background"] == "지역 공동체 활동에 익숙합니다."


def test_age_group_includes_19_in_20s_bucket():
    assert age_group_for(19) == "20s"
    assert age_group_for(29) == "20s"
    assert age_group_for(70) == "70_plus"


def test_calculate_quotas_uses_largest_remainder_and_exact_total():
    proportions = {
        ("20s", "capital", "female"): 0.5,
        ("30s", "capital", "male"): 0.3,
        ("40s", "yeongnam", "female"): 0.2,
    }

    quotas = calculate_quotas(proportions, 7)

    assert sum(quotas.values()) == 7
    assert quotas[("20s", "capital", "female")] == 4
    assert quotas[("30s", "capital", "male")] == 2
    assert quotas[("40s", "yeongnam", "female")] == 1


def test_sampling_redistributes_underfilled_cells_without_duplicates():
    records = [
        {
            "row_id": "a",
            "age": 25,
            "gender": "female",
            "region": "서울 강남구",
            "job": "사무직",
            "education": "대학교 졸업",
            "background": "A",
            "age_group": "20s",
            "region_group": "capital",
        },
        {
            "row_id": "b",
            "age": 35,
            "gender": "male",
            "region": "부산 해운대구",
            "job": "기술직",
            "education": "고등학교 졸업",
            "background": "B",
            "age_group": "30s",
            "region_group": "yeongnam",
        },
        {
            "row_id": "c",
            "age": 36,
            "gender": "male",
            "region": "부산 수영구",
            "job": "자영업",
            "education": "대학교 졸업",
            "background": "C",
            "age_group": "30s",
            "region_group": "yeongnam",
        },
    ]
    quotas = {
        ("20s", "capital", "female"): 2,
        ("30s", "yeongnam", "male"): 1,
    }

    sampled = sample_from_records(records, quotas, 3, seed=1)

    assert len(sampled) == 3
    assert [row["agent_id"] for row in sampled] == [0, 1, 2]
    assert len({row["row_id"] for row in sampled}) == 3


def test_sampling_plan_reports_quota_available_and_sampled_counts():
    records = [
        {"row_id": "a", "age_group": "20s", "region_group": "capital", "gender": "female"},
        {"row_id": "b", "age_group": "30s", "region_group": "yeongnam", "gender": "male"},
        {"row_id": "c", "age_group": "30s", "region_group": "yeongnam", "gender": "male"},
    ]
    quotas = {
        ("20s", "capital", "female"): 2,
        ("30s", "yeongnam", "male"): 1,
    }
    sampled = [
        {"row_id": "a", "age_group": "20s", "region_group": "capital", "gender": "female"},
        {"row_id": "b", "age_group": "30s", "region_group": "yeongnam", "gender": "male"},
        {"row_id": "c", "age_group": "30s", "region_group": "yeongnam", "gender": "male"},
    ]

    plan = build_sampling_plan(records, quotas, sampled, 3)

    assert plan["n_agents"] == 3
    assert plan["axes"] == ["age_group", "region_group", "gender"]
    assert plan["total_records"] == 3
    assert plan["cells"][0] == {
        "age_group": "20s",
        "region_group": "capital",
        "gender": "female",
        "available": 1,
        "quota": 2,
        "sampled": 1,
        "shortfall": 1,
        "proportion": 1 / 3,
    }


def test_population_sampling_uses_precomputed_cells_without_duplicates():
    records = [
        {"row_id": "a", "age_group": "20s", "region_group": "capital", "gender": "female"},
        {"row_id": "b", "age_group": "20s", "region_group": "capital", "gender": "female"},
        {"row_id": "c", "age_group": "30s", "region_group": "yeongnam", "gender": "male"},
    ]
    population = build_sampling_population(records)
    quotas = {
        ("20s", "capital", "female"): 2,
        ("30s", "yeongnam", "male"): 1,
    }

    sampled = sample_from_population(population, quotas, 3, seed=1)

    assert len(sampled) == 3
    assert [row["agent_id"] for row in sampled] == [0, 1, 2]
    assert len({row["row_id"] for row in sampled}) == 3
    assert population["available_counts"][("20s", "capital", "female")] == 2
    assert population["proportions"][("30s", "yeongnam", "male")] == 1 / 3


def test_sample_personas_with_plan_uses_uniform_random_records(monkeypatch):
    records = [
        {"row_id": "10", "age_group": "20s", "region_group": "capital", "gender": "female"},
        {"row_id": "20", "age_group": "30s", "region_group": "yeongnam", "gender": "male"},
        {"row_id": "30", "age_group": "30s", "region_group": "yeongnam", "gender": "male"},
    ]

    import app.services.persona_sampler as sampler

    monkeypatch.setattr(sampler, "load_random_persona_records", lambda n: records[:n])
    monkeypatch.setattr(sampler, "dataset_row_count", lambda: 1_000_000)

    sampled, plan = sample_personas_with_plan(3)

    assert [row["agent_id"] for row in sampled] == [0, 1, 2]
    assert [row["row_id"] for row in sampled] == ["10", "20", "30"]
    assert plan["mode"] == "uniform_random"
    assert plan["total_records"] == 1_000_000
    assert plan["cells"][0]["sampled"] == 1
    assert "quota" not in plan["cells"][0]


def test_aggregate_counts_are_deterministic_and_invalid_stance_is_neutral():
    responses = [
        {"age_group": "20s", "gender": "female", "region_group": "capital", "stance": "support"},
        {"age_group": "20s", "gender": "female", "region_group": "capital", "stance": "oppose"},
        {"age_group": "30s", "gender": "male", "region_group": "yeongnam", "stance": "bad"},
    ]

    aggregate = compute_aggregate(responses)

    assert aggregate["total"] == {"support": 1, "oppose": 1, "neutral": 1}
    assert aggregate["by_age"]["20s"] == {"support": 1, "oppose": 1, "neutral": 0}
    assert aggregate["by_gender"]["male"] == {"support": 0, "oppose": 0, "neutral": 1}
    assert aggregate["concern_clusters"] == []
    assert aggregate["support_clusters"] == []
