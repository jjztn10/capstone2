// ==========================================
// LOAD ENVIRONMENT VARIABLES FIRST
// ==========================================
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, ".env"),
});

// ==========================================
// IMPORTS
// ==========================================
const express = require("express");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const expressLayouts = require("express-ejs-layouts");

const { testConnection } = require("./database/config/db");
const { initSession } = require("./middleware/session");
const dashboardRoutes = require("./routes/dashboard");
const tasksRoutes = require("./routes/tasks");
const sessionRoutes = require("./routes/session");
const moodRoutes = require("./routes/mood");
const analyticsRoutes = require("./routes/analytics");
const leaderboardRoutes = require("./routes/leaderboard");
const profileRoutes = require("./routes/profile");

// ==========================================
// APP INITIALIZATION
// ==========================================
const app = express();

// ==========================================
// VIEW ENGINE
// ==========================================
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// ==========================================
// LAYOUTS
// ==========================================
app.use(expressLayouts);
app.set("layout", "layout/main-layout");
app.set("layout extractScripts", false);
app.set("layout extractStyles", false);

// ==========================================
// GENERAL MIDDLEWARE
// ==========================================
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==========================================
// SESSION MIDDLEWARE
// Use middleware/session.js as the only
// session configuration source.
// ==========================================
initSession(app);

// ==========================================
// STATIC FILES
// ==========================================
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// VIEW LOCALS (available in every EJS view)
// - currentPath: used by the sidebar for active links
// - layoutType:  fallback only; values passed to
//   res.render() override these defaults
// ==========================================
app.use((req, res, next) => {
    res.locals.currentPath = req.originalUrl;

    if (req.path.startsWith("/admin")) {
        res.locals.layoutType = "admin";
    } else if (req.path.startsWith("/userdashboard")) {
        res.locals.layoutType = "user";
    }

    next();
});

console.log("ENV FILE:", path.resolve(__dirname, ".env"));
console.log("SESSION_SECRET loaded:", Boolean(process.env.SESSION_SECRET));
console.log("MONGODB_URL loaded:", Boolean(process.env.MONGODB_URL));

// ==========================================
// DATABASE CONNECTION TEST
// ==========================================
testConnection()
    .then(() => {
        console.log("✅ MySQL connection established.");
    })
    .catch((err) => {
        console.error("❌ Database connection failed:", err.message);
    });

// ==========================================
// ROUTES
// ==========================================
const indexRouter = require("./routes/index");
const adminDashboardRouter = require("./routes/admindashboard");
const adminLeaderboardRouter = require("./routes/adminleaderboard");

// Validate routers
if (typeof indexRouter !== "function") {
    throw new Error("routes/index.js must export an Express router.");
}

if (typeof adminDashboardRouter !== "function") {
    throw new Error("routes/admindashboard.js must export an Express router.");
}

if (typeof adminLeaderboardRouter !== "function") {
    throw new Error("routes/adminleaderboard.js must export an Express router.");
}

console.log("dashboardRoutes:", typeof dashboardRoutes);
console.log("tasksRoutes:", typeof tasksRoutes);
console.log("sessionRoutes:", typeof sessionRoutes);
console.log("moodRoutes:", typeof moodRoutes);
console.log("analyticsRoutes:", typeof analyticsRoutes);
console.log("leaderboardRoutes:", typeof leaderboardRoutes);
console.log("profileRoutes:", typeof profileRoutes);

// Mount routes
app.use("/", indexRouter);
app.use("/admindashboard", adminDashboardRouter);
app.use("/userdashboard", dashboardRoutes);
app.use("/userdashboard", tasksRoutes);
app.use("/userdashboard", sessionRoutes);
app.use("/userdashboard", moodRoutes);
app.use("/userdashboard", analyticsRoutes);
app.use("/userdashboard", leaderboardRoutes);
app.use("/userdashboard", profileRoutes);

app.use("/adminleaderboard", adminLeaderboardRouter);

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
    res.status(404).render("error", {
        layout: false,
        title: "404",
        message: "Page Not Found",
        error: {}
    });
});

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
    console.error("Application error:", err);

    res.status(err.status || 500).render("error", {
        layout: false,
        title: "Server Error",
        message: err.message || "Internal Server Error",
        error: process.env.NODE_ENV === "development" ? err : {}
    });
});

// ==========================================
// EXPORT APP
// ==========================================
module.exports = app;