import json
import queue
import threading
import time

import anyio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.schemas import SimulateRequest
from app.services.aggregation import compute_aggregate
from app.services.llm_client import build_agent_llm_payload, build_summary_llm_payload, stream_agent_response, stream_summary_clusters
from app.services.persona_sampler import sample_personas_with_plan
from app.services.prior_service import get_prior

router = APIRouter()
HEARTBEAT_INTERVAL_SECONDS = 2.0


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_with_heartbeat(source, *args):
    events: queue.Queue[dict | object] = queue.Queue()
    done = object()

    def worker() -> None:
        try:
            for event in source(*args):
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


async def stream_agent_response_with_heartbeat(persona: dict, policy: str, prior: dict | None = None):
    async for event in stream_with_heartbeat(stream_agent_response, persona, policy, prior):
        yield event


async def stream_summary_clusters_with_heartbeat(policy: str, responses: list[dict]):
    async for event in stream_with_heartbeat(stream_summary_clusters, policy, responses):
        yield event


async def simulation_stream(policy: str, n_agents: int):
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
            yield sse_event("llm_prompt", build_agent_llm_payload(persona, policy, prior))
            yield sse_event("llm_status", {"agent_id": persona["agent_id"], "status": "started"})
            result = {"stance": "neutral", "rationale": "Response generation failed."}
            llm_failed = False
            async for llm_event in stream_agent_response_with_heartbeat(persona, policy, prior):
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
                "rationale": result.get("rationale", ""),
            }
            responses.append(response_event)
            yield sse_event("agent_responded", response_event)

        yield sse_event("summary_prompt", build_summary_llm_payload(policy, responses))
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
            "raw_output": "",
        }
        summary_failed = False
        async for summary_event in stream_summary_clusters_with_heartbeat(policy, responses):
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
                if summary_failed and summary["status"] != "failed":
                    summary["status"] = "failed"

        aggregate["concern_clusters"] = summary["concern_clusters"]
        aggregate["support_clusters"] = summary["support_clusters"]
        yield sse_event(
            "summary_status",
            {
                "status": summary["status"],
                "message": summary["message"],
                "raw_output": summary["raw_output"],
            },
        )
        yield sse_event("aggregate", aggregate)
        yield sse_event("done", {})
    except Exception:
        yield sse_event("error", {"message": "Simulation failed.", "code": "simulation_error"})


@router.post("/simulate")
async def simulate(req: SimulateRequest):
    return StreamingResponse(
        simulation_stream(req.policy, req.n_agents),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
