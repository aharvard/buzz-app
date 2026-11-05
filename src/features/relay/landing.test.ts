import { describe, expect, it } from "vitest";
import {
  landingInfo,
  landingTags,
  normalizeWelcome,
  validWelcomeCommand,
  welcomeTextProblem,
} from "./landing";

describe("landingTags", () => {
  it("reads the bare designation and its custom message", () => {
    expect(landingTags([["d", "x"]])).toEqual({});
    expect(landingTags([["landing"]])).toEqual({ landing: true });
    expect(landingTags([["landing"], ["welcome", "Hi\nall"]])).toEqual({
      landing: true,
      welcome: "Hi\nall",
    });
  });

  it("ignores a message without the designation", () => {
    // A stale tag can survive on the previous welcome channel.
    expect(landingTags([["welcome", "Old"]])).toEqual({});
  });

  it("falls back to the default for a blank, repeated or invalid message", () => {
    for (const tags of [
      [["landing"], ["welcome", ""]],
      [["landing"], ["welcome", "  "]],
      [["landing"], ["welcome"]],
      [["landing"], ["welcome", "a"], ["welcome", "b"]],
      [["landing"], ["welcome", "tab\there"]],
    ])
      expect(landingTags(tags)).toEqual({ landing: true });
  });
});

describe("welcome text", () => {
  it("normalizes line endings and trims before sending", () => {
    expect(normalizeWelcome("  Hi\r\nall\rthere \n")).toBe("Hi\nall\nthere");
  });

  it("mirrors the relay's limits in Unicode scalar values", () => {
    expect(welcomeTextProblem("é".repeat(1000))).toBeUndefined();
    // Surrogate pairs count once, as Rust `chars()` does.
    expect(welcomeTextProblem("😀".repeat(1000))).toBeUndefined();
    expect(welcomeTextProblem("a".repeat(1001))).toBe("long");
    expect(welcomeTextProblem(" \n ")).toBe("empty");
    // U+FEFF is not Unicode White_Space: the relay keeps it, so both hosts do.
    expect(welcomeTextProblem("\uFEFF")).toBeUndefined();
    expect(welcomeTextProblem("\u2003\u3000")).toBe("empty");
    expect(welcomeTextProblem("line\nbreak")).toBeUndefined();
    for (const text of ["tab\t", "cr\r", "nul\u0000", "del\u007f", "c1\u0085"])
      expect(welcomeTextProblem(text)).toBe("control");
  });

  it("admits the empty default marker only as a command", () => {
    expect(validWelcomeCommand("")).toBe(true);
    expect(validWelcomeCommand("Hello")).toBe(true);
    expect(validWelcomeCommand(" ")).toBe(false);
  });
});

describe("landingInfo", () => {
  const id = "6f1c2a4e-0b7d-4c1e-9a52-2f0d8b3c7e11";

  it("reads support and the designated channel from NIP-11", () => {
    expect(
      landingInfo({
        supported_extensions: ["buzz-gif", "buzz-landing-channel"],
        landing_channel: id,
      }),
    ).toEqual({ landingChannels: true, landingChannel: id });
    expect(
      landingInfo({ supported_extensions: ["buzz-landing-channel"] }),
    ).toEqual({ landingChannels: true });
  });

  it("ignores a designation from a relay without the extension", () => {
    expect(landingInfo({ landing_channel: id })).toEqual({
      landingChannels: false,
    });
    expect(landingInfo(undefined)).toEqual({ landingChannels: false });
  });

  it("ignores a malformed designation", () => {
    for (const landing_channel of [id.toUpperCase(), "", null, 1, "general"])
      expect(
        landingInfo({
          supported_extensions: ["buzz-landing-channel"],
          landing_channel,
        }),
      ).toEqual({ landingChannels: true });
  });
});
