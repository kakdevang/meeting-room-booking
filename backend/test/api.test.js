import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

let clock;
let app;

beforeEach(() => {
  clock = new Date("2030-05-14T06:00:00Z");
  app = createApp(createDb(":memory:"), { now: () => clock });
});

const payload = (override = {}) => ({
  roomId: 1,
  title: "Sprint planning",
  organizerEmail: "sam@example.com",
  attendees: 3,
  start: "2030-05-14T10:00:00Z",
  end: "2030-05-14T11:00:00Z",
  ...override,
});

const book = (override) => request(app).post("/api/bookings").send(payload(override));

describe("rooms", () => {
  it("lists the 5 seeded rooms", async () => {
    const res = await request(app).get("/api/rooms");
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.name)).toEqual(["Atlas", "Borealis", "Cascade", "Delta", "Ember"]);
    expect(res.body[1].amenities).toEqual(["projector", "whiteboard"]);
  });
});

describe("create booking", () => {
  it("creates a confirmed booking (201) and lists it for the day", async () => {
    const res = await book();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ roomId: 1, status: "confirmed", organizerEmail: "sam@example.com" });

    const list = await request(app).get("/api/bookings?date=2030-05-14");
    expect(list.body).toHaveLength(1);
    const other = await request(app).get("/api/bookings?date=2030-05-14&roomId=2");
    expect(other.body).toHaveLength(0);
  });

  it("returns 409 BOOKING_CONFLICT for an overlapping slot in the same room", async () => {
    const first = await book();
    const res = await book({ organizerEmail: "kim@example.com", start: "2030-05-14T10:30:00Z", end: "2030-05-14T11:30:00Z" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BOOKING_CONFLICT");
    expect(res.body.error.details.conflictingBookingId).toBe(first.body.id);
  });

  it("allows back-to-back bookings and the same slot in another room", async () => {
    await book();
    expect((await book({ start: "2030-05-14T11:00:00Z", end: "2030-05-14T12:00:00Z" })).status).toBe(201);
    expect((await book({ start: "2030-05-14T09:00:00Z", end: "2030-05-14T10:00:00Z" })).status).toBe(201);
    expect((await book({ roomId: 2, organizerEmail: "kim@example.com" })).status).toBe(201);
  });

  it("returns 400 for rule violations", async () => {
    expect((await book({ end: "2030-05-14T09:00:00Z" })).body.error.code).toBe("END_BEFORE_START");
    expect((await book({ start: "2030-05-14T05:00:00Z", end: "2030-05-14T05:30:00Z" })).body.error.code).toBe("OUTSIDE_BUSINESS_HOURS");
    expect((await book({ start: "2030-05-13T10:00:00Z", end: "2030-05-13T11:00:00Z" })).body.error.code).toBe("START_IN_PAST");
    const tooMany = await book({ attendees: 5 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe("CAPACITY_EXCEEDED");
    expect((await book({ title: "" })).status).toBe(400);
  });

  it("returns 400 for invalid JSON and 404 for an unknown room", async () => {
    const bad = await request(app).post("/api/bookings").set("Content-Type", "application/json").send("{oops");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_JSON");
    const res = await book({ roomId: 99 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("R9: a 4th booking on the same day returns 409", async () => {
    for (const [s, e] of [["08:00", "09:00"], ["09:00", "10:00"], ["10:00", "11:00"]]) {
      const ok = await book({ start: `2030-05-14T${s}:00Z`, end: `2030-05-14T${e}:00Z` });
      expect(ok.status).toBe(201);
    }
    const res = await book({ start: "2030-05-14T11:00:00Z", end: "2030-05-14T12:00:00Z" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORGANIZER_LIMIT_REACHED");
  });
});

describe("cancel booking", () => {
  it("cancels, is idempotent, and frees the slot", async () => {
    const created = await book();
    const first = await request(app).delete(`/api/bookings/${created.body.id}`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("cancelled");

    const again = await request(app).delete(`/api/bookings/${created.body.id}`);
    expect(again.status).toBe(200);

    expect((await book({ organizerEmail: "kim@example.com" })).status).toBe(201);
    const list = await request(app).get("/api/bookings?date=2030-05-14");
    expect(list.body).toHaveLength(1);
  });

  it("returns 409 once the booking has started and 404 for unknown ids", async () => {
    const created = await book();
    clock = new Date("2030-05-14T10:30:00Z");
    const res = await request(app).delete(`/api/bookings/${created.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BOOKING_ALREADY_STARTED");
    expect((await request(app).delete("/api/bookings/999")).status).toBe(404);
  });
});

describe("availability", () => {
  it("returns free rooms, smallest sufficient capacity first", async () => {
    await book();
    const url = "/api/availability?date=2030-05-14&start=10:00&end=11:00";

    const all = await request(app).get(`${url}&minCapacity=2`);
    expect(all.body.map((r) => r.name)).toEqual(["Ember", "Borealis", "Cascade", "Delta"]);

    const big = await request(app).get(`${url}&minCapacity=9`);
    expect(big.body.map((r) => r.name)).toEqual(["Cascade", "Delta"]);
  });

  it("applies the same time rules as a booking", async () => {
    const res = await request(app).get("/api/availability?date=2030-05-14&start=10:07&end=11:00");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TIME_BOUNDARY");
  });
});