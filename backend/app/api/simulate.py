import inspect
import json
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
    stream_agent_response,
    stream_openai_agent_response,
    stream_openai_summary_clusters,
    stream_summary_clusters,
)
from app.services.persona_sampler import sample_personas_with_plan
from app.services.prior_service import get_prior

router = APIRouter()
HEARTBEAT_INTERVAL_SECONDS = 2.0


def accepts_model_provider(source) -> bool:
    try:
        signature = inspect.signature(source)
    except (TypeError, ValueError):
        return True
    return "model_provider" in signature.parameters or any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()
    )


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


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


async def stream_agent_response_with_heartbeat(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
):
    async for event in stream_with_heartbeat(stream_agent_response, persona, policy, prior, model_name, thinking, persona_depth):
        yield event


async def stream_configured_agent_response_with_heartbeat(
    provider: str,
    persona: dict,
    policy: str,
    prior: dict | None,
    model_name: str,
    thinking: bool,
    persona_depth: str,
):
    if provider == "openai":
        args = [persona, policy, prior, model_name, persona_depth, thinking]
        kwargs = {}
        if accepts_model_provider(stream_openai_agent_response):
            kwargs["model_provider"] = provider
        async for event in stream_with_heartbeat(
            stream_openai_agent_response,
            *args,
            **kwargs,
        ):
            yield event
        return

    args = [persona, policy, prior, model_name, thinking, persona_depth]
    kwargs = {}
    if accepts_model_provider(stream_agent_response):
        kwargs["model_provider"] = provider
    async for event in stream_with_heartbeat(stream_agent_response, *args, **kwargs):
        yield event


async def stream_summary_clusters_with_heartbeat(policy: str, responses: list[dict], model_name: str | None = None):
    async for event in stream_with_heartbeat(stream_summary_clusters, policy, responses, model_name):
        yield event


async def stream_configured_summary_clusters_with_heartbeat(
    provider: str,
    policy: str,
    responses: list[dict],
    model_name: str,
    thinking: bool,
):
    if provider == "openai":
        async for event in stream_with_heartbeat(stream_openai_summary_clusters, policy, responses, model_name, thinking):
            yield event
        return

    async for event in stream_with_heartbeat(stream_summary_clusters, policy, responses, model_name):
        yield event


async def simulation_stream(req: SimulateRequest):
    policy = req.policy
    n_agents = req.n_agents
    responses: list[dict] = []
    try:
        personas, sampling_plan = sample_personas_with_plan(n_agents)
        yield sse_event("sampling_plan", sampling_plan)
        for persona in personas:
            sampled_event = {
                "agent_id": persona["agent_id"],
                "age": persona["age"],
                "gender": persona["gender"],
                "region": persona["region"],
                "job": persona["job"],
                "age_group": persona["age_group"],
                "region_group": persona["region_group"],
            }
            yield sse_event("agent_sampled", sampled_event)

            prior = get_prior(
                policy,
                {
                    "age_group": persona["age_group"],
                    "region_group": persona["region_group"],
                    "gender": persona["gender"],
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
                    model_provider=req.model_provider,
                ),
            )
            yield sse_event("llm_status", {"agent_id": persona["agent_id"], "status": "started"})
            result = {"stance": "neutral", "rationale": "Response generation failed."}
            llm_failed = False
            async for llm_event in stream_configured_agent_response_with_heartbeat(
                req.model_provider,
                persona,
                policy,
                prior,
                req.model_name,
                req.thinking,
                req.persona_depth,
            ):
                if llm_event["type"] in {"token", "thinking"}:
                    yield sse_event(
                        "llm_token",
                        {"agent_id": persona["agent_id"], "content": llm_event["content"]},
                    )
                elif llm_event["type"] == "heartbeat":
                    yield sse_event(
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
                    yield sse_event(
                        "llm_error",
                        {"agent_id": persona["agent_id"], "message": llm_event["message"]},
                    )
                    yield sse_event("llm_status", {"agent_id": persona["agent_id"], "status": "failed"})
                elif llm_event["type"] == "final":
                    result = llm_event["response"]
                    if not llm_failed:
                        yield sse_event("llm_status", {"agent_id": persona["agent_id"], "status": "completed"})

            response_event = {
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
            responses.append(response_event)
            yield sse_event("agent_responded", response_event)

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
            req.model_provider,
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
