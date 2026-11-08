# openrelik-deploy

##### Obligatory Fine Print

This is not an official Google product (experimental or otherwise), it is just code that happens to be owned by Google.

## Layout and releases

`docker/` holds the production deployment: `docker-compose.yml`, `config.env`
(image versions), `prometheus.yml` and `install.sh`.

On `main`, `config.env` uses the `latest` images; that is what the installer's
"bleeding edge" option installs. A minor release (`dev/release.py platform
0.18.0`) sets `config.env` on the release commit to the minor, `0.18`, for the
platform (`OPENRELIK_VERSION`) and every worker. Every component then has its
own patch releases (server 0.18.1, UI 0.18.3, a worker 0.18.2), and the
images' `0.18` tags follow the newest `0.18.x` release of each image, so an
install gets the newest patches with `docker compose pull`. To pin a
component, set its full version: `OPENRELIK_SERVER_VERSION` (server, mediator,
metrics), `OPENRELIK_UI_VERSION`, or the worker's variable.

`RELEASES` in `install.sh` lists minors (`0.18`). For a minor, the installer
downloads the compose file, config and the server's `settings_example.toml`
from the release branch `release/0.18`, where the server and UI patches of
the minor are released, so they always belong together. It needs no
GitHub API call (no account, no rate limit). Push a fix on the release branch
together with its release commit, as anything on the branch is what new
installs get.

Releases from before the monorepo (0.7.0, 0.6.0) are listed in
`LEGACY_RELEASES` and install from the archived `openrelik-deploy` and
`openrelik-server` repositories, as before.
