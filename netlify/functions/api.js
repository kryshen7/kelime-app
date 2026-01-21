const serverless = require("serverless-http");
const fs = require("fs");
const path = require("path");


// views klasörünü function içinde /tmp'ye kopyala (read-only /var/task yerine)
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

const srcViews = path.join(__dirname, "../../views");
const destViews = "/tmp/views";

// sadece ilk çalışmada kopyala
if (!fs.existsSync(destViews)) {
  try {
    copyDir(srcViews, destViews);
    console.log("✅ views copied to /tmp/views");
  } catch (e) {
    console.error("❌ views copy failed", e);
  }
}

const app = require("../../app");
module.exports.handler = serverless(app);
