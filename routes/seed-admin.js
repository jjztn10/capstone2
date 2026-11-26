const { Query } = require("../database/config/db.js");
const { EncryptString } = require("../database/cryptography.js");

(async () => {
  await Query(
    "INSERT IGNORE INTO master_roles (mr_name, mr_create_at) VALUES ('admin', NOW()), ('user', NOW())"
  );
  const [role] = await Query("SELECT mr_id FROM master_roles WHERE mr_name = 'admin'");

  await Query(
    "INSERT IGNORE INTO master_users (mu_fullname, mu_username, mu_password, mu_role, mu_create_at) VALUES (?,?,?,?,NOW())",
    ["Administrator", "admin", EncryptString("admin123"), role.mr_id]
  );

  console.log("Seeded. Login: admin / admin123 (change this password).");
  process.exit(0);
})();