/* ==========================================================
   GMAIL LOGIN TEST  (makes ONE login attempt, then exits)

   Put this file in the capstone2 folder (next to app.js), stop the
   server, then run:

       node test-mail.js                      checks the login only
       node test-mail.js you@example.com      also sends a test email

   It never prints your password, only its length.
========================================================== */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const nodemailer = require("nodemailer");

const user = String(process.env.MAIL_USER || "").trim();
const pass = String(process.env.MAIL_APP_PASSWORD || "").replace(/\s+/g, "");

console.log("MAIL_USER:", user || "(empty)");
console.log("App password length:", pass.length, "(must be 16)");

if (!user || !user.includes("@")) {
    console.error("\nMAIL_USER is missing or is not an email address. Fix .env first.");
    process.exit(1);
}
if (pass.length !== 16) {
    console.error("\nThe app password is not 16 characters. Copy the code from Google again.");
    process.exit(1);
}
if (/[^a-z]/i.test(pass)) {
    console.error("\nThe app password has characters that are not letters. Check for quotes or typos.");
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
});

(async () => {
    try {
        await transporter.verify();
        console.log("\nLogin OK. Gmail accepted this username and app password.");

        const to = process.argv[2];
        if (to) {
            await transporter.sendMail({
                from: `"SmartWork Planner" <${user}>`,
                to,
                subject: "SmartWork test email",
                text: "If you can read this, your SmartWork email setup works."
            });
            console.log("Test email sent to", to);
        }
    } catch (e) {
        console.error("\nLogin FAILED:", String(e.message).split("\n")[0]);
        process.exitCode = 1;
    } finally {
        transporter.close();
    }
})();