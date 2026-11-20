const express = require("express");
const { Query } = require("../database/db-helper");

const router = express.Router();
const api = express.Router();

/* ADMIN GUARD
   TODO: replace with your real check from middleware/auth.js, e.g.
   const requireAdmin = (req, res, next) =>
     req.session?.user?.role === "admin" ? next() : res.status(403).json({ error: "Forbidden" });
   Until then these routes are open to anyone who can reach the server. */
const requireAdmin = (req, res, next) => next();
router.use(requireAdmin);

const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

api.use(express.json());

/* ------------------------------------------
   SHARED QUERIES
------------------------------------------ */
async function getStats() {
  const [[u], [t], [m], [s]] = await Promise.all([
    Query("SELECT COUNT(*) AS c FROM users"),
    Query("SELECT COUNT(*) AS c FROM tasks"),
    Query("SELECT COUNT(*) AS c FROM mood_entries"),
    Query("SELECT COUNT(*) AS c FROM study_sessions"),
  ]);
  return {
    totalUsers: u.c,
    totalTasks: t.c,
    totalMoods: m.c,
    totalSessions: s.c,
  };
}

/* ------------------------------------------
   PAGE
------------------------------------------ */
router.get(
  "/",
  h(async (req, res) => {
    const stats = await getStats();
    res.render("pages/admindashboard-page", {
      title: "SmartWork Admin Dashboard",
      user: (req.session && req.session.user) || { name: "Administrator" },
      stats,
    });
  })
);

/* ------------------------------------------
   API: OVERVIEW
------------------------------------------ */
api.get(
  "/overview",
  h(async (req, res) => {
    const [stats, productivity, taskStatus, leaderboard] = await Promise.all([
      getStats(),
      Query(`
        SELECT day,
               ROUND(100 * SUM(tasks_completed) /
                 NULLIF(SUM(tasks_completed) + SUM(tasks_pending), 0), 1) AS productivity
        FROM metrics
        WHERE day >= CURDATE() - INTERVAL 6 DAY
        GROUP BY day
        ORDER BY day`),
      Query("SELECT status, COUNT(*) AS count FROM tasks GROUP BY status"),
      Query(`
        SELECT uid, name, email, total_points, weekly_points, study_streak
        FROM users
        ORDER BY total_points DESC
        LIMIT 10`),
    ]);

    res.json({
      stats,
      productivity: {
        labels: productivity.map((r) => r.day),
        values: productivity.map((r) => Number(r.productivity) || 0),
      },
      taskStatus: {
        labels: taskStatus.map((r) => r.status),
        values: taskStatus.map((r) => r.count),
      },
      leaderboard,
    });
  })
);

/* ------------------------------------------
   API: USERS + TASKS (separate files)
------------------------------------------ */
api.use("/users", require("./adminuser"));
api.use("/tasks", require("./admintasks"));
api.use("/mood", require("./adminmood"));
api.use("/sessions", require("./adminsessions"));

/* ------------------------------------------
   API: MOOD / SESSIONS
------------------------------------------ */
api.get(
  "/mood",
  h(async (req, res) => {
    res.json(
      await Query(`
        SELECT m.id, m.mood, m.stress_level, m.workload, m.notes, m.local_day,
               u.name AS user_name, u.email AS user_email
        FROM mood_entries m
        LEFT JOIN users u ON u.uid = m.uid
        ORDER BY m.created_at DESC
        LIMIT 500`)
    );
  })
);

api.get(
  "/sessions",
  h(async (req, res) => {
    res.json(
      await Query(`
        SELECT s.id, s.session_date, s.duration_minutes, s.started_at, s.ended_at,
               u.name AS user_name, u.email AS user_email
        FROM study_sessions s
        LEFT JOIN users u ON u.uid = s.uid
        ORDER BY s.created_at DESC
        LIMIT 500`)
    );
  })
);

/* ------------------------------------------
   API ERROR HANDLER (JSON)
------------------------------------------ */
api.use((err, req, res, next) => {
  if (err.code === "ER_DUP_ENTRY") {
    const msg = String(err.sqlMessage || "");
    return res.status(409).json({
      error: /email/i.test(msg)
        ? "A user with that email already exists."
        : "That user ID already exists.",
    });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

router.use("/api", api);

module.exports = router;