from app.services.prior_service import get_prior


def axes(gender="male", age_group="60s", province="서울"):
    return {"gender": gender, "age_group": age_group, "province": province}


def test_get_prior_matches_each_axis():
    prior = get_prior("2_1", axes(gender="male", age_group="60s", province="서울"))
    assert prior is not None
    assert prior["topic"] == "신규 원전 건설"
    assert prior["national"] == {"support": 54, "oppose": 25, "undecided": 21}
    assert prior["by_gender"] == {"support": 70, "oppose": 20, "undecided": 10}
    assert prior["by_age"] == {"support": 69, "oppose": 16, "undecided": 14}
    assert prior["by_region"] == {"support": 60, "oppose": 20, "undecided": 20}


def test_get_prior_province_maps_to_region_bucket():
    # 경기 belongs to the incheon_gyeonggi 권역
    prior = get_prior("2_1", axes(province="경기"))
    assert prior["by_region"] == {"support": 55, "oppose": 25, "undecided": 20}
    # 경상남 belongs to busan_ulsan_gyeongnam
    prior = get_prior("2_1", axes(province="경상남"))
    assert prior["by_region"] == {"support": 49, "oppose": 35, "undecided": 16}


def test_get_prior_suppressed_region_falls_back_to_national():
    prior = get_prior("2_1", axes(province="강원"))
    assert prior["by_region"] == prior["national"]
    prior = get_prior("2_1", axes(province="제주"))
    assert prior["by_region"] == prior["national"]


def test_get_prior_unknown_province_falls_back_to_national():
    prior = get_prior("2_1", axes(province="해외"))
    assert prior["by_region"] == prior["national"]


def test_get_prior_returns_none_for_unknown_or_missing_topic():
    assert get_prior(None, axes()) is None
    assert get_prior("", axes()) is None
    assert get_prior("9_9", axes()) is None
