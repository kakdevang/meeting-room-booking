import { describe, it, expect } from "vitest";
import {
  findConflict,
  validateWindow,
  validateNotInPast,
  validateCapacity,
  assertOrganizerLimit,
  assertCancellable,
  parseBookingInput,
} from "../src/rules.js";

const at = (hhmm) => new Date(`2030-05-14T${hhmm}:00Z`);
const win = (s, e) => ({ start: at(s), end: at(e) });
const codeOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
};

const atlas10to11 = [
  { id: 1, status: "confirmed", start: at("10:00").toISOString(), end: at("11:00").toISOString() },
];

describe("R7 overlap reference cases (Atlas has 10:00-11:00)", () => {
  it.each([
    ["09:00", "10:00", false],
    ["11:00", "12:00", false],
    ["09:30", "10:30", true],
    ["10:30", "11:30", true],
    ["10:15", "10:45", true],
    ["09:00", "12:00", true],
    ["10:00", "11:00", true],
  ])("%s to %s -> conflict: %s", (s, e, expected) => {
    expect(findConflict(atlas10to11, win(s, e)) !== null).toBe(expected);
  });

  it("cancelled bookings do not block a slot", () => {
    const cancelled = [{ ...atlas10to11[0], status: "cancelled" }];
    expect(findConflict(cancelled, win("10:00", "11:00"))).toBeNull();
  });
});

describe("R1 to R4 time window", () => {
  it("R1: end must be after start", () => {
    expect(codeOf(() => validateWindow(at("11:00"), at("10:00")))).toBe("END_BEFORE_START");
    expect(codeOf(() => validateWindow(at("10:00"), at("10:00")))).toBe("END_BEFORE_START");
  });

  it("R2: 15-minute boundaries with zero seconds", () => {
    expect(codeOf(() => validateWindow(at("10:07"), at("11:00")))).toBe("INVALID_TIME_BOUNDARY");
    expect(
      codeOf(() => validateWindow(new Date("2030-05-14T10:00:30Z"), at("11:00")))
    ).toBe("INVALID_TIME_BOUNDARY");
    expect(codeOf(() => validateWindow(at("10:15"), at("10:45")))).toBeNull();
  });

  it("R3: 15 minutes minimum, 4 hours maximum", () => {
    expect(codeOf(() => validateWindow(at("10:00"), at("10:15")))).toBeNull();
    expect(codeOf(() => validateWindow(at("08:00"), at("12:00")))).toBeNull();
    expect(codeOf(() => validateWindow(at("08:00"), at("12:15")))).toBe("INVALID_DURATION");
  });

  it("R4: inside 08:00-20:00 UTC on a single day", () => {
    expect(codeOf(() => validateWindow(at("07:45"), at("08:45")))).toBe("OUTSIDE_BUSINESS_HOURS");
    expect(codeOf(() => validateWindow(at("19:30"), at("20:30")))).toBe("OUTSIDE_BUSINESS_HOURS");
    expect(codeOf(() => validateWindow(at("19:00"), at("20:00")))).toBeNull();
    expect(
      codeOf(() => validateWindow(at("23:00"), new Date("2030-05-15T00:00:00Z")))
    ).toBe("OUTSIDE_BUSINESS_HOURS");
  });
});

describe("R5, R6, R8, R9", () => {
  it("R5: cannot start in the past", () => {
    expect(codeOf(() => validateNotInPast(at("09:00"), at("09:15")))).toBe("START_IN_PAST");
    expect(codeOf(() => validateNotInPast(at("09:00"), at("09:00")))).toBeNull();
  });

  it("R6: attendees cannot exceed capacity", () => {
    const atlas = { name: "Atlas", capacity: 4 };
    expect(codeOf(() => validateCapacity(5, atlas))).toBe("CAPACITY_EXCEEDED");
    expect(codeOf(() => validateCapacity(4, atlas))).toBeNull();
  });

  it("R8: a started booking cannot be cancelled", () => {
    const booking = { start: at("10:00").toISOString() };
    expect(codeOf(() => assertCancellable(booking, at("10:00")))).toBe("BOOKING_ALREADY_STARTED");
    expect(codeOf(() => assertCancellable(booking, at("09:59")))).toBeNull();
  });

  it("R9: at most 3 confirmed bookings per organizer per day", () => {
    expect(codeOf(() => assertOrganizerLimit(2))).toBeNull();
    expect(codeOf(() => assertOrganizerLimit(3))).toBe("ORGANIZER_LIMIT_REACHED");
  });
});

describe("input shape", () => {
  const valid = {
    roomId: 1,
    title: "  Sprint planning ",
    organizerEmail: "Sam@Example.com",
    attendees: 3,
    start: "2030-05-14T10:00:00Z",
    end: "2030-05-14T11:00:00Z",
  };

  it("trims the title and lower-cases the email", () => {
    const parsed = parseBookingInput(valid);
    expect(parsed.title).toBe("Sprint planning");
    expect(parsed.organizerEmail).toBe("sam@example.com");
  });

  it.each([
    [{ roomId: "1" }],
    [{ title: "   " }],
    [{ title: "x".repeat(101) }],
    [{ organizerEmail: "not-an-email" }],
    [{ attendees: 0 }],
    [{ attendees: 1.5 }],
    [{ start: "2030-05-14 10:00" }],
    [{ end: "2030-02-31T10:00:00Z" }],
  ])("rejects %j", (override) => {
    expect(codeOf(() => parseBookingInput({ ...valid, ...override }))).toBe("VALIDATION_ERROR");
  });
});
