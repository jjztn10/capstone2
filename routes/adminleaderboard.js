
const express = require("express");
const { Query } = require("../database/config/db");

const router = express.Router();

/* ==========================================
   ASYNC HANDLER
========================================== */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/* ==========================================
   GET LEADERBOARD
   GET /admindashboard/api/leaderboard
========================================== */
router.get("/", asyncHandler(async (req, res) => {

    const rows = await Query(`
        SELECT
            u.uid,
            u.name,
            u.email,
            IFNULL(u.total_points, 0) AS total_points,
            IFNULL(u.weekly_points, 0) AS weekly_points,
            IFNULL(u.study_streak, 0) AS study_streak,

            COUNT(
                CASE
                    WHEN t.status = 'completed' THEN 1
                END
            ) AS tasks_completed,

            ROUND(
                (
                    IFNULL(u.total_points, 0)
                    + IFNULL(u.weekly_points, 0)
                    + (
                        COUNT(
                            CASE
                                WHEN t.status = 'completed' THEN 1
                            END
                        ) * 10
                    )
                    + (IFNULL(u.study_streak, 0) * 5)
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
            tasks_completed DESC,
            study_streak DESC,
            u.name ASC
    `);

    const leaderboard = rows.map((row, index) => ({
        rank: index + 1,
        uid: row.uid,
        name: row.name,
        email: row.email,
        score: Number(row.score) || 0,
        totalPoints: Number(row.total_points) || 0,
        weeklyPoints: Number(row.weekly_points) || 0,
        tasksCompleted: Number(row.tasks_completed) || 0,
        studyStreak: Number(row.study_streak) || 0
    }));

    const totalParticipants = leaderboard.length;

    const averageScore = totalParticipants
        ? leaderboard.reduce((total, user) => total + user.score, 0)
            / totalParticipants
        : 0;

    const topPerformer = leaderboard.length
        ? leaderboard[0].name || leaderboard[0].email
        : "---";

    const highestScore = leaderboard.length
        ? leaderboard[0].score
        : 0;

    res.json({
        success: true,
        leaderboard,
        stats: {
            totalParticipants,
            averageScore: Number(averageScore.toFixed(1)),
            topPerformer,
            highestScore
        }
    });
}));

module.exports = router;
