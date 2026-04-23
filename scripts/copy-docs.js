import fs from "node:fs";
import path from "node:path";

const copyFile = (src, dest) => {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
};

copyFile("opencode.json", "dist/opencode.json");
if (!fs.existsSync("dist/.opencode")) {
  fs.mkdirSync("dist/.opencode", { recursive: true });
}
fs.cpSync(".opencode/skills", "dist/.opencode/skills", {
  recursive: true,
  force: true,
});
copyFile("docs/use-cases.md", "dist/docs/use-cases.md");
copyFile("docs/AGENTS.md", "dist/docs/AGENTS.md");
