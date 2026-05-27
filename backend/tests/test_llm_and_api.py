import json
import time

from fastapi.testclient import TestClient

from app.main import app
from app.services.llm_client import (
    agent_options,
    build_agent_prompt,
    build_summary_llm_payload,
    ollama_host,
    parse_agent_response,
    parse_json_object,
    summarize_clusters,
    summarize_options,
    stream_agent_response,
)


def empty_summary():
    return {
        "status": "empty",
        "message": "empty summary",
        "concern_clusters": [],
        "support_clusters": [],
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
        or (lambda persona, policy, prior=None: iter([{"type": "token", "content": "raw"}, {"type": "final", "response": {"stance": "support", "rationale": "ok"}}])),
    )
    monkeypatch.setattr(simulate_api, "stream_summary_clusters", lambda policy, responses: summary or summary_stream())


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


def test_simulate_stream_includes_llm_error_and_failed_status(monkeypatch):
    from app.api import simulate as simulate_api

    patch_fast_simulation(
        monkeypatch,
        simulate_api,
        agent_stream=lambda persona, policy, prior=None: iter(
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

    def slow_stream(persona, policy, prior=None):
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
