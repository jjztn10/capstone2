/* ==========================================================
   DEADLINE EMAIL REMINDERS (Gmail)

   Checks every minute for open tasks that are due today or
   within the next 24 hours, and emails the owner (the email
   saved on that user's row in the `users` table).

   Each task is emailed once per deadline. If the deadline is
   changed, the new deadline can be emailed again.

   Gmail protection:
   - one shared connection is reused (no new login per email)
   - if Gmail rejects the login, ALL sending pauses for 30 minutes
   - if one address fails, that user is skipped for 15 minutes
   - placeholder / invalid addresses (e.g. your_inbox@gmail.com)
     are skipped instead of being sent and bounced

   Needs in .env:
     MAIL_USER=yourname@gmail.com
     MAIL_APP_PASSWORD=16-letter Google app password (spaces are OK)
   Optional:
     MAIL_FROM_NAME=SmartWork Planner
     MAIL_CRON=* * * * *          (default: every minute)
     MAIL_WINDOW_HOURS=24         (how far ahead counts as "about to be due")
     MAIL_RUN_ON_START=true       (default true: also checks once at server start;
                                   set to false to turn that off)

   Needs these columns (run once in MySQL):
     ALTER TABLE tasks ADD COLUMN reminder_sent_at DATETIME NULL;
     ALTER TABLE tasks ADD COLUMN reminded_deadline DATETIME NULL;
========================================================== */

const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { Query } = require("../database/db-helper");

// ---------- adjust these to your schema if your column names differ ----------
const TASK_ID = "id";            // tasks primary key column
const USER_EMAIL = "email";      // users column that holds the email address
// -----------------------------------------------------------------------------

const WINDOW_HOURS = Math.max(1, Number(process.env.MAIL_WINDOW_HOURS) || 24);
const LOGIN_PAUSE_MS = 30 * 60 * 1000;   // pause after a Gmail login error
const USER_RETRY_MS = 15 * 60 * 1000;    // wait before retrying a failed address

let transporter = null;
let running = false;            // stops two checks from overlapping
let pausedUntil = 0;            // no sending before this time
let lastLoggedError = "";       // stops the same error from printing every minute
const retryAfter = new Map();   // uid -> time when this user may be tried again
const warnedBadEmail = new Set(); // uids already warned about a bad address

function getTransporter() {
    if (transporter) return transporter;

    if (!process.env.MAIL_USER || !process.env.MAIL_APP_PASSWORD) return null;

    transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true,              // reuse one connection instead of logging in every time
        maxConnections: 1,
        maxMessages: 50,
        auth: {
            user: process.env.MAIL_USER,
            // Google shows app passwords with spaces; they must not be sent
            pass: String(process.env.MAIL_APP_PASSWORD).replace(/\s+/g, "")
        }
    });
    return transporter;
}

function isLoginError(e) {
    return (
        e?.code === "EAUTH" ||
        e?.responseCode === 454 ||
        e?.responseCode === 535 ||
        /invalid login|username and password|too many login/i.test(e?.message || "")
    );
}

// Rejects empty, malformed, and obvious placeholder addresses
function isValidEmail(value) {
    const email = String(value ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    if (/^your[_-]?inbox@|^example@|@example\.(com|org|net)$|^test@test\./i.test(email)) return false;
    return true;
}

// Task titles come from users, so never put them into HTML unescaped
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function timePart(d) {
    // Tasks saved without a time sit at midnight: don't print "12:00 AM" for them
    if (d.getHours() === 0 && d.getMinutes() === 0) return "";
    return " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function whenText(deadline) {
    const d = new Date(deadline);
    if (isNaN(d)) return "due soon";

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    if (d.toDateString() === now.toDateString()) return "due today" + timePart(d);
    if (d.toDateString() === tomorrow.toDateString()) return "due tomorrow" + timePart(d);

    return "due " + d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + timePart(d);
}

function buildEmail(name, tasks) {
    const items = tasks
        .map(t => `<li><strong>${esc(t.title)}</strong> &ndash; ${esc(whenText(t.deadline))}</li>`)
        .join("");

    const text =
        `Hi ${name || "there"},\n\nThese tasks are almost due:\n\n` +
        tasks.map(t => `- ${t.title} (${whenText(t.deadline)})`).join("\n") +
        `\n\nOpen SmartWork to plan your day.`;

    const html = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1f2d26">
            <h2 style="color:#2d5a3d;margin-bottom:4px">Tasks almost due</h2>
            <p>Hi ${esc(name || "there")}, these tasks need your attention:</p>
            <ul style="line-height:1.7">${items}</ul>
            <p style="color:#6b7a72;font-size:13px">Open SmartWork to plan your day.</p>
        </div>`;

    return { text, html };
}

function fromAddress() {
    return `"${process.env.MAIL_FROM_NAME || "SmartWork Planner"}" <${process.env.MAIL_USER}>`;
}

/* ----------------------------------------------------------
   Test email: sends to the email saved for the given user.
   Use this in your test route instead of a hardcoded address.
---------------------------------------------------------- */
async function sendTestEmail(uid) {
    const mail = getTransporter();
    if (!mail) throw new Error("Mail is not configured. Set MAIL_USER and MAIL_APP_PASSWORD in .env.");

    const rows = await Query(
        `SELECT name, ${USER_EMAIL} AS email FROM users WHERE uid = ?`,
        [uid]
    );
    const user = rows[0];

    if (!user || !isValidEmail(user.email)) {
        throw new Error("This user has no valid email on file.");
    }

    await mail.sendMail({
        from: fromAddress(),
        to: user.email.trim(),
        subject: "SmartWork test email",
        text: `Hi ${user.name || "there"}, your SmartWork email setup works.`
    });

    return user.email.trim();
}

async function sendDeadlineReminders() {
    const mail = getTransporter();
    if (!mail) return { sent: 0, skipped: true };

    // Gmail said no recently: wait instead of trying again
    if (Date.now() < pausedUntil) return { sent: 0, paused: true };

    if (running) return { sent: 0, busy: true };
    running = true;

    try {
        // Open tasks due today or within the next WINDOW_HOURS hours
        // that have not been emailed for their current deadline
        const rows = await Query(`
            SELECT t.${TASK_ID} AS task_id, t.title, t.deadline,
                   u.uid, u.name, u.${USER_EMAIL} AS email
            FROM tasks t
            JOIN users u ON u.uid = t.uid
            WHERE COALESCE(t.status, '') <> 'completed'
              AND t.deadline IS NOT NULL
              AND (t.reminded_deadline IS NULL OR t.reminded_deadline <> t.deadline)
              AND u.${USER_EMAIL} IS NOT NULL AND u.${USER_EMAIL} <> ''
              AND DATE(t.deadline) >= CURDATE()
              AND t.deadline <= DATE_ADD(NOW(), INTERVAL ? HOUR)
            ORDER BY t.deadline ASC
        `, [WINDOW_HOURS]);

        // One email per user, listing all of their tasks
        const byUser = new Map();
        for (const r of rows) {
            if (!byUser.has(r.uid)) byUser.set(r.uid, { uid: r.uid, name: r.name, email: r.email, tasks: [] });
            byUser.get(r.uid).tasks.push(r);
        }

        let sent = 0;
        const now = Date.now();

        for (const [, u] of byUser) {
            if ((retryAfter.get(u.uid) || 0) > now) continue;   // failed recently, wait

            // Skip placeholder / malformed addresses (they only bounce later)
            if (!isValidEmail(u.email)) {
                if (!warnedBadEmail.has(u.uid)) {
                    warnedBadEmail.add(u.uid);
                    console.error(`Deadline mailer: user ${u.uid} has an invalid email ("${u.email}"). Fix it in the users table. Skipping.`);
                }
                continue;
            }

            let emailWentOut = false;

            try {
                const { text, html } = buildEmail(u.name, u.tasks);

                const info = await mail.sendMail({
                    from: fromAddress(),
                    to: String(u.email).trim(),
                    subject: u.tasks.length === 1
                        ? `Reminder: "${u.tasks[0].title}" is almost due`
                        : `Reminder: ${u.tasks.length} tasks are almost due`,
                    text,
                    html
                });

                if (!info.accepted || info.accepted.length === 0) {
                    throw new Error("Gmail did not accept the recipient address");
                }
                emailWentOut = true;

                // Mark as sent only after the email went out
                for (const t of u.tasks) {
                    await Query(
                        `UPDATE tasks SET reminder_sent_at = NOW(), reminded_deadline = deadline WHERE ${TASK_ID} = ?`,
                        [t.task_id]
                    );
                }
                retryAfter.delete(u.uid);
                sent++;

            } catch (e) {
                if (!emailWentOut && isLoginError(e)) {
                    // Wrong/blocked login affects everyone: stop now and pause
                    pausedUntil = Date.now() + LOGIN_PAUSE_MS;
                    console.error(
                        "Deadline mailer: Gmail rejected the login. Sending is paused for 30 minutes.\n" +
                        "  Reason: " + String(e.message).split("\n")[0] + "\n" +
                        "  Check MAIL_USER and MAIL_APP_PASSWORD in .env, then restart the server."
                    );
                    break;
                }

                // If the email was sent but saving "sent" failed, back off so the
                // same email is not re-sent every minute
                retryAfter.set(u.uid, Date.now() + USER_RETRY_MS);

                if (emailWentOut) {
                    console.error(`Deadline mailer: email to ${u.email} was sent, but marking tasks as sent failed:`, e.message);
                } else {
                    console.error(`Deadline mailer: could not email ${u.email} (will retry in 15 min):`, e.message);
                }
            }
        }

        if (sent) console.log(`Deadline mailer: ${sent} email(s) sent.`);
        lastLoggedError = "";
        return { sent };

    } finally {
        running = false;
    }
}

function runCheck() {
    sendDeadlineReminders().catch(e => {
        // Print a repeating error only once, not every minute
        if (e.message !== lastLoggedError) {
            console.error("Deadline mailer error:", e.message);
            lastLoggedError = e.message;
        }
    });
}

function startDeadlineMailer() {
    if (!getTransporter()) {
        console.log("Deadline mailer: off (set MAIL_USER and MAIL_APP_PASSWORD in .env to turn it on).");
        return;
    }

    const schedule = process.env.MAIL_CRON || "* * * * *";

    if (!cron.validate(schedule)) {
        console.error(`Deadline mailer: MAIL_CRON "${schedule}" is not a valid cron expression. Mailer not started.`);
        return;
    }

    cron.schedule(schedule, runCheck);

    console.log(`Deadline mailer: on (schedule "${schedule}", window ${WINDOW_HOURS}h).`);

    if (String(process.env.MAIL_RUN_ON_START).toLowerCase() !== "false") runCheck();
}

module.exports = { startDeadlineMailer, sendDeadlineReminders, sendTestEmail };