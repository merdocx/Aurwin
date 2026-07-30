import { spawnSync } from "node:child_process";
import net from "node:net";

/**
 * Глобальная тестовая инфраструктура для миграций/схемы БД (фаза 2).
 *
 * Поднимает ОДНОРАЗОВЫЙ, полностью изолированный от docker-compose.yml
 * контейнер postgres:16-alpine, привязанный к свободному порту на loopback.
 * Это НЕ нарушает правило "порт Postgres не публикуется наружу" (CLAUDE.md/А.7):
 * то правило — про боевой/dev-стек docker-compose, а не про одноразовую
 * тестовую инфраструктуру, которая живёт только на время `npm test` и
 * гарантированно удаляется в teardown.
 */

const CONTAINER_NAME = "aurwin-test-postgres";
const TEST_DB = { user: "aurwin_test", password: "aurwin_test", database: "aurwin_test" };

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

async function waitForPostgres(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const check = spawnSync("docker", ["exec", CONTAINER_NAME, "pg_isready", "-U", TEST_DB.user]);
    if (check.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Тестовый контейнер Postgres не поднялся за отведённое время");
}

export async function setup() {
  const dockerCheck = spawnSync("docker", ["--version"]);
  if (dockerCheck.status !== 0) {
    throw new Error(
      "Docker недоступен в этом окружении — тесты services/db требуют Docker " +
        "для эфемерного тестового Postgres (см. tests/setup/global-db-setup.ts).",
    );
  }

  // На случай, если предыдущий прогон упал и не убрал за собой контейнер.
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME]);

  const port = await findFreePort();
  const run = spawnSync("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "-e",
    `POSTGRES_USER=${TEST_DB.user}`,
    "-e",
    `POSTGRES_PASSWORD=${TEST_DB.password}`,
    "-e",
    `POSTGRES_DB=${TEST_DB.database}`,
    "-p",
    `127.0.0.1:${port}:5432`,
    "postgres:16-alpine",
  ]);

  if (run.status !== 0) {
    throw new Error(`Не удалось запустить тестовый Postgres: ${run.stderr?.toString()}`);
  }

  await waitForPostgres();

  process.env.DATABASE_URL = `postgres://${TEST_DB.user}:${TEST_DB.password}@127.0.0.1:${port}/${TEST_DB.database}`;
}

export async function teardown() {
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME]);
}
