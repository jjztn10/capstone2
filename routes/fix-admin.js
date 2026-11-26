const { Query } = require("../database/config/db.js");
const { EncryptString } = require("../database/cryptography.js");

(async () => {
  try {
    // 1) Make sure both roles exist
    for (const name of ["admin", "user"]) {
      const found = await Query("SELECT mr_id FROM master_roles WHERE mr_name = ?", [name]);
      if (found.length === 0) {
        await Query("INSERT INTO master_roles (mr_name, mr_create_at) VALUES (?, NOW())", [name]);
      }
    }
    const [role] = await Query("SELECT mr_id FROM master_roles WHERE mr_name = 'admin'");

    // 2) Create the admin, or reset its password if it already exists
    const existing = await Query("SELECT mu_id FROM master_users WHERE mu_username = 'admin'");
    if (existing.length === 0) {
      await Query(
        "INSERT INTO master_users (mu_fullname, mu_username, mu_password, mu_role, mu_create_at) VALUES (?,?,?,?,NOW())",
        ["Administrator", "admin", EncryptString("admin123"), role.mr_id]
      );
      console.log("Created admin user.");
    } else {
      await Query(
        "UPDATE master_users SET mu_password = ?, mu_role = ? WHERE mu_username = 'admin'",
        [EncryptString("admin123"), role.mr_id]
      );
      console.log("Admin already existed: password reset.");
    }

    // 3) Show every user so you know what's in the table
    const users = await Query(
      "SELECT u.mu_id, u.mu_username, u.mu_fullname, r.mr_name AS role FROM master_users u LEFT JOIN master_roles r ON r.mr_id = u.mu_role"
    );
    console.table(users);

    console.log("\nLogin with  username: admin   password: admin123");
  } catch (err) {
    console.error("Failed:", err.message);
  }
  process.exit(0);
})();