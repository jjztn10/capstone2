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
const {
    initSession,
    SESSION_COOKIE_NAME,
    SESSION_IDLE_TIMEOUT_MS,
} = require("./middleware/session");
const { requireLogin, requireRole } = require("./middleware/auth");

const authRouter = require("./routes/auth");
const indexRouter = require("./routes/index");
const dashboardRoutes = require("./routes/dashboard");
const tasksRoutes = require("./routes/tasks");
const sessionRoutes = require("./routes/session");
const moodRoutes = require("./routes/mood");
const analyticsRoutes = require("./routes/analytics");
const leaderboardRoutes = require("./routes/leaderboard");
const profileRoutes = require("./routes/profile");
const adminDashboardRouter = require("./routes/admindashboard");
const adminLeaderboardRouter = require("./routes/adminleaderboard");
const adminReportsRouter = require("./routes/adminreports");

// Smart features: focus list, assistant, team heatmap, anomalies
const {
    userRouter: smartUserRouter,
    adminRouter: smartAdminRouter,
} = require("./routes/smart");

// Gmail reminders for tasks that are almost due
const { startDeadlineMailer } = require("./services/deadline-mailer");

// ==========================================
// APP INITIALIZATION
// ==========================================
const app = express();

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

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
// STATIC FILES
// Before the session so images/css/js requests
// don't each trigger a session lookup.
// ==========================================
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// SESSION MIDDLEWARE
// middleware/session.js is the only session
// configuration source.
// ==========================================
initSession(app);

app.use((req, res, next) => {
    if (!req.session?.userId) return next();

    const now = Date.now();
    const lastActivityAt = Number(req.session.lastActivityAt);

    if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) {
        req.session.lastActivityAt = now;
        return next();
    }

    if (now - lastActivityAt < SESSION_IDLE_TIMEOUT_MS) return next();

    req.session.destroy((err) => {
        if (err) return next(err);

        res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });

        const wantsJson = req.xhr
            || (req.headers.accept || "").includes("application/json")
            || req.path === "/auth/activity"
            || req.path.indexOf("/api/") !== -1;

        if (wantsJson) {
            return res.status(401).json({
                success: false,
                message: "Session expired. Please log in again.",
            });
        }

        res.redirect("/auth");
    });
});

// ==========================================
// VIEW LOCALS (available in every EJS view)
// - currentPath: used by the sidebar for active links
// - layoutType:  fallback only; values passed to
//   res.render() override these defaults
// - roleName / fullname: from the logged-in session
// ==========================================
app.use((req, res, next) => {
    res.locals.currentPath = req.originalUrl;
    res.locals.sessionIdleTimeoutMs = SESSION_IDLE_TIMEOUT_MS;
    res.locals.roleName = req.session?.roleName || "";
    res.locals.fullname = req.session?.fullname || "";
    res.locals.PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

    if (req.path.startsWith("/admin")) {
        res.locals.layoutType = "admin";
    } else if (req.path.startsWith("/userdashboard")) {
        res.locals.layoutType = "user";
    }

    next();
});

console.log("ENV FILE:", path.resolve(__dirname, ".env"));
console.log("SESSION_SECRET loaded:", Boolean(process.env.SESSION_SECRET));
console.log("GEMINI_API_KEY loaded:", Boolean(process.env.GEMINI_API_KEY));
console.log("MAIL_USER loaded:", Boolean(process.env.MAIL_USER));
console.log("MAIL_APP_PASSWORD loaded:", Boolean(process.env.MAIL_APP_PASSWORD));

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
// DEADLINE EMAIL REMINDERS
// Runs once a day (default 8:00). Does nothing unless
// MAIL_USER and MAIL_APP_PASSWORD are set in .env.
// ==========================================
startDeadlineMailer();

// ==========================================
// VALIDATE ROUTERS
// ==========================================
const mustBeRouter = (router, file) => {
    if (typeof router !== "function") {
        throw new Error(`${file} must export an Express router.`);
    }
};

mustBeRouter(authRouter, "routes/auth.js");
mustBeRouter(indexRouter, "routes/index.js");
mustBeRouter(adminDashboardRouter, "routes/admindashboard.js");
mustBeRouter(adminLeaderboardRouter, "routes/adminleaderboard.js");
mustBeRouter(adminReportsRouter, "routes/adminreports.js");
mustBeRouter(smartUserRouter, "routes/smart.js (userRouter)");
mustBeRouter(smartAdminRouter, "routes/smart.js (adminRouter)");

// ==========================================
// PUBLIC ROUTES (no login needed)
// ==========================================
app.use("/auth", authRouter);

// Public health check for deployment platforms
app.get("/healthz", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Basic search-engine discovery
app.get("/robots.txt", (req, res) => {
    const baseUrl = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    res.type("text/plain").send([
        "User-agent: *",
        "Allow: /",
        baseUrl ? `Sitemap: ${baseUrl}/sitemap.xml` : "",
    ].filter(Boolean).join("\n"));
});

app.get("/sitemap.xml", (req, res) => {
    const baseUrl = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    const origin = baseUrl || `${req.protocol}://${req.get("host")}`;
    res.type("application/xml").send(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
        `<url><loc>${origin}/auth</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>` +
        `</urlset>`
    );
});

// "/" sends visitors to login, or to their own home if already logged in.
// Declared before indexRouter so it wins for the exact "/" path.
app.get("/", (req, res) => {
    if (!req.session?.userId) return res.redirect("/auth");
    if (String(req.session.roleName).toLowerCase() === "admin") {
        return res.redirect("/admindashboard");
    }
    return res.redirect("/userdashboard");
});
app.use("/", indexRouter);

// Old logout URLs -> new logout
app.get(["/logout", "/admindashboard/logout", "/userdashboard/logout"], (req, res) => {
    res.redirect("/auth/logout");
});

// ==========================================
// ACCESS GATES (everything below needs login + role)
// A gate runs first for every router mounted on that prefix.
// ==========================================
app.use("/admindashboard", requireLogin, requireRole("admin"));
app.use("/adminleaderboard", requireLogin, requireRole("admin"));
app.use("/userdashboard", requireLogin, requireRole("user"));

// ==========================================
// ADMIN ROUTES
// Smart admin API and the reports API are mounted BEFORE the admin
// dashboard router so a catch-all or auth redirect in that router
// can't swallow /api/team/* or /api/reports
// ==========================================
app.use("/admindashboard", smartAdminRouter);
app.use("/admindashboard", adminReportsRouter);
app.use("/admindashboard", adminDashboardRouter);
app.use("/adminleaderboard", adminLeaderboardRouter);

// ==========================================
// USER ROUTES
// ==========================================
app.use("/userdashboard", dashboardRoutes);
app.use("/userdashboard", tasksRoutes);
app.use("/userdashboard", sessionRoutes);
app.use("/userdashboard", moodRoutes);
app.use("/userdashboard", analyticsRoutes);
app.use("/userdashboard", leaderboardRoutes);
app.use("/userdashboard", profileRoutes);
app.use("/userdashboard", smartUserRouter);

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
    res.status(404).render("error", {
        layout: false,
        title: "404",
        message: "Page Not Found",
        error: {},
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
        error: process.env.NODE_ENV === "development" ? err : {},
    });
});

// ==========================================
// EXPORT APP
// ==========================================
module.exports = app;