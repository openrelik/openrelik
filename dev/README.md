# Development

How OpenRelik is developed, and the record of what was built and why.

| Path                          | What                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `process.md`                  | the development process, from an idea to merged code     |
| `templates/`                  | templates for the process documents                      |
| `artifacts/features/<slug>/`  | one piece of work: idea, research, design, spec, and screenshots |
| `artifacts/designs/<slug>/`   | designs that several features build on                   |
| `artifacts/decisions/`        | architecture decision records, `0001-<slug>.md`, ...     |
| `tools/devctl/`               | the `./devctl` command line (see its `README.md`)        |
| `tools/reload/`               | the reloader, mounted into the development stack's containers |
| `RELEASING.md`                | step-by-step guide for platform releases                 |
| `PATCHING.md`                 | step-by-step guide for patch releases                    |

Bugfixes leave no artifact: their record is the regression test and the commit
message (see `process.md`).

`tools/reload/reload.py` restarts the services without a reloader of their own when
their bind-mounted source changes (see `compose.yml`). It runs with each image's
Python, so it uses only the standard library.
