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

import os

from celery.app import Celery
from fastapi import APIRouter, HTTPException, Query, status

from lib import celery_utils
from . import schemas

from openrelik_common import telemetry
from openrelik_common.celery_utils import configure_celery_app

redis_url = os.getenv("REDIS_URL")
celery = configure_celery_app(Celery(broker=redis_url, backend=redis_url))

telemetry.setup_telemetry(service_name="openrelik-server")
telemetry.instrument_celery_app(celery)

router = APIRouter()


@router.get("/tasks/registered")
def get_registered_tasks():
    return celery_utils.get_registered_tasks(celery)


@router.get("/workers/stats/")
def get_worker_stats():
    return celery_utils.get_worker_stats(celery)


@router.get("/workers/configurations/")
def get_worker_configurations():
    return celery_utils.get_worker_configurations(celery)


@router.get("/workers/reports/")
def get_worker_reports():
    return celery_utils.get_worker_reports(celery)


@router.get("/workers/ping/")
def ping_workers():
    return celery_utils.ping_workers(celery)


@router.get("/tasks/active/")
def get_active_tasks():
    return celery_utils.get_active_tasks(celery)


@router.get("/tasks/scheduled/")
def get_scheduled_tasks():
    return celery_utils.get_scheduled_tasks(celery)


@router.get("/tasks/reserved/")
def get_reserved_tasks():
    return celery_utils.get_reserved_tasks(celery)


@router.get("/tasks/revoked/")
def get_revoked_tasks():
    return celery_utils.get_revoked_tasks(celery)


@router.get("/queues/active/")
def get_active_queues():
    return celery_utils.get_active_queues(celery)


@router.get("/status", response_model=schemas.TaskqueueStatusResponse)
def get_taskqueue_status(
    refresh: bool = Query(
        default=False, description="Bypass short cache cooldown when true."
    ),
):
    """Return aggregate Celery worker, slot, and per-queue/per-task status."""
    try:
        return celery_utils.get_cluster_status(celery, refresh=refresh)
    except celery_utils.BrokerUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
