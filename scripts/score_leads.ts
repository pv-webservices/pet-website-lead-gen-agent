import { initDb, updateLeadScore, getLeadStats } from '../src/db';
import type { Lead } from '../src/types';
import { getDb } from '../src/db';

// ─── Fetch unscored leads ────────────────────────────────────────────────────

function getUnscoredLeads(): Lead[] {
  return getDb().prepare(`
    SELECT * FROM leads WHERE score = 0
  `).all() as unknown as Lead[];
}

// ─── Scoring logic (0–10, no LLM) ───────────────────────────────────────────

function computeScore(lead: Lead): number {
  let score = 0;

  if ((lead.rating ?? 0) >= 4.5) score += 4;

  const reviews = lead.review_count ?? 0;
  if (reviews >= 200)       score += 4;
  else if (reviews >= 100)  score += 3;

  const city = (lead.city ?? lead.address ?? '').toLowerCase();
  if (city.includes('south delhi') || city.includes('gurugram')) score += 2;

  return score;
}

function assignTier(score: number): string {
  if (score >= 9) return 'A+';
  if (score >= 7) return 'A';
  if (score >= 5) return 'B';
  return 'C';
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('=== Lead Scorer ===');
  initDb();

  const leads = getUnscoredLeads();
  console.log(`Found ${leads.length} unscored leads (score = 0)`);

  if (leads.length === 0) {
    console.log('Nothing to score. Run `npm run scrape` first.');
    return;
  }

  const tally: Record<string, number> = { 'A+': 0, A: 0, B: 0, C: 0 };

  for (const lead of leads) {
    const score = computeScore(lead);
    const tier  = assignTier(score);
    updateLeadScore(lead.place_id, score, tier);
    tally[tier]++;
  }

  const stats = getLeadStats();
  console.log(`\nScored ${leads.length} leads:`);
  console.log(`  A+ : ${tally['A+']}`);
  console.log(`  A  : ${tally['A']}`);
  console.log(`  B  : ${tally['B']}`);
  console.log(`  C  : ${tally['C']}`);
  console.log(`\nDB totals — total: ${stats.total} | scored: ${stats.scored} | outreach_ready: ${stats.outreach_ready}`);
}

main();
