import { createDb } from "./db.js";

const db = createDb(process.env.DB_PATH ?? "bookings.db");
console.log(db.prepare("SELECT id, name, capacity FROM rooms").all());
