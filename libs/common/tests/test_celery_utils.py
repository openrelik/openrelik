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

"""Tests for openrelik_common.celery_utils."""

import logging

import pytest
from celery import Celery

from openrelik_common import celery_utils


def _make_app(**kwargs) -> Celery:
    return Celery(broker="redis://localhost:6379/0", backend="redis://localhost:6379/0", **kwargs)


def test_configure_celery_app_defaults(monkeypatch):
    monkeypatch.delenv(celery_utils.VISIBILITY_TIMEOUT_ENV, raising=False)
    monkeypatch.delenv(celery_utils.WORKER_DISABLE_PREFETCH_ENV, raising=False)

    app = _make_app(task_acks_late=True)
    returned = celery_utils.configure_celery_app(app)

    assert returned is app
    assert app.conf.worker_disable_prefetch is True
    assert app.conf.worker_prefetch_multiplier == 1
    assert app.conf.task_acks_late is False
    assert (
        app.conf.broker_transport_options["visibility_timeout"]
        == celery_utils.DEFAULT_VISIBILITY_TIMEOUT
    )


def test_configure_celery_app_preserves_existing_transport_options(monkeypatch):
    monkeypatch.delenv(celery_utils.VISIBILITY_TIMEOUT_ENV, raising=False)
    monkeypatch.delenv(celery_utils.WORKER_DISABLE_PREFETCH_ENV, raising=False)

    app = _make_app()
    app.conf.broker_transport_options = {"fanout_prefix": True}

    celery_utils.configure_celery_app(app)

    assert app.conf.broker_transport_options == {
        "fanout_prefix": True,
        "visibility_timeout": celery_utils.DEFAULT_VISIBILITY_TIMEOUT,
    }


def test_configure_celery_app_visibility_timeout_override(monkeypatch):
    monkeypatch.setenv(celery_utils.VISIBILITY_TIMEOUT_ENV, " 7200 ")

    app = _make_app()
    celery_utils.configure_celery_app(app)

    assert app.conf.broker_transport_options["visibility_timeout"] == 7200


@pytest.mark.parametrize("raw_value", ["", "   "])
def test_configure_celery_app_visibility_timeout_empty_uses_default(
    monkeypatch, caplog, raw_value
):
    monkeypatch.setenv(celery_utils.VISIBILITY_TIMEOUT_ENV, raw_value)

    app = _make_app()
    with caplog.at_level(logging.WARNING):
        celery_utils.configure_celery_app(app)

    assert (
        app.conf.broker_transport_options["visibility_timeout"]
        == celery_utils.DEFAULT_VISIBILITY_TIMEOUT
    )
    assert not caplog.records


@pytest.mark.parametrize("raw_value", ["abc", "0", "-100", "12.5"])
def test_configure_celery_app_visibility_timeout_invalid_uses_default(
    monkeypatch, caplog, raw_value
):
    monkeypatch.setenv(celery_utils.VISIBILITY_TIMEOUT_ENV, raw_value)

    app = _make_app()
    with caplog.at_level(logging.WARNING):
        celery_utils.configure_celery_app(app)

    assert (
        app.conf.broker_transport_options["visibility_timeout"]
        == celery_utils.DEFAULT_VISIBILITY_TIMEOUT
    )
    assert any(celery_utils.VISIBILITY_TIMEOUT_ENV in rec.message for rec in caplog.records)


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [
        ("false", False),
        ("FALSE", False),
        ("0", False),
        ("no", False),
        ("off", False),
        (" false ", False),
        ("true", True),
        ("TRUE", True),
        ("1", True),
        ("yes", True),
        ("on", True),
        (" true ", True),
    ],
)
def test_configure_celery_app_worker_disable_prefetch_override(
    monkeypatch, raw_value, expected
):
    monkeypatch.setenv(celery_utils.WORKER_DISABLE_PREFETCH_ENV, raw_value)

    app = _make_app()
    celery_utils.configure_celery_app(app)

    assert app.conf.worker_disable_prefetch is expected


@pytest.mark.parametrize("raw_value", ["", "   "])
def test_configure_celery_app_worker_disable_prefetch_empty_uses_default(
    monkeypatch, caplog, raw_value
):
    monkeypatch.setenv(celery_utils.WORKER_DISABLE_PREFETCH_ENV, raw_value)

    app = _make_app()
    with caplog.at_level(logging.WARNING):
        celery_utils.configure_celery_app(app)

    assert app.conf.worker_disable_prefetch is True
    assert not caplog.records


@pytest.mark.parametrize("raw_value", ["maybe", "2", "enabled"])
def test_configure_celery_app_worker_disable_prefetch_invalid_uses_default(
    monkeypatch, caplog, raw_value
):
    monkeypatch.setenv(celery_utils.WORKER_DISABLE_PREFETCH_ENV, raw_value)

    app = _make_app()
    with caplog.at_level(logging.WARNING):
        celery_utils.configure_celery_app(app)

    assert app.conf.worker_disable_prefetch is True
    assert any(
        celery_utils.WORKER_DISABLE_PREFETCH_ENV in rec.message for rec in caplog.records
    )
