import ast
import json
import os
from typing import Any

import ollama

from app.services.aggregation import normalize_stance

AGENT_FALLBACK = {
    "stance": "neutral",
    "rationale": "Model output could not be parsed.",
}

FAILURE_FALLBACK = {
    "stance": "neutral",
    "rationale": "Response generation failed.",
}

DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen3.5:9b"


def ollama_host() -> str:
    return os.getenv("OLLAMA_HOST", DEFAULT_OLLAMA_HOST)


def ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)


def parse_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()

    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    try:
        parsed = ast.literal_eval(stripped)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(stripped):
        if char != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(stripped[index:])
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("No JSON object found")


def parse_agent_response(text: str) -> dict:
    try:
        parsed = parse_json_object(text)
    except Exception:
        return dict(AGENT_FALLBACK)

    parsed = {str(key).strip(): value for key, value in parsed.items()}
    stance = normalize_stance(parsed.get("stance"))
    rationale = parsed.get("rationale") or parsed.get("reason") or parsed.get("explanation")
    if not isinstance(rationale, str) or not rationale.strip():
        rationale = AGENT_FALLBACK["rationale"]
    return {"stance": stance, "rationale": rationale.strip()}


def build_agent_prompt(persona: dict, policy: str, prior: dict | None = None) -> str:
    prior_text = json.dumps(prior, ensure_ascii=False) if prior else "none"
    structured_profile = persona.get(
        "structured_profile",
        {
            "age": persona.get("age"),
            "gender": persona.get("gender"),
            "district": persona.get("region"),
            "education_level": persona.get("education"),
            "occupation": persona.get("job"),
        },
    )
    narrative_context = persona.get("narrative_context", {"persona": persona.get("background", "")})
    structured_text = "\n".join(f"{key}: {value}" for key, value in structured_profile.items() if value not in ("", None))
    narrative_text = "\n".join(f"{key}: {value}" for key, value in narrative_context.items() if value not in ("", None))
    return f"""[Structured Profile]
{structured_text}

[Narrative Context]
{narrative_text}

[Prior]
{prior_text}

[Policy]
{policy}

Return only JSON with keys stance and rationale. stance must be support, oppose, or neutral.
Answer from this citizen's lived perspective. Reflect their age, family situation, housing, occupation, and local context.
Do not give a generic policy analysis."""


def build_agent_messages(persona: dict, policy: str, prior: dict | None = None) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You simulate one Korean citizen's policy reaction. "
                "Return only a valid JSON object with exactly two keys: stance and rationale. "
                "Do not use markdown, code fences, or thinking text. "
                "stance must be one of support, oppose, neutral. "
                "rationale must be one natural Korean sentence from that citizen's lived perspective."
            ),
        },
        {"role": "user", "content": build_agent_prompt(persona, policy, prior)},
    ]


def agent_options() -> dict:
    return {
        "temperature": float(os.getenv("OLLAMA_TEMPERATURE", "0.65")),
        "top_p": float(os.getenv("OLLAMA_TOP_P", "0.9")),
        "repeat_penalty": float(os.getenv("OLLAMA_REPEAT_PENALTY", "1.1")),
        "repeat_last_n": int(os.getenv("OLLAMA_REPEAT_LAST_N", "256")),
        "num_predict": int(os.getenv("OLLAMA_NUM_PREDICT", "500")),
    }


def summarize_options() -> dict:
    return {
        "temperature": float(os.getenv("OLLAMA_SUMMARY_TEMPERATURE", "0.45")),
        "top_k": int(os.getenv("OLLAMA_SUMMARY_TOP_K", "20")),
        "top_p": float(os.getenv("OLLAMA_SUMMARY_TOP_P", "0.95")),
        "repeat_penalty": float(os.getenv("OLLAMA_SUMMARY_REPEAT_PENALTY", "1.15")),
        "presence_penalty": float(os.getenv("OLLAMA_SUMMARY_PRESENCE_PENALTY", "1.5")),
        "repeat_last_n": int(os.getenv("OLLAMA_SUMMARY_REPEAT_LAST_N", "256")),
        "num_predict": int(os.getenv("OLLAMA_SUMMARY_NUM_PREDICT", "3000")),
    }


def build_agent_llm_payload(persona: dict, policy: str, prior: dict | None = None) -> dict:
    return {
        "agent_id": persona["agent_id"],
        "model": ollama_model(),
        "format": "json",
        "messages": build_agent_messages(persona, policy, prior),
        "options": agent_options(),
        "think": False,
    }


def build_summary_llm_payload(policy: str, responses: list[dict]) -> dict:
    payload = json.dumps(responses, ensure_ascii=False)
    return {
        "model": ollama_model(),
        "format": "json",
        "messages": [
            {
                "role": "system",
                "content": (
                    "Summarize Korean policy reaction rationales. "
                    "Return only a valid JSON object with exactly two arrays: concern_clusters and support_clusters. "
                    "Each cluster must have label, count, and examples. Do not use markdown. "
                    "In thinking mode, use at most 3 short reasoning bullets, then stop thinking and produce the final JSON. "
                    "Do not restart, re-check, say wait, say actually, or run another final review."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Policy: {policy}\nResponses: {payload}\n\n"
                    'Return schema: {"concern_clusters":[{"label":"string","count":1,"examples":["string"]}],'
                    '"support_clusters":[{"label":"string","count":1,"examples":["string"]}]}'
                ),
            },
        ],
        "options": summarize_options(),
        "think": True,
    }


def has_repeated_tail(text: str, window: int = 80, repeats: int = 3) -> bool:
    normalized = " ".join(text.split())
    if len(normalized) < window * repeats:
        return False
    tail = normalized[-window:]
    prior = normalized[: -window]
    return prior.count(tail) >= repeats - 1


def get_agent_response(persona: dict, policy: str, prior: dict | None = None) -> dict:
    try:
        client = ollama.Client(host=ollama_host(), timeout=60)
        response = client.chat(
            model=ollama_model(),
            format="json",
            messages=build_agent_messages(persona, policy, prior),
            options=agent_options(),
            think=False,
        )
        return parse_agent_response(response["message"]["content"])
    except Exception:
        return dict(FAILURE_FALLBACK)


def stream_agent_response(persona: dict, policy: str, prior: dict | None = None):
    raw_output = ""
    try:
        client = ollama.Client(host=ollama_host(), timeout=60)
        stream = client.chat(
            model=ollama_model(),
            format="json",
            messages=build_agent_messages(persona, policy, prior),
            options=agent_options(),
            think=False,
            stream=True,
        )
        thinking_output = ""
        repeated = False
        for chunk in stream:
            message = chunk.get("message", {})
            thinking = message.get("thinking", "")
            content = message.get("content", "")
            if thinking:
                thinking_output += thinking
                yield {"type": "thinking", "content": thinking}
                if has_repeated_tail(thinking_output):
                    repeated = True
                    yield {"type": "error", "message": "Repetition detected in model thinking output."}
                    break
            if content:
                raw_output += content
                yield {"type": "token", "content": content}
                if has_repeated_tail(raw_output):
                    repeated = True
                    yield {"type": "error", "message": "Repetition detected in model response output."}
                    break
        if repeated:
            yield {
                "type": "final",
                "response": {
                    "stance": "neutral",
                    "rationale": "모델 출력이 반복되어 응답 생성을 중단했습니다.",
                },
            }
            return
        yield {"type": "final", "response": parse_agent_response(raw_output or thinking_output)}
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        yield {"type": "error", "message": message}
        yield {
            "type": "final",
            "response": {
                "stance": "neutral",
                "rationale": f"LLM 호출 실패: {message}",
            },
        }


def summary_from_text(raw_output: str) -> dict:
    parsed = parse_json_object(raw_output)
    concerns = parsed.get("concern_clusters", [])
    support = parsed.get("support_clusters", [])
    concern_clusters = concerns if isinstance(concerns, list) else []
    support_clusters = support if isinstance(support, list) else []
    has_clusters = bool(concern_clusters or support_clusters)
    return {
        "status": "completed" if has_clusters else "empty",
        "message": "요약이 생성되었습니다." if has_clusters else "요약 모델이 빈 cluster 배열을 반환했습니다.",
        "concern_clusters": concern_clusters,
        "support_clusters": support_clusters,
        "raw_output": raw_output,
    }


def failed_summary(message: str, raw_output: str = "") -> dict:
    return {
        "status": "failed",
        "message": message,
        "concern_clusters": [],
        "support_clusters": [],
        "raw_output": raw_output,
    }


def stream_summary_clusters(policy: str, responses: list[dict]):
    raw_output = ""
    thinking_output = ""
    try:
        client = ollama.Client(host=ollama_host(), timeout=90)
        payload = build_summary_llm_payload(policy, responses)
        stream = client.chat(
            model=payload["model"],
            format=payload["format"],
            messages=payload["messages"],
            options=payload["options"],
            think=payload["think"],
            stream=True,
        )

        repeated = False
        for chunk in stream:
            message = chunk.get("message", {})
            thinking = message.get("thinking", "")
            content = message.get("content", "")
            if thinking:
                thinking_output += thinking
                yield {"type": "thinking", "content": thinking}
                if has_repeated_tail(thinking_output):
                    repeated = True
                    yield {"type": "error", "message": "Repetition detected in summary thinking output."}
                    break
            if content:
                raw_output += content
                yield {"type": "token", "content": content}
                if has_repeated_tail(raw_output):
                    repeated = True
                    yield {"type": "error", "message": "Repetition detected in summary response output."}
                    break

        if repeated:
            yield {"type": "final", "summary": failed_summary("요약 모델 출력이 반복되어 생성을 중단했습니다.", raw_output or thinking_output)}
            return
        if not raw_output.strip():
            yield {
                "type": "final",
                "summary": failed_summary("요약 모델이 추론만 출력하고 최종 JSON을 생성하지 않았습니다.", thinking_output),
            }
            return
        yield {"type": "final", "summary": summary_from_text(raw_output)}
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        yield {"type": "error", "message": message}
        yield {"type": "final", "summary": failed_summary(message, raw_output or thinking_output)}


def summarize_clusters(policy: str, responses: list[dict]) -> dict:
    final = failed_summary("Summary generation failed.")
    for event in stream_summary_clusters(policy, responses):
        if event["type"] == "final":
            final = event["summary"]
    return final
