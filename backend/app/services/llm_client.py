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

SYSTEM_PROMPT_OLLAMA = """당신은 주어진 페르소나 정보를 충실히 따르는 한국 시민입니다.
해당 페르소나의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 답하십시오.
반드시 아래 JSON 형식으로만 답하십시오. 다른 텍스트는 절대 포함하지 마십시오.
반드시 한국어로만 답하십시오.

{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "rationale": "입장 이유 (2문장, 이 페르소나의 관점에서)",
  "blind_spot": "이 정책이 당신 같은 처지의 사람에게 예상치 못한 문제를 일으킬 수 있다면, 정책 설계자가 놓치기 쉬운 구체적인 직업, 생활, 경제 상황의 문제를 쓰십시오. 일반적인 우려가 아니라 페르소나 맥락에서만 보이는 문제여야 합니다. (1~2문장)",
  "affected_group": "당신과 비슷한 처지의 사람들 중 이 정책으로 가장 타격받을 집단"
}"""

SYSTEM_PROMPT_OPENAI = """당신은 주어진 페르소나 정보를 충실히 따르는 한국 시민입니다.
해당 페르소나의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 답하십시오.
반드시 아래 JSON 형식으로만 답하십시오. 다른 텍스트는 절대 포함하지 마십시오.
반드시 한국어로만 답하십시오.

{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "rationale": "입장 이유 (2문장, 이 페르소나의 관점에서)",
  "blind_spot": "당신의 구체적인 삶의 맥락에서만 보이는 예상치 못한 문제 (1~2문장)",
  "affected_group": "가장 타격받을 집단",
  "reframing": "이 정책의 전제나 방향 자체에 동의하지 않는 부분이 있다면 반문하십시오. 없으면 null.",
  "persona_link": {
    "direct": "페르소나 텍스트에서 직접 언급된 근거만 쓰십시오. 예: '아파트 거주, 자녀 등교'",
    "inferred": "텍스트에 없지만 맥락에서 합리적으로 추론한 것. 예: '운전자 업무 -> 교통비 민감'. 고정관념은 피하십시오."
  }
}"""


def ollama_host() -> str:
    return os.getenv("OLLAMA_HOST", DEFAULT_OLLAMA_HOST)


def ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)


def get_openai_api_key() -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for OpenAI simulations")
    return api_key


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


def parse_agent_response(text: str, model_provider: str = "ollama") -> dict:
    try:
        parsed = parse_json_object(text)
    except Exception:
        return dict(AGENT_FALLBACK)

    parsed = {str(key).strip(): value for key, value in parsed.items()}
    stance = normalize_stance(parsed.get("stance"))
    rationale = parsed.get("rationale") or parsed.get("reason") or parsed.get("explanation") or ""
    if not isinstance(rationale, str) or not rationale.strip():
        rationale = AGENT_FALLBACK["rationale"]

    result = {"stance": stance, "rationale": rationale.strip()}

    for field in ("blind_spot", "affected_group"):
        value = parsed.get(field)
        if isinstance(value, str) and value.strip():
            result[field] = value.strip()

    if model_provider == "openai":
        reframing = parsed.get("reframing")
        if isinstance(reframing, str) and reframing.strip() and reframing.strip().lower() != "null":
            result["reframing"] = reframing.strip()

        persona_link = parsed.get("persona_link")
        if isinstance(persona_link, dict):
            direct = persona_link.get("direct", "")
            inferred = persona_link.get("inferred", "")
            if isinstance(direct, str) and isinstance(inferred, str):
                direct = direct.strip()
                inferred = inferred.strip()
                if direct or inferred:
                    result["persona_link"] = {"direct": direct, "inferred": inferred}

    return result


def build_agent_prompt(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    persona_depth: str = "standard",
) -> str:
    prior_text = json.dumps(prior, ensure_ascii=False) if prior else "none"
    if persona_depth == "minimal":
        structured_profile = {
            "age": persona.get("age"),
            "gender": persona.get("gender"),
            "region": persona.get("region"),
        }
        narrative_context = {}
    else:
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

이 정책에 대한 당신의 입장은 찬성, 반대, 중립 중 어느 쪽에 가깝습니까?
그리고 이 정책이 당신 같은 처지의 사람에게 예상치 못한 문제를 일으킬 수 있다면 무엇인지,
당신의 구체적인 직업과 생활 상황에서만 보이는 부분을 말해주십시오.

반드시 시스템 메시지에서 요구한 JSON 구조와 일치하는 JSON만 반환하십시오.
일반적인 정책 분석이 아니라 이 시민의 생활 맥락에서 답하십시오."""


def build_agent_messages(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
) -> list[dict[str, str]]:
    system = SYSTEM_PROMPT_OPENAI if model_provider == "openai" else SYSTEM_PROMPT_OLLAMA
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": build_agent_prompt(persona, policy, prior, persona_depth)},
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


def build_agent_llm_payload(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
) -> dict:
    return {
        "agent_id": persona["agent_id"],
        "model": model_name or ollama_model(),
        "format": "json",
        "messages": build_agent_messages(persona, policy, prior, persona_depth, model_provider),
        "options": agent_options(),
        "think": thinking,
    }


def build_summary_llm_payload(policy: str, responses: list[dict], model_name: str | None = None) -> dict:
    payload = json.dumps(responses, ensure_ascii=False)
    return {
        "model": model_name or ollama_model(),
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


def get_agent_response(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
) -> dict:
    try:
        client = ollama.Client(host=ollama_host(), timeout=60)
        response = client.chat(
            model=model_name or ollama_model(),
            format="json",
            messages=build_agent_messages(persona, policy, prior, persona_depth, model_provider),
            options=agent_options(),
            think=thinking,
        )
        return parse_agent_response(response["message"]["content"], model_provider=model_provider)
    except Exception:
        return dict(FAILURE_FALLBACK)


def stream_agent_response(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
):
    raw_output = ""
    try:
        client = ollama.Client(host=ollama_host(), timeout=60)
        stream = client.chat(
            model=model_name or ollama_model(),
            format="json",
            messages=build_agent_messages(persona, policy, prior, persona_depth, model_provider),
            options=agent_options(),
            think=thinking,
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
        yield {"type": "final", "response": parse_agent_response(raw_output or thinking_output, model_provider=model_provider)}
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


def stream_openai_agent_response(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str = "gpt-4o-mini",
    persona_depth: str = "standard",
    thinking: bool = False,
    model_provider: str = "openai",
):
    raw_output = ""
    try:
        from openai import OpenAI

        client = OpenAI(api_key=get_openai_api_key())
        stream = client.chat.completions.create(
            model=model_name,
            response_format={"type": "json_object"},
            messages=build_agent_messages(persona, policy, prior, persona_depth, model_provider),
            **openai_reasoning_options(thinking),
            stream=True,
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content or ""
            if content:
                raw_output += content
                yield {"type": "token", "content": content}
        yield {"type": "final", "response": parse_agent_response(raw_output, model_provider=model_provider)}
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        yield {"type": "error", "message": message}
        yield {
            "type": "final",
            "response": {
                "stance": "neutral",
                "rationale": f"LLM ?몄텧 ?ㅽ뙣: {message}",
            },
        }


def stream_openai_summary_clusters(
    policy: str,
    responses: list[dict],
    model_name: str = "gpt-4o-mini",
    thinking: bool = False,
):
    raw_output = ""
    try:
        from openai import OpenAI

        client = OpenAI(api_key=get_openai_api_key())
        payload = build_summary_llm_payload(policy, responses, model_name)
        stream = client.chat.completions.create(
            model=model_name,
            response_format={"type": "json_object"},
            messages=payload["messages"],
            **openai_reasoning_options(thinking),
            stream=True,
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content or ""
            if content:
                raw_output += content
                yield {"type": "token", "content": content}
        if not raw_output.strip():
            yield {"type": "final", "summary": failed_summary("Summary model returned no JSON output.", raw_output)}
            return
        yield {"type": "final", "summary": summary_from_text(raw_output)}
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        yield {"type": "error", "message": message}
        yield {"type": "final", "summary": failed_summary(message, raw_output)}


def openai_reasoning_options(thinking: bool) -> dict:
    return {"reasoning_effort": "medium"} if thinking else {}


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


def stream_summary_clusters(policy: str, responses: list[dict], model_name: str | None = None):
    raw_output = ""
    thinking_output = ""
    try:
        client = ollama.Client(host=ollama_host(), timeout=90)
        payload = build_summary_llm_payload(policy, responses, model_name)
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
