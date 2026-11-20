const express = require("express");
const crypto = require("crypto");
const { Query } = require("../database/db-helper");

const router = express.Router();
router.use(express.json());

const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const httpError = (msg, status = 400) => {
  const err = new Error(msg);
  err.status = status;
  return err;
};

const RANGES = [7, 30, 90, 0]; // 0 = all time

/* ------------------------------------------
   STATUS (time based)
   Completed: ended_at has passed
   Upcoming : not started yet (start in the future, or no start time)
   Active   : started, and not ended yet
------------------------------------------ */
const STATUS_SQL = `CASE
    WHEN s.ended_at IS NOT NULL AND s.ended_at <= ? THEN 'Completed'
    WHEN s.started_at IS NULL OR s.started_at > ? THEN 'Upcoming'
    ELSE 'Active' END`;

// "now" comes from the browser (local time) so it matches what the admin sees
function nowString(req) {
  const m = String(req.query.now || "").match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/
  );
  if (m) return `${m[1]} ${m[2]}:00`;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:00`;
}

/* ------------------------------------------
   HELPERS
------------------------------------------ */
const FILLED = new Set([
  "id", "uid", "duration_minutes", "session_date",
  "started_at", "ended_at", "created_at",
]);

let missingCache = null;
async function assertInsertable() {
  if (missingCache === null) {
    const rows = await Query(
      `SELECT COLUMN_NAME AS col
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'study_sessions'
          AND IS_NULLABLE = 'NO'
          AND COLUMN_DEFAULT IS NULL
          AND EXTRA NOT LIKE '%auto_increment%'
          AND EXTRA NOT LIKE '%GENERATED%'`
    );
    missingCache = rows.map((r) => r.col).filter((c) => !FILLED.has(c));
  }
  if (missingCache.length) {
    throw httpError(
      "The study_sessions table has required column(s) this form does not fill: " +
        missingCache.join(", ") +
        ". Add them to the INSERT in routes/adminsessions.js or give them a default in MySQL.",
      500
    );
  }
}

function parseDateTime(v, label) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) throw httpError("Invalid " + label + ".");
  return `${m[1]} ${m[2]}:${m[3] || "00"}`;
}

const toDate = (s) => new Date(s.replace(" ", "T"));

function build(b) {
  const started = parseDateTime(b.started_at, "start time");
  const ended = parseDateTime(b.ended_at, "end time");

  let day = String(b.session_date || "").trim();
  if (!day && started) day = started.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw httpError("Session date is required.");
  }

  if (ended && !started) {
    throw httpError("Please enter a start time before an end time.");
  }
  if (started && ended && toDate(ended) < toDate(started)) {
    throw httpError("End time cannot be before start time.");
  }

  let minutes;
  const raw = b.duration_minutes;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 9999) {
      throw httpError("Duration must be between 0 and 9999 minutes.");
    }
  } else if (started && ended) {
    minutes = (toDate(ended) - toDate(started)) / 60000;
  } else {
    minutes = 0;
  }

  return { day, started, ended, minutes: Math.round(minutes * 100) / 100 };
}

async function assertUserExists(uid) {
  const rows = await Query("SELECT uid FROM users WHERE uid = ? LIMIT 1", [uid]);
  if (!rows.length) throw httpError("The selected user does not exist.");
}

/* ------------------------------------------
   GET /admindashboard/api/sessions/meta
------------------------------------------ */
router.get(
  "/meta",
  h(async (req, res) => {
    const users = await Query(
      "SELECT uid, name, email FROM users ORDER BY name IS NULL, name, email LIMIT 1000"
    );
    res.json({ users });
  })
);

/* ------------------------------------------
   GET /admindashboard/api/sessions?days=30&now=YYYY-MM-DDTHH:mm
------------------------------------------ */
router.get(
  "/",
  h(async (req, res) => {
    const requested = Number(req.query.days);
    const days = RANGES.includes(requested) ? requested : 30; // validated number
    const sWhere = days ? `s.session_date >= CURDATE() - INTERVAL ${days} DAY` : "1=1";
    const mWhere = days ? `day >= CURDATE() - INTERVAL ${days} DAY` : "1=1";
    const now = nowString(req);

    const [rows, agg, prod] = await Promise.all([
      Query(
        `SELECT s.id, s.uid, s.duration_minutes,
                DATE_FORMAT(s.session_date, '%Y-%m-%d') AS session_date,
                DATE_FORMAT(s.started_at, '%Y-%m-%dT%H:%i') AS started_at,
                DATE_FORMAT(s.ended_at, '%Y-%m-%dT%H:%i') AS ended_at,
                ${STATUS_SQL} AS status,
                u.name AS user_name, u.email AS user_email
           FROM study_sessions s
           LEFT JOIN users u ON u.uid = s.uid
          WHERE ${sWhere}
          ORDER BY COALESCE(s.started_at, s.created_at) DESC
          LIMIT 500`,
        [now, now]
      ),
      Query(
        `SELECT SUM(x.st = 'Active') AS active,
                SUM(x.st = 'Completed') AS completed,
                SUM(x.st = 'Upcoming') AS upcoming,
                COUNT(*) AS total,
                AVG(CASE WHEN x.st = 'Completed' THEN x.duration_minutes END) AS avg_min
           FROM (
             SELECT s.duration_minutes, ${STATUS_SQL} AS st
               FROM study_sessions s
              WHERE ${sWhere}
           ) x`,
        [now, now]
      ),
      Query(
        `SELECT SUM(tasks_completed) AS c, SUM(tasks_pending) AS p
           FROM metrics
          WHERE ${mWhere}`
      ).catch((err) => {
        console.error("productivity query failed:", err.message);
        return [{ c: 0, p: 0 }];
      }),
    ]);

    const a = agg[0] || {};
    const c = Number((prod[0] && prod[0].c) || 0);
    const p = Number((prod[0] && prod[0].p) || 0);

    res.json({
      days,
      stats: {
        active: Number(a.active || 0),
        completed: Number(a.completed || 0),
        upcoming: Number(a.upcoming || 0),
        total: Number(a.total || 0),
        averageHours: Math.round((Number(a.avg_min || 0) / 60) * 100) / 100,
        productivity: c + p > 0 ? Math.round((1000 * c) / (c + p)) / 10 : 0,
      },
      sessions: rows,
    });
  })
);

/* ------------------------------------------
   POST /admindashboard/api/sessions
------------------------------------------ */
router.post(
  "/",
  h(async (req, res) => {
    const b = req.body || {};
    const uid = String(b.uid || "").trim();
    if (!uid) throw httpError("Please choose a student.");
    await assertUserExists(uid);
    await assertInsertable();

    const { day, started, ended, minutes } = build(b);
    const id = crypto.randomUUID();

    await Query(
      `INSERT INTO study_sessions
         (id, uid, duration_minutes, session_date, started_at, ended_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [id, uid, minutes, day, started, ended]
    );
    res.status(201).json({ id });
  })
);

/* ------------------------------------------
   PUT /admindashboard/api/sessions/:id
------------------------------------------ */
router.put(
  "/:id",
  h(async (req, res) => {
    const b = req.body || {};
    const existing = await Query(
      "SELECT uid FROM study_sessions WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    if (!existing.length) return res.status(404).json({ error: "Session not found." });

    const uid = String(b.uid || "").trim() || existing[0].uid;
    await assertUserExists(uid);

    const { day, started, ended, minutes } = build(b);
    await Query(
      `UPDATE study_sessions
          SET uid = ?, duration_minutes = ?, session_date = ?,
              started_at = ?, ended_at = ?
        WHERE id = ?`,
      [uid, minutes, day, started, ended, req.params.id]
    );
    res.json({ success: true });
  })
);

/* ------------------------------------------
   DELETE /admindashboard/api/sessions/:id
------------------------------------------ */
router.delete(
  "/:id",
  h(async (req, res) => {
    const result = await Query("DELETE FROM study_sessions WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Session not found." });
    res.json({ success: true });
  })
);

module.exports = router;