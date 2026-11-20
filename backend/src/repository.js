const BOOKING_COLUMNS = `id, room_id AS roomId, title, organizer_email AS organizerEmail,
  attendees, start, "end", status, created_at AS createdAt`;

function toRoom(row) {
  return { ...row, amenities: JSON.parse(row.amenities) };
}

export function listRooms(db) {
  return db
    .prepare("SELECT id, name, capacity, floor, amenities FROM rooms ORDER BY id")
    .all()
    .map(toRoom);
}

export function getRoom(db, id) {
  const row = db
    .prepare("SELECT id, name, capacity, floor, amenities FROM rooms WHERE id = ?")
    .get(id);
  return row ? toRoom(row) : null;
}

export function getBooking(db, id) {
  return db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ?`).get(id) ?? null;
}

export function listConfirmedForRoom(db, roomId, from, to) {
  return db
    .prepare(
      `SELECT ${BOOKING_COLUMNS} FROM bookings
       WHERE room_id = ? AND status = 'confirmed' AND start >= ? AND start < ?
       ORDER BY start`
    )
    .all(roomId, from, to);
}

export function listConfirmedForDay(db, from, to, roomId = null) {
  const sql = `SELECT ${BOOKING_COLUMNS} FROM bookings
    WHERE status = 'confirmed' AND start >= ? AND start < ?
    ${roomId === null ? "" : "AND room_id = ?"}
    ORDER BY start, id`;
  const params = roomId === null ? [from, to] : [from, to, roomId];
  return db.prepare(sql).all(...params);
}

export function countConfirmedForOrganizer(db, email, from, to) {
  const { count } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM bookings
       WHERE organizer_email = ? AND status = 'confirmed' AND start >= ? AND start < ?`
    )
    .get(email, from, to);
  return count;
}

export function insertBooking(db, booking) {
  const info = db
    .prepare(
      `INSERT INTO bookings
         (room_id, title, organizer_email, attendees, start, "end", status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`
    )
    .run(
      booking.roomId,
      booking.title,
      booking.organizerEmail,
      booking.attendees,
      booking.start.toISOString(),
      booking.end.toISOString(),
      booking.createdAt
    );
  return getBooking(db, Number(info.lastInsertRowid));
}

export function markCancelled(db, id) {
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
  return getBooking(db, id);
}
