import { describe, expect, it } from "vitest";
import { formatDuration, marketStatus } from "../src/market";

const hours = { open: 1793716200, close: 1793739600 }; // AAPL 2026-11-03 09:30-16:00 EST
const at = (sec: number) => sec * 1000;

describe("formatDuration", () => {
  it("formats seconds as d/h/m", () => {
    expect(formatDuration(59)).toBe("<1m");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(90000)).toBe("1d 1h");
  });
});

describe("marketStatus", () => {
  it("is undefined without hours", () => {
    expect(marketStatus(undefined, 0)).toBeUndefined();
  });

  it("is open during the session", () => {
    expect(marketStatus(hours, at(hours.open + 7200))).toEqual({
      state: "open",
      label: "Market open · closes in 4h 30m",
    });
  });

  it("opens at the open boundary and closes at the close boundary", () => {
    expect(marketStatus(hours, at(hours.open))?.state).toBe("open");
    expect(marketStatus(hours, at(hours.close - 1))?.state).toBe("open");
    expect(marketStatus(hours, at(hours.close))).toEqual({ state: "closed", label: "Market closed" });
  });

  it("is closed just after the close", () => {
    expect(marketStatus(hours, at(hours.close + 60))?.state).toBe("closed");
  });

  it("opens later before the open", () => {
    expect(marketStatus(hours, at(hours.open - 12600))).toEqual({ state: "opens-later", label: "Opens in 3h 30m" });
  });
});
