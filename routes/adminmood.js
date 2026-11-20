const express = require("express");
const { Query } = require("../database/db-helper");

const router = express.Router();

const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------
   MOOD GROUPING
   The mood ENUM values are not known here, so they are grouped by keyword.
   ADJUST these patterns to match your real enum values.
   Checked in order: stressed -> happy -> neutral (anything unknown = neutral).
------------------------------------------ */
const STRESSED_RE = /stress|anxi|sad|tired|angry|overwhelm|burn|frustrat|worr|exhaust|unhappy|bad|down|low/i;
const HAPPY_RE = /happy|great|good|excit|joy|energ|motivat|positive|productive|focus/i;

const categoryOf = (mood) => {
  const m = String(mood || "");
  if (STRESSED_RE.test(m)) return "stressed";
  if (HAPPY_RE.test(m)) return "happy";
  return "neutral";
};

// metrics.burnout_risk values that count as "at risk" (ADJUST if needed)
const BURNOUT_RE = "high|severe|critical";

const RANGES = [7, 30, 90];

/* ------------------------------------------
   GET /admindashboard/api/mood?days=30
------------------------------------------ */
router.get(
  "/",
  h(async (req, res) => {
    const requested = Number(req.query.days);
    const days = RANGES.includes(requested) ? requested : 30; // validated number
    const since = `CURDATE() - INTERVAL ${days} DAY`;
    const prevSince = `CURDATE() - INTERVAL ${days * 2} DAY`;

    const [moodRows, trendRows, avgRows, perUser, burnoutRows, logs] =
      await Promise.all([
        Query(
          `SELECT mood, COUNT(*) AS count
             FROM mood_entries
            WHERE local_day >= ${since}
            GROUP BY mood
            ORDER BY count DESC`
        ),
        Query(
          `SELECT DATE_FORMAT(local_day, '%Y-%m-%d') AS day,
                  ROUND(AVG(stress_level), 2) AS stress,
                  ROUND(AVG(workload), 2) AS workload,
                  COUNT(*) AS entries
             FROM mood_entries
            WHERE local_day >= ${since}
            GROUP BY local_day
            ORDER BY local_day`
        ),
        Query(
          `SELECT AVG(CASE WHEN local_day >= ${since} THEN stress_level END) AS cur,
                  AVG(CASE WHEN local_day <  ${since} THEN stress_level END) AS prev
             FROM mood_entries
            WHERE local_day >= ${prevSince}`
        ),
        Query(
          `SELECT m.uid, u.name, u.email, m.mood, COUNT(*) AS count
             FROM mood_entries m
             LEFT JOIN users u ON u.uid = m.uid
            WHERE m.local_day >= ${since}
            GROUP BY m.uid, u.name, u.email, m.mood`
        ),
        Query(
          `SELECT COUNT(DISTINCT uid) AS c
             FROM metrics
            WHERE day >= ${since}
              AND burnout_risk REGEXP '${BURNOUT_RE}'`
        ).catch((err) => {
          console.error("burnout query failed:", err.message);
          return [{ c: 0 }];
        }),
        Query(
          `SELECT m.id, m.mood, m.stress_level, m.workload, m.notes,
                  DATE_FORMAT(m.local_day, '%Y-%m-%d') AS local_day,
                  u.name AS user_name, u.email AS user_email
             FROM mood_entries m
             LEFT JOIN users u ON u.uid = m.uid
            ORDER BY m.local_day DESC, m.created_at DESC
            LIMIT 50`
        ),
      ]);

    // summary cards
    const stats = { happy: 0, neutral: 0, stressed: 0, burnout: 0, total: 0 };
    for (const r of moodRows) {
      stats[categoryOf(r.mood)] += Number(r.count);
      stats.total += Number(r.count);
    }
    stats.burnout = Number((burnoutRows[0] && burnoutRows[0].c) || 0);

    // employees with repeated stressed entries (3+ in the period)
    const stressedBy = new Map();
    for (const r of perUser) {
      if (categoryOf(r.mood) !== "stressed") continue;
      const cur = stressedBy.get(r.uid) || {
        name: r.name || r.email || "Unknown",
        count: 0,
      };
      cur.count += Number(r.count);
      stressedBy.set(r.uid, cur);
    }
    const repeatedStress = [...stressedBy.values()]
      .filter((u) => u.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const num = (v) => (v === null || v === undefined ? null : Number(v));

    res.json({
      days,
      stats,
      distribution: {
        labels: moodRows.map((r) => r.mood),
        values: moodRows.map((r) => Number(r.count)),
      },
      trend: {
        labels: trendRows.map((r) => r.day),
        stress: trendRows.map((r) => Number(r.stress)),
        workload: trendRows.map((r) => Number(r.workload)),
      },
      insights: {
        currentStress: num(avgRows[0] && avgRows[0].cur),
        previousStress: num(avgRows[0] && avgRows[0].prev),
        repeatedStress,
      },
      logs: logs.map((l) => ({ ...l, category: categoryOf(l.mood) })),
    });
  })
);

module.exports = router;