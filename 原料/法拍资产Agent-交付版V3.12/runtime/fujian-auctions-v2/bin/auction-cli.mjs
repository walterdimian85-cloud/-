#!/usr/bin/env node

try {
  if (process.argv[2] === "supervise") {
    const { main } = await import("../scripts/supervisor.mjs");
    await main();
  } else {
    const { main } = await import("../scripts/run.mjs");
    await main();
  }
  process.exit(process.exitCode || 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
