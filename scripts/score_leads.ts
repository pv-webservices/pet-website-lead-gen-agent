import {
  MIN_RATING,
  RATING_MAX,
  SCORE_WEIGHTS,
  REVIEW_SCORE_CEILING,
} from '../src/config';
import { initDb, getUnscoredLeads, updateLeadScoresBatch, getLeadStats } from '../src/db';
import type { ScoringInput, ScoredLead, ScoreUpdatePayload } from '../src/types';

// Scoring formula (weights sum to 100):
//   rating_score     = (rating - MIN_RATING) / (RATING_MAX - MIN_RATING) × 40
//   review_score     = min(review_count / REVIEW_SCORE_CEILING, 1) × 40
//   no_website_bonus = 20 if no website, else 0

function scoreOneLead(lead: ScoringInput): ScoredLead {
  const rating      = lead.rating       ?? MIN_RATING;
  const reviewCount = lead.review_count ?? 0;
  const hasNoWebsite = !lead.website || lead.website.trim() === '';

  const ratingNormalised = Math.max(0, (rating - MIN_RATING) / (RATING_MAX - MIN_RATING));
  const rating_score     = Math.min(ratingNormalised * SCORE_WEIGHTS.rating, SCORE_WEIGHTS.rating);

  const review_score     = Math.min(reviewCount / REVIEW_SCORE_CEILING, 1) * SCORE_WEIGHTS.reviews;

  const no_website_bonus = hasNoWebsite ? SCORE_WEIGHTS.no_website : 0;

  const score = parseFloat((rating_score + review_score + no_website_bonus).toFixed(2));

  return { ...lead, score, score_breakdown: { rating_score, review_score, no_website_bonus } };
}

function main(): void {
  console.log('=== Lead Scorer ===');
  initDb();

  const unscored = getUnscoredLeads();
  console.log(`Found ${unscored.length} unscored leads`);

  if (unscored.length === 0) {
    console.log('Nothing to score. Run `npm run scrape` first.');
    return;
  }

  const scored = unscored.map(scoreOneLead);

  const top10 = [...scored].sort((a, b) => b.score - a.score).slice(0, 10);
  console.log('\nTop 10 Leads by Score:');
  console.log('─'.repeat(72));
  for (const lead of top10) {
    const b = lead.score_breakdown;
    console.log(
      `  ${lead.score.toFixed(1).padStart(5)} | ${lead.name.padEnd(35)} ` +
      `| r:${b.rating_score.toFixed(1)} rv:${b.review_score.toFixed(1)} nw:${b.no_website_bonus}`
    );
  }
  console.log('─'.repeat(72));

  const updates: ScoreUpdatePayload[] = scored.map(s => ({
    place_id: s.place_id,
    score:    s.score,
    status:   'scored',
  }));

  updateLeadScoresBatch(updates);

  const stats = getLeadStats();
  console.log(`\nScored ${updates.length} leads.`);
  console.log(`DB totals — total: ${stats.total}, scored: ${stats.scored}, outreach_ready: ${stats.outreach_ready}`);
}

main();
