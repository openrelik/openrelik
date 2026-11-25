# Copyright 2026 Google LLC
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

"""Aggregate system storage and datastore counts for the Status page."""

from datetime import datetime, timezone
import json
import os
import shutil
import threading
import time

import redis
import redis.exceptions
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, aliased

from config import get_config
from datastores.sql.models.file import File
from datastores.sql.models.folder import Folder
from datastores.sql.models.workflow import Workflow

STORAGE_STATUS_CACHE_KEY = "openrelik:system:storage_status:v1"
STORAGE_STATUS_CACHE_TTL_SECONDS = 60
STORAGE_REFRESH_COOLDOWN_SECONDS = 5.0

_storage_lock = threading.Lock()
_last_collected_monotonic = 0.0
_redis_client = None


def _get_redis_client():
    """Return a shared Redis client when REDIS_URL is configured."""
    global _redis_client
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        return None
    if _redis_client is None:
        _redis_client = redis.from_url(
            redis_url,
            decode_responses=True,
            socket_timeout=2.0,
            socket_connect_timeout=2.0,
        )
    return _redis_client


def _read_cached_storage_status(client) -> dict | None:
    if client is None:
        return None
    try:
        raw = client.get(STORAGE_STATUS_CACHE_KEY)
    except redis.exceptions.RedisError:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _collect_storage_providers_config() -> tuple[str, list[dict]]:
    """Return ``(default_provider_name, provider_configs)`` from server settings."""
    current_config = get_config() or {}
    server_cfg = current_config.get("server", {})
    providers_cfg = server_cfg.get("storage", {}).get("providers", {})

    default_name = "server_default"
    providers: list[dict] = []

    if isinstance(providers_cfg, dict) and providers_cfg:
        if isinstance(providers_cfg.get("default"), str) and providers_cfg["default"]:
            default_name = providers_cfg["default"]
        for key, value in providers_cfg.items():
            if key == "default" or not isinstance(value, dict):
                continue
            providers.append(
                {
                    "name": key,
                    "display_name": value.get("display_name") or key,
                    "mode": value.get("mode") or "rw",
                    "path": value.get("path"),
                    "is_default": key == default_name,
                }
            )
    elif server_cfg.get("storage_path"):
        providers.append(
            {
                "name": default_name,
                "display_name": "Default Storage",
                "mode": "rw",
                "path": server_cfg["storage_path"],
                "is_default": True,
            }
        )

    return default_name, providers


def get_system_storage_status_from_db(db: Session, *, refresh: bool = False) -> dict:
    """Compute aggregate file, folder, workflow, and disk usage counts.

    Results are cached in Redis for ``STORAGE_STATUS_CACHE_TTL_SECONDS`` so
    frequent UI polling does not repeatedly scan large tables.

    Args:
        db (Session): SQLAlchemy database session.
        refresh (bool): Bypass cached snapshot when past the cooldown window.

    Returns:
        dict: Payload matching ``SystemStorageStatusResponse``.
    """
    global _last_collected_monotonic

    client = _get_redis_client()
    now = time.monotonic()
    can_bypass = (
        refresh
        and (now - _last_collected_monotonic) >= STORAGE_REFRESH_COOLDOWN_SECONDS
    )
    if not can_bypass:
        cached = _read_cached_storage_status(client)
        if cached is not None:
            return cached

    with _storage_lock:
        now = time.monotonic()
        can_bypass = (
            refresh
            and (now - _last_collected_monotonic) >= STORAGE_REFRESH_COOLDOWN_SECONDS
        )
        if not can_bypass:
            cached = _read_cached_storage_status(client)
            if cached is not None:
                return cached

        default_provider, provider_configs = _collect_storage_providers_config()
        # Legacy root folders with NULL storage_provider resolve to "server_default"
        # when configured (matching Folder.path), otherwise to default_provider.
        legacy_provider = (
            "server_default"
            if any(p["name"] == "server_default" for p in provider_configs)
            else default_provider
        )

        # Resolve each folder's effective storage provider down the folder tree
        # (matching Folder.get_effective_storage_provider) so files with NULL
        # File.storage_provider are attributed to their folder's actual volume.
        folder_tree = (
            select(
                Folder.id.label("id"),
                Folder.storage_provider.label("effective_provider"),
            )
            .where(Folder.parent_id.is_(None))
            .cte(name="folder_storage_tree", recursive=True)
        )
        child_folder = aliased(Folder)
        folder_tree = folder_tree.union_all(
            select(
                child_folder.id.label("id"),
                func.coalesce(
                    child_folder.storage_provider,
                    folder_tree.c.effective_provider,
                ).label("effective_provider"),
            ).join(folder_tree, child_folder.parent_id == folder_tree.c.id)
        )

        effective_provider_col = func.coalesce(
            File.storage_provider,
            folder_tree.c.effective_provider,
        )

        # Single grouped scan over File for active totals, unpurged soft-deleted totals,
        # and per-provider tracked file counts/bytes.
        file_rows = db.execute(
            select(
                effective_provider_col.label("provider"),
                func.coalesce(File.is_deleted, False).label("deleted"),
                func.coalesce(File.is_purged, False).label("purged"),
                func.count(File.id).label("cnt"),
                func.coalesce(func.sum(File.filesize), 0).label("total_bytes"),
            )
            .select_from(File)
            .outerjoin(folder_tree, File.folder_id == folder_tree.c.id)
            .group_by(
                effective_provider_col,
                func.coalesce(File.is_deleted, False),
                func.coalesce(File.is_purged, False),
            )
        ).all()

        files_count = 0
        files_total_bytes = 0
        deleted_unpurged_files_count = 0
        deleted_unpurged_bytes = 0
        provider_file_counts: dict[str, int] = {}
        provider_file_bytes: dict[str, int] = {}

        for provider_name, deleted, purged, cnt, total_bytes in file_rows:
            cnt = int(cnt or 0)
            total_bytes = int(total_bytes or 0)
            effective_provider = provider_name or legacy_provider
            if not deleted:
                files_count += cnt
                files_total_bytes += total_bytes
                provider_file_counts[effective_provider] = (
                    provider_file_counts.get(effective_provider, 0) + cnt
                )
                provider_file_bytes[effective_provider] = (
                    provider_file_bytes.get(effective_provider, 0) + total_bytes
                )
            elif not purged:
                deleted_unpurged_files_count += cnt
                deleted_unpurged_bytes += total_bytes

        folder_row = db.execute(
            select(
                func.count(Folder.id),
                func.coalesce(
                    func.sum(case((Folder.parent_id.is_(None), 1), else_=0)),
                    0,
                ),
            ).where(func.coalesce(Folder.is_deleted, False).is_(False))
        ).one()
        folders_count = int(folder_row[0] or 0)
        root_folders_count = int(folder_row[1] or 0)

        workflows_count = int(
            db.execute(
                select(func.count(Workflow.id)).where(
                    func.coalesce(Workflow.is_deleted, False).is_(False)
                )
            ).scalar()
            or 0
        )

        storage_providers = []
        for provider in provider_configs:
            p_name = provider["name"]
            p_path = provider["path"]
            available = False
            total_b = None
            used_b = None
            free_b = None
            used_pct = None
            if p_path and os.path.exists(p_path):
                try:
                    usage = shutil.disk_usage(p_path)
                    available = True
                    total_b = int(usage.total)
                    used_b = int(usage.used)
                    free_b = int(usage.free)
                    used_pct = (
                        round((usage.used / usage.total) * 100, 1)
                        if usage.total > 0
                        else 0.0
                    )
                except OSError:
                    available = False

            storage_providers.append(
                {
                    "name": p_name,
                    "display_name": provider["display_name"],
                    "mode": provider["mode"],
                    "is_default": provider["is_default"],
                    "available": available,
                    "total_bytes": total_b,
                    "used_bytes": used_b,
                    "free_bytes": free_b,
                    "used_percent": used_pct,
                    "file_count": provider_file_counts.get(p_name, 0),
                    "file_bytes": provider_file_bytes.get(p_name, 0),
                }
            )

        payload = {
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "files_count": files_count,
            "files_total_bytes": files_total_bytes,
            "deleted_unpurged_files_count": deleted_unpurged_files_count,
            "deleted_unpurged_bytes": deleted_unpurged_bytes,
            "folders_count": folders_count,
            "root_folders_count": root_folders_count,
            "workflows_count": workflows_count,
            "storage_providers": storage_providers,
        }

        _last_collected_monotonic = time.monotonic()
        if client is not None:
            try:
                client.setex(
                    STORAGE_STATUS_CACHE_KEY,
                    STORAGE_STATUS_CACHE_TTL_SECONDS,
                    json.dumps(payload),
                )
            except redis.exceptions.RedisError:
                pass

        return payload
