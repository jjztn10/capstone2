// middleware/session-lock.js
//
// While a study session is running, every other /userdashboard PAGE
// sends the user back to the session page. Stop Session lifts it.
//
// In app.js, mount it BEFORE the userdashboard routers:
//
//   const lockWhileStudying = require("./middleware/session-lock");
//   app.use("/userdashboard", lockWhileStudying);
//   app.use("/userdashboard", tasksRoutes);     // your existing lines
//   app.use("/userdashboard", sessionRoutes);

const path = require("path");
const { Query } = require("../database/db-helper");
const { getUid } = require("./current-user");

// paths (relative to /userdashboard) that stay open during a session
const ALLOWED = [
    /^\/session(\/|$)/,   // the session page itself
    /^\/api\//,           // all API calls (start/stop/list...)
    /^\/logout/           // adjust if your logout lives elsewhere
];

module.exports = async function lockWhileStudying(req, res, next) {
    try {
        if (req.method !== "GET") return next();
        if (path.extname(req.path)) return next();                 // css / js / images
        if (ALLOWED.some(rx => rx.test(req.path))) return next();

        const rows = await Query(`
            SELECT 1
            FROM study_sessions
            WHERE uid = ? AND ended_at IS NULL
            LIMIT 1
        `, [getUid(req)]);

        if (rows.length) {
            return res.redirect("/userdashboard/session?locked=1");
        }

        next();
    } catch (err) {
        // if the check fails, never lock people out
        console.error("session-lock:", err.message);
        next();
    }
};