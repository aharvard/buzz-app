import { describe, expect, it } from "vitest";
import {
  landingInfo,
  landingTags,
  normalizeWelcome,
  validWelcomeCommand,
  validWelcomeTitleCommand,
  welcomeTextProblem,
  welcomeTitleProblem,
} from "./landing";

describe("landingTags", () => {
  it("reads the bare designation and its custom message and title", () => {
    expect(landingTags([["d", "x"]])).toEqual({});
    expect(landingTags([["landing"]])).toEqual({ landing: true });
    expect(landingTags([["landing"], ["welcome", "Hi\nall"]])).toEqual({
      landing: true,
      welcome: "Hi\nall",
    });
    expect(
      landingTags([
        ["landing"],
        ["welcome", "# Hi\n\n\t**all**"],
        ["welcome_title", "Hello, Acme"],
      ]),
    ).toEqual({
      landing: true,
      welcome: "# Hi\n\n\t**all**",
      welcomeTitle: "Hello, Acme",
    });
    // Each part is customized on its own.
    expect(landingTags([["landing"], ["welcome_title", "Hello"]])).toEqual({
      landing: true,
      welcomeTitle: "Hello",
    });
  });

  it("ignores a message or title without the designation", () => {
    // A stale tag can survive on the previous welcome channel.
    expect(
      landingTags([
        ["welcome", "Old"],
        ["welcome_title", "Old"],
      ]),
    ).toEqual({});
  });

  it("falls back to the default for a blank, repeated or invalid message or title", () => {
    for (const tags of [
      [["landing"], ["welcome", ""]],
      [["landing"], ["welcome", "  "]],
      [["landing"], ["welcome"]],
      [["landing"], ["welcome", "a"], ["welcome", "b"]],
      [["landing"], ["welcome", "cr\rhere"]],
      [["landing"], ["welcome_title", ""]],
      [["landing"], ["welcome_title", " "]],
      [["landing"], ["welcome_title", "two\nlines"]],
      [["landing"], ["welcome_title", "a"], ["welcome_title", "b"]],
    ])
      expect(landingTags(tags)).toEqual({ landing: true });
  });
});

describe("welcome text", () => {
  it("normalizes line endings and trims before sending", () => {
    expect(normalizeWelcome("  Hi\r\nall\rthere \n")).toBe("Hi\nall\nthere");
  });

  it("mirrors the relay's limits in Unicode scalar values", () => {
    expect(welcomeTextProblem("é".repeat(4000))).toBeUndefined();
    // Surrogate pairs count once, as Rust `chars()` does.
    expect(welcomeTextProblem("😀".repeat(4000))).toBeUndefined();
    expect(welcomeTextProblem("a".repeat(4001))).toBe("long");
    expect(welcomeTextProblem(" \n ")).toBe("empty");
    // U+FEFF is not Unicode White_Space: the relay keeps it, so both hosts do.
    expect(welcomeTextProblem("\uFEFF")).toBeUndefined();
    expect(welcomeTextProblem("\u2003\u3000")).toBe("empty");
    // Markdown needs line breaks and tabs for structure and code.
    expect(welcomeTextProblem("line\nbreak")).toBeUndefined();
    expect(welcomeTextProblem("- item\n\t- nested")).toBeUndefined();
    for (const text of ["cr\r", "nul\u0000", "vt\u000b", "del\u007f", "c1\u0085"])
      expect(welcomeTextProblem(text)).toBe("control");
  });

  it("admits the empty default marker only as a command", () => {
    expect(validWelcomeCommand("")).toBe(true);
    expect(validWelcomeCommand("Hello")).toBe(true);
    expect(validWelcomeCommand(" ")).toBe(false);
  });
});

describe("welcome title", () => {
  it("mirrors the relay's one-line limits in Unicode scalar values", () => {
    expect(welcomeTitleProblem("é".repeat(120))).toBeUndefined();
    expect(welcomeTitleProblem("😀".repeat(120))).toBeUndefined();
    expect(welcomeTitleProblem("a".repeat(121))).toBe("long");
    expect(welcomeTitleProblem(" ")).toBe("empty");
    expect(welcomeTitleProblem("\uFEFF")).toBeUndefined();
    for (const text of [
      "two\nlines",
      "tab\t",
      "cr\r",
      "del\u007f",
      "c1\u0085",
      "line\u2028sep",
      "para\u2029sep",
    ])
      expect(welcomeTitleProblem(text)).toBe("control");
    // The message rejects neither separator; only the title is one line.
    expect(welcomeTextProblem("line\u2028sep")).toBeUndefined();
  });

  it("admits the empty default marker only as a command", () => {
    expect(validWelcomeTitleCommand("")).toBe(true);
    expect(validWelcomeTitleCommand("Hello")).toBe(true);
    expect(validWelcomeTitleCommand(" ")).toBe(false);
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
