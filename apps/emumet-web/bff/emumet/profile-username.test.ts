// ============================================================
// Profile username の入力規則 — E8/P1 で確定した契約 (形式・予約語 17 語・暗黙の正規化なし)
// ============================================================

import { describe, expect, test } from "bun:test";
import openapiDocument from "../../openapi/emumet.json" with { type: "json" };
import {
  PROFILE_USERNAME_MAX_LENGTH,
  PROFILE_USERNAME_PATTERN,
  RESERVED_PROFILE_USERNAMES,
  checkProfileUsername,
} from "./profile-username.ts";

describe("checkProfileUsername", () => {
  test("有効な値は null (境界: 1 文字・数字始まり・記号・64 文字)", () => {
    for (const value of ["a", "0", "alice", "a.b_c-d", "a".repeat(64), "0day", "bot-news"]) {
      expect(checkProfileUsername(value), value).toBeNull();
    }
  });

  test("形式違反は FORMAT: 空・大文字・前後空白・先頭記号・非 ASCII・65 文字・改行 (暗黙の trim/小文字化をしない)", () => {
    for (const value of ["", "Alice", " alice", "alice ", ".alice", "_a", "-a", "a b", "あ", "é", "a".repeat(65), "alice\n", "al@ice"]) {
      expect(checkProfileUsername(value), JSON.stringify(value)).toBe("FORMAT");
    }
  });

  test("予約語 17 語はちょうど RESERVED (大文字・前後空白付きは形式違反が先)", () => {
    expect([...RESERVED_PROFILE_USERNAMES].sort()).toEqual(
      [
        "admin",
        "administrator",
        "root",
        "system",
        "support",
        "security",
        "moderator",
        "api",
        "ap",
        "auth",
        "oauth",
        "oauth2",
        "login",
        "logout",
        "register",
        "settings",
        "well-known",
      ].sort(),
    );
    expect(RESERVED_PROFILE_USERNAMES).toHaveLength(17);
    for (const word of RESERVED_PROFILE_USERNAMES) {
      expect(checkProfileUsername(word), word).toBe("RESERVED");
      expect(checkProfileUsername(word.toUpperCase()), word.toUpperCase()).toBe("FORMAT");
      expect(checkProfileUsername(` ${word}`), ` ${word}`).toBe("FORMAT");
    }
    expect(checkProfileUsername("admins")).toBeNull();
  });

  test("形式 (pattern・最大長) は固定した Emumet OpenAPI の SetProfileUsernameRequest / CreateAccountRequest と一致する", () => {
    const schemas = (openapiDocument as unknown as { components: { schemas: Record<string, { properties: Record<string, { pattern?: string; maxLength?: number; minLength?: number }> }> } }).components.schemas;
    const fields = [
      schemas["SetProfileUsernameRequest"]?.properties["username"],
      schemas["CreateAccountRequest"]?.properties["profile_username"],
      schemas["CreateProfileRequest"]?.properties["username"],
    ];
    for (const field of fields) {
      expect(field?.pattern).toBe(PROFILE_USERNAME_PATTERN.source);
      expect(field?.maxLength).toBe(PROFILE_USERNAME_MAX_LENGTH);
      expect(field?.minLength).toBe(1);
    }
  });
});
