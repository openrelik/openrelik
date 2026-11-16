/*
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const UI_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const CURRENT_UI_ID = "sunstone";
const MANIFEST_URL = "/__openrelik/uis.json";

let cachedPromise = null;

/**
 * Clears the cached UI manifest lookup. Primarily used by tests.
 */
export function clearUiSwitchCache() {
  cachedPromise = null;
}

/**
 * Fetches and memoizes GET /__openrelik/uis.json, returning alternative UI
 * entries when two or more valid UIs are registered. Returns [] on standalone
 * deployments (where SPA fallback returns text/html) or single-UI setups.
 */
export async function getAlternativeUis() {
  if (cachedPromise) {
    return cachedPromise;
  }
  if (typeof fetch !== "function") {
    return [];
  }

  const request = (async () => {
    try {
      const response = await fetch(MANIFEST_URL, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response || !response.ok) {
        return [];
      }
      const contentType = response.headers?.get?.("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return [];
      }
      const data = await response.json();
      if (!data || typeof data !== "object" || !Array.isArray(data.uis)) {
        return [];
      }
      const validUis = [];
      const seen = new Set();
      for (const item of data.uis) {
        if (
          item &&
          typeof item.id === "string" &&
          UI_ID_RE.test(item.id) &&
          typeof item.name === "string" &&
          item.name.trim().length > 0 &&
          !seen.has(item.id)
        ) {
          seen.add(item.id);
          validUis.push({ id: item.id, name: item.name.trim() });
        }
      }
      if (validUis.length < 2) {
        return [];
      }
      return validUis.filter((ui) => ui.id !== CURRENT_UI_ID);
    } catch {
      cachedPromise = null;
      return [];
    }
  })();

  cachedPromise = request;
  return request;
}

/**
 * Formats the openrelik_ui cookie string for an allowlisted UI ID.
 */
export function formatUiCookie(targetId, protocol = window.location.protocol) {
  if (typeof targetId !== "string" || !UI_ID_RE.test(targetId)) {
    return null;
  }
  const secure = protocol === "https:" ? "; Secure" : "";
  return `openrelik_ui=${targetId}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function normalizeCorePath(pathname) {
  const path =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  if (path === "/" || path === "/my-folders" || path === "/shared-with-me") {
    return "/";
  }
  if (path === "/metrics") {
    return "/metrics";
  }
  const folderMatch = path.match(/^\/folder\/([^/]+)(?:\/investigation)?$/);
  if (folderMatch) {
    return `/folder/${folderMatch[1]}`;
  }
  const fileMatch = path.match(
    /^\/folder\/([^/]+)\/file\/([^/]+)(?:\/(?:details|content))?$/
  );
  if (fileMatch) {
    return `/folder/${fileMatch[1]}/file/${fileMatch[2]}`;
  }
  return null;
}

/**
 * Normalizes Sunstone routes to canonical OpenRelik paths when switching UIs.
 */
export function normalizeSunstonePath(rawPath) {
  if (
    typeof rawPath !== "string" ||
    !rawPath.startsWith("/") ||
    rawPath.startsWith("//") ||
    rawPath.startsWith("/\\")
  ) {
    return "/";
  }
  let url;
  try {
    url = new URL(rawPath, "http://localhost");
  } catch {
    return "/";
  }
  if (url.origin !== "http://localhost") {
    return "/";
  }
  const path =
    url.pathname.length > 1
      ? url.pathname.replace(/\/+$/, "") || "/"
      : url.pathname;
  if (path === "/login") {
    const redirect = url.searchParams.get("redirect");
    if (
      !redirect ||
      !redirect.startsWith("/") ||
      redirect.startsWith("//") ||
      redirect.startsWith("/\\")
    ) {
      return "/login";
    }
    try {
      const redirectUrl = new URL(redirect, "http://localhost");
      if (redirectUrl.origin !== "http://localhost") {
        return "/login";
      }
      const redirectPath =
        redirectUrl.pathname.length > 1
          ? redirectUrl.pathname.replace(/\/+$/, "") || "/"
          : redirectUrl.pathname;
      if (redirectPath === "/login") {
        return "/login";
      }
      const normalizedRedirect = normalizeCorePath(redirectPath) || "/";
      const encoded = encodeURIComponent(normalizedRedirect).replace(
        /%2F/gi,
        "/"
      );
      return `/login?redirect=${encoded}`;
    } catch {
      return "/login";
    }
  }
  return normalizeCorePath(path) || "/";
}

/**
 * Persists the openrelik_ui cookie and navigates to the normalized path.
 */
export function switchToUi(targetId, options = {}) {
  const loc = options.locationObj || window.location;
  const setCookie =
    options.setCookie ||
    ((cookie) => {
      document.cookie = cookie;
    });
  const cookie = formatUiCookie(targetId, loc.protocol);
  if (!cookie) {
    return;
  }
  setCookie(cookie);
  const currentPath = `${loc.pathname || "/"}${loc.search || ""}${
    loc.hash || ""
  }`;
  const targetPath = normalizeSunstonePath(currentPath);
  loc.assign(targetPath);
}
