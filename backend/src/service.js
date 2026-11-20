import * as repo from "./repository.js";
import {
  RuleError,
  parseBookingInput,
  validateWindow,
  validateNotInPast,
  validateCapacity,
  assertNoConflict,
  assertOrganizerLimit,
  assertCancellable,
  findConflict,
  dayBounds,
  parseDateParam,
  buildWindow,
} from "./rules.js";

const roomNotFound = () => new RuleError(404, "ROOM_NOT_FOUND", "Room not found.");

export function createBookingService(db, now = () => new Date()) {
  const insertTx = db.transaction((room, data) => {
    const { from, to } = dayBounds(data.start);
    assertNoConflict(room, repo.listConfirmedForRoom(db, room.id, from, to), data);
    assertOrganizerLimit(repo.countConfirmedForOrganizer(db, data.organizerEmail, from, to));
    return repo.insertBooking(db, { ...data, roomId: room.id, createdAt: now().toISOString() });
  });

  const cancelTx = db.transaction((id) => {
    const booking = repo.getBooking(db, id);
    if (!booking) throw new RuleError(404, "BOOKING_NOT_FOUND", "Booking not found.");
    if (booking.status === "cancelled") return booking;
    assertCancellable(booking, now());
    return repo.markCancelled(db, id);
  });

  return {
    listRooms: () => repo.listRooms(db),

    listBookings({ date, roomId }) {
      const day = parseDateParam(date);
      let id = null;
      if (roomId !== undefined && roomId !== "") {
        id = Number(roomId);
        if (!Number.isInteger(id)) {
          throw new RuleError(400, "VALIDATION_ERROR", "roomId must be an integer.", { field: "roomId" });
        }
        if (!repo.getRoom(db, id)) throw roomNotFound();
      }
      const { from, to } = dayBounds(day);
      return repo.listConfirmedForDay(db, from, to, id);
    },

    createBooking(body) {
      const data = parseBookingInput(body);
      const room = repo.getRoom(db, data.roomId);
      if (!room) throw roomNotFound();
      validateWindow(data.start, data.end);
      validateNotInPast(data.start, now());
      validateCapacity(data.attendees, room);
      return insertTx.immediate(room, data);
    },

    cancelBooking(rawId) {
      const id = Number(rawId);
      if (!Number.isInteger(id)) throw new RuleError(404, "BOOKING_NOT_FOUND", "Booking not found.");
      return cancelTx.immediate(id);
    },

    availability(query) {
      const { day, start, end } = buildWindow(query.date, query.start, query.end);
      validateWindow(start, end);

      let minCapacity = 1;
      if (query.minCapacity !== undefined && query.minCapacity !== "") {
        minCapacity = Number(query.minCapacity);
        if (!Number.isInteger(minCapacity) || minCapacity < 1) {
          throw new RuleError(400, "VALIDATION_ERROR", "minCapacity must be an integer of at least 1.", {
            field: "minCapacity",
          });
        }
      }

      const { from, to } = dayBounds(day);
      return repo
        .listRooms(db)
        .filter((room) => room.capacity >= minCapacity)
        .filter((room) => !findConflict(repo.listConfirmedForRoom(db, room.id, from, to), { start, end }))
        .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name));
    },
  };
}
