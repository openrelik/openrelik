# OpenRelik

[![Build Docker Images](https://github.com/openrelik/openrelik/actions/workflows/images.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/images.yml?query=branch%3Amain)
[![Python Unit Tests](https://github.com/openrelik/openrelik/actions/workflows/python-tests.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/python-tests.yml?query=branch%3Amain)
[![Frontend Unit Tests [sunstone]](https://github.com/openrelik/openrelik/actions/workflows/frontend-sunstone-tests.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/frontend-sunstone-tests.yml?query=branch%3Amain)
[![Version Check](https://github.com/openrelik/openrelik/actions/workflows/version-check.yml/badge.svg?branch=main)](https://github.com/openrelik/openrelik/actions/workflows/version-check.yml?query=branch%3Amain)
[![Coverage](https://codecov.io/gh/openrelik/openrelik/graph/badge.svg?branch=main)](https://app.codecov.io/gh/openrelik/openrelik/tree/main)

Every component of OpenRelik in one repository. Each was imported from its own
repository with its full history; the old repositories are archived.

| Directory            | What                                  | From                  |
| -------------------- | ------------------------------------- | --------------------- |
| server               | API, mediator, metrics, migrations    | openrelik-server      |
| web/sunstone         | web UI, codename sunstone (see web/)  | openrelik-ui          |
| workers              | task workers                          | openrelik-workers     |
| mcp                  | MCP server                            | openrelik-mcp-server  |
| libs/common          | shared Python library                 | openrelik-common      |
| libs/ai-common       | shared Python library (AI)            | openrelik-ai-common   |
| libs/python-client   | Python API client                     | openrelik-api-client  |
| libs/worker-common   | shared library for workers            | openrelik-workers     |
| deploy               | production deployment                 | openrelik-deploy      |

## Test coverage

Coverage of `main` from the unit tests in CI. The coverage of each project
(each worker and library) is on
[Codecov](https://app.codecov.io/gh/openrelik/openrelik/flags). mcp has no
tests yet.

| Directory    | Coverage |
| ------------ | -------- |
| server       | [![server coverage](https://codecov.io/gh/openrelik/openrelik/graph/badge.svg?branch=main&component=server)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/server) |
| workers      | [![workers coverage](https://codecov.io/gh/openrelik/openrelik/graph/badge.svg?branch=main&component=workers)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/workers) |
| libs         | [![libs coverage](https://codecov.io/gh/openrelik/openrelik/graph/badge.svg?branch=main&component=libs)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/libs) |
| web/sunstone | [![web/sunstone coverage](https://codecov.io/gh/openrelik/openrelik/graph/badge.svg?branch=main&component=web-sunstone)](https://app.codecov.io/gh/openrelik/openrelik/tree/main/web/sunstone) |

## License

Apache License 2.0, see [LICENSE](LICENSE).
