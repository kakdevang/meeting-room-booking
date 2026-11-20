import { createDb } from "./db.js";
import { createApp } from "./app.js";

const db = createDb(process.env.DB_PATH ?? "bookings.db");
const port = Number(process.env.PORT ?? 3000);

createApp(db).listen(port, () => {
  console.log(`Meeting room booking running at http://localhost:${port}`);
});
