import { afterEach, describe, expect, it, vi } from "vitest";
import {
  millisecondsUntilExpiration,
  scheduleShareExpiration,
} from "./share-expiration";

afterEach(() => vi.useRealTimers());

describe("millisecondsUntilExpiration", () => {
  it("returns null when a share has no expiration", () => {
    expect(millisecondsUntilExpiration(null, 0)).toBeNull();
  });

  it("returns the exact remaining milliseconds", () => {
    expect(millisecondsUntilExpiration("1970-01-01T00:00:10.000Z", 4_000)).toBe(
      6_000,
    );
  });

  it("expires immediately for past or invalid timestamps", () => {
    expect(millisecondsUntilExpiration("1970-01-01T00:00:01.000Z", 2_000)).toBe(
      0,
    );
    expect(millisecondsUntilExpiration("invalid", 0)).toBe(0);
  });
});

describe("scheduleShareExpiration", () => {
  it("runs the expiration callback at the exact deadline", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();

    scheduleShareExpiration("1970-01-01T00:00:10.000Z", onExpire, 4_000);
    vi.advanceTimersByTime(5_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it("runs immediately when a share is already expired", () => {
    const onExpire = vi.fn();
    scheduleShareExpiration("1970-01-01T00:00:01.000Z", onExpire, 2_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });
});
