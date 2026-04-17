import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { SQLInputValue } from 'node:sqlite';
import { initDb, getDb } from '../src/db';
import type { Lead } from '../src/types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DATA_DIR  = path.resolve(__dirname, '../data');
const JSON_FILE = path.join(DATA_DIR, 'leads.json');
const CSV_FILE  = path.join(DATA_DIR, 'leads.csv');

const CSV_COLUMNS = [
  'id', 'name', 'city', 'rating', 'review_count',
  'website_url', 'phone', 'niche', 'batch_keyword', 'status', 'score', 'tier',
] as const;

function esc(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function buildCsv(leads: Lead[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows   = leads.map(l =>
    CSV_COLUMNS.map(col => esc((l as unknown as Record<string, unknown>)[col])).join(','),
  );
  return [header, ...rows].join('\n');
}

function getScoredLeadsAll(): Lead[] {
  return getDb()
    .prepare(`SELECT * FROM leads WHERE status = 'scored' ORDER BY score DESC`)
    .all() as unknown as Lead[];
}

async function main(): Promise<void> {
  initDb();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const leads = getScoredLeadsAll();

  fs.writeFileSync(JSON_FILE, JSON.stringify(leads, null, 2), 'utf-8');
  fs.writeFileSync(CSV_FILE, buildCsv(leads), 'utf-8');

  console.log(`Exported ${leads.length} leads to data/leads.json and data/leads.csv`);
}

main().catch(err => {
  console.error('[export:leads] Fatal error:', err);
  process.exit(1);
});
