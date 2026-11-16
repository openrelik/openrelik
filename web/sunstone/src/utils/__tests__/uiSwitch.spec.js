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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUiSwitchCache,
  formatUiCookie,
  getAlternativeUis,
  normalizeSunstonePath,
  switchToUi,
} from "../uiSwitch";

function makeResponse({ ok = true, contentType = "application/json", body = {} } = {}) {
  return {
    ok,
    headers: {
      get: (name) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    },
    json: async () => body,
  };
}

describe("uiSwitch", () => {
  beforeEach(() => {
    clearUiSwitchCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("getAlternativeUis", () => {
    it("returns [] on standalone SPA HTML fallback", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeResponse({
          contentType: "text/html; charset=utf-8",
          body: {},
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(getAlternativeUis()).resolves.toEqual([]);
    });

    it("returns [] on non-ok response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse({ ok: false }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(getAlternativeUis()).resolves.toEqual([]);
    });

    it("returns [] on network failure and allows retry", async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(
          makeResponse({
            body: {
              default: "sunstone",
              uis: [
                { id: "sunstone", name: "Sunstone" },
                { id: "runestone", name: "Runestone" },
              ],
            },
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(getAlternativeUis()).resolves.toEqual([]);
      await expect(getAlternativeUis()).resolves.toEqual([
        { id: "runestone", name: "Runestone" },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns [] when 0 or 1 UIs are registered", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeResponse({ body: { default: "sunstone", uis: [] } })
      );
      vi.stubGlobal("fetch", fetchMock);
      await expect(getAlternativeUis()).resolves.toEqual([]);

      clearUiSwitchCache();
      fetchMock.mockResolvedValueOnce(
        makeResponse({
          body: {
            default: "sunstone",
            uis: [{ id: "sunstone", name: "Sunstone" }],
          },
        })
      );
      await expect(getAlternativeUis()).resolves.toEqual([]);
    });

    it("returns alternative UIs for 2 and 3+ UIs and memoizes across calls", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeResponse({
          body: {
            default: "sunstone",
            uis: [
              { id: "sunstone", name: "Sunstone" },
              { id: "runestone", name: "Runestone" },
              { id: "custom-ui", name: " Custom UI " },
              { id: "INVALID_ID", name: "Broken" },
            ],
          },
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const first = await getAlternativeUis();
      const second = await getAlternativeUis();
      expect(first).toEqual([
        { id: "runestone", name: "Runestone" },
        { id: "custom-ui", name: "Custom UI" },
      ]);
      expect(second).toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/__openrelik/uis.json", {
        cache: "no-store",
        credentials: "same-origin",
      });
    });
  });

  describe("formatUiCookie", () => {
    it("formats cookie with Secure only on https", () => {
      expect(formatUiCookie("runestone", "http:")).toBe(
        "openrelik_ui=runestone; Path=/; Max-Age=31536000; SameSite=Lax"
      );
      expect(formatUiCookie("runestone", "https:")).toBe(
        "openrelik_ui=runestone; Path=/; Max-Age=31536000; SameSite=Lax; Secure"
      );
    });

    it("rejects invalid UI IDs", () => {
      expect(formatUiCookie("Bad_Id", "http:")).toBeNull();
      expect(formatUiCookie("runestone; Path=/", "http:")).toBeNull();
    });
  });

  describe("normalizeSunstonePath", () => {
    it.each([
      ["/", "/"],
      ["/my-folders", "/"],
      ["/shared-with-me", "/"],
      ["/metrics", "/metrics"],
      ["/folder/42", "/folder/42"],
      ["/folder/42/", "/folder/42"],
      ["/folder/42/investigation", "/folder/42"],
      ["/folder/42/file/99", "/folder/42/file/99"],
      ["/folder/42/file/99/details", "/folder/42/file/99"],
      ["/folder/42/file/99/content", "/folder/42/file/99"],
      ["/login", "/login"],
      ["/login?redirect=/folder/42", "/login?redirect=/folder/42"],
      [
        "/login?redirect=/folder/42/file/99/details",
        "/login?redirect=/folder/42/file/99",
      ],
      ["/login?redirect=/my-folders", "/login?redirect=/"],
      ["/login?redirect=https://evil.example/phish", "/login"],
      ["/login?redirect=//evil.example/phish", "/login"],
      ["/login?redirect=/\\evil.example/phish", "/login"],
      ["/login?redirect=/login", "/login"],
      ["/unknown/route", "/"],
      ["//evil.example", "/"],
      ["/\\evil.example", "/"],
    ])("normalizes %s -> %s", (input, expected) => {
      expect(normalizeSunstonePath(input)).toBe(expected);
    });
  });

  describe("switchToUi", () => {
    it("sets openrelik_ui cookie and navigates to normalized path", () => {
      const setCookie = vi.fn();
      const assign = vi.fn();

      switchToUi("runestone", {
        setCookie,
        locationObj: {
          pathname: "/folder/42/investigation",
          search: "",
          hash: "",
          protocol: "https:",
          assign,
        },
      });

      expect(setCookie).toHaveBeenCalledWith(
        "openrelik_ui=runestone; Path=/; Max-Age=31536000; SameSite=Lax; Secure"
      );
      expect(assign).toHaveBeenCalledWith("/folder/42");
    });

    it("ignores invalid target UI IDs", () => {
      const setCookie = vi.fn();
      const assign = vi.fn();

      switchToUi("not valid", {
        setCookie,
        locationObj: {
          pathname: "/",
          search: "",
          hash: "",
          protocol: "http:",
          assign,
        },
      });

      expect(setCookie).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
