import { migrateUp, migrateDown } from "../src/migrate.js";

const direction = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}

if (direction === "up") {
  await migrateUp({ databaseUrl });
  console.log("up: OK");
} else if (direction === "down") {
  await migrateDown({ databaseUrl, count: Infinity });
  console.log("down: OK");
} else {
  console.error("Использование: migrate-cli.ts up|down");
  process.exit(1);
}
