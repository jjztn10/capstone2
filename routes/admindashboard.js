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
   RECOMMENDED ASSIGNEE : scoring
   Fit = 35% workload + 25% low stress
       + 25% on-time history + 15% subject experience
------------------------------------------ */
const DONE = `COALESCE(LOWER(status), '') IN ('completed', 'done')`;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

async function rankTeam({ subject, effort, priority, deadline }) {
  let daysLeft = null;
  if (deadline) {
    const d = new Date(deadline);
    if (!isNaN(d)) daysLeft = Math.ceil((d - Date.now()) / 86400000);
  }

  // add  WHERE role = 'user'  here if admins should not be ranked
  const users = await Query(`SELECT uid, name FROM users`);
  if (!users.length) return [];

  const taskRows = await Query(
    `
    SELECT
      uid,
      SUM(CASE WHEN ${DONE} THEN 0 ELSE 1 END) AS openTasks,
      SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) AS doneTasks,
      SUM(CASE WHEN NOT (${DONE}) AND deadline < NOW()
               THEN 1 ELSE 0 END) AS lateTasks,
      SUM(CASE WHEN ${DONE} AND LOWER(TRIM(subject)) = LOWER(?)
               THEN 1 ELSE 0 END) AS subjectDone
    FROM tasks
    GROUP BY uid
  `,
    [subject],
  );
  const tasks = new Map(taskRows.map((r) => [String(r.uid), r]));

  // average stress over the last 7 days (optional: skipped if it fails)
  const stress = new Map();
  let stressMax = 5;
  try {
    const moodRows = await Query(`
      SELECT uid, AVG(stress_level) AS stress
      FROM mood_entries
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY uid
    `);
    moodRows.forEach((r) => stress.set(String(r.uid), Number(r.stress)));

    // handle both 1-5 and 1-10 stress scales
    const [mx] = await Query(`SELECT MAX(stress_level) AS mx FROM mood_entries`);
    stressMax = Number(mx?.mx) > 5 ? 10 : 5;
  } catch (e) {
    console.warn("Recommend: mood data unavailable:", e.code || e.message);
  }

  const prioMult = { Low: 1, Medium: 1.15, High: 1.3 }[priority];

  return users
    .map((u) => {
      const key = String(u.uid);
      const t = tasks.get(key) || {};

      const open = Number(t.openTasks) || 0;
      const done = Number(t.doneTasks) || 0;
      const late = Number(t.lateTasks) || 0;
      const subjDone = Number(t.subjectDone) || 0;
      const st = stress.has(key) ? stress.get(key) : null;

      // on-time rate: finished vs. currently overdue
      const onTimeRate =
        done + late > 0 ? Math.round((done / (done + late)) * 100) : null;

      const workload = clamp(100 - open * (6 + effort * 2) * prioMult);
      const stressScore =
        st == null ? 60 : clamp(((stressMax - st) / (stressMax - 1)) * 100);
      const onTime = onTimeRate == null ? 70 : onTimeRate;
      const experience = subject ? clamp(subjDone * 34) : 50;

      const fit = Math.round(
        workload * 0.35 +
          stressScore * 0.25 +
          onTime * 0.25 +
          experience * 0.15,
      );

      // chance of being late (0..1), only when a deadline is given
      let lateRisk = null;
      if (daysLeft != null) {
        const needed = effort + open * 0.5;
        const squeeze = clamp(
          (needed - Math.max(daysLeft, 0.5)) / needed,
          0,
          1,
        );
        lateRisk = clamp(0.1 + (1 - onTime / 100) * 0.4 + squeeze * 0.5, 0, 0.95);
        lateRisk = Math.round(lateRisk * 100) / 100;
      }

      const reasons = [];
      const warnings = [];

      if (open <= 2) reasons.push("Light workload");
      if (open >= 6) warnings.push(open + " open tasks");
      if (st != null && stressScore >= 70) reasons.push("Low stress");
      if (st != null && stressScore < 40) warnings.push("High stress lately");
      if (onTimeRate != null && onTimeRate >= 80)
        reasons.push("Reliable on deadlines");
      if (onTimeRate != null && onTimeRate < 50) warnings.push("Often late");
      if (subject && subjDone > 0) reasons.push("Has done " + subject + " tasks");
      if (late > 0) warnings.push(late + " overdue now");
      if (!reasons.length) reasons.push("Available");

      return {
        uid: u.uid,
        name: u.name || "User " + u.uid,
        fit,
        openTasks: open,
        stress: st == null ? null : Math.round(st * 10) / 10,
        onTimeRate,
        lateRisk,
        reasons,
        warnings,
      };
    })
    .sort((a, b) => b.fit - a.fit);
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
                0,
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
  }),
);

/* ------------------------------------------
   API : OVERVIEW
------------------------------------------ */
api.get(
  "/overview",
  h(async (req, res) => {
    const [stats, productivity, taskStatus, leaderboard] = await Promise.all([
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

      getLeaderboard(),
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
  }),
);

/* ------------------------------------------
   API : RECOMMENDED ASSIGNEE
------------------------------------------ */
api.post(
  "/team/recommend",
  h(async (req, res) => {
    const body = req.body || {};

    const subject = String(body.subject || "").trim().slice(0, 120);
    const effort = clamp(Math.round(Number(body.effort) || 3), 1, 5);
    const priority = ["Low", "Medium", "High"].includes(body.priority)
      ? body.priority
      : "Medium";

    const ranked = await rankTeam({
      subject,
      effort,
      priority,
      deadline: body.deadline || null,
    });

    res.set("Cache-Control", "no-store");
    res.json({ ranked });
  }),
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
  }),
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
  }),
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