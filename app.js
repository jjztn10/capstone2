
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const session = require("express-session");
const expressLayouts = require("express-ejs-layouts");
const {testConnection} = require("./database/config/db")
const {initSession} = require("./middleware/session")

const app = express();

/* ==========================================
   VIEW ENGINE
========================================== */

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

/* ==========================================
   LAYOUTS
========================================== */

app.use(expressLayouts);
app.set("layout", "layout/main-layout");
app.set("layout extractScripts", false);
app.set("layout extractStyles", false);

/* ==========================================
   MIDDLEWARE
========================================== */

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
    session({
        secret: process.env.SESSION_SECRET || "smartwork-secret-key",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24
        }
    })
);

/* ==========================================
   STATIC FILES
========================================== */
testConnection().catch((err) =>
  console.error("❌ Database connection failed:", err.message)
);
app.use(express.static(path.join(__dirname, "public")));

/* ==========================================
   ROUTES
========================================== */

const indexRouter = require("./routes/index");
const adminDashboardRouter = require("./routes/admindashboard");

if (typeof indexRouter !== "function") {
    throw new Error("routes/index.js must export an Express router.");
}

if (typeof adminDashboardRouter !== "function") {
    throw new Error("routes/admindashboard.js must export an Express router.");
}

app.use("/", indexRouter);
app.use("/admindashboard", adminDashboardRouter);

/* ==========================================
   404 PAGE
========================================== */

app.use((req, res) => {
    res.status(404).render("error", {
        layout: false,
        title: "404",
        message: "Page Not Found",
        error: {}
    });
});

/* ==========================================
   ERROR HANDLER
========================================== */

app.use((err, req, res, next) => {
    console.error(err);

    res.status(err.status || 500).render("error", {
        layout: false,
        title: "Server Error",
        message: err.message || "Internal Server Error",
        error: process.env.NODE_ENV === "development" ? err : {}
    });
});

/* ==========================================
   EXPORT
========================================== */

module.exports = app;
