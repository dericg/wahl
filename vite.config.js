import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

function getCommitHistory() {
  try {
    return execFileSync("git", ["log", "-5", "--format=%h%x09%cI%x09%s"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean).map((line) => {
      const [hash, date, ...message] = line.split("\t");
      return { hash, date, message: message.join(" ") };
    });
  } catch {
    return [];
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __WAHL_RELEASE__: JSON.stringify({ version, commits: getCommitHistory() }),
  },
});
