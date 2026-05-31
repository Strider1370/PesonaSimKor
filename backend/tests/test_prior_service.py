from app.services.prior_service import get_prior


def axes(gender="male", age_group="60s", province="서울"):
    return {"gender": gender, "age_group": age_group, "province": province}


def test_get_prior_builds_labeled_groups_for_each_axis():
    prior = get_prior("2_1", axes(gender="male", age_group="60s", province="서울"))
    assert prior is not None
    assert prior["topic"] == "신규 원전 건설"
    assert prior["national"] == {"support": 54, "oppose": 25, "undecided": 21}
    assert prior["groups"] == [
        {"label": "남성", "support": 70, "oppose": 20, "undecided": 10},
        {"label": "60대", "support": 69, "oppose": 16, "undecided": 14},
        {"label": "서울", "support": 60, "oppose": 20, "undecided": 20},
    ]


def test_get_prior_province_maps_to_region_label():
    prior = get_prior("2_1", axes(province="경기"))
    region = prior["groups"][-1]
    assert region["label"] == "인천·경기"
    assert region["support"] == 55

    prior = get_prior("2_1", axes(province="경상남"))
    region = prior["groups"][-1]
    assert region["label"] == "부산·울산·경남"
    assert region["support"] == 49


def test_get_prior_omits_region_when_suppressed():
    for province in ("강원", "제주"):
        prior = get_prior("2_1", axes(province=province))
        labels = [g["label"] for g in prior["groups"]]
        assert labels == ["남성", "60대"]  # no region entry


def test_get_prior_omits_region_for_unknown_province():
    prior = get_prior("2_1", axes(province="해외"))
    assert [g["label"] for g in prior["groups"]] == ["남성", "60대"]


def test_get_prior_returns_none_for_unknown_or_missing_topic():
    assert get_prior(None, axes()) is None
    assert get_prior("", axes()) is None
    assert get_prior("9_9", axes()) is None
