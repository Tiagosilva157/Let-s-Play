// Executa as migrations pendentes (controle na tabela _migrations).
// Uso: DATABASE_URL="postgresql://..." node scripts/run-migrations.mjs
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Defina DATABASE_URL"); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("create table if not exists _migrations (name text primary key, applied_at timestamptz default now())");
const { rows } = await client.query("select name from _migrations");
const applied = new Set(rows.map((r) => r.name));

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const f of files) {
  if (applied.has(f)) { console.log(`↷ ${f} (já aplicada)`); continue; }
  process.stdout.write(`→ ${f} ... `);
  try {
    await client.query("begin");
    await client.query(readFileSync(join(dir, f), "utf8"));
    await client.query("insert into _migrations (name) values ($1)", [f]);
    await client.query("commit");
    console.log("OK");
  } catch (e) {
    await client.query("rollback");
    console.log("ERRO");
    console.error(e.message);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log("Migrations em dia.");
