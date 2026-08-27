import { describe, it, expect } from "vitest";
import { normalizeSentinel, mapConnectivityStatus, clampOutcome } from "./sarvam-voice";

describe("normalizeSentinel", () => {
  it("normalises known sentinel strings to null", () => {
    expect(normalizeSentinel("NO_INTERACTION_ID")).toBeNull();
    expect(normalizeSentinel("NO_FAILURE_REASON")).toBeNull();
    expect(normalizeSentinel("NO_END_REASON")).toBeNull();
  });

  it("normalises a future NO_* sentinel we have not seen yet", () => {
    expect(normalizeSentinel("NO_SOMETHING_NEW")).toBeNull();
  });

  it("passes through real values unchanged", () => {
    expect(normalizeSentinel("USER_ENDS")).toBe("USER_ENDS");
    expect(normalizeSentinel("call dropped mid-sentence")).toBe("call dropped mid-sentence");
  });

  it("treats null/undefined/empty as null", () => {
    expect(normalizeSentinel(null)).toBeNull();
    expect(normalizeSentinel(undefined)).toBeNull();
    expect(normalizeSentinel("")).toBeNull();
  });
});

describe("mapConnectivityStatus", () => {
  it("maps the four known connectivity statuses through", () => {
    expect(mapConnectivityStatus("connected")).toBe("connected");
    expect(mapConnectivityStatus("busy")).toBe("busy");
    expect(mapConnectivityStatus("no_answer")).toBe("no_answer");
    expect(mapConnectivityStatus("failed")).toBe("failed");
  });

  it("clamps anything unrecognised to unknown rather than passing it through", () => {
    expect(mapConnectivityStatus("ringing")).toBe("unknown");
    expect(mapConnectivityStatus(null)).toBe("unknown");
    expect(mapConnectivityStatus(undefined)).toBe("unknown");
    expect(mapConnectivityStatus("")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(mapConnectivityStatus("CONNECTED")).toBe("connected");
  });
});

describe("clampOutcome", () => {
  it("passes the six known dispositions through", () => {
    for (const v of ["will_buy", "asked_link", "not_interested", "do_not_call", "callback_later", "unknown"]) {
      expect(clampOutcome(v)).toBe(v);
    }
  });

  it("clamps an unrecognised disposition to unknown (never a raw passthrough)", () => {
    expect(clampOutcome("maybe_later_idk")).toBe("unknown");
    expect(clampOutcome(null)).toBe("unknown");
    expect(clampOutcome(undefined)).toBe("unknown");
    expect(clampOutcome(42)).toBe("unknown");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(clampOutcome(" DO_NOT_CALL ")).toBe("do_not_call");
  });
});
