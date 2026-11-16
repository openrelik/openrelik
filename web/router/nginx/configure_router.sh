#!/bin/sh

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

set -eu

DEFAULT_UIS="sunstone|Sunstone|http://openrelik-web-sunstone:8711,runestone|Runestone|http://openrelik-web-runestone:8711"
RESOLV_CONF="${RESOLV_CONF:-/etc/resolv.conf}"
NGINX_CONF_OUT="${NGINX_CONF_OUT:-/etc/nginx/conf.d/default.conf}"
ROUTER_HTML_DIR="${ROUTER_HTML_DIR:-/usr/share/nginx/html/__openrelik}"

die() {
  printf 'configure_router.sh: error: %s\n' "$1" >&2
  exit 1
}

warn() {
  printf 'configure_router.sh: warning: %s\n' "$1" >&2
}

trim() {
  printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

html_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'\''/\&#39;/g'
}

detect_resolver() {
  if [ -r "$RESOLV_CONF" ]; then
    candidate="$(awk '
      /^[[:space:]]*nameserver[[:space:]]+/ {
        addr = $2
        sub(/#.*/, "", addr)
        sub(/%.*/, "", addr)
        if (addr != "") {
          print addr
          exit
        }
      }
    ' "$RESOLV_CONF")"
    candidate="$(trim "$candidate")"
    if [ -n "$candidate" ]; then
      if printf '%s\n' "$candidate" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        printf '%s' "$candidate"
        return 0
      elif printf '%s\n' "$candidate" | grep -Eq '^\[[0-9a-fA-F:]+\]$'; then
        printf '%s' "$candidate"
        return 0
      elif printf '%s\n' "$candidate" | grep -Eq '^[0-9a-fA-F:]+$'; then
        printf '[%s]' "$candidate"
        return 0
      fi
    fi
  fi
  printf '127.0.0.11'
}

if [ "${OPENRELIK_UIS+x}" != "x" ]; then
  uis_raw="$DEFAULT_UIS"
else
  uis_raw="$(trim "$OPENRELIK_UIS")"
  [ -n "$uis_raw" ] || die "OPENRELIK_UIS is set but empty"
fi

cr="$(printf '\r')"
nl='
'
case "$uis_raw" in
  *"$cr"*|*"$nl"*) die "OPENRELIK_UIS must not contain newlines" ;;
  ,*|*,|*,,*) die "OPENRELIK_UIS contains an empty entry" ;;
esac

seen_ids=" "
first_id=""
first_upstream=""
default_id=""
default_upstream=""
requested_default="$(trim "${OPENRELIK_DEFAULT_UI:-}")"

map_entries=""
switch_locations=""
asset_locations=""

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

old_ifs="$IFS"
IFS=','
set -f
for raw_entry in $uis_raw; do
  entry="$(trim "$raw_entry")"
  [ -n "$entry" ] || die "OPENRELIK_UIS contains an empty entry"

  case "$entry" in
    *\|*\|*) ;;
    *) die "invalid OPENRELIK_UIS entry '$entry': expected id|Label|upstream_url" ;;
  esac

  id="$(trim "${entry%%|*}")"
  rest="${entry#*|}"
  case "$rest" in
    *\|*\|*) die "invalid OPENRELIK_UIS entry '$entry': expected id|Label|upstream_url" ;;
  esac
  label="$(trim "${rest%%|*}")"
  upstream="$(trim "${rest#*|}")"
  upstream="${upstream%/}"

  printf '%s\n' "$id" | grep -Eq '^[a-z0-9][a-z0-9-]*$' || \
    die "invalid UI id '$id': must match ^[a-z0-9][a-z0-9-]*$"
  [ -n "$label" ] || die "UI '$id' has an empty label"
  printf '%s\n' "$upstream" | grep -Eq '^https?://(\[[0-9a-fA-F:]+\]|[A-Za-z0-9._-]+)(:[0-9]+)?$' || \
    die "invalid upstream URL '$upstream' for UI '$id'"

  case "$seen_ids" in
    *" $id "*) die "duplicate UI id '$id' in OPENRELIK_UIS" ;;
  esac
  seen_ids="${seen_ids}${id} "

  if [ -z "$first_id" ]; then
    first_id="$id"
    first_upstream="$upstream"
  fi
  if [ -n "$requested_default" ] && [ "$id" = "$requested_default" ]; then
    default_id="$id"
    default_upstream="$upstream"
  fi

  printf '%s\t%s\n' "$id" "$label" >> "$tmp_dir/uis.tsv"

  map_entries="${map_entries}    \"${id}\" \"${upstream}\";
"
  switch_locations="${switch_locations}    location = /__openrelik/switch/${id} {
        add_header Set-Cookie \"openrelik_ui=${id}; Path=/; Max-Age=31536000; SameSite=Lax\$cookie_secure_flag\" always;
        add_header Cache-Control \"no-store\" always;
        return 302 /;
    }

"
  asset_locations="${asset_locations}    location ^~ /assets/${id}/ {
        set \$asset_upstream \"${upstream}\";
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$forwarded_proto;
        proxy_pass \$asset_upstream;
    }

"
done
set +f
IFS="$old_ifs"

[ -n "$first_id" ] || die "OPENRELIK_UIS produced no UI entries"

if [ -z "$default_id" ]; then
  if [ -n "$requested_default" ]; then
    warn "OPENRELIK_DEFAULT_UI '$requested_default' is not in OPENRELIK_UIS; falling back to '$first_id'"
  fi
  default_id="$first_id"
  default_upstream="$first_upstream"
fi

resolver="$(detect_resolver)"

mkdir -p "$(dirname "$NGINX_CONF_OUT")" "$ROUTER_HTML_DIR"

{
  printf '{\n  "default": "%s",\n  "uis": [\n' "$(json_escape "$default_id")"
  first_row=1
  while IFS="$(printf '\t')" read -r id label; do
    if [ "$first_row" -eq 0 ]; then
      printf ',\n'
    fi
    first_row=0
    printf '    { "id": "%s", "name": "%s" }' "$(json_escape "$id")" "$(json_escape "$label")"
  done < "$tmp_dir/uis.tsv"
  printf '\n  ]\n}\n'
} > "$ROUTER_HTML_DIR/uis.json"

{
  cat <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>Choose OpenRelik UI</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, -apple-system, sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
      }
      main {
        width: 100%;
        max-width: 24rem;
      }
      h1 {
        font-size: 1.25rem;
        margin: 0 0 0.5rem;
      }
      p {
        margin: 0 0 1rem;
        opacity: 0.8;
        font-size: 0.9375rem;
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 0.5rem;
      }
      a {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1rem;
        border: 1px solid currentColor;
        border-radius: 4px;
        text-decoration: none;
        color: inherit;
        font-weight: 500;
      }
      a:hover {
        opacity: 0.8;
      }
      .tag {
        font-size: 0.75rem;
        opacity: 0.75;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenRelik UI</h1>
      <p>Select a web interface:</p>
      <ul>
EOF
  while IFS="$(printf '\t')" read -r id label; do
    escaped_label="$(html_escape "$label")"
    if [ "$id" = "$default_id" ]; then
      printf '        <li><a href="/__openrelik/switch/%s"><span>%s</span><span class="tag">default</span></a></li>\n' "$id" "$escaped_label"
    else
      printf '        <li><a href="/__openrelik/switch/%s"><span>%s</span></a></li>\n' "$id" "$escaped_label"
    fi
  done < "$tmp_dir/uis.tsv"
  cat <<'EOF'
      </ul>
    </main>
  </body>
</html>
EOF
} > "$ROUTER_HTML_DIR/ui.html"

cat > "$NGINX_CONF_OUT" <<EOF
map_hash_bucket_size 128;

map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

map "\$scheme:\$http_x_forwarded_proto" \$cookie_secure_flag {
    "~*(^|:)https([,:\s]|\$)" "; Secure";
    default "";
}

map \$http_x_forwarded_proto \$forwarded_proto {
    "" \$scheme;
    default \$http_x_forwarded_proto;
}

map \$upstream_http_vary \$router_vary {
    "" "Cookie";
    "~*(^|,\s*)Cookie(\s*,|\$)" \$upstream_http_vary;
    default "\$upstream_http_vary, Cookie";
}

map \$cookie_openrelik_ui \$selected_ui_upstream {
    default "${default_upstream}";
${map_entries}}

server {
    listen 8711;
    server_name localhost;
    absolute_redirect off;
    resolver ${resolver} valid=10s;
    client_body_buffer_size 10K;
    client_header_buffer_size 1k;
    client_max_body_size 8m;
    large_client_header_buffers 4 32k;

    location = /__openrelik/uis.json {
        alias ${ROUTER_HTML_DIR}/uis.json;
        default_type application/json;
        add_header Cache-Control "no-store" always;
    }

    location = /__openrelik/ui {
        alias ${ROUTER_HTML_DIR}/ui.html;
        default_type text/html;
        charset utf-8;
        add_header Cache-Control "no-store" always;
    }

${switch_locations}    location ^~ /__openrelik/ {
        return 404;
    }

${asset_locations}    location / {
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$forwarded_proto;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_hide_header Vary;
        add_header Vary \$router_vary always;
        proxy_pass \$selected_ui_upstream;
    }
}
EOF

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
