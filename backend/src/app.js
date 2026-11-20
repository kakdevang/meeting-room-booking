// HTTP layer: routing and error formatting only.
import express from "express";
import { fileURLToPath } from "node:url";
import { RuleError } from "./rules.js";
import { createBookingService } from "./service.js";

const FRONTEND_DIR = fileURLToPath(new URL("../../frontend", import.meta.url));

export function createApp(db, { now = () => new Date() } = {}) {
  const service = createBookingService(db, now);
  const app = express();
  app.use(express.json());

  const handle = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  app.get("/api/rooms", handle((req, res) => res.json(service.listRooms())));

  app.get("/api/bookings", handle((req, res) => res.json(service.listBookings(req.query))));

  app.post(
    "/api/bookings",
    handle((req, res) => res.status(201).json(service.createBooking(req.body)))
  );

  app.delete("/api/bookings/:id", handle((req, res) => res.json(service.cancelBooking(req.params.id))));

  app.get("/api/availability", handle((req, res) => res.json(service.availability(req.query))));

  app.use("/api", (req, res, next) => next(new RuleError(404, "NOT_FOUND", "Route not found.")));

  app.use(express.static(FRONTEND_DIR));

  app.use((err, req, res, next) => {
    if (err instanceof RuleError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({
        error: { code: "INVALID_JSON", message: "Request body is not valid JSON.", details: {} },
      });
    }
    console.error(err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error.", details: {} },
    });
  });

  return app;
}
