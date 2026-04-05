import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("[db:check] Missing POSTGRES_URL or DATABASE_URL in environment");
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

try {
  await client.connect();

  const versionRes = await client.query("select version() as version");
  const infoRes = await client.query(
    "select current_database() as database, current_user as user, now() as server_time"
  );

  console.log("[db:check] Connected to PostgreSQL successfully");
  console.log(`[db:check] Database: ${infoRes.rows[0].database}`);
  console.log(`[db:check] User: ${infoRes.rows[0].user}`);
  console.log(`[db:check] Server time: ${infoRes.rows[0].server_time}`);
  console.log(`[db:check] Version: ${versionRes.rows[0].version}`);

  await client.end();
  process.exit(0);
} catch (error) {
  console.error("[db:check] Connection failed");
  console.error(error instanceof Error ? error.message : String(error));

  try {
    await client.end();
  } catch {
    // ignore cleanup errors
  }

  process.exit(1);
}
