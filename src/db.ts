import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import * as fs from 'fs';

type SqlParams = Record<string, SQLInputValue>;
import { DB_PATH, SCHEMA_PATH } from './config';
import type {
  Lead,
  InsertLeadPayload,
  ScoreUpdatePayload,
  OutreachUpdatePayload,
  ScoringInput,
} from './types';

// ─── Singleton Connection ────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
  }
  return _db;
}

// ─── Initialisation ──────────────────────────────────────────────────────────

export function initDb(): void {
  const db     = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  console.log(`[db] Initialised database at: ${DB_PATH}`);
}

// ─── Insert ──────────────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT OR IGNORE INTO leads
    (place_id, name, address, phone, rating, review_count,
     categories, website, source_keyword)
  VALUES
    (@place_id, @name, @address, @phone, @rating, @review_count,
     @categories, @website, @source_keyword)
`;

export function insertLeadsBatch(payloads: InsertLeadPayload[]): number {
  const db   = getDb();
  const stmt = db.prepare(INSERT_SQL);
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const p of payloads) {
      const result = stmt.run(p as unknown as SqlParams);
      inserted += result.changes as number;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

// ─── Score ───────────────────────────────────────────────────────────────────

export function getUnscoredLeads(): ScoringInput[] {
  return getDb().prepare(`
    SELECT place_id, name, rating, review_count, website, categories
    FROM leads
    WHERE score IS NULL
    ORDER BY review_count DESC
  `).all() as unknown as ScoringInput[];
}

export function updateLeadScoresBatch(payloads: ScoreUpdatePayload[]): void {
  const db   = getDb();
  const stmt = db.prepare(`
    UPDATE leads SET score = @score, status = @status
    WHERE place_id = @place_id
  `);
  db.exec('BEGIN');
  try {
    for (const p of payloads) stmt.run(p as unknown as SqlParams);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ─── Outreach ────────────────────────────────────────────────────────────────

export function getScoredLeadsForOutreach(): Lead[] {
  return getDb().prepare(`
    SELECT * FROM leads
    WHERE status = 'scored' AND outreach_message IS NULL
    ORDER BY score DESC
  `).all() as unknown as Lead[];
}

export function updateLeadOutreach(payload: OutreachUpdatePayload): void {
  getDb().prepare(`
    UPDATE leads
    SET outreach_message = @outreach_message, status = @status
    WHERE place_id = @place_id
  `).run(payload as unknown as SqlParams);
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function getAllLeads(): Lead[] {
  return getDb().prepare(`
    SELECT * FROM leads ORDER BY score DESC
  `).all() as unknown as Lead[];
}

export function getLeadStats(): {
  total: number; new: number; scored: number; outreach_ready: number;
} {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'new'            THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN status = 'scored'         THEN 1 ELSE 0 END) AS scored_count,
      SUM(CASE WHEN status = 'outreach_ready' THEN 1 ELSE 0 END) AS outreach_count
    FROM leads
  `).get() as Record<string, number>;
  return {
    total:          row['total'],
    new:            row['new_count'],
    scored:         row['scored_count'],
    outreach_ready: row['outreach_count'],
  };
}
