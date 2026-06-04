from app.services.discovery_aggregate import compute_discovery_aggregate


def _resp(agent_id, occupation, blind_spot, **overrides):
    response = {
        "agent_id": agent_id,
        "occupation_stratum": occupation,
        "age_band": "60s",
        "gender": "female",
        "region_group": "capital",
        "household_stratum": "1인가구",
        "housing_stratum": "아파트",
        "education_stratum": "고등학교",
        "field_stratum": "해당없음",
        "blind_spot": blind_spot,
        "stance": "support",
    }
    response.update(overrides)
    return response


def test_presence_headcount_no_rate():
    aggregate = compute_discovery_aggregate(
        [_resp(0, "unemployed_노년은퇴", "b1"), _resp(1, "3", None)]
    )

    cell = aggregate["axes"]["occupation_stratum"]["unemployed_노년은퇴"]

    assert cell["presence"] is True
    assert cell["blind_spot_headcount"] == 1
    assert cell["agent_ids"] == [0]
    assert cell["category_population"] == 1
    assert "rate" not in cell
    assert "ratio" not in cell


def test_featured_axis_is_deterministic():
    responses = [
        _resp(0, "unemployed_노년은퇴", "b"),
        _resp(1, "unemployed_노년은퇴", "b2"),
        _resp(2, "3", None),
    ]

    first = compute_discovery_aggregate(responses)
    second = compute_discovery_aggregate(responses)

    assert first["featured_axis"]["primary"] == second["featured_axis"]["primary"]


def test_featured_axis_excludes_singleton_low_population_categories():
    responses = [
        _resp(0, "3", "b0", age_band="a0", gender="g0", region_group="r0", household_stratum="1인가구", housing_stratum="h0", education_stratum="e0", field_stratum="f0"),
        _resp(1, "4", None, age_band="a1", gender="g1", region_group="r1", household_stratum="1인가구", housing_stratum="h1", education_stratum="e1", field_stratum="f1"),
        _resp(2, "5", "b2", age_band="a2", gender="g2", region_group="r2", household_stratum="부부+자녀", housing_stratum="h2", education_stratum="e2", field_stratum="f2"),
        _resp(3, "6", "b3", age_band="a3", gender="g3", region_group="r3", household_stratum="부부+자녀", housing_stratum="h3", education_stratum="e3", field_stratum="f3"),
        _resp(4, "7", None, age_band="a4", gender="g4", region_group="r4", household_stratum="부부+자녀", housing_stratum="h4", education_stratum="e4", field_stratum="f4"),
    ]

    aggregate = compute_discovery_aggregate(responses)

    assert aggregate["axes"]["occupation_stratum"]["3"]["presence"] is True
    assert aggregate["featured_axis"]["primary"] == "household_stratum"
