const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const file = path.join(__dirname, "..", "public", "images", "logo.png");
const backup = path.join(__dirname, "..", "public", "images", "logo-original.png");
const temp = path.join(__dirname, "..", "public", "images", "logo-small.png");

(async () => {
  // Keep the original once, in case you ever need the big version
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);

  await sharp(backup)
    .resize(200, 200, {
      fit: "inside",              // keeps the shape, never stretches
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, palette: true })  // palette = much smaller file
    .toFile(temp);

  fs.copyFileSync(temp, file);
  fs.unlinkSync(temp);

  console.log("Done. New size:", (fs.statSync(file).size / 1024).toFixed(0), "KB");
})();