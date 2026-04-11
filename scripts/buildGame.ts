import { execSync } from "node:child_process";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Parses the target date for a one-shot game build.
 */
function parseArgs(): { date: string } {
  const args = process.argv.slice(2);
  let date = todayIsoDate();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--date") {
      const nextValue = args[i + 1];
      if (!nextValue) {
        throw new Error("Missing value for --date. Expected YYYY-MM-DD.");
      }
      if (!isIsoDateString(nextValue)) {
        throw new Error(`Invalid --date value: ${nextValue}. Expected YYYY-MM-DD.`);
      }
      date = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { date };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function run(command: string) {
  console.log(`\n▶ Running: ${command}`);
  execSync(command, { stdio: "inherit" });
}

/**
 * Runs generate, solve, and publish in sequence for a single date.
 */
function main() {
  try {
    const { date } = parseArgs();
    const quotedDate = shellQuote(date);

    run(`tsx scripts/generateGame.ts --date ${quotedDate}`);
    run(`tsx scripts/solveGame.ts --date ${quotedDate}`);
    run(`tsx scripts/publishGame.ts --date ${quotedDate}`);

    console.log(`\n✅ Game build complete for ${date}.`);
  } catch (_error) {
    console.error("\n❌ Game build failed.");
    process.exit(1);
  }
}

main();
