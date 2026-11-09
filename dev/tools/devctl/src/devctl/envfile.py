"""Reading .env files and rendering a checkout's local configuration."""

import re
from pathlib import Path

CONTAINER_DATA_PATH = "/usr/share/openrelik/data"

def read_env(path: Path) -> dict[str, str]:
    """Returns the KEY=value lines of a .env file; a later line wins over an earlier one."""
    if not path.is_file():
        return {}
    values = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key] = value
    return values


def render_env(template: str, values: dict[str, str]) -> str:
    """Replaces the value of each KEY= line in the template whose key is in values."""
    lines = []
    for line in template.splitlines(keepends=True):
        key, sep, _ = line.partition("=")
        if sep and key in values:
            line = f"{key}={values[key]}\n"
        lines.append(line)
    return "".join(lines)


def render_settings(
    template: str, ui_port: str, postgres_password: str, session_secret: str, jwt_secret: str
) -> str:
    """Fills in server/settings_example.toml for a development stack."""
    placeholders = {
        "<REPLACE_WITH_STORAGE_PATH>": f"{CONTAINER_DATA_PATH}/storage",
        "<REPLACE_WITH_POSTGRES_USER>": "forensics",
        "<REPLACE_WITH_POSTGRES_PASSWORD>": postgres_password,
        "<REPLACE_WITH_POSTGRES_SERVER>": "postgres",
        "<REPLACE_WITH_POSTGRES_DATABASE_NAME>": "openrelik",
        "<REPLACE_WITH_RANDOM_SESSION_STRING>": session_secret,
        "<REPLACE_WITH_RANDOM_JWT_STRING>": jwt_secret,
    }
    for placeholder, value in placeholders.items():
        template = template.replace(placeholder, value)
    lines = {
        "ui_server_url": f'ui_server_url = "http://localhost:{ui_port}"',
        "allowed_origins": (
            f'allowed_origins = ["http://localhost:{ui_port}", "http://127.0.0.1:{ui_port}"]'
        ),
    }
    for key, line in lines.items():
        template = re.sub(rf"^{key} = .*$", lambda _: line, template, flags=re.MULTILINE)
    return template.replace(
        'allowlist = ["<REPLACE_WITH_USERNAME>@gmail.com"]', "allowlist = []"
    )
