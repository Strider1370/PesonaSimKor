import json
import threading
from types import SimpleNamespace
import time

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models.schemas import SimulateRequest
from app.services.aggregation import compute_aggregate
from app.services.persona_repository import normalize_record
from app.services.llm_client import (
    build_agent_llm_payload,
    build_agent_messages,
    build_agent_prompt,
    build_summary_llm_payload,
    CORE_NARRATIVE_KEYS,
    failed_summary,
    get_openai_api_key,
    normalize_summary,
    OPTIONAL_NARRATIVE_FIELDS,
    parse_agent_response,
    parse_json_object,
    STRUCTURED_PROFILE_KEYS,
    summary_from_text,
    stream_openai_agent_response,
    stream_openai_summary_clusters,
)


def empty_summary():
    return {
        "status": "empty",
        "message": "empty summary",
        "concern_clusters": [],
        "support_clusters": [],
        "blind_spot_clusters": [],
        "raw_output": '{"concern_clusters":[],"support_clusters":[]}',
    }


def summary_stream():
    return iter(
        [
            {"type": "thinking", "content": "summary thinking"},
            {"type": "token", "content": '{"concern_clusters":[],"support_clusters":[]}'},
            {"type": "final", "summary": empty_summary()},
        ]
    )


def test_persona_field_constants_are_disjoint_and_exclude_noise():
    assert "military_status" not in STRUCTURED_PROFILE_KEYS
    assert "country" not in STRUCTURED_PROFILE_KEYS
    assert len(STRUCTURED_PROFILE_KEYS) == 10
    assert set(CORE_NARRATIVE_KEYS) == {
        "professional_persona", "family_persona", "persona", "career_goals_and_ambitions",
    }
    # Conditional _list variants are intentionally not loaded.
    assert all(not k.endswith("_list") for k in OPTIONAL_NARRATIVE_FIELDS)
    # All sets are disjoint.
    assert set(STRUCTURED_PROFILE_KEYS).isdisjoint(CORE_NARRATIVE_KEYS)
    assert set(CORE_NARRATIVE_KEYS).isdisjoint(OPTIONAL_NARRATIVE_FIELDS)


def _raw_row():
    return {
        "age": 41, "sex": "female", "province": "Seoul", "district": "Mapo",
        "occupation": "unemployed", "education_level": "bachelors", "marital_status": "married",
        "military_status": "not_applicable", "family_type": "spouse_children", "housing_type": "owned",
        "bachelors_field": "social_science", "country": "Korea", "persona": "P", "cultural_background": "C",
        "career_goals_and_ambitions": "G", "hobbies_and_interests": "H",
        "professional_persona": "PP", "family_persona": "FP", "skills_and_expertise": "SE",
        "arts_persona": "AP", "travel_persona": "TP", "culinary_persona": "CP", "sports_persona": "SP",
    }


def test_normalize_record_structured_profile_excludes_noise():
    rec = normalize_record(0, _raw_row())
    sp = rec["structured_profile"]
    assert "military_status" not in sp and "country" not in sp
    assert set(sp.keys()) == {
        "age", "gender", "province", "district", "occupation",
        "family_type", "marital_status", "housing_type", "education_level", "bachelors_field",
    }


def test_normalize_record_narrative_context_has_core_and_optional():
    rec = normalize_record(0, _raw_row())
    nc = rec["narrative_context"]
    for k in ("professional_persona", "family_persona", "persona", "career_goals_and_ambitions"):
        assert k in nc
    for k in ("arts_persona", "skills_and_expertise", "cultural_background", "hobbies_and_interests"):
        assert k in nc


_PERSONA = {
    "agent_id": 0, "age": 41, "gender": "female", "region": "Mapo",
    "structured_profile": {
        "age": 41, "gender": "female", "province": "Seoul", "district": "Mapo",
        "occupation": "unemployed", "family_type": "spouse_children", "marital_status": "married",
        "housing_type": "owned", "education_level": "bachelors", "bachelors_field": "social_science",
    },
    "narrative_context": {
        "persona": "P", "professional_persona": "PP", "family_persona": "FP",
        "career_goals_and_ambitions": "G", "cultural_background": "C",
        "skills_and_expertise": "SE", "arts_persona": "AP", "travel_persona": "TP",
        "culinary_persona": "CP", "sports_persona": "SP", "hobbies_and_interests": "H",
    },
}


def test_prompt_minimal_has_structured_no_narrative_no_noise():
    p = build_agent_prompt(_PERSONA, "policy", "minimal")
    assert "occupation" in p and "Mapo" in p
    assert "PP" not in p and "professional_persona" not in p
    assert "military_status" not in p and "country" not in p


def test_prompt_standard_core_plus_selected_optional_only():
    p = build_agent_prompt(_PERSONA, "policy", "standard", optional_fields=("arts_persona",))
    assert "PP" in p and "FP" in p
    assert "AP" in p
    assert "TP" not in p and "SP" not in p
    assert "CP" not in p


def test_prompt_full_includes_all_optional_ignoring_arg():
    p = build_agent_prompt(_PERSONA, "policy", "full", optional_fields=())
    for v in ("AP", "TP", "CP", "SP", "SE", "C", "H"):
        assert v in p


def test_messages_thread_optional_fields():
    msgs = build_agent_messages(_PERSONA, "policy", "standard", optional_fields=("arts_persona",))
    assert "AP" in msgs[1]["content"] and "TP" not in msgs[1]["content"]


def test_payload_thread_optional_fields():
    payload = build_agent_llm_payload(
        _PERSONA,
        "policy",
        persona_depth="standard",
        optional_fields=("arts_persona",),
    )
    assert "AP" in payload["messages"][1]["content"]


def test_parse_valid_agent_response_json():
    parsed = parse_agent_response('{"stance": "support", "rationale": "ok"}')

    assert parsed == {"stance": "support", "rationale": "ok"}


def test_parse_agent_response_extracts_json_from_text():
    parsed = parse_agent_response('prefix {"stance": "oppose", "rationale": "no"} suffix')

    assert parsed == {"stance": "oppose", "rationale": "no"}


def test_parse_agent_response_falls_back_on_malformed_output():
    parsed = parse_agent_response("not json")

    assert parsed == {"stance": "neutral", "rationale": "Model output could not be parsed."}


def test_parse_agent_response_handles_fenced_json():
    parsed = parse_agent_response('```json\n{"stance":"support","rationale":"ok"}\n```')

    assert parsed == {"stance": "support", "rationale": "ok"}


def test_parse_agent_response_trims_output_key_names():
    parsed = parse_agent_response('{"stance":"neutral"," rationale":"watch carefully"}')

    assert parsed == {"stance": "neutral", "rationale": "watch carefully"}


def test_parse_agent_response_keeps_common_blind_spot_fields():
    parsed = parse_agent_response(
        '{"stance":"반대","rationale":"부담이 큽니다.",'
        '"blind_spot":"야간 근무자는 요금 변화에 취약합니다.",'
        '"affected_group":"수도권 야간 이전 노동자"}'
    )

    assert parsed == {
        "stance": "oppose",
        "rationale": "부담이 큽니다.",
        "blind_spot": "야간 근무자는 요금 변화에 취약합니다.",
        "affected_group": "수도권 야간 이전 노동자",
    }


def test_parse_agent_response_keeps_openai_only_fields_for_openai():
    parsed = parse_agent_response(
        '{"stance":"중립","rationale":"조건에 따라 다릅니다.",'
        '"blind_spot":"지역 신청 시간이 근무시간과 겹칩니다.",'
        '"affected_group":"교대 근무 맞벌이 노동자",'
        '"reframing":"지원 금액보다 신청 접근성이 먼저입니다.",'
        '"persona_link":{"direct":"교대 근무, 자녀 등교","inferred":"근무시간 때문에 행정 접근성이 낮음"}}',
        model_provider="openai",
    )

    assert parsed["stance"] == "neutral"
    assert parsed["reframing"] == "지원 금액보다 신청 접근성이 먼저입니다."
    assert parsed["persona_link"] == {
        "direct": "교대 근무, 자녀 등교",
        "inferred": "근무시간 때문에 행정 접근성이 낮음",
    }


def test_parse_agent_response_keeps_openai_fields_without_provider_branch():
    parsed = parse_agent_response(
        '{"stance":"support","rationale":"ok","reframing":"frame",'
        '"persona_link":{"direct":"direct","inferred":"inferred"}}'
    )

    assert parsed["reframing"] == "frame"
    assert parsed["persona_link"] == {"direct": "direct", "inferred": "inferred"}

def test_agent_messages_use_openai_system_prompt_and_user_prompt_not_two_keys():
    persona = {
        "agent_id": 1,
        "age": 42,
        "gender": "female",
        "region": "Gyeonggi",
        "job": "driver",
        "structured_profile": {"occupation": "driver", "housing_type": "apartment"},
        "narrative_context": {"persona": "자녀를 키우는 운전자"},
    }

    messages = build_agent_messages(persona, "policy")

    assert "blind_spot" in messages[0]["content"]
    assert "affected_group" in messages[0]["content"]
    assert "reframing" in messages[0]["content"]
    assert "persona_link" in messages[0]["content"]
    assert "[Question]" in messages[1]["content"]
    assert "Return only JSON with keys stance and rationale" not in messages[1]["content"]
    assert "exactly two keys" not in messages[1]["content"]


def test_parse_agent_response_keeps_caveat_and_stance_strength():
    parsed = parse_agent_response(
        '{"stance":"찬성","stance_strength":"기울어짐","rationale":"정책 방향은 받아들입니다.",'
        '"caveat":"다만 보완책은 필요합니다."}'
    )

    assert parsed == {
        "stance": "support",
        "stance_strength": "기울어짐",
        "rationale": "정책 방향은 받아들입니다.",
        "caveat": "다만 보완책은 필요합니다.",
    }


def test_parse_agent_response_keeps_expected_complaint():
    raw = '{"stance":"중립","rationale":"r","expected_complaint":"나는 대상자인가요?"}'

    parsed = parse_agent_response(raw)

    assert parsed["expected_complaint"] == "나는 대상자인가요?"


def test_parse_agent_response_omits_null_expected_complaint():
    raw = '{"stance":"중립","rationale":"r","expected_complaint":null}'

    parsed = parse_agent_response(raw)

    assert "expected_complaint" not in parsed


def test_parse_agent_response_drops_null_optional_blind_spot_fields():
    parsed = parse_agent_response(
        '{"stance":"찬성","rationale":"정책 방향은 받아들입니다.",'
        '"blind_spot":null,"affected_group":"null","caveat":"null"}'
    )

    assert parsed == {"stance": "support", "rationale": "정책 방향은 받아들입니다."}


def test_agent_messages_explain_general_stance_and_blind_spot_rules():
    persona = {
        "agent_id": 1,
        "age": 42,
        "gender": "female",
        "region": "Gyeonggi",
        "job": "driver",
    }

    messages = build_agent_messages(persona, "정책 방향", model_provider="openai")
    full_prompt = "\n".join(message["content"] for message in messages)

    assert "최종 선택 방향" in full_prompt
    assert "조건부 동의" in full_prompt
    assert "caveat" in full_prompt
    assert "직접성" in full_prompt
    assert "특수성" in full_prompt
    assert "비중복성" in full_prompt
    assert "세 조건 중 하나라도 부족하면 blind_spot은 null" in full_prompt


def test_agent_messages_limit_policy_expert_style_and_caveat_scope():
    messages = build_agent_messages(
        {
            "agent_id": 1,
            "age": 52,
            "gender": "male",
            "region": "Seoul",
            "job": "store owner",
            "structured_profile": {"occupation": "store owner"},
            "narrative_context": {"persona": "작은 가게를 운영한다."},
        },
        "원전 확대",
        model_provider="openai",
    )
    full_prompt = "\n".join(message["content"] for message in messages)

    assert "정책 전문가가 아닙니다" in full_prompt
    assert "포괄적인 조건 목록" in full_prompt
    assert "1~2개 이유" in full_prompt
    assert "전문용어" in full_prompt
    assert "유보점 하나" in full_prompt
    assert "정책 보완책 묶음" in full_prompt
    assert "전문가적 정책 분석이 아닙니다" in full_prompt
    assert "정책 구조 전체를 분석해야만 보이는 문제" in full_prompt


def test_parse_json_object_handles_nested_json():
    parsed = parse_json_object('noise {"a": {"b": 1}, "c": 2} tail')

    assert parsed == {"a": {"b": 1}, "c": 2}


def test_structure_policy_fallback_on_parse_error(monkeypatch):
    from app.services import llm_client

    monkeypatch.setattr(llm_client, "_structure_policy_raw", lambda text: "not-json")

    out = llm_client.structure_policy("청년 월세 한시 지원\n대상: 만19-34")

    assert out["policy_name"]["source"] == "stated"
    assert out["policy_name"]["value"]


def test_summary_prompt_explicitly_limits_recheck_loops():
    payload = build_summary_llm_payload("policy", [{"stance": "support", "rationale": "ok"}])
    system_prompt = payload["messages"][0]["content"]

    assert "at most 3 short reasoning bullets" in system_prompt
    assert "Do not restart, re-check, say wait" in system_prompt


def test_summary_prompt_requests_result_page_short_fields_and_agent_ids():
    payload = build_summary_llm_payload(
        "policy",
        [
            {
                "agent_id": 9,
                "age_group": "50s",
                "gender": "female",
                "region_group": "capital",
                "stance": "oppose",
                "rationale": "living costs are worrying",
                "blind_spot": "night workers may miss application windows",
                "affected_group": "night shift workers",
            }
        ],
    )
    full_prompt = "\n".join(message["content"] for message in payload["messages"])

    assert "short_label" in full_prompt
    assert "short_title" in full_prompt
    assert "agent_ids" in full_prompt
    assert "Response #9" in full_prompt
    assert "Do not invent or infer ids" in full_prompt
    assert "Merge blind spots that share the same policy bottleneck" in full_prompt
    assert "Keep one-person blind spots as single clusters" not in full_prompt


def test_compute_aggregate_collects_blind_spots_and_reframing():
    aggregate = compute_aggregate(
        [
            {
                "stance": "oppose",
                "age_group": "40s",
                "gender": "female",
                "region_group": "capital",
                "blind_spot": "월세 전환 때 보증금 흐름이 불안정합니다.",
                "affected_group": "수도권 맞벌이 가구",
                "reframing": "월세 지원보다 금융 안정성이 먼저입니다.",
            },
            {
                "stance": "support",
                "age_group": "70_plus",
                "gender": "male",
                "region_group": "honam",
                "blind_spot": "온라인 신청만 있으면 접근이 어렵습니다.",
            },
        ]
    )

    assert aggregate["blind_spot_raw"] == [
        {
            "blind_spot": "월세 전환 때 보증금 흐름이 불안정합니다.",
            "affected_group": "수도권 맞벌이 가구",
        },
        {
            "blind_spot": "온라인 신청만 있으면 접근이 어렵습니다.",
            "affected_group": "",
        },
    ]
    assert aggregate["reframing_list"] == [
        {
            "text": "월세 지원보다 금융 안정성이 먼저입니다.",
            "age_group": "40s",
            "gender": "female",
            "region_group": "capital",
        }
    ]
    assert aggregate["blind_spot_clusters"] == []


def test_summary_from_text_parses_blind_spot_clusters_and_completed_status():
    raw_output = json.dumps(
        {
            "concern_clusters": [],
            "support_clusters": [],
            "blind_spot_clusters": [
                {
                    "affected_group": "수도권 맞벌이 가구",
                    "count": 2,
                    "blind_spot_examples": ["보증금 흐름 불안"],
                }
            ],
        },
        ensure_ascii=False,
    )

    summary = summary_from_text(raw_output)

    assert summary["status"] == "completed"
    assert summary["blind_spot_clusters"] == [
        {
            "affected_group": "수도권 맞벌이 가구",
            "short_title": "",
            "count": 2,
            "blind_spot_examples": ["보증금 흐름 불안"],
            "agent_ids": [],
        }
    ]


def test_summary_from_text_preserves_result_page_fields():
    raw_output = json.dumps(
        {
            "headline": "blind spots appeared",
            "concern_clusters": [
                {
                    "label": "living costs may rise",
                    "short_label": "living costs",
                    "count": 3,
                    "examples": ["burden"],
                }
            ],
            "support_clusters": [
                {
                    "label": "education labor rights are protected",
                    "short_label": "labor rights",
                    "count": 2,
                    "examples": ["needed"],
                }
            ],
            "blind_spot_clusters": [
                {
                    "affected_group": "night shift workers",
                    "short_title": "night shift",
                    "count": 1,
                    "blind_spot_examples": ["(Response #9) missed application windows"],
                    "agent_ids": [9],
                }
            ],
        },
        ensure_ascii=False,
    )

    summary = summary_from_text(raw_output)

    assert summary["headline"] == "blind spots appeared"
    assert summary["concern_clusters"][0]["short_label"] == "living costs"
    assert summary["support_clusters"][0]["short_label"] == "labor rights"
    assert summary["blind_spot_clusters"][0]["short_title"] == "night shift"
    assert summary["blind_spot_clusters"][0]["agent_ids"] == [9]


def test_normalize_summary_fills_missing_short_labels_and_titles():
    summary = {
        "status": "completed",
        "message": "ok",
        "concern_clusters": [{"label": "생활비 부담이 커진다는 우려", "count": 2, "examples": []}],
        "support_clusters": [{"label": "아이들 활동 보장을 지지", "count": 1, "examples": []}],
        "blind_spot_clusters": [
            {
                "affected_group": "야간근무 보호자",
                "count": 1,
                "blind_spot_examples": ["(응답자 7) 낮 시간 안내를 챙기기 어렵습니다."],
            }
        ],
    }
    responses = [{"agent_id": 7, "blind_spot": "낮 시간 안내를 챙기기 어렵습니다."}]

    normalized = normalize_summary(summary, responses)

    assert normalized["concern_clusters"][0]["short_label"] == "생활비 부담"
    assert normalized["support_clusters"][0]["short_label"] == "아이들 활동"
    assert normalized["blind_spot_clusters"][0]["short_title"] == "야간근무 보호자"
    assert normalized["blind_spot_clusters"][0]["agent_ids"] == [7]


def test_normalize_summary_removes_unknown_agent_ids_and_corrects_count():
    summary = {
        "status": "completed",
        "message": "ok",
        "concern_clusters": [],
        "support_clusters": [],
        "blind_spot_clusters": [
            {
                "affected_group": "맞벌이 가구",
                "short_title": "맞벌이 가구",
                "count": 1,
                "blind_spot_examples": ["(응답자 1) 일정 조정이 어렵습니다.", "(응답자 2) 돌봄 공백이 생깁니다."],
                "agent_ids": [1, 2, 999],
            }
        ],
    }
    responses = [{"agent_id": 1}, {"agent_id": 2}]

    normalized = normalize_summary(summary, responses)

    assert normalized["blind_spot_clusters"][0]["agent_ids"] == [1, 2]
    assert normalized["blind_spot_clusters"][0]["count"] == 2


def test_cluster_representative_quote_is_verbatim_and_deterministic():
    from app.services.llm_client import attach_representative_quotes

    responses = [
        {"agent_id": 0, "blind_spot": "가구 조건이 좁다"},
        {"agent_id": 1, "blind_spot": "동거 청년이 빠진다고 본다 길게 적음"},
        {"agent_id": 2, "blind_spot": "앱만 된다"},
    ]
    clusters = [{"agent_ids": [0, 1, 2], "count": 3}]

    out = attach_representative_quotes(clusters, responses, field="blind_spot")

    assert out[0]["representative_quote"] == "가구 조건이 좁다"
    assert out[0]["denominator"] == 3


def test_normalize_summary_preserves_unclustered_raw_blind_spots():
    responses = [
        {"agent_id": 0, "blind_spot": "앱 가입이 어렵다", "affected_group": "디지털 취약 이용자"},
        {"agent_id": 1, "blind_spot": "야간 택시 이용자는 빠진다", "affected_group": "야간 근무자"},
    ]
    raw = {
        "blind_spot_clusters": [
            {
                "affected_group": "디지털 취약 이용자",
                "short_title": "앱 가입",
                "blind_spot_examples": ["앱 가입이 어렵다"],
                "agent_ids": [0],
                "count": 1,
            }
        ]
    }

    out = normalize_summary(raw, responses)

    assert [cluster["agent_ids"] for cluster in out["blind_spot_clusters"]] == [[0], [1]]
    assert out["blind_spot_clusters"][1]["affected_group"] == "야간 근무자"
    assert out["blind_spot_clusters"][1]["representative_quote"] == "야간 택시 이용자는 빠진다"


def test_inferred_based_uses_direct_empty_proxy():
    from app.services.llm_client import compute_inferred_based

    responses = [
        {"agent_id": 0, "persona_link": {"direct": "", "inferred": "추론"}},
        {"agent_id": 1, "persona_link": {"direct": "명시", "inferred": ""}},
    ]

    assert compute_inferred_based([0, 0], responses) is True
    assert compute_inferred_based([1], responses) is False


def test_normalize_summary_emits_complaint_clusters():
    responses = [
        {"agent_id": 0, "expected_complaint": "대상자인가요?"},
        {"agent_id": 1, "expected_complaint": "앱 말고 신청법?"},
    ]
    raw = {"complaint_clusters": [{"short_title": "자격", "agent_ids": [0, 99], "count": 2}]}

    out = normalize_summary(raw, responses)

    assert out["complaint_clusters"][0]["agent_ids"] == [0]
    assert out["complaint_clusters"][0]["representative_quote"] == "대상자인가요?"


def test_normalize_summary_uses_refill_callback_before_fallback():
    summary = {
        "status": "completed",
        "message": "ok",
        "concern_clusters": [{"label": "생활비 부담이 커진다는 우려", "count": 1, "examples": []}],
        "support_clusters": [],
        "blind_spot_clusters": [
            {
                "affected_group": "야간근무 보호자",
                "count": 1,
                "blind_spot_examples": ["(응답자 7) 낮 시간 안내를 챙기기 어렵습니다."],
            }
        ],
    }

    def refill_missing(missing_summary):
        assert missing_summary["concern_clusters"][0]["label"] == "생활비 부담이 커진다는 우려"
        return {
            "concern_clusters": [{"label": "생활비 부담이 커진다는 우려", "short_label": "생활비 부담"}],
            "blind_spot_clusters": [{"affected_group": "야간근무 보호자", "short_title": "야간 보호자"}],
        }

    normalized = normalize_summary(summary, [{"agent_id": 7}], refill_missing=refill_missing)

    assert normalized["concern_clusters"][0]["short_label"] == "생활비 부담"
    assert normalized["blind_spot_clusters"][0]["short_title"] == "야간 보호자"


def test_failed_summary_includes_blind_spot_clusters_default():
    summary = failed_summary("no output")

    assert summary["blind_spot_clusters"] == []


def test_summary_prompt_requests_blind_spot_clusters_schema():
    payload = build_summary_llm_payload(
        "월세 지원",
        [
            {
                "stance": "oppose",
                "rationale": "불안정합니다.",
                "blind_spot": "월세 전환 때 보증금 흐름 불안",
                "affected_group": "수도권 맞벌이 가구",
            }
        ],
    )
    full_prompt = "\n".join(message["content"] for message in payload["messages"])

    assert "blind_spot_clusters" in full_prompt
    assert "complaint_clusters" in full_prompt
    assert "affected_group_clusters" in full_prompt
    assert "affected_group" in full_prompt
    assert "expected_complaint" in full_prompt
    assert "blind_spot_examples" in full_prompt
    assert "non-null blind_spot" in full_prompt
    assert "blind_spot_clusters must be []" in full_prompt


def test_agent_prompt_includes_structured_profile_and_selected_narratives():
    persona = {
        "age": 42,
        "gender": "female",
        "region": "Gyeonggi-Yangju",
        "job": "care worker",
        "education": "college",
        "background": "A 40s woman living in Yangju.",
        "structured_profile": {
            "province": "Gyeonggi",
            "district": "Gyeonggi-Yangju",
            "marital_status": "married",
            "housing_type": "apartment",
            "country": "Korea",
        },
        "narrative_context": {
            "persona": "A 40s woman living in Yangju.",
            "cultural_background": "Local community context.",
        },
    }

    prompt = build_agent_prompt(persona, "policy", optional_fields=("cultural_background",))

    assert "[Structured Profile]" in prompt
    assert "marital_status: married" in prompt
    assert "housing_type: apartment" in prompt
    assert "country" not in prompt
    assert "[Narrative Context]" in prompt
    assert "cultural_background: Local community context." in prompt


def test_build_agent_prompt_minimal_depth_excludes_job_and_narrative():
    persona = {
        "agent_id": 1,
        "age": 35,
        "gender": "female",
        "region": "Seoul",
        "job": "teacher",
        "education": "college",
        "structured_profile": {
            "age": 35,
            "gender": "female",
            "district": "Seoul",
            "education_level": "college",
            "occupation": "teacher",
        },
        "narrative_context": {"persona": "A teacher with a housing loan."},
    }

    prompt = build_agent_prompt(persona, "policy", persona_depth="minimal")

    assert "age: 35" in prompt
    assert "gender: female" in prompt
    assert "district: Seoul" in prompt
    assert "occupation: teacher" in prompt
    assert "housing loan" not in prompt


def test_build_agent_prompt_keeps_user_message_to_inputs_and_question():
    prompt = build_agent_prompt({"age": 35, "gender": "male", "region": "Seoul"}, "policy")

    assert "[Question]" in prompt
    assert "[Task]" not in prompt
    assert "위 정책 방향에 대해 당신은 찬성, 반대, 중립 중 어느 쪽에 가장 가깝습니까?" in prompt
    assert "정책 전문가처럼 답하지 말고" not in prompt
    assert "조건부 동의나 조건부 반대" not in prompt
    assert "blind_spot은 직접성·특수성·비중복성" not in prompt
    assert "시스템 메시지에서 요구한 JSON 구조" not in prompt


def test_build_agent_llm_payload_uses_requested_model_thinking_and_depth():
    persona = {
        "agent_id": 1,
        "age": 35,
        "gender": "female",
        "region": "Seoul",
        "job": "teacher",
        "age_group": "30s",
        "region_group": "capital",
    }

    payload = build_agent_llm_payload(
        persona,
        "policy",
        model_name="gpt-5-mini",
        thinking=True,
        persona_depth="minimal",
    )

    assert payload["model"] == "gpt-5-mini"
    assert "think" not in payload
    assert "options" not in payload
    assert "occupation:" not in payload["messages"][1]["content"]


def test_build_agent_llm_payload_omits_local_options_for_openai():
    payload = build_agent_llm_payload(
        {"agent_id": 1},
        "policy",
        model_name="gpt-4o-mini",
        thinking=True,
        model_provider="openai",
    )

    assert payload["model"] == "gpt-4o-mini"
    assert "options" not in payload
    assert "think" not in payload


def test_healthz_returns_dataset_status_without_local_llm_fields():
    client = TestClient(app)
    response = client.get("/healthz")

    assert response.status_code == 200
    payload = response.json()
    assert "ollama_host" not in payload
    assert "ollama_model" not in payload
    assert "ollama_reachable" not in payload
    assert "dataset_loaded" in payload


def test_simulate_preflight_allows_127_frontend_origin():
    client = TestClient(app)
    response = client.options(
        "/api/simulate",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_simulate_request_defaults_to_openai_model_and_accepts_options():
    req = SimulateRequest(
        policy="policy",
        n_agents=12,
        thinking=True,
        persona_depth="full",
    )

    assert req.model_provider == "openai"
    assert req.model_name == "gpt-5-mini"
    assert req.thinking is True
    assert req.persona_depth == "full"


def test_simulate_request_rejects_local_provider():
    try:
        SimulateRequest(policy="policy", model_provider="ollama")
    except ValidationError as exc:
        assert "model_provider" in str(exc)
    else:
        raise AssertionError("Expected validation error")


def test_simulate_request_has_no_topic_id():
    from app.models.schemas import SimulateRequest

    req = SimulateRequest(policy="청년 월세 지원", n_agents=5)
    assert not hasattr(req, "topic_id")


def test_simulate_request_rejects_invalid_provider_and_depth():
    try:
        SimulateRequest(policy="policy", model_provider="bad", persona_depth="huge")
    except ValidationError as exc:
        errors = str(exc)
        assert "model_provider" in errors
        assert "persona_depth" in errors
    else:
        raise AssertionError("Expected validation error")


def test_response_event_includes_complaint_and_demographics():
    from app.api.simulate import response_event_from_result

    persona = {
        "agent_id": 0,
        "age": 27,
        "gender": "male",
        "province": "경기",
        "district": "파주시",
        "occupation": "무직",
        "family_type": "3세대 가구",
        "age_group": "20s",
        "region_group": "incheon_gyeonggi",
    }
    result = {"stance": "neutral", "rationale": "r", "expected_complaint": "대상자인가요?"}

    ev = response_event_from_result(persona, result)

    assert ev["expected_complaint"] == "대상자인가요?"
    for key in ("age", "province", "district", "occupation", "family_type"):
        assert key in ev


def test_get_openai_api_key_requires_env(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    try:
        get_openai_api_key()
    except RuntimeError as exc:
        assert "OPENAI_API_KEY" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError")


def test_get_openai_api_key_reads_env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    assert get_openai_api_key() == "sk-test"


def test_openai_agent_response_uses_reasoning_effort_when_thinking_enabled(monkeypatch):
    import openai
    import app.services.llm_client as llm_client

    captured = {}

    class CapturingCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return iter([SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content='{"stance":"support","rationale":"ok"}'))])])

    class CapturingOpenAI:
        def __init__(self, *args, **kwargs):
            pass

        chat = SimpleNamespace(completions=CapturingCompletions())

    monkeypatch.setattr(llm_client, "get_openai_api_key", lambda: "sk-test")
    monkeypatch.setattr(openai, "OpenAI", CapturingOpenAI)

    events = list(stream_openai_agent_response({"agent_id": 1}, "policy", model_name="gpt-5-mini", thinking=True))

    assert captured["reasoning_effort"] == "medium"
    assert events[-1]["response"]["stance"] == "support"


def test_openai_summary_uses_reasoning_effort_when_thinking_enabled(monkeypatch):
    import openai
    import app.services.llm_client as llm_client

    captured = {}

    class CapturingCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return iter(
                [
                    SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                delta=SimpleNamespace(content='{"concern_clusters":[],"support_clusters":[]}')
                            )
                        ]
                    )
                ]
            )

    class CapturingOpenAI:
        def __init__(self, *args, **kwargs):
            pass

        chat = SimpleNamespace(completions=CapturingCompletions())

    monkeypatch.setattr(llm_client, "get_openai_api_key", lambda: "sk-test")
    monkeypatch.setattr(openai, "OpenAI", CapturingOpenAI)

    events = list(stream_openai_summary_clusters("policy", [], model_name="gpt-5-mini", thinking=True))

    assert captured["reasoning_effort"] == "medium"
    assert events[-1]["summary"]["status"] == "empty"


def sample_personas(n: int):
    personas = [
        {
            "agent_id": index,
            "age": 25 + index,
            "gender": "female" if index % 2 == 0 else "male",
            "region": "Seoul Gangnam",
            "job": "office worker",
            "education": "college",
            "background": "A",
            "age_group": "20s",
            "region_group": "capital",
            "structured_profile": {"province": "서울"},
        }
        for index in range(n)
    ]
    return personas, {"n_agents": n, "axes": ["age_group", "region_group", "gender"], "total_records": n, "cells": []}


def patch_fast_simulation(monkeypatch, simulate_api, agent_stream=None, summary=None):
    monkeypatch.setattr(simulate_api, "sample_personas_with_plan", sample_personas)
    monkeypatch.setattr(
        simulate_api,
        "stream_openai_agent_response",
        agent_stream
        or (
            lambda persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard": iter(
                [{"type": "token", "content": "raw"}, {"type": "final", "response": {"stance": "support", "rationale": "ok"}}]
            )
        ),
    )
    monkeypatch.setattr(simulate_api, "stream_openai_summary_clusters", lambda policy, responses, model_name=None, thinking=False: summary or summary_stream())
    monkeypatch.setattr(simulate_api, "refill_summary_short_fields", lambda *args, **kwargs: {})


def test_simulate_stream_event_order_with_summary_stream(monkeypatch):
    from app.api import simulate as simulate_api

    patch_fast_simulation(monkeypatch, simulate_api)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")]

    assert events[0] == "policy_structured"
    assert events[1] == "sampling_plan"
    assert events.count("agent_sampled") == 5
    assert events.count("llm_prompt") == 5
    assert "llm_status" in events
    assert "llm_token" in events
    assert "summary_prompt" in events
    assert "summary_status" in events
    assert "summary_token" in events
    assert events[-2:] == ["aggregate", "done"]


def test_simulate_stream_includes_llm_input_payload(monkeypatch):
    from app.api import simulate as simulate_api

    patch_fast_simulation(monkeypatch, simulate_api)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    llm_payloads = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif current_event == "llm_prompt" and line.startswith("data: "):
            llm_payloads.append(json.loads(line.removeprefix("data: ")))

    assert llm_payloads[0]["agent_id"] == 0
    assert llm_payloads[0]["model"] == "gpt-5-mini"
    assert "options" not in llm_payloads[0]
    assert "think" not in llm_payloads[0]
    assert llm_payloads[0]["messages"][0]["role"] == "system"
    assert "policy" in llm_payloads[0]["messages"][1]["content"]


def test_simulate_stream_includes_blind_spot_fields_in_response_and_aggregate(monkeypatch):
    from app.api import simulate as simulate_api

    def agent_stream(
        persona,
        policy,
        prior=None,
        model_name=None,
        thinking=False,
        persona_depth="standard",
        model_provider="openai",
    ):
        yield {"type": "token", "content": "raw"}
        yield {
            "type": "final",
            "response": {
                "stance": "oppose",
                "stance_strength": "기울어짐",
                "rationale": "부담이 큽니다.",
                "caveat": "보완책은 별도로 필요합니다.",
                "blind_spot": "월세 전환 때 보증금 흐름 불안",
                "affected_group": "수도권 맞벌이 가구",
                "reframing": "월세 지원보다 금융 안정성이 먼저입니다.",
                "persona_link": {"direct": "자녀 등교", "inferred": "주거비 민감"},
            },
        }

    def custom_summary_stream():
        yield {
            "type": "final",
            "summary": {
                "status": "completed",
                "message": "ok",
                "concern_clusters": [],
                "support_clusters": [],
                "blind_spot_clusters": [
                    {
                        "affected_group": "수도권 맞벌이 가구",
                        "count": 5,
                        "blind_spot_examples": ["(응답자 0) 월세 전환 때 보증금 흐름 불안"],
                    }
                ],
                "raw_output": "{}",
            },
        }

    patch_fast_simulation(monkeypatch, simulate_api, agent_stream=agent_stream, summary=custom_summary_stream())

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    agent_payloads = []
    aggregate_payloads = []
    prompt_payloads = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif line.startswith("data: "):
            payload = json.loads(line.removeprefix("data: "))
            if current_event == "agent_responded":
                agent_payloads.append(payload)
            elif current_event == "aggregate":
                aggregate_payloads.append(payload)
            elif current_event == "llm_prompt":
                prompt_payloads.append(payload)

    assert agent_payloads[0]["blind_spot"] == "월세 전환 때 보증금 흐름 불안"
    assert agent_payloads[0]["stance_strength"] == "기울어짐"
    assert agent_payloads[0]["caveat"] == "보완책은 별도로 필요합니다."
    assert agent_payloads[0]["affected_group"] == "수도권 맞벌이 가구"
    assert agent_payloads[0]["reframing"] == "월세 지원보다 금융 안정성이 먼저입니다."
    assert agent_payloads[0]["persona_link"] == {"direct": "자녀 등교", "inferred": "주거비 민감"}
    assert aggregate_payloads[-1]["blind_spot_clusters"] == [
        {
            "affected_group": "수도권 맞벌이 가구",
            "short_title": "수도권 맞벌이 가구",
            "count": 5,
            "blind_spot_examples": [
                "(응답자 0) 월세 전환 때 보증금 흐름 불안",
                "월세 전환 때 보증금 흐름 불안",
                "월세 전환 때 보증금 흐름 불안",
                "월세 전환 때 보증금 흐름 불안",
                "월세 전환 때 보증금 흐름 불안",
            ],
            "agent_ids": [0, 1, 2, 3, 4],
            "title_fallback": True,
            "denominator": 5,
            "representative_quote": "월세 전환 때 보증금 흐름 불안",
            "inferred_based": False,
        }
    ]
    assert aggregate_payloads[-1]["blind_spot_clusters"][0]["short_title"]
    assert aggregate_payloads[-1]["blind_spot_clusters"][0]["agent_ids"]
    assert "blind_spot" in prompt_payloads[0]["messages"][0]["content"]


def test_simulate_stream_drops_fabricated_summary_blind_spots_without_raw_blind_spots(monkeypatch):
    from app.api import simulate as simulate_api

    def agent_stream(
        persona,
        policy,
        prior=None,
        model_name=None,
        thinking=False,
        persona_depth="standard",
        model_provider="openai",
    ):
        yield {
            "type": "final",
            "response": {
                "stance": "support",
                "rationale": "정책 방향에는 동의하지만 신중해야 합니다.",
                "caveat": "오판 방지 장치가 필요합니다.",
            },
        }

    def fabricated_summary_stream():
        yield {
            "type": "final",
            "summary": {
                "status": "completed",
                "message": "ok",
                "concern_clusters": [],
                "support_clusters": [],
                "blind_spot_clusters": [
                    {
                        "affected_group": "일반 사형제 논점",
                        "count": 5,
                        "blind_spot_examples": ["요약 모델이 새로 만든 사각지대"],
                    }
                ],
                "raw_output": "{}",
            },
        }

    patch_fast_simulation(monkeypatch, simulate_api, agent_stream=agent_stream, summary=fabricated_summary_stream())

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    aggregate_payloads = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif current_event == "aggregate" and line.startswith("data: "):
            aggregate_payloads.append(json.loads(line.removeprefix("data: ")))

    assert aggregate_payloads[-1]["blind_spot_raw"] == []
    assert aggregate_payloads[-1]["blind_spot_clusters"] == []


def test_simulate_stream_handles_partial_summary_payload_defensively(monkeypatch):
    from app.api import simulate as simulate_api

    def partial_summary_stream():
        yield {
            "type": "final",
            "summary": {
                "concern_clusters": [],
                "support_clusters": [],
                "blind_spot_clusters": [],
            },
        }

    patch_fast_simulation(monkeypatch, simulate_api, summary=partial_summary_stream())

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    events = [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")]

    assert events[-2:] == ["aggregate", "done"]
    assert "error" not in events


def test_simulate_stream_keeps_legacy_agent_stream_replacements_working(monkeypatch):
    from app.api import simulate as simulate_api

    def legacy_agent_stream(persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard"):
        yield {"type": "token", "content": "legacy"}
        yield {"type": "final", "response": {"stance": "support", "rationale": "legacy ok"}}

    patch_fast_simulation(monkeypatch, simulate_api, agent_stream=legacy_agent_stream)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    statuses = []
    tokens = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif line.startswith("data: "):
            payload = json.loads(line.removeprefix("data: "))
            if current_event == "llm_status":
                statuses.append(payload)
            elif current_event == "llm_token":
                tokens.append(payload)

    assert {"agent_id": 0, "status": "completed"} in statuses
    assert tokens[0] == {"agent_id": 0, "content": "legacy"}


def test_simulate_stream_supports_keyword_only_model_provider_streams(monkeypatch):
    from app.api import simulate as simulate_api

    captured = []

    def keyword_only_agent_stream(
        persona,
        policy,
        prior=None,
        model_name=None,
        thinking=False,
        persona_depth="standard",
        *,
        model_provider="openai",
    ):
        captured.append(model_provider)
        yield {"type": "token", "content": "keyword"}
        yield {"type": "final", "response": {"stance": "support", "rationale": "keyword ok"}}

    patch_fast_simulation(monkeypatch, simulate_api, agent_stream=keyword_only_agent_stream)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    tokens = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif current_event == "llm_token" and line.startswith("data: "):
            tokens.append(json.loads(line.removeprefix("data: ")))

    assert captured == ["openai"] * 5
    assert tokens[0] == {"agent_id": 0, "content": "keyword"}


def test_simulate_stream_includes_summary_tokens(monkeypatch):
    from app.api import simulate as simulate_api

    patch_fast_simulation(monkeypatch, simulate_api)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    summary_tokens = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif current_event == "summary_token" and line.startswith("data: "):
            summary_tokens.append(json.loads(line.removeprefix("data: ")))

    assert summary_tokens[0] == {"content": "summary thinking"}
    assert summary_tokens[1] == {"content": '{"concern_clusters":[],"support_clusters":[]}'}


def test_simulate_stream_uses_openai_for_summary(monkeypatch):
    from app.api import simulate as simulate_api

    called = {"openai": 0}

    def openai_summary(policy, responses, model_name="gpt-4o-mini", thinking=False):
        called["openai"] += 1
        assert model_name == "gpt-4o-mini"
        return summary_stream()

    patch_fast_simulation(monkeypatch, simulate_api)
    monkeypatch.setattr(simulate_api, "stream_openai_summary_clusters", openai_summary, raising=False)

    client = TestClient(app)
    response = client.post(
        "/api/simulate",
        json={"policy": "policy", "n_agents": 5, "model_provider": "openai", "model_name": "gpt-4o-mini"},
    )

    assert response.status_code == 200
    assert called == {"openai": 1}


def test_simulate_stream_runs_openai_agent_calls_in_parallel(monkeypatch):
    from app.api import simulate as simulate_api

    active = 0
    max_active = 0
    lock = threading.Lock()

    def openai_agent_stream(
        persona,
        policy,
        prior=None,
        model_name="gpt-4o-mini",
        persona_depth="standard",
        thinking=False,
        model_provider="openai",
    ):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.05)
        yield {"type": "token", "content": f"agent-{persona['agent_id']}"}
        yield {"type": "final", "response": {"stance": "support", "rationale": "ok"}}
        with lock:
            active -= 1

    patch_fast_simulation(monkeypatch, simulate_api)
    monkeypatch.setattr(simulate_api, "stream_openai_agent_response", openai_agent_stream, raising=False)
    monkeypatch.setattr(simulate_api, "stream_openai_summary_clusters", lambda policy, responses, model_name, thinking: summary_stream(), raising=False)

    client = TestClient(app)
    response = client.post(
        "/api/simulate",
        json={"policy": "policy", "n_agents": 5, "model_provider": "openai", "model_name": "gpt-4o-mini"},
    )

    assert response.status_code == 200
    assert max_active > 1


def test_simulate_stream_includes_llm_error_and_failed_status(monkeypatch):
    from app.api import simulate as simulate_api

    patch_fast_simulation(
        monkeypatch,
        simulate_api,
        agent_stream=lambda persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard", model_provider="openai": iter(
            [
                {"type": "error", "message": "openai unavailable"},
                {"type": "final", "response": {"stance": "neutral", "rationale": "openai unavailable"}},
            ]
        ),
    )

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    statuses = []
    errors = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif current_event == "llm_status" and line.startswith("data: "):
            statuses.append(json.loads(line.removeprefix("data: ")))
        elif current_event == "llm_error" and line.startswith("data: "):
            errors.append(json.loads(line.removeprefix("data: ")))

    assert {"agent_id": 0, "status": "failed"} in statuses
    assert errors[0] == {"agent_id": 0, "message": "openai unavailable"}


def test_simulate_stream_emits_llm_heartbeat_while_waiting(monkeypatch):
    from app.api import simulate as simulate_api

    def slow_stream(persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard", model_provider="openai"):
        time.sleep(0.05)
        yield {"type": "token", "content": "raw"}
        yield {"type": "final", "response": {"stance": "support", "rationale": "ok"}}

    monkeypatch.setattr(simulate_api, "HEARTBEAT_INTERVAL_SECONDS", 0.01)
    patch_fast_simulation(monkeypatch, simulate_api, agent_stream=slow_stream)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    heartbeats = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif current_event == "llm_heartbeat" and line.startswith("data: "):
            heartbeats.append(json.loads(line.removeprefix("data: ")))

    assert heartbeats
    assert 0 <= heartbeats[0]["agent_id"] < 5
    assert heartbeats[0]["tokens_seen"] == 0
    assert heartbeats[0]["elapsed_seconds"] >= 0
