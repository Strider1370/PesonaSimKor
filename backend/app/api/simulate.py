import json
import os
import queue
import threading
import time

import anyio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.schemas import SimulateRequest
from app.services.discovery_aggregate import compute_discovery_aggregate
from app.services.discovery_summarizer import build_discovery_summary_payload, summarize_discovery
from app.services.llm_client import (
    build_agent_llm_payload,
    compute_included_fields,
    structure_policy,
    stream_openai_agent_response,
)
from app.services.persona_sampler import sample_personas_with_plan
from app.services.strata_classifier import classify_persona

router = APIRouter()
HEARTBEAT_INTERVAL_SECONDS = 2.0
DEFAULT_OPENAI_AGENT_CONCURRENCY = 5


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def openai_agent_concurrency() -> int:
    try:
        return max(1, int(os.getenv("OPENAI_AGENT_CONCURRENCY", str(DEFAULT_OPENAI_AGENT_CONCURRENCY))))
    except ValueError:
        return DEFAULT_OPENAI_AGENT_CONCURRENCY


def sampled_event_from_persona(persona: dict) -> dict:
    profile = persona.get("structured_profile", {})
    return {
        "agent_id": persona["agent_id"],
        "age": persona["age"],
        "gender": persona["gender"],
        "province": persona.get("province") or profile.get("province"),
        "district": persona.get("district") or profile.get("district"),
        "region": persona["region"],
        "job": persona["job"],
        "family_type": persona.get("family_type") or profile.get("family_type"),
        "age_group": persona["age_group"],
        "region_group": persona["region_group"],
    }


def response_event_from_result(persona: dict, result: dict) -> dict:
    profile = persona.get("structured_profile", {})
    strata = classify_persona(persona) if persona.get("structured_profile") and persona.get("narrative_context") else {}
    event = {
        "agent_id": persona["agent_id"],
        "name": persona.get("name"),
        "age": persona.get("age"),
        "age_group": persona["age_group"],
        "gender": persona["gender"],
        "province": persona.get("province") or profile.get("province"),
        "district": persona.get("district") or profile.get("district"),
        "occupation": persona.get("occupation") or profile.get("occupation") or persona.get("job"),
        "family_type": persona.get("family_type") or profile.get("family_type"),
        "region_group": persona["region_group"],
        **strata,
        "stance": result.get("stance", "neutral"),
        "rationale": result.get("rationale", ""),
        "expected_complaint": result.get("expected_complaint"),
        "blind_spot": result.get("blind_spot"),
        "blind_spot_reason": result.get("blind_spot_reason"),
        "affected_group": result.get("affected_group"),
        "grounding": result.get("grounding"),
        "reframing": result.get("reframing"),
    }
    return event


async def stream_with_heartbeat(source, *args, **kwargs):
    events: queue.Queue[dict | object] = queue.Queue()
    done = object()

    def worker() -> None:
        try:
            for event in source(*args, **kwargs):
                events.put(event)
        finally:
            events.put(done)

    threading.Thread(target=worker, daemon=True).start()
    started_at = time.monotonic()
    last_token_at: float | None = None
    tokens_seen = 0

    while True:
        try:
            event = await anyio.to_thread.run_sync(events.get, True, HEARTBEAT_INTERVAL_SECONDS)
        except queue.Empty:
            now = time.monotonic()
            yield {
                "type": "heartbeat",
                "elapsed_seconds": round(now - started_at, 1),
                "seconds_since_last_token": None if last_token_at is None else round(now - last_token_at, 1),
                "tokens_seen": tokens_seen,
            }
            continue

        if event is done:
            break

        if isinstance(event, dict) and event.get("type") in {"token", "thinking"}:
            tokens_seen += 1
            last_token_at = time.monotonic()
        yield event


async def stream_configured_agent_response_with_heartbeat(
    persona: dict,
    policy: str,
    model_name: str,
    thinking: bool,
    persona_depth: str,
    optional_fields: tuple[str, ...],
):
    async for event in stream_with_heartbeat(
        stream_openai_agent_response,
        persona,
        policy,
        model_name,
        persona_depth=persona_depth,
        thinking=thinking,
        optional_fields=optional_fields,
    ):
        yield event


async def stream_agent_sse_events(
    req: SimulateRequest,
    policy: str,
    persona: dict,
    optional_fields: tuple[str, ...],
):
    yield ("llm_status", {"agent_id": persona["agent_id"], "status": "started"})
    result = {"stance": "neutral", "rationale": "Response generation failed."}
    llm_failed = False
    async for llm_event in stream_configured_agent_response_with_heartbeat(
        persona,
        policy,
        req.model_name,
        req.thinking,
        req.persona_depth,
        optional_fields,
    ):
        if llm_event["type"] in {"token", "thinking"}:
            yield (
                "llm_token",
                {"agent_id": persona["agent_id"], "content": llm_event["content"]},
            )
        elif llm_event["type"] == "heartbeat":
            yield (
                "llm_heartbeat",
                {
                    "agent_id": persona["agent_id"],
                    "elapsed_seconds": llm_event["elapsed_seconds"],
                    "seconds_since_last_token": llm_event["seconds_since_last_token"],
                    "tokens_seen": llm_event["tokens_seen"],
                },
            )
        elif llm_event["type"] == "error":
            llm_failed = True
            yield (
                "llm_error",
                {"agent_id": persona["agent_id"], "message": llm_event["message"]},
            )
            yield ("llm_status", {"agent_id": persona["agent_id"], "status": "failed"})
        elif llm_event["type"] == "final":
            result = llm_event["response"]
            if not llm_failed:
                yield ("llm_status", {"agent_id": persona["agent_id"], "status": "completed"})

    yield ("agent_responded", response_event_from_result(persona, result))


async def stream_openai_agent_sse_events_parallel(
    req: SimulateRequest,
    policy: str,
    prepared_agents: list[dict],
    optional_fields: tuple[str, ...],
):
    send, receive = anyio.create_memory_object_stream[tuple[str, dict]](100)
    semaphore = anyio.Semaphore(openai_agent_concurrency())

    async def run_one(persona: dict) -> None:
        async with semaphore:
            async for event in stream_agent_sse_events(req, policy, persona, optional_fields):
                await send.send(event)

    async def produce() -> None:
        async with send:
            async with anyio.create_task_group() as task_group:
                for persona in prepared_agents:
                    task_group.start_soon(run_one, persona)

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(produce)
        async with receive:
            async for event in receive:
                yield event


async def simulation_stream(req: SimulateRequest):
    policy = req.policy
    n_agents = req.n_agents
    responses: list[dict] = []
    try:
        try:
            structured_policy = structure_policy(policy, model=req.control_model)
        except TypeError:
            structured_policy = structure_policy(policy)
        optional_fields = tuple(structured_policy.get("relevant_optional_fields") or ())
        included_fields = compute_included_fields(req.persona_depth, optional_fields)
        policy_event = {
            **structured_policy,
            "relevant_optional_fields": list(optional_fields),
            "included_fields": included_fields,
            "persona_depth": req.persona_depth,
        }
        yield sse_event("policy_structured", policy_event)
        personas, sampling_plan = sample_personas_with_plan(n_agents)
        yield sse_event("sampling_plan", sampling_plan)
        prepared_agents = []
        for persona in personas:
            yield sse_event("agent_sampled", sampled_event_from_persona(persona))
            yield sse_event(
                "llm_prompt",
                build_agent_llm_payload(
                    persona,
                    policy,
                    model_name=req.model_name,
                    thinking=req.thinking,
                    persona_depth=req.persona_depth,
                    optional_fields=optional_fields,
                ),
            )
            prepared_agents.append(persona)

        async for event_name, event_data in stream_openai_agent_sse_events_parallel(req, policy, prepared_agents, optional_fields):
            if event_name == "agent_responded":
                responses.append(event_data)
            yield sse_event(event_name, event_data)

        responses.sort(key=lambda response: response["agent_id"])

        aggregate = compute_discovery_aggregate(responses)
        yield sse_event("discovery_aggregate", aggregate)

        summary_payload = build_discovery_summary_payload(aggregate, responses, req.control_model)
        yield sse_event(
            "discovery_summary_prompt",
            {"model": summary_payload["model"], "messages": summary_payload["messages"]},
        )
        yield sse_event("discovery_summary_status", {"status": "started"})
        try:
            summary = summarize_discovery(aggregate, responses, req.control_model)
        except Exception as exc:
            summary = {
                "merged_blind_spots": [],
                "merged_reframings": [],
                "merged_complaints": [],
                "featured_axis": aggregate["featured_axis"],
                "featured_axis_rationale": "",
                "raw_output": "",
                "error": f"{type(exc).__name__}: {exc}",
            }
        yield sse_event("discovery_summary", summary)
        yield sse_event(
            "discovery_summary_status",
            {"status": "failed" if summary.get("error") else "completed"},
        )
        yield sse_event("done", {})
    except Exception:
        yield sse_event("error", {"message": "Simulation failed.", "code": "simulation_error"})


@router.post("/simulate")
async def simulate(req: SimulateRequest):
    return StreamingResponse(
        simulation_stream(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
