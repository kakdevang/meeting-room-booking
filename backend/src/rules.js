const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const BUSINESS_START_MIN = 8 * 60;
export const BUSINESS_END_MIN = 20 * 60;
export const MIN_DURATION_MIN = 15;
export const MAX_DURATION_MIN = 4 * 60;
export const MAX_BOOKINGS_PER_DAY = 3;

export class RuleError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RuleError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const toMs = (value) => new Date(value).getTime();
const hhmm = (value) => new Date(value).toISOString().slice(11, 16);
const minuteOfDay = (date) => date.getUTCHours() * 60 + date.getUTCMinutes();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_UTC =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?Z$/;

export function parseUtcTimestamp(value) {
  if (typeof value !== "string") return null;
  const m = ISO_UTC.exec(value);
  if (!m) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const sameDay =
    date.getUTCFullYear() === Number(m[1]) &&
    date.getUTCMonth() === Number(m[2]) - 1 &&
    date.getUTCDate() === Number(m[3]);
  return sameDay ? date : null;
}

export function parseBookingInput(body) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const fail = (field, message) => {
    throw new RuleError(400, "VALIDATION_ERROR", message, { field });
  };

  if (!Number.isInteger(input.roomId)) fail("roomId", "roomId must be an integer.");

  if (typeof input.title !== "string") fail("title", "title is required.");
  const title = input.title.trim();
  if (title.length < 1 || title.length > 100) {
    fail("title", "title must be 1 to 100 characters after trimming.");
  }

  const email = typeof input.organizerEmail === "string" ? input.organizerEmail.trim() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    fail("organizerEmail", "organizerEmail must be a valid email address.");
  }

  if (!Number.isInteger(input.attendees) || input.attendees < 1) {
    fail("attendees", "attendees must be an integer of at least 1.");
  }

  const start = parseUtcTimestamp(input.start);
  if (!start) fail("start", "start must be an ISO 8601 UTC timestamp, e.g. 2030-05-14T10:00:00Z.");
  const end = parseUtcTimestamp(input.end);
  if (!end) fail("end", "end must be an ISO 8601 UTC timestamp, e.g. 2030-05-14T11:00:00Z.");

  return {
    roomId: input.roomId,
    title,
    organizerEmail: email.toLowerCase(),
    attendees: input.attendees,
    start,
    end,
  };
}

const onQuarterHour = (date) =>
  date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0 && date.getUTCMinutes() % 15 === 0;

export function validateWindow(start, end) {
  if (end.getTime() <= start.getTime()) {
    throw new RuleError(400, "END_BEFORE_START", "end must be after start.");
  }
  if (!onQuarterHour(start) || !onQuarterHour(end)) {
    throw new RuleError(400, "INVALID_TIME_BOUNDARY", "start and end must fall on 15-minute boundaries.");
  }
  const minutes = (end.getTime() - start.getTime()) / MINUTE;
  if (minutes < MIN_DURATION_MIN || minutes > MAX_DURATION_MIN) {
    throw new RuleError(400, "INVALID_DURATION", "A booking must last between 15 minutes and 4 hours.");
  }
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  if (!sameDay || minuteOfDay(start) < BUSINESS_START_MIN || minuteOfDay(end) > BUSINESS_END_MIN) {
    throw new RuleError(
      400,
      "OUTSIDE_BUSINESS_HOURS",
      "A booking must be within 08:00 to 20:00 UTC and on a single UTC day."
    );
  }
}

export function validateNotInPast(start, now) {
  if (start.getTime() < now.getTime()) {
    throw new RuleError(400, "START_IN_PAST", "A booking cannot start in the past.");
  }
}

export function validateCapacity(attendees, room) {
  if (attendees > room.capacity) {
    throw new RuleError(
      400,
      "CAPACITY_EXCEEDED",
      `Room ${room.name} fits ${room.capacity} people, but ${attendees} attendees were given.`,
      { capacity: room.capacity }
    );
  }
}

export function overlaps(a, b) {
  return toMs(a.start) < toMs(b.end) && toMs(b.start) < toMs(a.end);
}

export function findConflict(bookings, window) {
  return bookings.find((b) => b.status === "confirmed" && overlaps(b, window)) ?? null;
}

export function assertNoConflict(room, bookings, window) {
  const conflict = findConflict(bookings, window);
  if (conflict) {
    throw new RuleError(
      409,
      "BOOKING_CONFLICT",
      `Room ${room.name} is already booked from ${hhmm(conflict.start)} to ${hhmm(conflict.end)} UTC.`,
      { conflictingBookingId: conflict.id }
    );
  }
}

export function assertOrganizerLimit(count) {
  if (count >= MAX_BOOKINGS_PER_DAY) {
    throw new RuleError(
      409,
      "ORGANIZER_LIMIT_REACHED",
      `An organizer cannot hold more than ${MAX_BOOKINGS_PER_DAY} confirmed bookings on the same day.`
    );
  }
}

export function assertCancellable(booking, now) {
  if (toMs(booking.start) <= now.getTime()) {
    throw new RuleError(409, "BOOKING_ALREADY_STARTED", "A booking that has already started cannot be cancelled.");
  }
}


export function dayBounds(date) {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { from: from.toISOString(), to: new Date(from.getTime() + DAY).toISOString() };
}

export function parseDateParam(value) {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!date || date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) {
    throw new RuleError(400, "INVALID_DATE", "date must be a real date in YYYY-MM-DD format.");
  }
  return date;
}

export function parseTimeParam(value, field) {
  const m = typeof value === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  if (!m) throw new RuleError(400, "INVALID_TIME", `${field} must be a time in HH:mm format.`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function buildWindow(dateValue, startValue, endValue) {
  const day = parseDateParam(dateValue);
  const startMin = parseTimeParam(startValue, "start");
  const endMin = parseTimeParam(endValue, "end");
  return {
    day,
    start: new Date(day.getTime() + startMin * MINUTE),
    end: new Date(day.getTime() + endMin * MINUTE),
  };
}
