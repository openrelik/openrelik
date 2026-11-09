# Changelog

All notable changes to OpenRelik are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.18.0] - 2026-11-08

Initial release consolidating OpenRelik into a unified monorepo.

### Server
- Added case folders with cursor-based pagination and sorting.
- Switched file hashing to Celery background task processing with configurable size limits.
- Added OIDC provider support (Keycloak, Okta, Auth0) and Google Cloud IAP integration.
- Added markdown rendering in file previews.
- Migrated server build and dependency management from Poetry to uv.

### Web UI
- Added automatic redirection to login when unauthenticated.
- Updated package and Vite build configurations.

### Workers
- Standardized all first-party workers to 0.18.0.
- Raised minimum Python version requirement to Python 3.12 across all workers.

### Libraries
- Published `openrelik-common`, `openrelik-ai-common`, `openrelik-worker-common`, and `openrelik-python-client` to PyPI with trusted publishing.
