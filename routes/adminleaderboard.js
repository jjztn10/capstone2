const express = require("express");
const crypto = require("crypto");
const { Query } = require("../database/db-helper");

const router = express.Router();

router.get("/", async (req, res) => {

    const leaderboard = await getLeaderboard();

    const leaderboardStats = {
        averageScore:
            leaderboard.length > 0
                ? (
                    leaderboard.reduce(
                        (sum, r) => sum + Number(r.score || 0),
                        0
                    ) / leaderboard.length
                ).toFixed(1)
                : 0
    };

    res.render("pages/admindashboard-page", {
        leaderboard,
        leaderboardStats
    });

});

module.exports = router;