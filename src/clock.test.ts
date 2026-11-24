import { describe, expect, it } from "vitest";
import { createClock } from "./clock";

const DAY = 86_400_000;

describe("edit-time clock", () => {
  it("follows the server's clock when this device's clock is far off", () => {
    const device = 1_000_000;
    const clock = createClock(() => device);
    clock.learnServerTime(device - DAY, device - 40, device + 40);
    expect(clock.stamp()).toBe(device - DAY);
  });

  it("ignores small differences between the device and the server", () => {
    let device = 5_000_000;
    const clock = createClock(() => device);
    clock.learnServerTime(device + 2_000, device - 40, device + 40);
    device += 100;
    expect(clock.stamp()).toBe(device);
  });

  it("ignores a measurement whose round trip took too long to be trusted", () => {
    const device = 5_000_000;
    const clock = createClock(() => device);
    clock.learnServerTime(device + DAY, device - 20_000, device);
    expect(clock.stamp()).toBe(device);
  });

  it("never hands out an earlier stamp than one it already gave, even after correcting backwards", () => {
    let device = 9_000_000;
    const clock = createClock(() => device);
    const first = clock.stamp();
    clock.learnServerTime(device - DAY, device - 10, device + 10);
    const second = clock.stamp();
    device += 1;
    const third = clock.stamp();
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("gives two edits in the same millisecond different stamps", () => {
    const clock = createClock(() => 42_000);
    expect(clock.stamp()).toBeLessThan(clock.stamp());
  });
});
