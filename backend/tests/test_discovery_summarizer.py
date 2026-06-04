from app.services.discovery_summarizer import summarize_discovery


def _aggregate():
    return {
        "axes": {},
        "featured_axis": {"primary": "occupation_stratum", "secondary": "household_stratum"},
    }


def test_summarize_discovery_parses_llm_merge_output():
    raw = (
        '{"merged_blind_spots":[{"label":"access","text":"hard to apply","agent_ids":[2,0],"grounding":"direct"}],'
        '"merged_reframings":[{"label":"change frame","agent_ids":[1]}],'
        '"merged_complaints":[{"label":"where apply","agent_ids":[0]}],'
        '"featured_axis_rationale":"Occupation reveals missed access paths."}'
    )

    summary = summarize_discovery(_aggregate(), [], "gpt-5.5", llm_call=lambda _payload: raw)

    assert summary["merged_blind_spots"] == [
        {"label": "access", "text": "hard to apply", "agent_ids": [0, 2], "grounding": "direct"}
    ]
    assert summary["merged_reframings"] == [{"label": "change frame", "agent_ids": [1]}]
    assert summary["merged_complaints"] == [{"label": "where apply", "agent_ids": [0]}]
    assert summary["featured_axis"] == _aggregate()["featured_axis"]
    assert summary["featured_axis_rationale"] == "Occupation reveals missed access paths."


def test_summarize_discovery_fallback_preserves_featured_axis_and_raw_signals():
    responses = [
        {"agent_id": 1, "blind_spot": "b", "reframing": "r", "expected_complaint": "c", "grounding": "inferred"},
    ]

    summary = summarize_discovery(_aggregate(), responses, "gpt-5.5", llm_call=lambda _payload: (_ for _ in ()).throw(RuntimeError("boom")))

    assert summary["featured_axis"] == _aggregate()["featured_axis"]
    assert summary["merged_blind_spots"] == [
        {"label": "b", "text": "b", "agent_ids": [1], "grounding": "inferred"}
    ]
    assert summary["merged_reframings"] == [{"label": "r", "agent_ids": [1]}]
    assert summary["merged_complaints"] == [{"label": "c", "agent_ids": [1]}]


def test_empty_after_normalization_falls_back_to_raw_signals():
    # 회귀: LLM이 agent_ids 없이 묶음을 반환 → 정규화에서 전부 탈락(빈 결과)이었던 버그.
    # 이제 원본 신호가 있으면 폴백으로 채워 빈 화면을 막는다.
    raw = (
        '{"merged_blind_spots":[{"label":"접근성","text":"신청이 어렵다"}],'  # agent_ids 누락
        '"merged_reframings":[],"merged_complaints":[],"featured_axis_rationale":"x"}'
    )
    responses = [{"agent_id": 3, "blind_spot": "신청이 어렵다", "grounding": "inferred"}]
    summary = summarize_discovery(_aggregate(), responses, "gpt-5.5", llm_call=lambda _p: raw)
    assert summary["merged_blind_spots"] == [
        {"label": "신청이 어렵다", "text": "신청이 어렵다", "agent_ids": [3], "grounding": "inferred"}
    ]


def test_discovery_summarizer_uses_responses_api(monkeypatch):
    import openai
    import app.services.discovery_summarizer as summarizer

    captured = {}

    class CapturingResponses:
        def create(self, **kwargs):
            captured.update(kwargs)
            return type("Response", (), {"output_text": '{"merged_blind_spots":[],"merged_reframings":[],"merged_complaints":[],"featured_axis_rationale":"ok"}'})()

    class CapturingOpenAI:
        def __init__(self, *args, **kwargs):
            pass

        responses = CapturingResponses()

    monkeypatch.setattr(summarizer, "get_openai_api_key", lambda: "sk-test")
    monkeypatch.setattr(openai, "OpenAI", CapturingOpenAI)

    summary = summarize_discovery(_aggregate(), [], "gpt-5.5")

    assert summary["featured_axis_rationale"] == "ok"
    assert captured["model"] == "gpt-5.5"
    assert captured["text"]["format"]["type"] == "json_object"
    assert "input" in captured
    assert "messages" not in captured
