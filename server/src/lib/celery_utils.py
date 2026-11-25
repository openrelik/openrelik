# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import ast
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
import re
import threading
import time

from celery.app import Celery
import kombu.exceptions
import redis
import redis.exceptions

STATUS_CACHE_KEY = "openrelik:taskqueue:status:v1"
STATUS_CACHE_TTL_SECONDS = 5
STATUS_REFRESH_COOLDOWN_SECONDS = 1.0
QUEUE_SCAN_LIMIT = 2000
INSPECT_TIMEOUT_SECONDS = 1.0
REDIS_SOCKET_TIMEOUT_SECONDS = 2.0
REDIS_PRIORITY_SEP = "\x06\x16"
REDIS_PRIORITY_STEPS = (0, 3, 6, 9)

_status_lock = threading.Lock()
_last_collected_monotonic = 0.0
_last_payload_cache: dict | None = None
_last_live_snapshot: dict | None = None
_status_redis_client = None


class BrokerUnavailableError(RuntimeError):
    """Raised when Redis or the Celery broker cannot be reached."""


def _get_status_redis_client(celery_instance):
    """Return a timeout-bounded Redis client for status caching and queue scans."""
    global _status_redis_client
    broker_url = getattr(
        getattr(celery_instance, "conf", None), "broker_url", None
    ) or os.getenv("REDIS_URL")
    if not broker_url:
        # Fallback for unit-test mocks that only provide celery_instance.connection().
        return None
    if _status_redis_client is None:
        _status_redis_client = redis.from_url(
            broker_url,
            socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
            socket_connect_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        )
    return _status_redis_client


def _short_task_name(task_name: str) -> str:
    """Fallback human-readable label when a task registers without metadata."""
    return task_name.rsplit(".", 1)[-1]


def _extract_task_info_from_message(
    raw_message: bytes | str,
) -> tuple[str | None, str | None]:
    """Read Celery's ``(task_name, task_id)`` from a raw Redis broker JSON envelope."""
    try:
        envelope = json.loads(raw_message)
    except (TypeError, ValueError):
        return None, None
    if not isinstance(envelope, dict):
        return None, None
    headers = envelope.get("headers")
    task_name = None
    task_id = None
    if isinstance(headers, dict):
        if isinstance(headers.get("task"), str):
            task_name = headers["task"]
        if isinstance(headers.get("id"), str):
            task_id = headers["id"]
    if task_name is None and isinstance(envelope.get("task"), str):
        task_name = envelope["task"]
    if task_id is None and isinstance(envelope.get("id"), str):
        task_id = envelope["id"]
    return task_name, task_id


def _priority_key(queue_name: str, priority: int) -> str:
    """Build Kombu's Redis list key for a queue and priority step."""
    return f"{queue_name}{REDIS_PRIORITY_SEP}{priority}" if priority else queue_name


def _discover_redis_queue_names(redis_client) -> set[str]:
    """Find OpenRelik queue names present in Redis, including offline queues with backlog."""
    discovered: set[str] = set()
    try:
        for raw_key in redis_client.scan_iter(match="openrelik-*", count=200):
            key = (
                raw_key.decode("utf-8", errors="ignore")
                if isinstance(raw_key, bytes)
                else str(raw_key)
            )
            if ":" in key or key.endswith(".pidbox"):
                continue
            base = key.split(REDIS_PRIORITY_SEP, 1)[0]
            if base:
                discovered.add(base)
    except AttributeError:
        pass
    return discovered


def _scan_redis_queues(
    redis_client, queue_names: set[str], scan_limit: int = QUEUE_SCAN_LIMIT
) -> tuple[dict[str, int], dict[str, dict[str, int]], dict[str, bool], set[str]]:
    """Read exact queue depths (LLEN), bounded per-task counts, and queued task UUIDs."""
    if not queue_names:
        return {}, {}, {}, set()

    sorted_queues = sorted(queue_names)
    key_pairs = [
        (queue_name, _priority_key(queue_name, pri))
        for queue_name in sorted_queues
        for pri in REDIS_PRIORITY_STEPS
    ]

    pipe = redis_client.pipeline(transaction=False)
    for _, key in key_pairs:
        pipe.llen(key)
    lengths = pipe.execute()

    queue_totals: dict[str, int] = {q: 0 for q in sorted_queues}
    keys_to_scan: list[tuple[str, str, int]] = []
    remaining_per_queue: dict[str, int] = {q: scan_limit for q in sorted_queues}

    for (queue_name, key), length in zip(key_pairs, lengths):
        length = int(length or 0)
        queue_totals[queue_name] += length
        if length > 0 and remaining_per_queue[queue_name] > 0:
            take = min(length, remaining_per_queue[queue_name])
            keys_to_scan.append((queue_name, key, take))
            remaining_per_queue[queue_name] -= take

    task_counts: dict[str, dict[str, int]] = {
        q: defaultdict(int) for q in sorted_queues
    }
    queued_task_ids: set[str] = set()
    if keys_to_scan:
        scan_pipe = redis_client.pipeline(transaction=False)
        for _, key, take in keys_to_scan:
            scan_pipe.lrange(key, 0, take - 1)
        scanned_batches = scan_pipe.execute()

        for (queue_name, _, _), messages in zip(keys_to_scan, scanned_batches):
            for raw in messages or []:
                task_name, task_id = _extract_task_info_from_message(raw)
                task_counts[queue_name][task_name or "unknown"] += 1
                if task_id:
                    queued_task_ids.add(task_id.replace("-", ""))

    truncated = {q: queue_totals[q] > scan_limit for q in sorted_queues}
    return queue_totals, task_counts, truncated, queued_task_ids


def _collect_inspect_snapshots(
    celery_instance, timeout: float = INSPECT_TIMEOUT_SECONDS
) -> dict:
    """Run Celery inspect broadcasts concurrently using isolated Celery apps.

    Using a short-lived Celery instance per thread with ``broker_pool_limit=None``
    and explicit Redis socket timeouts avoids Kombu connection-pool contention and
    pub/sub deadlocks on a shared global ``Celery`` app.
    """
    broker_url = getattr(
        getattr(celery_instance, "conf", None), "broker_url", None
    ) or os.getenv("REDIS_URL")

    def _run_cmd(method_name: str, *args, **kwargs):
        if broker_url:
            app = Celery(broker=broker_url)
            app.conf.broker_pool_limit = None
            app.conf.broker_transport_options = {
                "socket_timeout": timeout + 1.5,
                "socket_connect_timeout": REDIS_SOCKET_TIMEOUT_SECONDS,
            }
            try:
                inspector = app.control.inspect(timeout=timeout)
                return getattr(inspector, method_name)(*args, **kwargs)
            finally:
                app.close()
        inspector = celery_instance.control.inspect(timeout=timeout)
        return getattr(inspector, method_name)(*args, **kwargs)

    calls = {
        "stats": ("stats", (), {}),
        "active": ("active", (), {"safe": True}),
        "reserved": ("reserved", (), {"safe": True}),
        "active_queues": ("active_queues", (), {}),
        "registered": ("registered", ("metadata",), {}),
    }
    results = {}
    pool = ThreadPoolExecutor(max_workers=len(calls))
    try:
        futures = {
            name: pool.submit(_run_cmd, method, *args, **kwargs)
            for name, (method, args, kwargs) in calls.items()
        }
        deadline = time.monotonic() + timeout + 2.0
        for name, future in futures.items():
            remaining = max(0.1, deadline - time.monotonic())
            try:
                results[name] = future.result(timeout=remaining) or {}
            except Exception:
                results[name] = {}
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return results


def _read_cached_status(redis_client) -> tuple[dict, dict] | None:
    """Return cached ``(payload, live_snapshot)`` from Redis if present and valid.

    Propagates ``redis.exceptions.RedisError`` so unreachable brokers fail fast
    with HTTP 503 instead of silently returning empty counts.
    """
    raw = redis_client.get(STATUS_CACHE_KEY)
    if not raw:
        return None
    try:
        envelope = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(envelope, dict):
        return None
    payload = envelope.get("payload")
    snap = envelope.get("live_snapshot")
    if not isinstance(payload, dict) or not isinstance(snap, dict):
        return None
    return payload, {
        "live_task_ids": set(snap.get("live_task_ids") or ()),
        "online_queues": set(snap.get("online_queues") or ()),
        "truncated_queues": set(snap.get("truncated_queues") or ()),
    }


def get_cluster_status(celery_instance, *, refresh: bool = False) -> dict:
    """Collect aggregate Celery worker, slot, and per-queue/per-task status.

    Uses a short in-memory + Redis TTL cache with a bounded single-flight lock so
    auto-refreshing browsers never flood workers or block server threads.
    Never returns raw task args, kwargs, file paths, or task_config.

    Args:
        celery_instance: A Celery application connected to Redis.
        refresh: When True, bypasses the cached snapshot unless collected within
            the minimum cooldown window.

    Returns:
        dict: Serialized status payload matching ``TaskqueueStatusResponse``.

    Raises:
        BrokerUnavailableError: If the Redis broker cannot be reached.
    """
    global _last_collected_monotonic, _last_payload_cache, _last_live_snapshot

    now = time.monotonic()
    age = now - _last_collected_monotonic
    can_bypass = refresh and age >= STATUS_REFRESH_COOLDOWN_SECONDS
    if (
        _last_payload_cache is not None
        and not can_bypass
        and age < STATUS_CACHE_TTL_SECONDS
    ):
        return _last_payload_cache

    acquired = _status_lock.acquire(timeout=INSPECT_TIMEOUT_SECONDS + 3.0)
    if not acquired:
        if _last_payload_cache is not None:
            return _last_payload_cache
        raise BrokerUnavailableError("Timed out waiting for Celery status collection.")

    try:
        now = time.monotonic()
        age = now - _last_collected_monotonic
        can_bypass = refresh and age >= STATUS_REFRESH_COOLDOWN_SECONDS
        if (
            _last_payload_cache is not None
            and not can_bypass
            and age < STATUS_CACHE_TTL_SECONDS
        ):
            return _last_payload_cache

        redis_client = _get_status_redis_client(celery_instance)
        conn_ctx = None
        if redis_client is None:
            conn_ctx = celery_instance.connection()
            connection = conn_ctx.__enter__()
            redis_client = connection.default_channel.client

        try:
            if not can_bypass:
                cached = _read_cached_status(redis_client)
                if cached is not None:
                    cached_payload, cached_snapshot = cached
                    _last_payload_cache = cached_payload
                    _last_live_snapshot = cached_snapshot
                    _last_collected_monotonic = time.monotonic()
                    return cached_payload
            else:
                # Verify broker reachability before waiting on Celery inspect timeouts.
                redis_client.ping()

            snapshots = _collect_inspect_snapshots(celery_instance)
            stats_map = snapshots["stats"]
            active_map = snapshots["active"]
            reserved_map = snapshots["reserved"]
            queues_map = snapshots["active_queues"]
            registered_map = snapshots["registered"]

            worker_names = sorted(
                set(stats_map)
                | set(active_map)
                | set(reserved_map)
                | set(queues_map)
                | set(registered_map)
            )

            task_display_names: dict[str, str] = {}
            task_has_metadata: dict[str, bool] = {}
            worker_registered_tasks: dict[str, list[str]] = {}
            worker_queues: dict[str, list[str]] = {}
            queue_registered_tasks: dict[str, set[str]] = defaultdict(set)
            all_queues: set[str] = set()

            for worker in worker_names:
                q_names = sorted(
                    {
                        q.get("name")
                        for q in (queues_map.get(worker) or [])
                        if isinstance(q, dict) and q.get("name")
                    }
                )
                worker_queues[worker] = q_names
                all_queues.update(q_names)

                reg_tasks: list[str] = []
                for entry in registered_map.get(worker) or []:
                    if not isinstance(entry, str) or not entry.strip():
                        continue
                    task_name = entry.split()[0]
                    if task_name.startswith("celery."):
                        continue
                    reg_tasks.append(task_name)

                    metadata = None
                    metadata_match = re.search(r"(\{.+\})", entry)
                    if metadata_match:
                        try:
                            parsed = ast.literal_eval(metadata_match.group(0))
                            if isinstance(parsed, dict):
                                metadata = parsed
                        except (ValueError, SyntaxError):
                            metadata = None

                    if metadata is not None:
                        task_has_metadata[task_name] = True
                        task_display_names[task_name] = metadata.get(
                            "display_name"
                        ) or _short_task_name(task_name)
                    else:
                        task_has_metadata.setdefault(task_name, False)
                        task_display_names.setdefault(
                            task_name, _short_task_name(task_name)
                        )

                    # Route prefix matches queue name by convention; fall back to the worker's
                    # sole active queue when a worker uses a custom queue name.
                    prefix_queue = task_name.split(".")[0]
                    if prefix_queue in q_names:
                        queue_registered_tasks[prefix_queue].add(task_name)
                    elif len(q_names) == 1:
                        queue_registered_tasks[q_names[0]].add(task_name)
                    else:
                        for q_name in q_names:
                            queue_registered_tasks[q_name].add(task_name)

                worker_registered_tasks[worker] = sorted(set(reg_tasks))

            def _task_queue(task_item: dict, worker: str) -> str:
                delivery = task_item.get("delivery_info")
                if isinstance(delivery, dict):
                    rk = delivery.get("routing_key")
                    if isinstance(rk, str) and rk:
                        return rk
                t_name = task_item.get("name")
                if isinstance(t_name, str) and "." in t_name:
                    return t_name.split(".")[0]
                w_queues = worker_queues.get(worker) or []
                return w_queues[0] if w_queues else "default"

            running_by_queue_task: dict[str, dict[str, int]] = defaultdict(
                lambda: defaultdict(int)
            )
            reserved_by_queue_task: dict[str, dict[str, int]] = defaultdict(
                lambda: defaultdict(int)
            )
            running_by_queue: dict[str, int] = defaultdict(int)
            reserved_by_queue: dict[str, int] = defaultdict(int)

            live_task_ids: set[str] = set()

            for worker, tasks in active_map.items():
                for task_item in tasks or []:
                    if not isinstance(task_item, dict):
                        continue
                    t_name = str(task_item.get("name") or "unknown")
                    t_id = task_item.get("id")
                    if isinstance(t_id, str) and t_id:
                        live_task_ids.add(t_id.replace("-", ""))
                    q_name = _task_queue(task_item, worker)
                    all_queues.add(q_name)
                    running_by_queue[q_name] += 1
                    running_by_queue_task[q_name][t_name] += 1

            for worker, tasks in reserved_map.items():
                for task_item in tasks or []:
                    if not isinstance(task_item, dict):
                        continue
                    t_name = str(task_item.get("name") or "unknown")
                    t_id = task_item.get("id")
                    if isinstance(t_id, str) and t_id:
                        live_task_ids.add(t_id.replace("-", ""))
                    q_name = _task_queue(task_item, worker)
                    all_queues.add(q_name)
                    reserved_by_queue[q_name] += 1
                    reserved_by_queue_task[q_name][t_name] += 1

            redis_discovered_queues = _discover_redis_queue_names(redis_client)
            scan_queues = all_queues | redis_discovered_queues
            queued_totals, queued_by_queue_task, truncated_map, queued_task_ids = (
                _scan_redis_queues(
                    redis_client, scan_queues, scan_limit=QUEUE_SCAN_LIMIT
                )
            )
            live_task_ids.update(queued_task_ids)

            # Surface offline queues only when they still hold queued backlog in Redis.
            for q_name in redis_discovered_queues:
                if queued_totals.get(q_name, 0) > 0:
                    all_queues.add(q_name)

            workers_out = []
            queue_worker_counts: dict[str, int] = defaultdict(int)
            queue_slots_busy: dict[str, int] = defaultdict(int)
            queue_slots_total: dict[str, int] = defaultdict(int)

            workers_busy = 0
            total_slots_busy = 0
            total_slots = 0
            total_running = 0
            total_reserved = 0

            for worker in worker_names:
                w_stats = stats_map.get(worker) or {}
                pool_info = (
                    w_stats.get("pool") if isinstance(w_stats.get("pool"), dict) else {}
                )
                concurrency = int(pool_info.get("max-concurrency") or 0)
                busy = len(active_map.get(worker) or [])
                res = len(reserved_map.get(worker) or [])
                totals = w_stats.get("total")
                processed = (
                    sum(int(v) for v in totals.values())
                    if isinstance(totals, dict)
                    else 0
                )
                uptime = w_stats.get("uptime")
                prefetch_count = w_stats.get("prefetch_count")
                reg = worker_registered_tasks.get(worker, [])
                is_internal = bool(reg) and all(
                    not task_has_metadata.get(t, False) for t in reg
                )

                if busy > 0:
                    workers_busy += 1
                total_slots_busy += busy
                total_slots += concurrency
                total_running += busy
                total_reserved += res

                for q_name in worker_queues.get(worker, []):
                    queue_worker_counts[q_name] += 1
                    queue_slots_busy[q_name] += busy
                    queue_slots_total[q_name] += concurrency

                workers_out.append(
                    {
                        "hostname": worker,
                        "status": "online",
                        "queues": worker_queues.get(worker, []),
                        "is_internal": is_internal,
                        "slots_busy": busy,
                        "slots_total": concurrency,
                        "reserved": res,
                        "processed": processed,
                        "uptime": (
                            int(uptime) if isinstance(uptime, (int, float)) else None
                        ),
                        "prefetch_count": (
                            int(prefetch_count)
                            if isinstance(prefetch_count, (int, float))
                            else None
                        ),
                        "registered_tasks": reg,
                    }
                )

            queues_out = []
            total_queued = 0
            for q_name in sorted(all_queues):
                q_running = running_by_queue.get(q_name, 0)
                q_reserved = reserved_by_queue.get(q_name, 0)
                q_queued = queued_totals.get(q_name, 0)
                total_queued += q_queued

                task_names = sorted(
                    queue_registered_tasks.get(q_name, set())
                    | set(running_by_queue_task.get(q_name, {}))
                    | set(reserved_by_queue_task.get(q_name, {}))
                    | set(queued_by_queue_task.get(q_name, {}))
                )
                is_internal = bool(task_names) and all(
                    task_has_metadata.get(t) is False for t in task_names
                )

                q_tasks = []
                for t_name in task_names:
                    t_run = running_by_queue_task.get(q_name, {}).get(t_name, 0)
                    t_res = reserved_by_queue_task.get(q_name, {}).get(t_name, 0)
                    t_q = queued_by_queue_task.get(q_name, {}).get(t_name, 0)
                    q_tasks.append(
                        {
                            "task_name": t_name,
                            "display_name": task_display_names.get(
                                t_name, _short_task_name(t_name)
                            ),
                            "running": t_run,
                            "reserved": t_res,
                            "queued": t_q,
                            "waiting": t_res + t_q,
                        }
                    )

                queues_out.append(
                    {
                        "name": q_name,
                        "is_internal": is_internal,
                        "workers_online": queue_worker_counts.get(q_name, 0),
                        "slots_busy": queue_slots_busy.get(q_name, 0),
                        "slots_total": queue_slots_total.get(q_name, 0),
                        "running": q_running,
                        "reserved": q_reserved,
                        "queued": q_queued,
                        "waiting": q_reserved + q_queued,
                        "scan_truncated": truncated_map.get(q_name, False),
                        "scan_limit": QUEUE_SCAN_LIMIT,
                        "tasks": q_tasks,
                    }
                )

            workers_online = len(workers_out)
            payload = {
                "collected_at": datetime.now(timezone.utc).isoformat(),
                "summary": {
                    "workers_online": workers_online,
                    "workers_busy": workers_busy,
                    "workers_idle": max(0, workers_online - workers_busy),
                    "slots_busy": total_slots_busy,
                    "slots_total": total_slots,
                    "tasks_running": total_running,
                    "tasks_reserved": total_reserved,
                    "tasks_queued": total_queued,
                    "tasks_waiting": total_reserved + total_queued,
                },
                "queues": queues_out,
                "workers": workers_out,
            }

            live_snapshot = {
                "live_task_ids": live_task_ids,
                "online_queues": {
                    q for q, cnt in queue_worker_counts.items() if cnt > 0
                },
                "truncated_queues": {
                    q for q, is_trunc in truncated_map.items() if is_trunc
                },
            }
            _last_payload_cache = payload
            _last_live_snapshot = live_snapshot
            _last_collected_monotonic = time.monotonic()
            cache_envelope = {
                "payload": payload,
                "live_snapshot": {
                    "live_task_ids": sorted(live_snapshot["live_task_ids"]),
                    "online_queues": sorted(live_snapshot["online_queues"]),
                    "truncated_queues": sorted(live_snapshot["truncated_queues"]),
                },
            }
            try:
                redis_client.setex(
                    STATUS_CACHE_KEY,
                    STATUS_CACHE_TTL_SECONDS,
                    json.dumps(cache_envelope),
                )
            except redis.exceptions.RedisError:
                pass
            return payload
        finally:
            if conn_ctx is not None:
                conn_ctx.__exit__(None, None, None)
    except (
        kombu.exceptions.OperationalError,
        redis.exceptions.RedisError,
        OSError,
    ) as exc:
        raise BrokerUnavailableError("Unable to reach Celery broker (Redis).") from exc
    finally:
        _status_lock.release()


def get_live_task_snapshot(celery_instance) -> dict:
    """Return cached ``(live_task_ids, online_queues, truncated_queues)`` for stall checks."""
    now = time.monotonic()
    if (
        _last_live_snapshot is not None
        and (now - _last_collected_monotonic) < STATUS_CACHE_TTL_SECONDS
    ):
        return _last_live_snapshot
    get_cluster_status(celery_instance, refresh=False)
    return _last_live_snapshot or {
        "live_task_ids": set(),
        "online_queues": set(),
        "truncated_queues": set(),
    }


def get_registered_tasks(celery_instance):
    """Get a list of registered celery tasks.

    Args:
        celery_instance (Celery): A celery instance.

    Returns:
        list: A list of registered celery tasks.
    """
    registered_celery_tasks = celery_instance.control.inspect().registered("metadata")
    registered_task_names = set()
    registered_tasks_formatted = []

    # If no Celery workers are currently active, return an empty list.
    if not registered_celery_tasks:
        return []

    for _, tasks in registered_celery_tasks.items():
        for task in tasks:
            task_name = task.split()[0]
            # Extract metadata embedded within the task string.
            # Metadata is stored as a Python dictionary enclosed in curly braces within the string.
            # This regular expression captures the entire dictionary using curly braces as delimiters.
            # group(0) retrieves the full match, i.e., the dictionary string.
            # ast.literal_eval() safely converts the dictionary string into an actual Python dictionary object.
            metadata_match = re.search("({.+})", task)
            # The embedded metadata dict is what marks a task as a worker/workflow
            # task. Internal tasks (e.g. the mediator's background hashing task) are
            # registered without metadata; skip them so they don't appear in the task
            # registry/UI and don't break parsing.
            if not metadata_match:
                continue
            metadata = ast.literal_eval(metadata_match.group(0))
            if task_name in registered_task_names:
                continue

            # Create a dictionary for task information
            task_info = {"task_name": task_name, "queue_name": task_name.split(".")[0]}

            # Merge metadata into task information
            task_info.update(metadata)  # Extend with metadata

            # Add the enriched task information to the list
            registered_tasks_formatted.append(task_info)

            registered_task_names.add(task_name)
    return registered_tasks_formatted


def update_task_queues(celery_instance):
    """Update the task queues for the celery instance.

    Args:
        celery_instance (Celery): The celery instance.
    """
    registered_tasks = get_registered_tasks(celery_instance)
    task_routes = {}
    for task in registered_tasks:
        task_routes[task.get("task_name")] = {"queue": task.get("queue_name")}
    celery_instance.conf.task_routes = task_routes


def get_worker_stats(celery_instance):
    """Retrieves worker statistics."""
    return celery_instance.control.inspect().stats()


def get_worker_configurations(celery_instance):
    """Retrieves worker configurations."""
    return celery_instance.control.inspect().conf()


def get_worker_reports(celery_instance):
    """Retrieves worker reports."""
    return celery_instance.control.inspect().report()


def ping_workers(celery_instance):
    """Pings workers to check their status."""
    return celery_instance.control.ping()


def get_active_tasks(celery_instance):
    """Retrieves active tasks."""
    return celery_instance.control.inspect().active(safe=True)


def get_scheduled_tasks(celery_instance):
    """Retrieves scheduled tasks."""
    return celery_instance.control.inspect().scheduled(safe=True)


def get_reserved_tasks(celery_instance):
    """Retrieves reserved tasks."""
    return celery_instance.control.inspect().reserved(safe=True)


def get_revoked_tasks(celery_instance):
    """Retrieves revoked tasks."""
    return celery_instance.control.inspect().revoked(safe=True)


def get_active_queues(celery_instance):
    """Retrieves active queues."""
    return celery_instance.control.inspect().active_queues()
