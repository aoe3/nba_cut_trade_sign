import fs from 'node:fs';
import path from 'node:path';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseArgs(): { date: string } {
  const args = process.argv.slice(2);
  let date = todayIsoDate();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--date') {
      const nextValue = args[i + 1];
      if (!nextValue) {
        throw new Error('Missing value for --date. Expected YYYY-MM-DD.');
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

function main(): void {
  const { date } = parseArgs();
  const outputPath = path.resolve(process.cwd(), 'src/data/dates/currentDate.ts');
  const content = `export const CURRENT_GAME_DATE = ${JSON.stringify(date)};\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf-8');

  console.log(`Updated current Daily game date to ${date}`);
  console.log(`Wrote ${outputPath}`);
}

main();
