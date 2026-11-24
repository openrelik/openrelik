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

"""Tests for Celery app configuration."""

from openrelik_common.celery_utils import DEFAULT_VISIBILITY_TIMEOUT
from src import app


def test_celery_app_uses_redis_safe_config():
    assert app.celery.conf.worker_disable_prefetch is True
    assert app.celery.conf.worker_prefetch_multiplier == 1
    assert app.celery.conf.task_acks_late is False
    assert (
        app.celery.conf.broker_transport_options["visibility_timeout"]
        == DEFAULT_VISIBILITY_TIMEOUT
    )
