// middleware/session.js

const session = require("express-session");
const connectMongo = require("connect-mongo");
const path = require("path");

// Load .env from the project root
require("dotenv").config({
    path: path.resolve(__dirname, "../.env"),
});

const MongoStore = connectMongo.default || connectMongo;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_COOKIE_NAME = process.env.SESSION_NAME || "smartwork.sid";

const initSession = (app) => {
    const mongoUrl = process.env.MONGODB_URL;
    const sessionSecret = process.env.SESSION_SECRET;

    // Validate session secret
    if (!sessionSecret) {
        throw new Error("SESSION_SECRET is missing from your .env file");
    }

    let sessionStore;

    // Use MongoDB session storage if MONGODB_URL is configured
    if (mongoUrl) {
        sessionStore = MongoStore.create({
            mongoUrl: mongoUrl,
            collectionName: process.env.SESSION_COLLECTION || "sessions",
            ttl: SESSION_IDLE_TIMEOUT_MS / 1000,
        });

        console.log("✅ MongoDB session store configured");
    } else {
        // Development fallback only
        console.warn(
            "⚠️ MONGODB_URL is missing. Using temporary MemoryStore for sessions."
        );

        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "MONGODB_URL is required in production. Configure your MongoDB connection."
            );
        }
    }

    app.use(
        session({
            store: sessionStore,
            name: SESSION_COOKIE_NAME,
            secret: sessionSecret,
            resave: false,
            saveUninitialized: false,
            rolling: true,

            cookie: {
                httpOnly: true,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
                maxAge: SESSION_IDLE_TIMEOUT_MS,
            },
        })
    );

    console.log("✅ Session middleware initialized");
};

module.exports = {
    initSession,
    SESSION_COOKIE_NAME,
    SESSION_IDLE_TIMEOUT_MS,
};