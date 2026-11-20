import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const now = () => new Date("2030-05-14T06:00:00Z");
const body = (i) => ({
  roomId: 3,
  title: `Race ${i}`,
  organizerEmail: `user${i}@example.com`,
  attendees: 2,
  start: "2030-05-14T14:00:00Z",
  end: "2030-05-14T15:00:00Z",
});

describe("simultaneous conflicting requests", () => {
  it("exactly one of 10 parallel requests succeeds (one app)", async () => {
    const app = createApp(createDb(":memory:"), { now });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => request(app).post("/api/bookings").send(body(i)))
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });

  const file = join(tmpdir(), `booking-race-${process.pid}.db`);
  const db1 = createDb(file);
  const db2 = createDb(file);

  afterAll(() => {
    db1.close();
    db2.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
  });

  it("exactly one succeeds when two connections share one database file", async () => {
    const apps = [createApp(db1, { now }), createApp(db2, { now })];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => request(apps[i % 2]).post("/api/bookings").send(body(i)))
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });
});
