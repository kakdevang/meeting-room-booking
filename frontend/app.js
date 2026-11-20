const $ = (id) => document.getElementById(id);
const hhmm = (iso) => iso.slice(11, 16);
const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

let rooms = [];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status}).`);
  return body;
}

function setStatus(id, message, isError = false) {
  const node = $(id);
  node.textContent = message;
  node.className = isError ? "error" : "";
}

async function loadDay() {
  const date = $("day-date").value;
  if (!date) return;
  setStatus("day-status", "Loading bookings…");
  try {
    const bookings = await api(`/api/bookings?date=${date}`);
    renderSchedule(bookings);
    setStatus(
      "day-status",
      bookings.length === 0 ? `No bookings on ${date} (UTC).` : `${bookings.length} booking(s) on ${date} (UTC).`
    );
  } catch (err) {
    $("schedule").replaceChildren();
    setStatus("day-status", `Could not load bookings: ${err.message}`, true);
  }
}

function renderSchedule(bookings) {
  const cards = rooms.map((room) => {
    const mine = bookings.filter((b) => b.roomId === room.id);
    const content = mine.length
      ? el("ul", {}, ...mine.map(bookingItem))
      : el("p", { class: "empty", text: "No bookings." });
    return el(
      "article",
      { class: "room" },
      el("h3", { text: `${room.name} (capacity ${room.capacity}, floor ${room.floor})` }),
      content
    );
  });
  $("schedule").replaceChildren(...cards);
}

function bookingItem(b) {
  const label = `${hhmm(b.start)} to ${hhmm(b.end)} UTC`;
  return el(
    "li",
    {},
    el("span", { text: `${label}: ${b.title} (${b.organizerEmail}, ${b.attendees} attendees)` }),
    el("button", {
      type: "button",
      "aria-label": `Cancel booking ${b.title}, ${label}`,
      text: "Cancel",
      onclick: () => cancelBooking(b),
    })
  );
}

async function cancelBooking(b) {
  if (!confirm(`Cancel "${b.title}" (${hhmm(b.start)} to ${hhmm(b.end)} UTC)?`)) return;
  try {
    await api(`/api/bookings/${b.id}`, { method: "DELETE" });
    await loadDay();
  } catch (err) {
    setStatus("day-status", `Could not cancel: ${err.message}`, true);
  }
}


function readForm() {
  return {
    roomId: Number($("room").value),
    title: $("title").value.trim(),
    email: $("email").value.trim(),
    attendees: Number($("attendees").value),
    date: $("book-date").value,
    start: $("book-start").value,
    end: $("book-end").value,
  };
}

function validateForm(v) {
  const errors = [];
  if (!v.roomId) errors.push("Choose a room.");
  if (v.title.length < 1 || v.title.length > 100) errors.push("Title must be 1 to 100 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.push("Enter a valid organizer email.");

  const room = rooms.find((r) => r.id === v.roomId);
  if (!Number.isInteger(v.attendees) || v.attendees < 1) {
    errors.push("Attendees must be a whole number of at least 1.");
  } else if (room && v.attendees > room.capacity) {
    errors.push(`${room.name} fits ${room.capacity} people.`);
  }

  if (!v.date || !v.start || !v.end) {
    errors.push("Choose a date, a start time and an end time (UTC).");
    return errors;
  }
  const s = toMinutes(v.start);
  const e = toMinutes(v.end);
  if (e <= s) errors.push("End must be after start.");
  else if (s % 15 !== 0 || e % 15 !== 0) errors.push("Times must be on 15-minute boundaries.");
  else if (e - s > 240) errors.push("A booking can last at most 4 hours.");
  if (s < 8 * 60 || e > 20 * 60) errors.push("Bookings must be within 08:00 to 20:00 UTC.");
  if (new Date(`${v.date}T${v.start}:00Z`) < new Date()) errors.push("A booking cannot start in the past.");
  return errors;
}

function showFormErrors(errors) {
  const box = $("form-errors");
  $("form-success").textContent = "";
  if (errors.length === 0) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(el("ul", {}, ...errors.map((message) => el("li", { text: message }))));
  box.focus();
}

$("booking-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const v = readForm();
  const errors = validateForm(v);
  showFormErrors(errors);
  if (errors.length > 0) return;

  const button = $("submit-booking");
  button.disabled = true;
  try {
    await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        roomId: v.roomId,
        title: v.title,
        organizerEmail: v.email,
        attendees: v.attendees,
        start: `${v.date}T${v.start}:00Z`,
        end: `${v.date}T${v.end}:00Z`,
      }),
    });
    $("day-date").value = v.date;
    await loadDay();
    $("form-success").textContent = `Booked ${v.start} to ${v.end} UTC on ${v.date}.`;
  } catch (err) {
    showFormErrors([err.message]);
  } finally {
    button.disabled = false;
  }
});


$("find-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const date = $("find-date").value;
  const start = $("find-start").value;
  const end = $("find-end").value;
  const minCapacity = $("find-capacity").value || "1";
  $("find-results").replaceChildren();

  if (!date || !start || !end) {
    setStatus("find-status", "Choose a date, a start time and an end time (UTC).", true);
    return;
  }
  setStatus("find-status", "Searching…");
  try {
    const params = new URLSearchParams({ date, start, end, minCapacity });
    const found = await api(`/api/availability?${params}`);
    if (found.length === 0) {
      setStatus("find-status", "No rooms are free for that window.");
      return;
    }
    setStatus("find-status", `${found.length} room(s) free from ${start} to ${end} UTC, best fit first.`);
    $("find-results").replaceChildren(
      ...found.map((room) => {
        const amenities = room.amenities.length ? room.amenities.join(", ") : "no amenities";
        return el(
          "li",
          {},
          el("span", { text: `${room.name}: capacity ${room.capacity}, floor ${room.floor}, ${amenities}` }),
          el("button", {
            type: "button",
            "aria-label": `Book ${room.name}`,
            text: "Book",
            onclick: () => startBooking(room, date, start, end),
          })
        );
      })
    );
  } catch (err) {
    setStatus("find-status", `Search failed: ${err.message}`, true);
  }
});

function startBooking(room, date, start, end) {
  $("room").value = String(room.id);
  $("book-date").value = date;
  $("book-start").value = start;
  $("book-end").value = end;
  $("booking-form").scrollIntoView();
  $("title").focus();
}


async function init() {
  const today = new Date().toISOString().slice(0, 10);
  for (const id of ["day-date", "book-date", "find-date"]) $(id).value = today;
  $("day-date").addEventListener("change", loadDay);

  setStatus("day-status", "Loading rooms…");
  try {
    rooms = await api("/api/rooms");
    $("room").append(...rooms.map((r) => el("option", { value: r.id, text: `${r.name} (capacity ${r.capacity})` })));
    await loadDay();
  } catch (err) {
    setStatus("day-status", `Could not load rooms: ${err.message}`, true);
  }
}

init();
