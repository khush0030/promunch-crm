import { describe, it, expect } from "vitest";
import { describeDevice } from "./device";

describe("describeDevice", () => {
  it("names common browser + OS pairs", () => {
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("Chrome on macOS");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge on Windows");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(describeDevice("node")).toBe("Script / API client");
  });
  it("handles missing input", () => {
    expect(describeDevice(null)).toBe("Unknown device");
    expect(describeDevice("")).toBe("Unknown device");
  });
});
