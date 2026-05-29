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


STANCE_RULES = """stance 판정 기준:
stance는 응답자의 최종 선택 방향입니다. 우려, 조건, 보완 요구가 있다는 이유만으로 중립을 선택하지 마십시오.

- 제시된 정책 방향을 대체로 받아들이면 "찬성"
- 제시된 정책 방향을 대체로 거부하면 "반대"
- 양쪽 중 어느 방향도 고르지 못하고 판단을 유보하면 "중립"

조건부 동의/조건부 반대의 조건은 stance가 아니라 caveat에 쓰십시오."""

CITIZEN_VOICE_RULES = """응답 방식 기준:
응답자는 정책 전문가가 아닙니다.
정책 보고서처럼 포괄적인 조건 목록을 만들지 마십시오.
이 페르소나가 실제로 알고 있거나 생활에서 체감할 만한 1~2개 이유만 말하십시오.
전문용어는 페르소나의 직업이나 배경상 자연스러울 때만 사용하십시오.
모든 쟁점을 균형 있게 다루려고 하지 마십시오.
잘 모르는 부분은 막연하게, 제한적으로, 또는 감정적으로 말할 수 있습니다."""

CAVEAT_RULES = """caveat 판정 기준:
caveat는 가장 중요한 유보점 하나만 쓰십시오.
여러 조건을 병렬로 나열하거나 정책 보완책 묶음을 설계하지 마십시오.
이 페르소나가 정책 방향에 동의하거나 반대하면서도 가장 먼저 걸릴 법한 한 가지 걱정만 쓰십시오.
해당되는 유보점이 없으면 null을 반환하십시오."""

BLIND_SPOT_RULES = """blind_spot 판정 기준:
blind_spot은 필수가 아닙니다. 아래 세 조건을 모두 만족할 때만 작성하십시오.

1. 직접성: 정책 변화가 해당 문제로 이어지는 구체적인 인과 경로가 있어야 합니다.
2. 특수성: 이 문제가 일반 시민 모두의 우려가 아니라, 이 페르소나의 직업·생활·경제 조건 때문에 특히 잘 보이는 문제여야 합니다.
3. 비중복성: rationale이나 일반 찬반 쟁점에서 이미 말한 내용을 다른 말로 반복하면 안 됩니다.

blind_spot은 전문가적 정책 분석이 아닙니다.
이 페르소나의 생활, 직업, 가족, 지역, 경제 조건 때문에 직접 떠올릴 수 있는 문제일 때만 쓰십시오.
정책 구조 전체를 분석해야만 보이는 문제, 거시적 제도 설계 문제, 일반 시민 모두에게 해당되는 문제는 blind_spot이 아닙니다.
페르소나 정보가 그 문제를 직접 뒷받침하지 않으면 null을 반환하십시오.
세 조건 중 하나라도 부족하면 blind_spot은 null로 반환하십시오.
blind_spot이 null이면 affected_group도 null로 반환하십시오."""

SYSTEM_PROMPT_OLLAMA = f"""당신은 주어진 페르소나 정보를 충실히 따르는 한국 시민입니다.
해당 페르소나의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 답하십시오.
반드시 아래 JSON 형식으로만 답하십시오. 다른 텍스트는 절대 포함하지 마십시오.
반드시 한국어로만 답하십시오.

{STANCE_RULES}

{CITIZEN_VOICE_RULES}

{CAVEAT_RULES}

{BLIND_SPOT_RULES}

{{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "stance_strength": "강함" 또는 "기울어짐" 또는 "약함",
  "rationale": "최종 선택 방향의 핵심 이유. 이 페르소나가 체감할 만한 1~2개 이유만 쓰십시오.",
  "caveat": "가장 중요한 유보점 하나. 없으면 null.",
  "blind_spot": "직접성·특수성·비중복성을 모두 만족하는 사각지대. 없으면 null.",
  "affected_group": "blind_spot이 있을 때 가장 직접적으로 영향받는 집단. 없으면 null."
}}"""

SYSTEM_PROMPT_OPENAI = f"""당신은 주어진 페르소나 정보를 충실히 따르는 한국 시민입니다.
해당 페르소나의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 답하십시오.
반드시 아래 JSON 형식으로만 답하십시오. 다른 텍스트는 절대 포함하지 마십시오.
반드시 한국어로만 답하십시오.

{STANCE_RULES}

{CITIZEN_VOICE_RULES}

{CAVEAT_RULES}

{BLIND_SPOT_RULES}

{{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "stance_strength": "강함" 또는 "기울어짐" 또는 "약함",
  "rationale": "최종 선택 방향의 핵심 이유. 이 페르소나가 체감할 만한 1~2개 이유만 쓰십시오.",
  "caveat": "가장 중요한 유보점 하나. 없으면 null.",
  "blind_spot": "직접성·특수성·비중복성을 모두 만족하는 사각지대. 없으면 null.",
  "affected_group": "blind_spot이 있을 때 가장 직접적으로 영향받는 집단. 없으면 null.",
  "reframing": "정책 전제나 방향 자체에 동의하지 않는 부분이 있으면 반문하십시오. 없으면 null.",
  "persona_link": {{
    "direct": "페르소나 텍스트에서 직접 언급된 근거만 쓰십시오.",
    "inferred": "텍스트에 없지만 맥락에서 합리적으로 추론한 것. 고정관념은 피하십시오."
  }}
}}"""


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


def clean_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned or cleaned.lower() == "null":
        return None
    return cleaned


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

    for field in ("stance_strength", "caveat"):
        value = clean_optional_text(parsed.get(field))
        if value:
            result[field] = value

    blind_spot = clean_optional_text(parsed.get("blind_spot"))
    affected_group = clean_optional_text(parsed.get("affected_group"))
    if blind_spot:
        result["blind_spot"] = blind_spot
        if affected_group:
            result["affected_group"] = affected_group

    if model_provider == "openai":
        reframing = clean_optional_text(parsed.get("reframing"))
        if reframing:
            result["reframing"] = reframing

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

[Task]
제시된 정책 방향에 대한 이 시민의 최종 선택 방향을 판단하십시오.
찬성, 반대, 중립 중 어느 쪽에 가깝습니까?
정책 전문가처럼 답하지 말고 이 페르소나가 실제로 알거나 생활에서 체감할 만한 1~2개 이유만 말하십시오.
정책 보고서처럼 포괄적인 조건 목록을 만들거나 모든 쟁점을 균형 있게 다루려고 하지 마십시오.
조건부 동의나 조건부 반대는 stance를 중립으로 바꾸지 말고 caveat에 분리하십시오.
caveat는 가장 중요한 유보점 하나만 쓰고, 여러 조건을 병렬로 나열하거나 정책 보완책 묶음을 설계하지 마십시오.
예상치 못한 문제는 blind_spot 기준을 통과할 때만 작성하십시오.
blind_spot은 직접성·특수성·비중복성을 모두 만족할 때만 작성하십시오.
blind_spot은 전문가적 정책 분석이 아니라 페르소나의 생활, 직업, 가족, 지역, 경제 조건 때문에 직접 떠올릴 수 있는 문제여야 합니다.
정책 구조 전체를 분석해야만 보이는 문제는 blind_spot으로 쓰지 마십시오.
세 조건 중 하나라도 부족하면 blind_spot은 null로 반환하십시오.

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
                    "Return only a valid JSON object with exactly three arrays: "
                    "concern_clusters, support_clusters, and blind_spot_clusters. "
                    "Concern and support clusters must have label, count, and examples. "
                    "Blind spot clusters must have affected_group, count, and blind_spot_examples. "
                    "For blind_spot_clusters, use only response items with a non-null blind_spot field. "
                    "Do not infer, invent, generalize, or add blind spots from rationale, caveat, reframing, policy context, or outside knowledge. "
                    "If there are no responses with a non-null blind_spot, blind_spot_clusters must be []. "
                    "All cluster labels and examples should be written in Korean. "
                    "Do not use markdown. "
                    "In thinking mode, use at most 3 short reasoning bullets, then stop thinking and produce the final JSON. "
                    "Do not restart, re-check, say wait, say actually, or run another final review."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Policy: {policy}\nResponses: {payload}\n\n"
                    'Return schema: {"concern_clusters":[{"label":"string","count":1,"examples":["string"]}],'
                    '"support_clusters":[{"label":"string","count":1,"examples":["string"]}],'
                    '"blind_spot_clusters":[{"affected_group":"string","count":1,"blind_spot_examples":["string"]}]}'
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
    blind_spots = parsed.get("blind_spot_clusters", [])
    concern_clusters = concerns if isinstance(concerns, list) else []
    support_clusters = support if isinstance(support, list) else []
    blind_spot_clusters = blind_spots if isinstance(blind_spots, list) else []
    has_clusters = bool(concern_clusters or support_clusters or blind_spot_clusters)
    return {
        "status": "completed" if has_clusters else "empty",
        "message": "요약이 생성되었습니다." if has_clusters else "요약 모델이 빈 cluster 배열을 반환했습니다.",
        "concern_clusters": concern_clusters,
        "support_clusters": support_clusters,
        "blind_spot_clusters": blind_spot_clusters,
        "raw_output": raw_output,
    }


def failed_summary(message: str, raw_output: str = "") -> dict:
    return {
        "status": "failed",
        "message": message,
        "concern_clusters": [],
        "support_clusters": [],
        "blind_spot_clusters": [],
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
