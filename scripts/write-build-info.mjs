// Grava public/version.json no build (commit + data/hora) para /api/version
// mostrar qual versão está no ar. Lê o hash direto dos arquivos do .git —
// a imagem de build não tem o binário git.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

function gitCommit() {
  try {
    const head = readFileSync(".git/HEAD", "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 7);
    const ref = head.slice(5).trim();
    const refPath = join(".git", ref);
    if (existsSync(refPath)) return readFileSync(refPath, "utf8").trim().slice(0, 7);
    const packed = readFileSync(".git/packed-refs", "utf8");
    const line = packed.split("\n").find((l) => l.endsWith(" " + ref));
    return line ? line.split(" ")[0].slice(0, 7) : null;
  } catch {
    return null;
  }
}

const info = {
  commit: process.env.SOURCE_COMMIT?.slice(0, 7) || gitCommit(),
  builtAt: new Date().toISOString(),
};
mkdirSync("public", { recursive: true });
writeFileSync("public/version.json", JSON.stringify(info));
console.log("[build-info]", JSON.stringify(info));
