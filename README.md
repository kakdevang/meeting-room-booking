# Meeting Room Booking System

Small app to view meeting rooms, book without double-booking, cancel bookings and find free rooms. All times are UTC.

## Run

Needs Node.js 20+.

```bash
cd backend
npm install
npm start      # http://localhost:3000 (API + UI, rooms seeded on first run)
npm test       # all tests
```

## Structure

Express serves the JSON API (`/api`) and the plain HTML/JS frontend (`frontend/`).

- `src/app.js`: routes and error format
- `src/service.js`: create, cancel, search
- `src/rules.js`: pure booking rules (R1 to R9), no HTTP or database
- `src/repository.js`: SQL
- `src/db.js`: SQLite schema and room seed

Data: `rooms(id, name, capacity, floor, amenities)` and `bookings(id, room_id, title, organizer_email, attendees, start, end, status, created_at)`. Times are stored as ISO UTC strings.

## API

`GET /api/rooms`, `GET /api/bookings?date=&roomId=`, `POST /api/bookings`, `DELETE /api/bookings/:id`, `GET /api/availability?date=&start=&end=&minCapacity=`

Errors look like `{ "error": { "code", "message", "details" } }`. 400 for R1 to R6, 404 for unknown room or booking, 409 for conflict (R7), started booking (R8) and organizer limit (R9).

## Concurrency

The conflict check and the insert run in one SQLite `BEGIN IMMEDIATE` transaction, which takes the write lock first, so two overlapping requests cannot both succeed. On several servers I would use PostgreSQL with an exclusion constraint on `(room_id, time range)`, and an advisory lock for R9.

## Assumptions

- Emails are lower-cased.
- Starting exactly now is allowed (R5), but counts as started for cancelling (R8).
- R9 counts confirmed bookings starting on the same UTC day.
- Availability search applies R1 to R4 only.

## Not built

Login, room management, frontend tests, PostgreSQL setup, timeline grid (the day view is a list per room).

## Tests

`cd backend && npm test` covers the overlap table, R1 to R9, the API including 409, and 10 simultaneous conflicting requests (exactly one succeeds).

## Sources

Express, better-sqlite3, vitest and supertest docs; MDN.

Name: Devang Kakde
Date: 2026-11-20