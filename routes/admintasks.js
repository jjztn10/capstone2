const express = require("express");
const crypto = require("crypto");
const { Query } = require("../database/db-helper");

const router = express.Router();
router.use(express.json()); // harmless if already applied upstream

const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------
   PRIORITY: priority_score is numeric, so High/Medium/Low are derived.
   ADJUST to match the scale your app uses.
------------------------------------------ */
const HIGH_MIN = 7;
const MEDIUM_MIN = 4;
const SCORE_FOR = { High: 8, Medium: 5, Low: 2 };

const labelFor = (score) => {
  const s = Number(score) || 0;
  return s >= HIGH_MIN ? "High" : s >= MEDIUM_MIN ? "Medium" : "Low";
};

const httpError = (msg, status = 400) => {
  const err = new Error(msg);
  err.status = status;
  return err;
};

/* ------------------------------------------
   HELPERS
------------------------------------------ */
let statusCache = null;
async function getStatuses() {
  if (statusCache && statusCache.length) return statusCache;
  const rows = await Query(
    `SELECT COLUMN_TYPE AS column_type
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tasks'
        AND COLUMN_NAME = 'status'`
  );
  const type = String((rows[0] && rows[0].column_type) || "");
  statusCache = [...type.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replace(/''/g, "'")
  );
  return statusCache;
}

// Columns this route fills on INSERT
const FILLED = new Set([
  "id", "uid", "title", "description", "subject", "deadline",
  "estimated_hours", "weight", "priority_score", "status",
  "created_at", "updated_at",
]);

// Find NOT NULL columns without a default that the INSERT does not fill,
// so a schema mismatch gives a clear message instead of a vague DB error.
let missingCache = null;
async function assertInsertable() {
  if (missingCache === null) {
    const rows = await Query(
      `SELECT COLUMN_NAME AS col
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tasks'
          AND IS_NULLABLE = 'NO'
          AND COLUMN_DEFAULT IS NULL
          AND EXTRA NOT LIKE '%auto_increment%'
          AND EXTRA NOT LIKE '%GENERATED%'`
    );
    missingCache = rows.map((r) => r.col).filter((c) => !FILLED.has(c));
  }
  if (missingCache.length) {
    throw httpError(
      "The tasks table has required column(s) this form does not fill: " +
        missingCache.join(", ") +
        ". Add them to the INSERT in routes/admintasks.js or give them a default in MySQL.",
      500
    );
  }
}

// "2026-11-20T14:30" -> "2026-11-20 14:30:00"; empty -> null
function parseDeadline(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) throw httpError("Invalid deadline.");
  return `${m[1]} ${m[2]}:${m[3] || "00"}`;
}

function parseNumber(v, label, fallback) {
  if (v === undefined || v === null || String(v).trim() === "") {
    if (fallback !== undefined) return fallback;
    throw httpError(label + " is required.");
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999) {
    throw httpError(label + " must be a number between 0 and 999.");
  }
  return n;
}

async function assertUserExists(uid) {
  const rows = await Query("SELECT uid FROM users WHERE uid = ? LIMIT 1", [uid]);
  if (!rows.length) throw httpError("The selected user does not exist.");
}

/* ------------------------------------------
   GET /meta
------------------------------------------ */
router.get(
  "/meta",
  h(async (req, res) => {
    const [statuses, users] = await Promise.all([
      getStatuses(),
      Query(
        "SELECT uid, name, email FROM users ORDER BY name IS NULL, name, email LIMIT 1000"
      ),
    ]);
    res.json({ statuses, users });
  })
);

/* ------------------------------------------
   GET /
------------------------------------------ */
router.get(
  "/",
  h(async (req, res) => {
    const rows = await Query(`
      SELECT t.id, t.uid, t.title, t.description, t.subject,
             DATE_FORMAT(t.deadline, '%Y-%m-%dT%H:%i') AS deadline,
             t.estimated_hours, t.weight, t.priority_score,
             CASE WHEN t.priority_score >= ${HIGH_MIN} THEN 'High'
                  WHEN t.priority_score >= ${MEDIUM_MIN} THEN 'Medium'
                  ELSE 'Low' END AS priority,
             t.status,
             u.name AS user_name, u.email AS user_email
      FROM tasks t
      LEFT JOIN users u ON u.uid = t.uid
      ORDER BY t.created_at DESC
      LIMIT 500`);
    res.json(rows);
  })
);

/* ------------------------------------------
   POST /
------------------------------------------ */
router.post(
  "/",
  h(async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const uid = String(b.uid || "").trim();
    const description = String(b.description || "").trim() || null;
    const subject = String(b.subject || "").trim() || null;

    if (!title) throw httpError("Task title is required.");
    if (title.length > 255) throw httpError("Title is too long (max 255).");
    if (subject && subject.length > 120) {
      throw httpError("Subject is too long (max 120).");
    }
    if (!uid) throw httpError("Please choose who the task is assigned to.");
    await assertUserExists(uid);
    await assertInsertable();

    const statuses = await getStatuses();
    const status = String(b.status || "").trim() || statuses[0];
    if (!status || (statuses.length && !statuses.includes(status))) {
      throw httpError("Invalid status.");
    }

    const priority = SCORE_FOR[b.priority] !== undefined ? b.priority : "Medium";
    const deadline = parseDeadline(b.deadline);
    const hours = parseNumber(b.estimated_hours, "Estimated hours", 1);
    const weight = parseNumber(b.weight, "Weight", 1);

    const id = crypto.randomUUID();
    await Query(
      `INSERT INTO tasks
         (id, uid, title, description, subject, deadline,
          estimated_hours, weight, priority_score, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, uid, title, description, subject, deadline, hours, weight, SCORE_FOR[priority], status]
    );
    res.status(201).json({ id, title });
  })
);

/* ------------------------------------------
   PUT /:id
------------------------------------------ */
router.put(
  "/:id",
  h(async (req, res) => {
    const b = req.body || {};
    const existing = await Query(
      "SELECT priority_score FROM tasks WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    if (!existing.length) return res.status(404).json({ error: "Task not found." });

    const sets = [];
    const vals = [];

    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title) throw httpError("Task title is required.");
      if (title.length > 255) throw httpError("Title is too long (max 255).");
      sets.push("title = ?");
      vals.push(title);
    }
    if (b.description !== undefined) {
      sets.push("description = ?");
      vals.push(String(b.description).trim() || null);
    }
    if (b.subject !== undefined) {
      const subject = String(b.subject).trim();
      if (subject.length > 120) throw httpError("Subject is too long (max 120).");
      sets.push("subject = ?");
      vals.push(subject || null);
    }
    if (b.uid !== undefined) {
      const uid = String(b.uid).trim();
      if (!uid) throw httpError("Please choose who the task is assigned to.");
      await assertUserExists(uid);
      sets.push("uid = ?");
      vals.push(uid);
    }
    if (b.deadline !== undefined) {
      sets.push("deadline = ?");
      vals.push(parseDeadline(b.deadline));
    }
    if (b.estimated_hours !== undefined) {
      sets.push("estimated_hours = ?");
      vals.push(parseNumber(b.estimated_hours, "Estimated hours", 1));
    }
    if (b.weight !== undefined) {
      sets.push("weight = ?");
      vals.push(parseNumber(b.weight, "Weight", 1));
    }
    if (b.status !== undefined) {
      const status = String(b.status).trim();
      const statuses = await getStatuses();
      if (!status || (statuses.length && !statuses.includes(status))) {
        throw httpError("Invalid status.");
      }
      sets.push("status = ?");
      vals.push(status);
    }
    // only overwrite the score when the label actually changed
    if (b.priority !== undefined && SCORE_FOR[b.priority] !== undefined) {
      if (labelFor(existing[0].priority_score) !== b.priority) {
        sets.push("priority_score = ?");
        vals.push(SCORE_FOR[b.priority]);
      }
    }

    if (!sets.length) return res.json({ success: true, unchanged: true });
    sets.push("updated_at = NOW()");

    await Query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, [
      ...vals,
      req.params.id,
    ]);
    res.json({ success: true });
  })
);

/* ------------------------------------------
   DELETE /:id
------------------------------------------ */
router.delete(
  "/:id",
  h(async (req, res) => {
    const result = await Query("DELETE FROM tasks WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Task not found." });
    res.json({ success: true });
  })
);

module.exports = router;