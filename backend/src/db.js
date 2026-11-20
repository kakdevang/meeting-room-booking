import Database from "better-sqlite3";

export function createDb(path = "bookings.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL,
      floor INTEGER NOT NULL,
      amenities TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      title TEXT NOT NULL,
      organizer_email TEXT NOT NULL,
      attendees INTEGER NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_room_start ON bookings(room_id, start);
  `);

  seedRooms(db);
  return db;
}

function seedRooms(db) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM rooms").get();
  if (count > 0) return;

  const rooms = [
    ["Atlas", 4, 1, ["monitor"]],
    ["Borealis", 8, 1, ["projector", "whiteboard"]],
    ["Cascade", 12, 2, ["projector", "video-conferencing"]],
    ["Delta", 20, 3, ["projector", "video-conferencing", "whiteboard"]],
    ["Ember", 2, 2, []],
  ];

  const insert = db.prepare(
    "INSERT INTO rooms (name, capacity, floor, amenities) VALUES (?, ?, ?, ?)"
  );
  const seedAll = db.transaction(() => {
    for (const [name, capacity, floor, amenities] of rooms) {
      insert.run(name, capacity, floor, JSON.stringify(amenities));
    }
  });
  seedAll();
}
