import { execSync } from "node:child_process";

const DEFAULT_NUM_DAYS = 7;

/**
 * Returns the current UTC date in YYYY-MM-DD form.
 */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseIsoDate(value: string): Date {
  if (!isIsoDateString(value)) {
    throw new Error(`Invalid date: ${value}. Expected YYYY-MM-DD.`);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}. Expected YYYY-MM-DD.`);
  }

  const normalized = parsed.toISOString().slice(0, 10);
  if (normalized !== value) {
    throw new Error(`Invalid calendar date: ${value}.`);
  }

  return parsed;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid ${flagName} value: ${value}. Expected a positive integer.`);
  }
  return parsed;
}

/**
 * Parses CLI flags for historical backfill generation.
 */
function parseArgs(): { numDays: number; dateFrom: string } {
  const args = process.argv.slice(2);
  let numDays = DEFAULT_NUM_DAYS;
  let dateFrom = todayIsoDate();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--num_days") {
      const nextValue = args[i + 1];
      if (!nextValue) {
        throw new Error("Missing value for --num_days.");
      }
      numDays = parsePositiveInteger(nextValue, "--num_days");
      i += 1;
      continue;
    }

    if (arg === "--date_from") {
      const nextValue = args[i + 1];
      if (!nextValue) {
        throw new Error("Missing value for --date_from. Expected YYYY-MM-DD.");
      }
      if (!isIsoDateString(nextValue)) {
        throw new Error(`Invalid --date_from value: ${nextValue}. Expected YYYY-MM-DD.`);
      }
      dateFrom = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  parseIsoDate(dateFrom);

  return { numDays, dateFrom };
}

/**
 * Computes the list of prior dates to generate, skipping the anchor date itself.
 */
function getBackfillDates(dateFrom: string, numDays: number): string[] {
  const anchorDate = parseIsoDate(dateFrom);
  const dates: string[] = [];

  for (let dayOffset = 1; dayOffset <= numDays; dayOffset += 1) {
    dates.push(formatIsoDate(addDays(anchorDate, -dayOffset)));
  }

  return dates;
}

function run(command: string): void {
  console.log(`\n▶ Running: ${command}`);
  execSync(command, { stdio: "inherit" });
}

/**
 * Builds historical daily files by repeatedly delegating to the regular build pipeline.
 */
function main(): void {
  const { numDays, dateFrom } = parseArgs();
  const dates = getBackfillDates(dateFrom, numDays);

  console.log(`Backfilling ${dates.length} day(s) ending before ${dateFrom}:`);
  for (const date of dates) {
    console.log(`  - ${date}`);
  }

  for (const date of dates) {
    const quotedDate = shellQuote(date);
    run(`tsx scripts/buildGame.ts --date ${quotedDate}`);
  }

  console.log(`\n✅ Backfill complete for ${dates.length} day(s).`);
}

main();
