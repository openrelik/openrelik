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

"""Shared Redis-safe Celery configuration helpers for OpenRelik."""

import logging
import os

from celery import Celery

logger = logging.getLogger(__name__)

DEFAULT_VISIBILITY_TIMEOUT = 86400  # 24 hours
DEFAULT_WORKER_DISABLE_PREFETCH = True

VISIBILITY_TIMEOUT_ENV = "OPENRELIK_CELERY_VISIBILITY_TIMEOUT"
WORKER_DISABLE_PREFETCH_ENV = "OPENRELIK_CELERY_WORKER_DISABLE_PREFETCH"

_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_FALSE_VALUES = frozenset({"0", "false", "no", "off"})


def _get_visibility_timeout() -> int:
    """Parse Redis broker visibility_timeout from the environment.

    Returns:
        Positive integer timeout in seconds, falling back to
        DEFAULT_VISIBILITY_TIMEOUT if unset, empty, or invalid.
    """
    raw = os.getenv(VISIBILITY_TIMEOUT_ENV)
    if raw is None or not raw.strip():
        return DEFAULT_VISIBILITY_TIMEOUT

    try:
        value = int(raw.strip())
    except ValueError:
        logger.warning(
            "Invalid %s=%r; falling back to default %d",
            VISIBILITY_TIMEOUT_ENV,
            raw,
            DEFAULT_VISIBILITY_TIMEOUT,
        )
        return DEFAULT_VISIBILITY_TIMEOUT

    if value <= 0:
        logger.warning(
            "Non-positive %s=%r; falling back to default %d",
            VISIBILITY_TIMEOUT_ENV,
            raw,
            DEFAULT_VISIBILITY_TIMEOUT,
        )
        return DEFAULT_VISIBILITY_TIMEOUT

    return value


def _get_worker_disable_prefetch() -> bool:
    """Parse worker_disable_prefetch from the environment.

    Returns:
        Boolean flag, falling back to DEFAULT_WORKER_DISABLE_PREFETCH if unset,
        empty, or invalid.
    """
    raw = os.getenv(WORKER_DISABLE_PREFETCH_ENV)
    if raw is None or not raw.strip():
        return DEFAULT_WORKER_DISABLE_PREFETCH

    normalized = raw.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False

    logger.warning(
        "Invalid %s=%r; falling back to default %s",
        WORKER_DISABLE_PREFETCH_ENV,
        raw,
        DEFAULT_WORKER_DISABLE_PREFETCH,
    )
    return DEFAULT_WORKER_DISABLE_PREFETCH


def configure_celery_app(celery_app: Celery) -> Celery:
    """Apply Redis-safe prefetch and visibility timeout settings to a Celery app.

    Disables Redis task prefetching (requires Celery >= 5.6), keeps early ACKs
    enabled (task_acks_late=False) so running tasks are not left in Redis
    unacked, and raises broker_transport_options["visibility_timeout"] so no
    consumer sweeps Redis unacked_index at Kombu's 1-hour default.

    Args:
        celery_app: The Celery application instance to configure.

    Returns:
        The configured Celery application instance.
    """
    transport_options = dict(celery_app.conf.broker_transport_options or {})
    transport_options["visibility_timeout"] = _get_visibility_timeout()

    celery_app.conf.update(
        broker_transport_options=transport_options,
        worker_disable_prefetch=_get_worker_disable_prefetch(),
        worker_prefetch_multiplier=1,
        task_acks_late=False,
    )
    return celery_app
