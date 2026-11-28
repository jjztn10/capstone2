// database/config/db.js

const path = require("path");
require("dotenv").config({
    path: path.resolve(__dirname, "../../.env"),
});

const mysql = require("mysql2");

console.log("===== DATABASE ENV CHECK =====");
console.log("DB_HOST:", process.env.DB_HOST || "MISSING");
console.log("DB_USER:", process.env.DB_USER || "MISSING");
console.log("DB_NAME:", process.env.DB_NAME || "MISSING");
console.log("DB_PORT:", process.env.DB_PORT || "MISSING");
console.log("DB_PASSWORD:", process.env.DB_PASSWORD ? "LOADED" : "MISSING");
console.log("============================");

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
    ssl: process.env.DB_SSL === "true"
        ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
        : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

const promisePool = pool.promise();

// Test database connection
const testConnection = async () => {
    let conn;

    try {
        conn = await promisePool.getConnection();
        await conn.ping();

        console.log("✅ Database connected successfully");
    } catch (error) {
        console.error("❌ Database connection failed:", error.message);
        throw error;
    } finally {
        if (conn) conn.release();
    }
};

// Universal query function
const Query = async (sql, params = [], prefixes) => {
    try {
        const [result] = await promisePool.query(sql, params);

        if (sql.trim().toUpperCase().startsWith("INSERT")) {
            return {
                ...result,
                insertId: result.insertId,
            };
        }

        if (
            prefixes &&
            sql.trim().toUpperCase().startsWith("SELECT")
        ) {
            return DataModeling(result, prefixes);
        }

        return result;
    } catch (error) {
        console.error("Error executing query:", error.message);
        throw error;
    }
};

// Transaction function
const Transaction = async (queries) => {
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        for (const query of queries) {
            await connection.execute(query.sql, query.values || []);
        }

        await connection.commit();
        return true;
    } catch (error) {
        console.error("Transaction failed:", error.message);

        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Rollback failed:", rollbackError.message);
            }
        }

        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

module.exports = {
    pool: promisePool,
    Query,
    Transaction,
    testConnection,
};