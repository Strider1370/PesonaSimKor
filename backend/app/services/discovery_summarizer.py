import json
from typing import Callable

from app.services.llm_client import get_openai_api_key, parse_json_object, response_output_text


def _agent_ids(value) -> list[int]:
    if not isinstance(value, list):
        return []
    return sorted({int(item) for item in value if str(item).isdigit()})


def _text(value) -> str:
    return str(value or "").strip()


def _normalize_blind_spots(items) -> list[dict]:
    if not isinstance(items, list):
        return []
    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label"))
        text = _text(item.get("text")) or label
        agent_ids = _agent_ids(item.get("agent_ids"))
        grounding = item.get("grounding") if item.get("grounding") in {"direct", "inferred"} else "inferred"
        if label and text and agent_ids:
            normalized.append({"label": label, "text": text, "agent_ids": agent_ids, "grounding": grounding})
    return normalized


def _normalize_label_items(items) -> list[dict]:
    if not isinstance(items, list):
        return []
    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label"))
        text = _text(item.get("text"))
        agent_ids = _agent_ids(item.get("agent_ids"))
        if label and agent_ids:
            result: dict = {"label": label, "agent_ids": agent_ids}
            if text:
                result["text"] = text
            normalized.append(result)
    return normalized


def _normalize_complaint_items(items) -> list[dict]:
    if not isinstance(items, list):
        return []
    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label"))
        short_label = _text(item.get("short_label"))
        agent_ids = _agent_ids(item.get("agent_ids"))
        if label and agent_ids:
            result: dict = {"label": label, "agent_ids": agent_ids}
            if short_label:
                result["short_label"] = short_label
            normalized.append(result)
    return normalized


def _fallback_summary(aggregate: dict, responses: list[dict]) -> dict:
    blind_spots = []
    reframings = []
    complaints = []
    for response in responses:
        agent_id = int(response.get("agent_id", 0))
        blind_spot = _text(response.get("blind_spot"))
        if blind_spot:
            grounding = response.get("grounding") if response.get("grounding") in {"direct", "inferred"} else "inferred"
            blind_spots.append({"label": blind_spot, "text": blind_spot, "agent_ids": [agent_id], "grounding": grounding})
        reframing = _text(response.get("reframing"))
        if reframing:
            reframings.append({"label": reframing, "agent_ids": [agent_id]})
        complaint = _text(response.get("expected_complaint"))
        if complaint:
            complaints.append({"label": complaint, "agent_ids": [agent_id]})
    return {
        "merged_blind_spots": blind_spots,
        "merged_reframings": reframings,
        "merged_complaints": complaints,
        "featured_axis": aggregate.get("featured_axis", {"primary": "age_band", "secondary": None}),
        "featured_axis_rationale": "",
    }


def build_discovery_summary_payload(aggregate: dict, responses: list[dict], model: str) -> dict:
    return {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Merge near-duplicate Korean discovery texts only. Do not compute counts, rates, "
                    "or choose featured_axis. "
                    "Return a JSON object EXACTLY in this shape — every merged item MUST include an "
                    "agent_ids array of the integer agent_id values (from the input) that belong to it; "
                    "items without agent_ids will be discarded:\n"
                    '{"merged_blind_spots":[{"label":"짧은 제목","text":"대표 문장","agent_ids":[0,4],'
                    '"grounding":"direct|inferred"}],'
                    '"merged_reframings":[{"label":"반문 핵심 질문 (의문문 형태)","text":"이 반문이 제기되는 맥락과 핵심 논지를 1~2문장으로 설명","agent_ids":[2]}],'
                    '"merged_complaints":[{"short_label":"6-10자 핵심 제목","label":"민원 요지 전문","agent_ids":[1]}],'
                    '"featured_axis_rationale":"왜 이 축이 발굴 가치 있는지 한국어 한 줄"}\n'
                    "Use ONLY integer agent_id values present in the input. Do not invent ids. "
                    "Every input blind_spot/reframing/expected_complaint must appear in some merged item."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "featured_axis": aggregate.get("featured_axis"),
                        "responses": [
                            {
                                "agent_id": response.get("agent_id"),
                                "blind_spot": response.get("blind_spot"),
                                "grounding": response.get("grounding"),
                                "reframing": response.get("reframing"),
                                "expected_complaint": response.get("expected_complaint"),
                            }
                            for response in responses
                        ],
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    }


def _call_openai(payload: dict) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=get_openai_api_key())
    response = client.responses.create(
        model=payload["model"],
        text={"format": {"type": "json_object"}},
        input=payload["messages"],
    )
    return response_output_text(response) or "{}"


def summarize_discovery(
    aggregate: dict,
    responses: list[dict],
    model: str,
    llm_call: Callable[[dict], str] | None = None,
) -> dict:
    payload = build_discovery_summary_payload(aggregate, responses, model)
    fallback = _fallback_summary(aggregate, responses)
    try:
        raw = (llm_call or _call_openai)(payload)
        parsed = parse_json_object(raw)
        merged_blind_spots = _normalize_blind_spots(parsed.get("merged_blind_spots"))
        merged_reframings = _normalize_label_items(parsed.get("merged_reframings"))
        merged_complaints = _normalize_complaint_items(parsed.get("merged_complaints"))
        # 안전망: LLM이 성공해도 정규화 후 전부 비었는데 원본엔 신호가 있으면 폴백(빈 화면 방지)
        if not (merged_blind_spots or merged_reframings or merged_complaints) and (
            fallback["merged_blind_spots"] or fallback["merged_reframings"] or fallback["merged_complaints"]
        ):
            return {**fallback, "raw_output": raw, "error": "normalized empty — used raw-signal fallback"}
        return {
            "merged_blind_spots": merged_blind_spots,
            "merged_reframings": merged_reframings,
            "merged_complaints": merged_complaints,
            "featured_axis": aggregate.get("featured_axis", {"primary": "age_band", "secondary": None}),
            "featured_axis_rationale": _text(parsed.get("featured_axis_rationale")),
            "raw_output": raw,
            "error": None,
        }
    except Exception as exc:
        return {**fallback, "raw_output": "", "error": f"{type(exc).__name__}: {exc}"}
