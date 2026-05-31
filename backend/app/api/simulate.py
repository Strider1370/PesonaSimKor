import json
import os
import queue
import threading
import time

import anyio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.schemas import SimulateRequest
from app.services.aggregation import compute_aggregate
from app.services.llm_client import (
    build_agent_llm_payload,
    build_summary_llm_payload,
    normalize_summary,
    refill_summary_short_fields,
    stream_openai_agent_response,
    stream_openai_summary_clusters,
)
from app.services.persona_sampler import sample_personas_with_plan
from app.services.prior_service import get_prior

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
    return {
        "agent_id": persona["agent_id"],
        "age": persona["age"],
        "gender": persona["gender"],
        "region": persona["region"],
        "job": persona["job"],
        "age_group": persona["age_group"],
        "region_group": persona["region_group"],
    }


def response_event_from_result(persona: dict, result: dict, prior: dict | None = None) -> dict:
    event = {
        "agent_id": persona["agent_id"],
        "age_group": persona["age_group"],
        "gender": persona["gender"],
        "region_group": persona["region_group"],
        "stance": result.get("stance", "neutral"),
        "stance_strength": result.get("stance_strength"),
        "rationale": result.get("rationale", ""),
        "caveat": result.get("caveat"),
        "blind_spot": result.get("blind_spot"),
        "affected_group": result.get("affected_group"),
        "reframing": result.get("reframing"),
        "persona_link": result.get("persona_link"),
    }
    if prior:
        event["prior"] = prior
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
    prior: dict | None,
    model_name: str,
    thinking: bool,
    persona_depth: str,
):
    async for event in stream_with_heartbeat(
        stream_openai_agent_response,
        persona,
        policy,
        prior,
        model_name,
        persona_depth=persona_depth,
        thinking=thinking,
    ):
        yield event


async def stream_configured_summary_clusters_with_heartbeat(
    policy: str,
    responses: list[dict],
    model_name: str,
    thinking: bool,
):
    async for event in stream_with_heartbeat(stream_openai_summary_clusters, policy, responses, model_name, thinking):
        yield event


async def stream_agent_sse_events(req: SimulateRequest, policy: str, persona: dict, prior: dict | None):
    yield ("llm_status", {"agent_id": persona["agent_id"], "status": "started"})
    result = {"stance": "neutral", "rationale": "Response generation failed."}
    llm_failed = False
    async for llm_event in stream_configured_agent_response_with_heartbeat(
        persona,
        policy,
        prior,
        req.model_name,
        req.thinking,
        req.persona_depth,
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

    yield ("agent_responded", response_event_from_result(persona, result, prior))


async def stream_openai_agent_sse_events_parallel(
    req: SimulateRequest,
    policy: str,
    prepared_agents: list[tuple[dict, dict | None]],
):
    send, receive = anyio.create_memory_object_stream[tuple[str, dict]](100)
    semaphore = anyio.Semaphore(openai_agent_concurrency())

    async def run_one(persona: dict, prior: dict | None) -> None:
        async with semaphore:
            async for event in stream_agent_sse_events(req, policy, persona, prior):
                await send.send(event)

    async def produce() -> None:
        async with send:
            async with anyio.create_task_group() as task_group:
                for persona, prior in prepared_agents:
                    task_group.start_soon(run_one, persona, prior)

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
        personas, sampling_plan = sample_personas_with_plan(n_agents)
        yield sse_event("sampling_plan", sampling_plan)
        prepared_agents = []
        for persona in personas:
            yield sse_event("agent_sampled", sampled_event_from_persona(persona))
            prior = get_prior(
                req.topic_id,
                {
                    "age_group": persona["age_group"],
                    "gender": persona["gender"],
                    "province": persona.get("structured_profile", {}).get("province"),
                },
            )
            yield sse_event(
                "llm_prompt",
                build_agent_llm_payload(
                    persona,
                    policy,
                    prior,
                    model_name=req.model_name,
                    thinking=req.thinking,
                    persona_depth=req.persona_depth,
                ),
            )
            prepared_agents.append((persona, prior))

        async for event_name, event_data in stream_openai_agent_sse_events_parallel(req, policy, prepared_agents):
            if event_name == "agent_responded":
                responses.append(event_data)
            yield sse_event(event_name, event_data)

        responses.sort(key=lambda response: response["agent_id"])

        yield sse_event("summary_prompt", build_summary_llm_payload(policy, responses, req.model_name))
        yield sse_event(
            "summary_status",
            {"status": "started", "message": f"{len(responses)}개 응답을 취합 요약하는 중입니다."},
        )

        aggregate = compute_aggregate(responses)
        summary = {
            "status": "failed",
            "message": "Summary generation failed.",
            "concern_clusters": [],
            "support_clusters": [],
            "blind_spot_clusters": [],
            "raw_output": "",
        }
        summary_failed = False
        async for summary_event in stream_configured_summary_clusters_with_heartbeat(
            policy,
            responses,
            req.model_name,
            req.thinking,
        ):
            if summary_event["type"] in {"token", "thinking"}:
                yield sse_event("summary_token", {"content": summary_event["content"]})
            elif summary_event["type"] == "heartbeat":
                yield sse_event(
                    "summary_heartbeat",
                    {
                        "elapsed_seconds": summary_event["elapsed_seconds"],
                        "seconds_since_last_token": summary_event["seconds_since_last_token"],
                        "tokens_seen": summary_event["tokens_seen"],
                    },
                )
            elif summary_event["type"] == "error":
                summary_failed = True
                yield sse_event("summary_error", {"message": summary_event["message"]})
            elif summary_event["type"] == "final":
                summary = summary_event["summary"]
                if summary_failed and summary.get("status") != "failed":
                    summary["status"] = "failed"

        summary = normalize_summary(
            summary,
            responses,
            refill_missing=lambda missing: refill_summary_short_fields(
                policy,
                missing,
                model_name=req.model_name,
                thinking=req.thinking,
            ),
        )
        aggregate["concern_clusters"] = summary.get("concern_clusters", [])
        aggregate["support_clusters"] = summary.get("support_clusters", [])
        aggregate["blind_spot_clusters"] = summary.get("blind_spot_clusters", []) if aggregate["blind_spot_raw"] else []
        yield sse_event(
            "summary_status",
            {
                "status": summary.get("status", "empty"),
                "message": summary.get("message", "Summary generation returned no status message."),
                "raw_output": summary.get("raw_output", ""),
            },
        )
        yield sse_event("aggregate", aggregate)
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
