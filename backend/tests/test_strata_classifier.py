from app.services.strata_classifier import classify_occupation, OCCUPATION_CODES


def test_occupation_codes_are_ksco_major():
    assert OCCUPATION_CODES == (
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "A",
        "unemployed",
    )


def test_known_occupations_map_to_csv_codes():
    assert classify_occupation("무직") == "unemployed"
    assert classify_occupation("경리 사무원") == "3"
    assert classify_occupation("건물 청소원") == "9"
    assert classify_occupation("건물 경비원") == "4"


def test_unseen_value_falls_back_to_etc():
    assert classify_occupation("듣도보도못한직업ZZZ") == "etc"


def test_every_csv_occupation_classifies_non_etc():
    from app.services.strata_classifier import _occ_map

    m = _occ_map()
    assert len(m) == 2120
    assert all(classify_occupation(k) in OCCUPATION_CODES for k in m)


def test_unemployed_substrata_enum():
    from app.services.strata_classifier import UNEMPLOYED_SUBSTRATA

    assert UNEMPLOYED_SUBSTRATA == ("노년은퇴", "청년취준", "전업돌봄", "구직중", "기타")


def test_unemployed_by_explicit_phrase():
    from app.services.strata_classifier import classify_unemployed_with_source

    assert classify_unemployed_with_source(
        {"professional_persona": "은퇴 후 산책을 즐긴다"},
        age=67,
        marital="배우자있음",
        family="배우자와 거주",
    ) == ("노년은퇴", "explicit")
    assert classify_unemployed_with_source(
        {"professional_persona": "전업주부로 아이를 돌본다"},
        age=40,
        marital="배우자있음",
        family="배우자와 자녀와 거주",
    ) == ("전업돌봄", "explicit")


def test_unemployed_skeleton_fallback_when_no_phrase():
    from app.services.strata_classifier import classify_unemployed_with_source

    assert classify_unemployed_with_source(
        {"professional_persona": "매일 산책을 한다"},
        age=70,
        marital="이혼",
        family="1인 가구",
    ) == ("노년은퇴", "fallback")
    assert classify_unemployed_with_source(
        {"professional_persona": "게임을 좋아한다"},
        age=24,
        marital="미혼",
        family="부모와 동거",
    ) == ("청년취준", "fallback")
    assert classify_unemployed_with_source(
        {"professional_persona": "가족을 챙긴다"},
        age=45,
        marital="배우자있음",
        family="배우자와 자녀와 거주",
    ) == ("전업돌봄", "fallback")
    assert classify_unemployed_with_source(
        {"professional_persona": "별 내용 없음"},
        age=50,
        marital="미혼",
        family="1인 가구",
    ) == ("구직중", "fallback")


def test_unemployed_etc_when_missing():
    from app.services.strata_classifier import classify_unemployed, classify_unemployed_with_source

    assert classify_unemployed({"professional_persona": ""}, age=None, marital="", family="") == "기타"
    assert classify_unemployed_with_source(
        {"professional_persona": ""},
        age=None,
        marital="",
        family="",
    ) == ("기타", "fallback")


def test_classify_persona_reads_nested_record():
    from app.services.strata_classifier import classify_persona

    rec = {
        "age": 41,
        "gender": "female",
        "age_group": "40s",
        "region_group": "capital",
        "structured_profile": {
            "age": 41,
            "gender": "female",
            "province": "서울",
            "district": "마포구",
            "occupation": "회계 사무원",
            "family_type": "배우자·자녀와 거주",
            "marital_status": "배우자있음",
            "housing_type": "아파트",
            "education_level": "4년제 대학교",
            "bachelors_field": "경영·행정·법",
        },
        "narrative_context": {"professional_persona": "", "persona": ""},
    }

    tags = classify_persona(rec)

    assert set(tags) == {
        "age_band",
        "gender",
        "region_group",
        "occupation_stratum",
        "household_stratum",
        "housing_stratum",
        "education_stratum",
        "field_stratum",
    }
    assert tags["occupation_stratum"] == "3"
    assert tags["household_stratum"] == "부부+자녀"
    assert tags["housing_stratum"] == "아파트"
    assert tags["education_stratum"] == "4년제 대학교"
    assert tags["field_stratum"] == "경영·행정·법"


def test_classify_persona_emits_unemployed_source_when_needed():
    from app.services.strata_classifier import classify_persona

    rec = {
        "age": 67,
        "gender": "male",
        "age_group": "60s",
        "region_group": "honam",
        "structured_profile": {
            "age": 67,
            "gender": "male",
            "occupation": "무직",
            "family_type": "혼자 거주",
            "marital_status": "이혼",
            "housing_type": "단독주택",
            "education_level": "고등학교",
            "bachelors_field": "해당없음",
        },
        "narrative_context": {"professional_persona": "은퇴 후 텃밭을 가꾼다", "persona": ""},
    }

    tags = classify_persona(rec)

    assert tags["occupation_stratum"] == "unemployed_노년은퇴"
    assert tags["classification_source"] == "explicit"
