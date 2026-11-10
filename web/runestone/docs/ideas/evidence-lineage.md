# Evidence lineage: how derived evidence was produced

Nov 1, 2026 · Johan Berggren

## Summary

Every task records one **lineage record**: what code ran, on which input bytes, with which parameters, rules and versions, what it produced and how it ended. `openrelik-worker-common` writes it, in three layers:

1. **Automatic, for every worker, with no code change.** The library already sits on every task's way in (`get_input_files()`) and way out (`create_task_result()`). There it records the task, its inputs and outputs with hashes, timings, outcome and the exact image and library versions.
2. **`run_tool()`, for workers that run another program.** It replaces `subprocess` and records the exact invocation, the program's identity, its rules and its logs.
3. **`step()`, for workers that do the work in Python or call a service.** A worker wraps each unit of work and says what it used and what it decided: library versions, parameters, the model and prompt for an LLM, the sketch and timeline for a Timesketch import.

The record travels in the task result's existing `meta` field, so the server needs no change to store it. An investigator can then answer, for any derived file: what produced it, from exactly which inputs, and how to run it again.

## Background

The server already keeps the lineage between files: `File.task_output_id` names the task that produced a file, `tasks_input` the tasks that read it, and `Task.config` the options the operator chose. What it cannot say is how a task turned its inputs into its outputs.

Workers do that in three ways. Of the 27 workers in `openrelik-workers` and `contrib-workers`:

| How the work is done | Workers (examples) | What is recorded today |
| --- | --- | --- |
| Runs another program | Hayabusa, YARA, capa, floss, strings, bulk_extractor, photorec, Zeek, THOR Lite | A joined `command` string, when the worker passes one |
| Python code, in the worker | entropy, chromecreds, duckdb, analyzer-logs | Nothing beyond the task's config |
| Calls a service | llm, analyzer-config (LLM), timesketch (import into a sketch) | The prompt, for llm (`meta={"prompt": …}`); nothing for Timesketch |

Several mix them: Plaso, Dissect and Volatility import their tool as a library in some tasks and run it as a program in others.

Whatever the kind, the same facts are missing:

| Gap | Example |
| --- | --- |
| Inputs are not hashed when read | The server hashes in the background after upload; a quick workflow can run before hashing ends, and nothing proves the task read those bytes |
| Code and data versions are not recorded | No image digest, worker version or library versions. Hayabusa's rules come from `update-rules` at image build time, so two images of Hayabusa 3.7.0 can flag different events |
| Failures are not detected | Hayabusa's worker never checks the exit code, so a crash leaves a partial CSV registered as good |
| The tool's own account is lost | stdout and stderr go nowhere; an LLM's raw response and model version are not kept |
| Parameters are partly recorded | `Task.config` holds what the operator chose, not the defaults a worker filled in |
| Effects outside OpenRelik are invisible | A Timesketch import leaves no record of which server, sketch and timeline received the data |

One fact shapes the design. Input files from the workflow's start carry an `id`; files piped from an earlier task carry only `uuid` and `path` (`lib/workflow_utils.py`, `get_input_files()`), because the mediator registers them afterwards. The record therefore names files by `uuid`, which every file has.

## Goals and non-goals

Goals:

1. **Every worker has a record.** A worker that changes nothing still gets one: inputs, outputs, hashes, versions, timings and outcome.
2. **Bytes in, bytes out.** Hash every input as the task reads it and every output as it writes it, so the chain from evidence to derived file has no unverified link.
3. **Everything that changes the result.** Code versions (image, worker, libraries, programs), rules and models, parameters including defaults, and the environment the code reads.
4. **The work itself, where the worker says more.** The exact invocation of a program; the parameters and decisions of Python code; the request and response of a service call, and what it changed outside OpenRelik.
5. **Honest outcome.** A failed run fails the task and still leaves its record and logs.
6. **Small changes to adopt.** Layer 1 needs none; `run_tool()` replaces a `subprocess` call; `step()` wraps a block of code.
7. **Repeatable where it can be.** The record holds what is needed to run the same code on the same inputs again, and says when the result cannot be expected to match (an LLM, a remote service).

Non-goals:

- Explaining a program's or library's internal logic. The record says which rule or parser produced a result where the code reports it, not why it matched.
- Tracing every Python function call. A worker records the units of work an investigator would ask about, not a profile.
- Proving the code is correct, or sandboxing it.
- Tamper evidence for the record itself. Hash-chaining and signing belong to the file event log, a separate design; the record is written so it can be signed later.

## The lineage record

A task has one record, under `meta.lineage` in its result. It has a task-level part, filled automatically, and a list of **steps**, one per unit of work the worker describes. Every timestamp is UTC in ISO 8601; every hash is SHA-256 in lowercase hex.

```json
{
  "schema": "openrelik.lineage/1",
  "task": { "name": "openrelik-worker-entropy.tasks.entropy", "celery_task_id": "…",
            "workflow_id": 41, "config": { "entropy-threshold": 7.2 } },
  "environment": {
    "image": "ghcr.io/openrelik/openrelik-worker-entropy", "image_digest": "sha256:…",
    "build": { "repository": "…", "commit": "…", "built_at": "…" },
    "worker": { "name": "openrelik-worker-entropy", "version": "0.3.0" },
    "python": "3.12.3", "packages_sha256": "…", "hostname": "…"
  },
  "inputs": [
    { "uuid": "3e1d…", "file_id": 812, "display_name": "Security.evtx",
      "size": 69632, "sha256": "…", "used": true }
  ],
  "outputs": [ { "uuid": "9f2c…", "display_name": "entropy.csv", "size": 4211, "sha256": "…" } ],
  "task_files": [ { "uuid": "…", "display_name": "step-1.stdout.log", "sha256": "…" } ],
  "steps": [ { "kind": "library", "name": "entropy", "…": "…" } ],
  "started_at": "2026-11-01T10:02:11.402Z", "finished_at": "2026-11-01T10:02:49.977Z",
  "outcome": "success",
  "detail": "steps"
}
```

`detail` says how much the record can tell: `basic` when the worker described no steps (layer 1 only), `steps` when it did. The UI shows the difference, so a basic record is never mistaken for a full account.

`packages_sha256` is a hash of the sorted list of every installed Python distribution and version. The list itself is in `environment.packages` (a few kilobytes); the hash makes "same packages" a plain comparison.

### Steps

Every step has the same frame, and one block for its kind:

| Field | What it holds |
| --- | --- |
| `kind` | `process`, `library` or `service` |
| `name` | What the worker calls this unit of work, e.g. `csv-timeline`, `entropy`, `summarise` |
| `inputs`, `outputs` | The `uuid`s of the task's files this step read and wrote, with a `role` each |
| `components` | Everything with a version that the step used: programs, libraries, rulesets, models, each with its version and, where it is a file, a hash |
| `parameters` | The values that decided the result, defaults included, as JSON |
| `notes` | Short facts the code reports: files skipped and why, counts, warnings |
| `started_at`, `finished_at`, `outcome` | `success`, `failed`, `timeout` or `cancelled`, with `error` on failure |

The kind-specific block:

| Kind | Block | Fields |
| --- | --- | --- |
| `process` | `process` | `argv` with placeholders, `placeholders`, `cwd`, the named `env` variables, `exit_code`, `stdout` and `stderr` as task files |
| `library` | none | The frame is enough: the code is the worker's own, pinned by `environment.build.commit`; the libraries are in `components` |
| `service` | `service` | `system` (e.g. `llm`, `timesketch`), `endpoint` without credentials, `request` and `response` (each a task file with its hash, or inline when small), `remote_version` when the service reports one, `effects` (what it changed outside OpenRelik: a sketch and timeline id) and `deterministic: false` |

Placeholders keep a process step's `argv` stable across runs: two runs differ in `placeholders`, not in `argv`, so "same invocation" is a plain comparison.

## The helpers

All of it lives in a new module, `openrelik_worker_common/lineage.py`, which `task_utils` imports, so every worker loads it.

### Layer 1: the automatic record

No worker code changes. The library hooks the points every task already passes:

| Point | What it records |
| --- | --- |
| Celery's `task_prerun` signal, connected when the module loads | Opens the task's record: start time, task name, Celery id, `workflow_id`, the `task_config` as received, every input file given |
| `get_input_files()` | Marks the inputs that passed the worker's filter as `used`, and hashes them just before the work starts |
| `create_task_result()` | Closes the record: hashes outputs and task files, adds the environment, sets the end time and `outcome: success`, writes it to `meta.lineage` |
| Celery's `task_failure` signal | Closes the record with `outcome: failed` and the error, and writes it as JSON to `<output_path>/.openrelik/lineage-<celery id>.json`, because a failed task returns no result to carry it |

The record is kept per Celery request (a context variable), so it is right under any worker concurrency. Workers that never call `get_input_files()` still get a record; their inputs are hashed at `create_task_result()` and marked `used: null`, meaning unknown.

### Layer 2: `run_tool()` for another program

A worker describes the program once, at module level, and calls `run_tool()` where it called `subprocess`. The result is a `process` step.

```python
from openrelik_worker_common.lineage import Tool, Ruleset, InputDir, Output, run_tool

TOOL = Tool(
    name="<program>",
    binary="/opt/<program>/bin/<program>",
    version_env="<PROGRAM>_VERSION",        # or version_cmd=["--version"], version_pattern=r"…"
    rulesets=[Ruleset(name="<rules>", source="<url>", path="/opt/<program>/rules",
                      revision_file="/opt/<program>/rules/.openrelik-revision")],
    config_files=["/opt/<program>/config/**/*"],
    env=["LANG", "LC_ALL", "TZ"],
)

run = run_tool(TOOL, args=["scan", "--out", Output("report", output_file), InputDir(input_files)],
               task=self, output_path=output_path)
```

Arguments are strings or markers, which the helper turns into paths and placeholders:

| Marker | Becomes | Recorded as |
| --- | --- | --- |
| `Input(file)` | The input file's path | `{input:<uuid>}`, and the input in the step's `inputs` |
| `InputDir(files)` | A temporary directory holding a link to each file | `{input_dir}`, and each input in `inputs` |
| `Output(role, output_file)` | The output file's path | `{output:<role>}`, and the output in `outputs` |

What `run_tool()` does, in order:

1. **Identify the program**: hash the binary, read the version, build each ruleset's manifest, hash the config files. Once per worker process; the image does not change while it runs.
2. **Stage inputs**: for `InputDir`, hard-link each file into a fresh directory, named `<uuid>.<extension>`; a symlink when a hard link would cross filesystems; never a copy.
3. **Start the process** with the argument list (never a shell) and a controlled environment. stdout and stderr go straight to two task files, so a chatty program neither fills memory nor blocks on a full pipe.
4. **Wait**, sending `task-progress` every 2 seconds. On `timeout`, or when Celery revokes the task, send SIGTERM, then SIGKILL after 10 seconds.
5. **Judge the outcome**: the exit code against `ok_exit_codes` (default `{0}`); every declared output must exist, and with `require_output=True` (the default) be non-empty.
6. **Clean up** the staging directory, whatever happened, and add the step to the record.
7. **Return** a `ToolRun` with `log_files` and `exit_code`, or raise `ToolFailed`.

### Layer 3: `step()` for Python code and services

Work done in the worker's own process is wrapped in a `step()`. The worker says what the step read, used, decided and wrote; the helper adds the frame (times, outcome, hashes) and catches failures.

Python code, e.g. the entropy worker:

```python
from openrelik_worker_common.lineage import step

with step("entropy", kind="library",
          parameters={"threshold": threshold, "max_file_size_mb": max_size}) as s:
    for f in input_files:
        if size_mb(f) > max_size:
            s.note(f"skipped {f['uuid']}: larger than {max_size} MB")
            continue
        s.input(f)
        …
    s.output(output_file, role="report")
```

A service, e.g. the LLM worker:

```python
with step("summarise", kind="service", system="llm",
          endpoint=provider.base_url,
          uses=[Model(provider=provider_name, name=model_name)],
          parameters={"temperature": temperature, "max_tokens": max_tokens}) as s:
    s.input(input_file)
    s.request(prompt)                       # saved as a task file, hashed
    response = llm.generate(prompt)
    s.response(response.text, remote_version=response.model_version)
    s.output(output_file, role="summary")
```

The step's methods:

| Method | Records |
| --- | --- |
| `s.input(file, role=)` / `s.output(file, role=)` | Which of the task's files this step read and wrote |
| `uses=[…]` | Components: a package name (`"pandas"`, resolved with `importlib.metadata`), `Component(name, version, path=)` for a native library or data file (hashed), `Model(…)` for a model |
| `parameters=` | The values that decided the result, defaults included |
| `s.note(text)` | A short fact: a skip, a count, a warning |
| `s.request(payload)` / `s.response(payload, remote_version=)` | A service call's content, as task files with hashes |
| `s.effect(**ids)` | A change outside OpenRelik, e.g. `s.effect(server=url, sketch_id=12, timeline_id=88)` |

An exception inside the block marks the step `failed` with its error, and is raised again; the task fails as before, with the record.

### Secrets

The record is evidence and is shown to everyone who can see the folder, so it never holds secrets. Endpoints are stored without user info and query strings; `env` lists only the variables a worker names; parameters whose config option is a password or key are stored as `"<redacted>"`. Request payloads are stored as sent, so a worker must not put credentials in them.

### `create_task_result()`

Its arguments do not change. `command` stays, and is filled from the first process step's `argv` when the worker passes none, so the current UI and older readers keep working.

## Code, rules and model identity

A record is only as good as what the worker knows about itself, so each part has a rule for where it comes from. What is computed beats what is declared: a declared version is kept as declared, and a hash proves what actually ran.

| Part | Applies to | Source | Rule |
| --- | --- | --- | --- |
| Worker code | all | `build.json`: repository and commit | The commit pins the worker's own Python code, which is all a `library` step needs |
| Image | all | `OPENRELIK_IMAGE_DIGEST`, set by the deployment | An image cannot contain its own digest; when unset, `build.json` still identifies the build |
| Python packages | all | `importlib.metadata.distributions()`, once per process | Every installed distribution and version, not only the ones a step names |
| Program version | process | `version_env` (an `ENV` from a Dockerfile build argument), or `version_cmd` with a pattern | Kept as declared |
| Program binary | process | The helper hashes `binary`, once per process | Always computed |
| Native library | library | `Component(name, version, path=)`; the version from the library itself, e.g. `sqlite3.sqlite_version` | The file at `path` is hashed when given |
| Rules and signatures | process, library | `Ruleset(…)`: YARA rules, Sigma or Hayabusa rules, capa rules, Plaso parser presets | Pinned at image build time to a revision given as a build argument, never "latest"; a manifest hash over every file catches later edits |
| Config and data files | process, library | Globs or paths the worker declares, each hashed | A missing file is recorded as missing, not skipped |
| Local model | library | `Model(name, path=)` | The weights file is hashed |
| Remote model or service | service | Provider, model name, and the version the service reports in its response | Recorded as reported, marked unverifiable; a service can change behind the same name |

A shared build step in `openrelik-worker-template`, a short script or Dockerfile fragment, writes `/etc/openrelik/build.json` (repository, commit, build time, base image digest) and the revision files for pinned rules, so every worker produces them the same way.

## Storage and API

**Phase 1 stores the record where results already go.** The mediator writes the decoded result, `meta.lineage` included, to `Task.result`, and `TaskResponse` returns it. Three small server changes:

1. **Failed tasks.** The mediator's failure path (`process_failed_task`) reads `<output_path>/.openrelik/lineage-<celery id>.json`, saves it into `Task.result` next to `error_exception`, and deletes the file. No output of a failed task is registered; its logs are, as task files.
2. **Hash check.** When the server's hashing task finishes a file, it compares the SHA-256 with the record: an input's with what the task read, an output's with what the task wrote. The result goes on the task, `meta.hash_check`, until the file event log exists. A mismatch is shown, never ignored.
3. **The `.openrelik` directory** is skipped wherever the server lists or cleans a folder's storage.

**Phase 2 makes the records searchable.** JSON in a text column answers "how was this file made", but not the questions that follow when a rule, a model or a build turns out to be wrong. Four tables, filled by the mediator from the same record:

| Table | Columns |
| --- | --- |
| `task_lineage` | `task_id`, `image_digest`, `build_commit`, `worker_version`, `packages_sha256`, `detail`, `outcome`, `started_at`, `finished_at`, `record` (the full JSON) |
| `lineage_step` | `lineage_id`, `index`, `kind`, `name`, `system` (for services), `outcome` |
| `lineage_component` | `step_id`, `type` (program, package, library, ruleset, model), `name`, `version`, `sha256` |
| `lineage_file` | `lineage_id`, `step_id` (null for task level), `file_uuid`, `file_id`, `direction`, `role`, `sha256` |

With those indexed, these become single queries:

- Every file derived with ruleset revision X, model Y, or image digest Z.
- Everything ever produced from the bytes with SHA-256 W, in any folder.
- Every import into a given Timesketch server, with its sketch and timeline.
- Every task that ended in failure last month, by worker.

API: `GET /files/{id}/lineage` returns the records that produced the file and those that read it, so the UI needs one request, not a walk through tasks.

## UI

A file's side panel gains a section, **How this was produced**, shown when the file is a task's output. Its first line says how complete the account is: *basic* (inputs, outputs, versions, nothing about the work) or *detailed* (with steps). Then, top to bottom as the run happened:

| Row | Shows |
| --- | --- |
| Task | Worker, task name, the operator's config, start and end (`.tabular`), outcome |
| Inputs | Each input's name, size, SHA-256 and the hash check: matched, mismatched, not yet hashed |
| Steps | One block per step, by kind (below) |
| Environment | Image and digest, build commit, worker version; packages on demand |

Each step shows its frame (name, components with versions, parameters, notes, times, outcome) and its kind's detail:

- **Process:** the command, with each placeholder replaced by the file's name, linking to the file; exit code; stdout and stderr opened in the text viewer.
- **Library:** nothing more; the components and parameters are the account.
- **Service:** system and endpoint, model and reported version, request and response opened in the text viewer, effects (a Timesketch sketch and timeline as copyable ids), and a plain note that a repeat run may differ.

Actions: copy the record as JSON, and download it. The task inspector in the workflow panel shows the same section for each task, failed ones included.

Following the rules in `AGENTS.md`:

- The record is read through the query cache. A finished task's record never changes, so its key can stay fresh for a long time.
- Every string in the record, the logs and the service payloads come from the code and its inputs, and are untrusted. They are shown as text, with control characters escaped; logs and payloads are read in byte ranges like any file. Links in effects carry no `href` and go through the link menu.
- Tasks finished before layer 1 existed have no record. The section then shows the old `command` string and says the run was not recorded.

## Worked examples

One worker of each kind, and what adopting the helpers means for it. Every worker gets layer 1 by updating `openrelik-worker-common` and nothing else.

| Worker | Kind | Changes | What the record then answers |
| --- | --- | --- | --- |
| Hayabusa | process | Pin the rules; `run_tool()` in place of `Popen` and its polling loop | Exact command, binary, rules revision, exit code, Hayabusa's own summary |
| entropy | library | One `step()` around the loop, with threshold and size limit as parameters and a note per skipped file | Which files were measured, with which settings, and which were skipped and why |
| llm | service | One `step()` around the call; prompt and response through `s.request()` / `s.response()` | Model and reported version, parameters, the exact prompt and raw response |
| timesketch | service | One `step()` around the import, with `s.effect()` for the result | Which server, sketch and timeline received which file's bytes |
| Plaso, Dissect | mixed | A `process` step where they run a CLI, a `library` step where they import the package | Both, in order, in one record (Plaso in full in the appendix) |

### Pinning rules at build time

Any worker whose results depend on rules or signatures clones them at a fixed revision instead of fetching the latest, and writes the revision down. For Hayabusa:

```dockerfile
ARG HAYABUSA_RULES_REV=<commit>
RUN git clone https://github.com/Yamato-Security/hayabusa-rules /hayabusa/rules \
 && git -C /hayabusa/rules checkout ${HAYABUSA_RULES_REV} \
 && git -C /hayabusa/rules rev-parse HEAD > /hayabusa/rules/.openrelik-revision \
 && rm -rf /hayabusa/rules/.git
```

This replaces `hayabusa update-rules`, and needs `git` among the image's packages. Updating rules is then a new image with a new revision on record, not a side effect of a rebuild. The same pattern applies to YARA and capa rules.

### From one result back to the evidence

Many programs name the rule and the source of each result: Hayabusa's CSV rows carry the rule file, the EVTX file and the record ID (check the exact columns against the `timesketch-verbose` profile); YARA names the rule per match. With the record, a single result traces back without a gap:

1. The **result row**, in an output whose SHA-256 is in `outputs`.
2. The **rule** it names, whose text is fixed by the ruleset's revision and manifest hash.
3. The **source file** it names, a staged name like `3e1d….evtx` that matches a placeholder, giving the OpenRelik file and the SHA-256 the program read.
4. The **position** it names inside that file: a record ID, an offset.

The table viewer could later make those cells link to the input file and the rule; that is a follow-up.

### What a service step cannot promise

A service runs code OpenRelik cannot see. The record keeps what was sent, what came back, what the service said about itself and what it changed, which is enough to show the derived evidence came from that exchange. It cannot show the service would answer the same way again; the step says so with `deterministic: false`, and the UI repeats it.

## Rollout

Layer 1 comes first: it gives every worker a basic record with one library upgrade, before any worker code changes. Each step ships on its own and leaves everything else working.

1. **`openrelik-worker-common`, layer 1:** the signals, the hooks in `get_input_files()` and `create_task_result()`, the failure file; unit tests with a fake Celery request covering success, an exception, a worker that skips `get_input_files()`, and concurrent tasks.
2. **Server, small:** read the failure file; compare hashes after hashing; skip `.openrelik`.
3. **Worker template:** the `build.json` build step. Rebuilding a worker's image on the new template is the only change it needs for full environment identity.
4. **New UI:** the "How this was produced" section, reading `Task.result`; basic records first.
5. **`openrelik-worker-common`, layers 2 and 3:** `run_tool()`, `step()`, the components; tests with small scripts (succeeds, exits 1, writes nothing, ignores SIGTERM) and with steps that raise.
6. **One worker of each kind:** Hayabusa (process), entropy (library), llm (service). They test the design before it spreads.
7. **Other workers**, one at a time, starting with those whose results depend on rules, signatures or models (YARA, capa, THOR Lite, analyzer-config), and timesketch for its effects.
8. **Server, later:** the four tables, filled from new records and back-filled from stored results, and `GET /files/{id}/lineage`.

Compatibility:

- Every part is optional to readers: a worker on an old library sends no record, and the UI falls back to `command`.
- A mediator that does not know `meta.lineage` stores it anyway, since it saves the whole result. Only failed tasks need the server change to keep their record.
- The `schema` field lets the format grow; readers ignore what they do not know, and a breaking change takes `openrelik.lineage/2`.

## Open questions

- [ ] **Signals connected on import.** Layer 1 depends on `task_utils` importing `lineage.py`, which connects Celery's `task_prerun` and `task_failure`. Is that implicit hook acceptable, or should workers opt in with one line in `app.py`, at the cost of layer 1 no longer being automatic?
- [ ] **Hashing cost on large inputs.** Hashing a 500 GB disk image before every task doubles its reads. Should the server send each input's SHA-256 in the input dict, so the helper checks rather than computes, and skips the read when the input is on read-only storage?
- [ ] **Service payload size and sensitivity.** Prompts can hold a whole input file, and responses can be long. Keep them whole as task files, as proposed, or keep hashes only above a size?
- [ ] **Log size.** Keep stdout and stderr whole, or cap them (e.g. at 64 MiB, keeping head and tail) for programs that log per event?
- [ ] **Environment variables per program.** Which count, beyond locale and time zone? Each worker declares them; the common programs need a starting list.
- [ ] **Deterministic output.** Which programs give byte-identical output across runs (Hayabusa with several threads, Plaso)? Where they do not, "run it again" compares sorted rows, not file hashes.
- [ ] **Signing.** Should the mediator sign each record with a server key when it stores it, or wait for the file event log's hash chain?

## Appendix: a Plaso workflow, recorded

A disk image uploaded in two EWF segments (`laptop.E01`, `laptop.E02`) goes through `log2timeline` with the `win7` parser preset and two operator-written YARA rules, then `psort` to CSV with a date filter: two tasks, two records. The Plaso worker is a good test because it runs a program (`log2timeline.py`), then reads the result in-process (`pinfo_tool`, for the per-parser event counts it already puts in `meta`), and depends on rules from three places. All values are made up.

### Task 1: `log2timeline`

```json
{
  "schema": "openrelik.lineage/1",
  "task": {
    "name": "openrelik-worker-plaso.tasks.log2timeline",
    "celery_task_id": "b7c1…",
    "workflow_id": 57,
    "config": {
      "parsers": ["win7"],
      "Yara rules": "<saved as a task file: see rulesets>",
      "register_in_db": true
    }
  },
  "environment": {
    "image": "ghcr.io/openrelik/openrelik-worker-plaso",
    "image_digest": "sha256:4f0e…",
    "build": { "repository": "github.com/openrelik/openrelik-workers", "commit": "e91a…",
               "built_at": "2026-10-28T08:12:00Z", "base_image": "ubuntu:26.04@sha256:…" },
    "worker": { "name": "openrelik-worker-plaso", "version": "0.6.2" },
    "worker_common_version": "0.19.0",
    "python": "3.13.1",
    "packages_sha256": "a3d9…",
    "packages": [ { "name": "plaso", "version": "20250918" }, { "name": "dfvfs", "version": "20250707" },
                  { "name": "artifacts", "version": "20250602" }, "…" ],
    "hostname": "worker-plaso-5d8f"
  },
  "inputs": [
    { "uuid": "1a2b…", "file_id": 901, "display_name": "laptop.E01", "size": 2147483648, "sha256": "c0ff…", "used": true },
    { "uuid": "3c4d…", "file_id": 902, "display_name": "laptop.E02", "size": 1073741824, "sha256": "beef…", "used": true }
  ],
  "steps": [
    {
      "kind": "process",
      "name": "log2timeline",
      "components": [
        { "type": "program", "name": "log2timeline.py", "version": "20250918",
          "version_source": "dpkg plaso-tools", "path": "/usr/bin/log2timeline.py", "sha256": "77aa…" },
        { "type": "package", "name": "plaso", "version": "20250918" },
        { "type": "ruleset", "name": "plaso-parser-presets", "source": "plaso package data",
          "path": "/usr/share/plaso/presets.yaml", "sha256": "19e2…" },
        { "type": "ruleset", "name": "artifact-definitions", "version": "20250602",
          "path": "/usr/share/artifacts", "manifest_sha256": "5b61…", "file_count": 64 },
        { "type": "ruleset", "name": "operator-yara", "source": "task_config",
          "file": { "uuid": "8e8e…", "display_name": "rules.yara", "sha256": "d00d…" }, "rule_count": 2 }
      ],
      "parameters": {
        "parsers": "win7", "partitions": "all", "volumes": "all",
        "artifact_filters": null, "archives": null
      },
      "process": {
        "argv": ["log2timeline.py", "--quiet", "--unattended", "--partitions", "all", "--volumes", "all",
                 "--status-view", "file", "--status-view-file", "{task_file:status}",
                 "--storage-file", "{output:storage}",
                 "--parsers", "win7", "--yara_rules", "{ruleset:operator-yara}",
                 "{input_dir}/{ewf_base}.e01"],
        "placeholders": {
          "{input_dir}": "/data/folders/12/tmp-41ab…",
          "{ewf_base}": "6f3e…",
          "{output:storage}": "/tmp/tmpq81x3c (moved to /data/folders/12/9f2c….plaso)",
          "{task_file:status}": "/data/folders/12/aa01….status",
          "{ruleset:operator-yara}": "/data/folders/12/8e8e….yara"
        },
        "staged_inputs": [
          { "uuid": "1a2b…", "path_as_seen": "{input_dir}/{ewf_base}.e01" },
          { "uuid": "3c4d…", "path_as_seen": "{input_dir}/{ewf_base}.e02" }
        ],
        "cwd": "/openrelik",
        "env": { "LANG": "C.UTF-8", "TZ": null },
        "exit_code": 0,
        "stdout": { "uuid": "51f0…", "size": 2210, "sha256": "…" },
        "stderr": { "uuid": "52f0…", "size": 18734, "sha256": "…" }
      },
      "inputs": [ { "uuid": "1a2b…", "role": "image" }, { "uuid": "3c4d…", "role": "image" } ],
      "outputs": [ { "uuid": "9f2c…", "role": "storage" } ],
      "notes": ["stderr: 312 extraction warnings (see stderr log)"],
      "started_at": "2026-11-01T10:02:11.402Z", "finished_at": "2026-11-01T11:47:03.118Z",
      "outcome": "success"
    },
    {
      "kind": "library",
      "name": "storage-summary",
      "components": [ { "type": "package", "name": "plaso", "version": "20250918" } ],
      "inputs": [ { "uuid": "9f2c…", "role": "storage" } ],
      "parameters": {},
      "result": {
        "storage_format_version": "20230327",
        "events_by_parser": { "winevtx": 1840211, "filestat": 912004, "winreg/windows_run": 311, "prefetch": 2650 },
        "warnings": 312
      },
      "started_at": "2026-11-01T11:47:03.200Z", "finished_at": "2026-11-01T11:47:31.950Z",
      "outcome": "success"
    }
  ],
  "outputs": [ { "uuid": "9f2c…", "display_name": "laptop.E01.plaso", "size": 1288490188, "sha256": "e7e7…" } ],
  "task_files": [
    { "uuid": "51f0…", "display_name": "log2timeline.stdout.log", "sha256": "…" },
    { "uuid": "52f0…", "display_name": "log2timeline.stderr.log", "sha256": "…" },
    { "uuid": "8e8e…", "display_name": "rules.yara", "sha256": "d00d…" },
    { "uuid": "aa01…", "display_name": "log2timeline.status", "sha256": "…" }
  ],
  "started_at": "2026-11-01T10:02:10.990Z", "finished_at": "2026-11-01T11:49:12.004Z",
  "outcome": "success",
  "detail": "steps"
}
```

### Task 2: `psort`, the step only

```json
{
  "kind": "process",
  "name": "psort",
  "components": [ { "type": "program", "name": "psort.py", "version": "20250918", "sha256": "88bb…" } ],
  "parameters": { "output_format": "dynamic", "additional_fields": ["yara_match"],
                  "filter": "date > '2026-10-01 00:00:00'" },
  "process": {
    "argv": ["psort.py", "--quiet", "--status-view", "file", "--additional_fields", "yara_match",
             "--status-view-file", "{task_file:status}", "-w", "{output:timeline}",
             "{input:9f2c…}", "date > '2026-10-01 00:00:00'"],
    "exit_code": 0
  },
  "inputs": [ { "uuid": "9f2c…", "role": "storage" } ],
  "outputs": [ { "uuid": "c3c3…", "role": "timeline" } ],
  "notes": ["filter kept 48211 of 2755176 events"],
  "outcome": "success"
}
```

Its input `9f2c…` is task 1's output, with the same SHA-256 on both sides: that match joins the two records into one chain from the uploaded segments to the CSV.

### What it answers about a row in the CSV

| Question | Answered by |
| --- | --- |
| Which bytes did it come from? | CSV → `.plaso` (hash checked) → `laptop.E01` + `laptop.E02`, hashed just before `log2timeline` read them |
| Why is it in the timeline? | The `win7` preset at that Plaso version, with the presets file hash; the `psort` filter decided what was kept |
| Why does it have a `yara_match` value? | The operator's two rules, saved as `rules.yara` with their hash |
| What might have been missed? | 312 extraction warnings, with the full stderr kept |
| How do I run it again? | The image digest, the exact `argv`, and the inputs by hash |

### What the example asks of the design

- **Pin the tool, not only its rules.** The Dockerfile installs `plaso-tools` from the GIFT PPA's `stable` track with no version, so the record would show drift but not prevent it. Pin the package version as a build argument.
- **Rules from the task config.** `Ruleset` needs `source="task_config"`: the operator's text is saved as a task file and hashed, and gets a placeholder in `argv`. Today `rules.yara` is written but never kept.
- **Outputs written elsewhere first.** The storage file is written to a temporary path (to avoid slow NFS writes) and copied into place. `Output()` needs `written_to=`; the hash is of the final file.
- **Segment naming.** `InputDir` needs `naming="ewf"`, linking every segment under one base name, as Plaso requires and the worker now does by hand.
- **Two bugs `run_tool()` removes.** stdout and stderr are pipes nobody reads until the process ends, so a run that logs a lot can block forever; and the progress loop spins without sleeping until the status file appears.
