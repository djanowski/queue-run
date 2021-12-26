import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { loadQueues, loadRoutes } from "queue-run";

export type Services = {
  routes: Awaited<ReturnType<typeof loadRoutes>>;
  queues: Awaited<ReturnType<typeof loadQueues>>;
};

export async function loadServices(dirname: string): Promise<Services> {
  const cwd = process.cwd();
  try {
    process.chdir(dirname);
    const routes = await loadRoutes();
    const queues = await loadQueues();
    return { routes, queues };
  } catch (error) {
    process.chdir(cwd);
    throw error;
  }
}

export async function displayServices({
  dirname,
  queues,
  routes,
}: { dirname: string } & Services) {
  console.info(
    chalk.bold.blue("λ: %s"),
    routes.size > 0 ? "API:" : "No routes"
  );
  const rows: [string, string][] = Array.from(routes.entries()).map(
    ([path, { filename }]) => [path, filename]
  );
  const width = Math.max(...rows.map(([path]) => path.length));
  const table = await Promise.all(
    rows.map(async ([path, filename]) =>
      [path.padEnd(width), await getOriginalFilename(dirname, filename)].join(
        "  →  "
      )
    )
  );
  console.info(
    "%s",
    table
      .sort()
      .map((line) => `   ${line}`)
      .join("\n")
  );

  console.info(
    chalk.bold.blue("λ: %s"),
    queues.size > 0 ? "Queues:" : "No queues"
  );
  console.info(
    "%s",
    Array.from(queues.keys())
      .map((name, i, all) => [i === all.length - 1 ? "└──" : "├──", name])
      .map(([prefix, name]) => `   ${prefix} ${name}`)
      .join("\n")
  );
}

async function getOriginalFilename(dirname: string, filename: string) {
  const sourceMap = await fs.readFile(
    path.join(dirname, `${filename}.map`),
    "utf8"
  );
  const { sources } = JSON.parse(sourceMap);
  return sources[0];
}
