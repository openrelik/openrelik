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

"""Verify every server Celery app applies Redis-safe configuration."""

from unittest.mock import patch

from openrelik_common.celery_utils import DEFAULT_VISIBILITY_TIMEOUT

from api.v1 import taskqueue
from lib import workflow_utils
from mediator import mediator
from metrics import exporter
from tasks.hashing import file_hashes_tasks


def _assert_redis_safe_celery_conf(celery_app):
    assert celery_app.conf.worker_disable_prefetch is True
    assert celery_app.conf.worker_prefetch_multiplier == 1
    assert celery_app.conf.task_acks_late is False
    assert (
        celery_app.conf.broker_transport_options["visibility_timeout"]
        == DEFAULT_VISIBILITY_TIMEOUT
    )


def test_all_server_celery_apps_use_redis_safe_config():
    with patch("lib.celery_utils.update_task_queues"):
        import main

    apps = [
        main.celery,
        workflow_utils.celery_app,
        taskqueue.celery,
        file_hashes_tasks.celery,
        mediator.create_celery_app("redis://testhost:6379/0"),
        exporter.create_celery_app("redis://testhost:6379/0"),
    ]
    for app in apps:
        _assert_redis_safe_celery_conf(app)
