import json
from types import SimpleNamespace
import time

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models.schemas import SimulateRequest
from app.services.aggregation import compute_aggregate
from app.services.llm_client import (
    agent_options,
    build_agent_llm_payload,
    build_agent_messages,
    build_agent_prompt,
    build_summary_llm_payload,
    failed_summary,
    get_openai_api_key,
    ollama_host,
    parse_agent_response,
    parse_json_object,
    summary_from_text,
    summarize_clusters,
    summarize_options,
    stream_agent_response,
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


def test_parse_agent_response_drops_openai_only_fields_for_ollama():
    parsed = parse_agent_response(
        '{"stance":"찬성","rationale":"필요합니다.",'
        '"reframing":"정책 전제가 좁습니다.",'
        '"persona_link":{"direct":"직접","inferred":"추론"}}',
        model_provider="ollama",
    )

    assert parsed == {"stance": "support", "rationale": "필요합니다."}


def test_agent_messages_use_provider_specific_system_prompt_and_user_prompt_not_two_keys():
    persona = {
        "agent_id": 1,
        "age": 42,
        "gender": "female",
        "region": "Gyeonggi",
        "job": "driver",
        "structured_profile": {"occupation": "driver", "housing_type": "apartment"},
        "narrative_context": {"persona": "자녀를 키우는 운전자"},
    }

    ollama_messages = build_agent_messages(persona, "전세 지원", model_provider="ollama")
    openai_messages = build_agent_messages(persona, "전세 지원", model_provider="openai")

    assert "blind_spot" in ollama_messages[0]["content"]
    assert "affected_group" in ollama_messages[0]["content"]
    assert "reframing" not in ollama_messages[0]["content"]
    assert "reframing" in openai_messages[0]["content"]
    assert "persona_link" in openai_messages[0]["content"]
    assert "어느 쪽에 가깝습니까" in ollama_messages[1]["content"]
    assert "예상치 못한 문제" in ollama_messages[1]["content"]
    assert "Return only JSON with keys stance and rationale" not in ollama_messages[1]["content"]
    assert "exactly two keys" not in ollama_messages[1]["content"]


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


def test_ollama_host_defaults_to_loopback_ip(monkeypatch):
    monkeypatch.delenv("OLLAMA_HOST", raising=False)

    assert ollama_host() == "http://127.0.0.1:11434"


def test_agent_options_discourage_repetition(monkeypatch):
    monkeypatch.delenv("OLLAMA_TEMPERATURE", raising=False)
    monkeypatch.delenv("OLLAMA_TOP_P", raising=False)
    monkeypatch.delenv("OLLAMA_REPEAT_PENALTY", raising=False)
    monkeypatch.delenv("OLLAMA_REPEAT_LAST_N", raising=False)
    monkeypatch.delenv("OLLAMA_NUM_PREDICT", raising=False)

    assert agent_options() == {
        "temperature": 0.65,
        "top_p": 0.9,
        "repeat_penalty": 1.1,
        "repeat_last_n": 256,
        "num_predict": 500,
    }


def test_summarize_options_allow_bounded_thinking(monkeypatch):
    monkeypatch.delenv("OLLAMA_SUMMARY_TEMPERATURE", raising=False)
    monkeypatch.delenv("OLLAMA_SUMMARY_TOP_K", raising=False)
    monkeypatch.delenv("OLLAMA_SUMMARY_TOP_P", raising=False)
    monkeypatch.delenv("OLLAMA_SUMMARY_REPEAT_PENALTY", raising=False)
    monkeypatch.delenv("OLLAMA_SUMMARY_PRESENCE_PENALTY", raising=False)
    monkeypatch.delenv("OLLAMA_SUMMARY_REPEAT_LAST_N", raising=False)
    monkeypatch.delenv("OLLAMA_SUMMARY_NUM_PREDICT", raising=False)

    assert summarize_options() == {
        "temperature": 0.45,
        "top_k": 20,
        "top_p": 0.95,
        "repeat_penalty": 1.15,
        "presence_penalty": 1.5,
        "repeat_last_n": 256,
        "num_predict": 3000,
    }


def test_stream_agent_response_exposes_ollama_failures(monkeypatch):
    import app.services.llm_client as llm_client

    class FailingClient:
        def __init__(self, *args, **kwargs):
            pass

        def chat(self, *args, **kwargs):
            raise RuntimeError("ollama unavailable")

    monkeypatch.setattr(llm_client.ollama, "Client", FailingClient)

    events = list(stream_agent_response({"agent_id": 0}, "policy"))

    assert events[0]["type"] == "error"
    assert "ollama unavailable" in events[0]["message"]
    assert events[1]["type"] == "final"
    assert events[1]["response"]["stance"] == "neutral"
    assert "ollama unavailable" in events[1]["response"]["rationale"]


def test_stream_agent_response_streams_thinking_and_parses_final_content(monkeypatch):
    import app.services.llm_client as llm_client

    class StreamingClient:
        def __init__(self, *args, **kwargs):
            pass

        def chat(self, *args, **kwargs):
            return iter(
                [
                    {"message": {"thinking": "thinking..."}},
                    {"message": {"content": '{"stance":"support","rationale":"ok"}'}},
                ]
            )

    monkeypatch.setattr(llm_client.ollama, "Client", StreamingClient)

    events = list(stream_agent_response({"agent_id": 0}, "policy"))

    assert events[0] == {"type": "thinking", "content": "thinking..."}
    assert events[1] == {"type": "token", "content": '{"stance":"support","rationale":"ok"}'}
    assert events[2] == {"type": "final", "response": {"stance": "support", "rationale": "ok"}}


def test_stream_agent_response_disables_thinking_for_agent_calls(monkeypatch):
    import app.services.llm_client as llm_client

    captured = {}

    class CapturingClient:
        def __init__(self, *args, **kwargs):
            pass

        def chat(self, *args, **kwargs):
            captured.update(kwargs)
            return iter([{"message": {"content": '{"stance":"support","rationale":"ok"}'}}])

    monkeypatch.setattr(llm_client.ollama, "Client", CapturingClient)

    list(stream_agent_response({"agent_id": 0}, "policy"))

    assert captured["think"] is False
    assert captured["options"] == agent_options()


def test_summarize_clusters_uses_summary_thinking_options(monkeypatch):
    import app.services.llm_client as llm_client

    captured = {}

    class CapturingClient:
        def __init__(self, *args, **kwargs):
            pass

        def chat(self, *args, **kwargs):
            captured.update(kwargs)
            return iter([{"message": {"content": '{"concern_clusters":[],"support_clusters":[]}'}}])

    monkeypatch.setattr(llm_client.ollama, "Client", CapturingClient)

    summary = summarize_clusters("policy", [{"stance": "support", "rationale": "ok"}])

    assert summary["concern_clusters"] == []
    assert summary["support_clusters"] == []
    assert summary["status"] == "empty"
    assert captured["think"] is True
    assert captured["stream"] is True
    assert captured["options"] == summarize_options()


def test_summary_prompt_explicitly_limits_recheck_loops():
    payload = build_summary_llm_payload("policy", [{"stance": "support", "rationale": "ok"}])
    system_prompt = payload["messages"][0]["content"]

    assert "at most 3 short reasoning bullets" in system_prompt
    assert "Do not restart, re-check, say wait" in system_prompt


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
            "count": 2,
            "blind_spot_examples": ["보증금 흐름 불안"],
        }
    ]


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
    assert "affected_group" in full_prompt
    assert "blind_spot_examples" in full_prompt
    assert "exactly three arrays" in full_prompt
    assert "non-null blind_spot" in full_prompt
    assert "blind_spot_clusters must be []" in full_prompt


def test_summarize_clusters_does_not_parse_json_from_thinking_only(monkeypatch):
    import app.services.llm_client as llm_client

    class ThinkingOnlyClient:
        def __init__(self, *args, **kwargs):
            pass

        def chat(self, *args, **kwargs):
            return iter(
                [
                    {
                        "message": {
                            "thinking": 'draft {"concern_clusters":[{"label":"draft","count":1,"examples":["x"]}],"support_clusters":[]}'
                        }
                    }
                ]
            )

    monkeypatch.setattr(llm_client.ollama, "Client", ThinkingOnlyClient)

    summary = summarize_clusters("policy", [{"stance": "oppose", "rationale": "x"}])

    assert summary["status"] == "failed"
    assert summary["concern_clusters"] == []
    assert "최종 JSON" in summary["message"]
    assert "draft" in summary["raw_output"]


def test_stream_agent_response_stops_repeated_thinking(monkeypatch):
    import app.services.llm_client as llm_client

    repeated = "repeating thought " * 20

    class RepeatingClient:
        def __init__(self, *args, **kwargs):
            pass

        def chat(self, *args, **kwargs):
            return iter({"message": {"thinking": repeated}} for _ in range(4))

    monkeypatch.setattr(llm_client.ollama, "Client", RepeatingClient)

    events = list(stream_agent_response({"agent_id": 0}, "policy"))

    assert any(event["type"] == "error" and "Repetition detected" in event["message"] for event in events)
    assert events[-1]["type"] == "final"
    assert events[-1]["response"]["stance"] == "neutral"


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

    prompt = build_agent_prompt(persona, "policy")

    assert "[Structured Profile]" in prompt
    assert "marital_status: married" in prompt
    assert "housing_type: apartment" in prompt
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
    assert "region: Seoul" in prompt
    assert "teacher" not in prompt
    assert "housing loan" not in prompt


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
        model_name="qwen3:14b",
        thinking=True,
        persona_depth="minimal",
    )

    assert payload["model"] == "qwen3:14b"
    assert payload["think"] is True
    assert "occupation:" not in payload["messages"][1]["content"]


def test_healthz_returns_model_and_dataset_status(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "qwen3.5:9b")

    client = TestClient(app)
    response = client.get("/healthz")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ollama_model"] == "qwen3.5:9b"
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


def test_simulate_request_accepts_experiment_options():
    req = SimulateRequest(
        policy="policy",
        n_agents=12,
        model_provider="ollama",
        model_name="qwen3:14b",
        thinking=True,
        persona_depth="full",
    )

    assert req.model_provider == "ollama"
    assert req.model_name == "qwen3:14b"
    assert req.thinking is True
    assert req.persona_depth == "full"


def test_simulate_request_rejects_invalid_provider_and_depth():
    try:
        SimulateRequest(policy="policy", model_provider="bad", persona_depth="huge")
    except ValidationError as exc:
        errors = str(exc)
        assert "model_provider" in errors
        assert "persona_depth" in errors
    else:
        raise AssertionError("Expected validation error")


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
        }
        for index in range(n)
    ]
    return personas, {"n_agents": n, "axes": ["age_group", "region_group", "gender"], "total_records": n, "cells": []}


def patch_fast_simulation(monkeypatch, simulate_api, agent_stream=None, summary=None):
    monkeypatch.setattr(simulate_api, "sample_personas_with_plan", sample_personas)
    monkeypatch.setattr(
        simulate_api,
        "stream_agent_response",
        agent_stream
        or (
            lambda persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard", model_provider="ollama": iter(
                [{"type": "token", "content": "raw"}, {"type": "final", "response": {"stance": "support", "rationale": "ok"}}]
            )
        ),
    )
    monkeypatch.setattr(simulate_api, "stream_summary_clusters", lambda policy, responses, model_name=None: summary or summary_stream())


def test_simulate_stream_event_order_with_summary_stream(monkeypatch):
    from app.api import simulate as simulate_api

    patch_fast_simulation(monkeypatch, simulate_api)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")]

    assert events[:6] == ["sampling_plan", "agent_sampled", "llm_prompt", "llm_status", "llm_token", "llm_status"]
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
    assert llm_payloads[0]["model"] == "qwen3.5:9b"
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
        model_provider="ollama",
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
                        "blind_spot_examples": ["월세 전환 때 보증금 흐름 불안"],
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
            "count": 5,
            "blind_spot_examples": ["월세 전환 때 보증금 흐름 불안"],
        }
    ]
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
        model_provider="ollama",
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
        model_provider="ollama",
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

    assert captured == ["ollama"] * 5
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


def test_simulate_stream_uses_openai_for_summary_when_provider_is_openai(monkeypatch):
    from app.api import simulate as simulate_api

    called = {"ollama": 0, "openai": 0}

    def ollama_summary(policy, responses, model_name=None):
        called["ollama"] += 1
        return summary_stream()

    def openai_summary(policy, responses, model_name="gpt-4o-mini", thinking=False):
        called["openai"] += 1
        assert model_name == "gpt-4o-mini"
        return summary_stream()

    patch_fast_simulation(monkeypatch, simulate_api)
    monkeypatch.setattr(simulate_api, "stream_summary_clusters", ollama_summary)
    monkeypatch.setattr(simulate_api, "stream_openai_summary_clusters", openai_summary, raising=False)

    client = TestClient(app)
    response = client.post(
        "/api/simulate",
        json={"policy": "policy", "n_agents": 5, "model_provider": "openai", "model_name": "gpt-4o-mini"},
    )

    assert response.status_code == 200
    assert called == {"ollama": 0, "openai": 1}


def test_simulate_stream_includes_llm_error_and_failed_status(monkeypatch):
    from app.api import simulate as simulate_api

    patch_fast_simulation(
        monkeypatch,
        simulate_api,
        agent_stream=lambda persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard", model_provider="ollama": iter(
            [
                {"type": "error", "message": "ollama unavailable"},
                {"type": "final", "response": {"stance": "neutral", "rationale": "ollama unavailable"}},
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
    assert errors[0] == {"agent_id": 0, "message": "ollama unavailable"}


def test_simulate_stream_emits_llm_heartbeat_while_waiting(monkeypatch):
    from app.api import simulate as simulate_api

    def slow_stream(persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard", model_provider="ollama"):
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
    assert heartbeats[0]["agent_id"] == 0
    assert heartbeats[0]["tokens_seen"] == 0
    assert heartbeats[0]["elapsed_seconds"] >= 0
