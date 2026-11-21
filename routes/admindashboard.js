const express = require("express");
const { Query } = require("../database/db-helper");

const router = express.Router();
const api = express.Router();

/* ------------------------------------------
   ADMIN GUARD
------------------------------------------ */
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
   LEADERBOARD
------------------------------------------ */
/* ------------------------------------------
   LEADERBOARD
------------------------------------------ */
async function getLeaderboard() {
  return await Query(`
    SELECT
      u.uid,
      u.name,
      u.email,

      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS tasksCompleted,

      IFNULL(u.total_points, 0) AS total_points,
      IFNULL(u.weekly_points, 0) AS weekly_points,
      IFNULL(u.study_streak, 0) AS study_streak,

      ROUND(
        (
          IFNULL(u.total_points, 0)
          +
          (COUNT(CASE WHEN t.status = 'completed' THEN 1 END) * 10)
          +
          (IFNULL(u.study_streak, 0) * 5)
          +
          IFNULL(u.weekly_points, 0)
        ) / 10,
        1
      ) AS score

    FROM users u

    LEFT JOIN tasks t
      ON t.uid = u.uid

    GROUP BY
      u.uid,
      u.name,
      u.email,
      u.total_points,
      u.weekly_points,
      u.study_streak

    ORDER BY
      score DESC,
      total_points DESC,
      tasksCompleted DESC,
      study_streak DESC
  `);
}

/* ------------------------------------------
   PAGE
------------------------------------------ */
router.get(
  "/",
  h(async (req, res) => {

    const [stats, leaderboard] = await Promise.all([
      getStats(),
      getLeaderboard(),
    ]);

    const leaderboardStats = {
      averageScore:
        leaderboard.length > 0
          ? (
              leaderboard.reduce(
                (sum, row) => sum + Number(row.score || 0),
                0
              ) / leaderboard.length
            ).toFixed(1)
          : 0,
    };

    res.render("pages/admindashboard-page", {
      title: "SmartWork Admin Dashboard",
      user: req.session?.user || {
        name: "Administrator",
      },
      stats,
      leaderboard,
      leaderboardStats,
    });
  })
);

/* ------------------------------------------
   API : OVERVIEW
------------------------------------------ */
api.get(
  "/overview",
  h(async (req, res) => {

    const [
    stats,
    productivity,
    taskStatus,
    leaderboard
] = await Promise.all([
    getStats(),

    Query(`
        SELECT
            day,
            ROUND(
                100 * SUM(tasks_completed) /
                NULLIF(SUM(tasks_completed)+SUM(tasks_pending),0),
                1
            ) AS productivity
        FROM metrics
        WHERE day >= CURDATE() - INTERVAL 6 DAY
        GROUP BY day
        ORDER BY day
    `),

    Query(`
        SELECT
            status,
            COUNT(*) AS count
        FROM tasks
        GROUP BY status
    `),

    getLeaderboard()
]);

    res.json({
      stats,

      productivity: {
        labels: productivity.map(r => r.day),
        values: productivity.map(r => Number(r.productivity) || 0),
      },

      taskStatus: {
        labels: taskStatus.map(r => r.status),
        values: taskStatus.map(r => r.count),
      },

      leaderboard,
    });
  })
);

/* ------------------------------------------
   MODULE ROUTES
------------------------------------------ */
api.use("/users", require("./adminuser"));
api.use("/tasks", require("./admintasks"));
api.use("/mood", require("./adminmood"));
api.use("/sessions", require("./adminsessions"));
api.use("/leaderboard", require("./adminleaderboard"));

/* ------------------------------------------
   MOOD API
------------------------------------------ */
api.get(
  "/mood",
  h(async (req, res) => {

    const rows = await Query(`
      SELECT
        m.id,
        m.mood,
        m.stress_level,
        m.workload,
        m.notes,
        m.local_day,
        u.name AS user_name,
        u.email AS user_email
      FROM mood_entries m
      LEFT JOIN users u
        ON u.uid = m.uid
      ORDER BY m.created_at DESC
      LIMIT 500
    `);

    res.json(rows);
  })
);

/* ------------------------------------------
   SESSIONS API
------------------------------------------ */
api.get(
  "/sessions",
  h(async (req, res) => {
    const rows = await Query(`
      SELECT
        s.id,
        s.session_date,
        s.duration_minutes,
        s.started_at,
        s.ended_at,
        u.name AS user_name,
        u.email AS user_email
      FROM study_sessions s
      LEFT JOIN users u
        ON u.uid = s.uid
      ORDER BY s.created_at DESC
      LIMIT 500
    `);

    res.json(rows);
  })
);

/* ------------------------------------------
   API ERROR HANDLER
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

  res.status(err.status || 500).json({
    error: err.message || "Server error",
  });
});

router.use("/api", api);

module.exports = router;