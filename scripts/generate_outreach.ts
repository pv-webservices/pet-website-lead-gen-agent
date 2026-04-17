import * as fs   from 'fs';
import * as path from 'path';
import { initDb, getScoredLeadsForOutreach, updateLeadOutreach, getLeadStats } from '../src/db';
import type { Lead, BusinessCategory, OutreachContext, OutreachUpdatePayload } from '../src/types';

// ─── Classification ──────────────────────────────────────────────────────────

const GROOMER_KEYWORDS = ['groo', 'salon', 'spa', 'pet care', 'pet shop', 'boarding'];
const VET_KEYWORDS     = ['vet', 'clinic', 'hospital', 'animal', 'doctor', 'dr.', 'surgical', 'ortho'];

function classifyBusiness(lead: Lead): BusinessCategory {
  const text = [lead.name, lead.categories ?? ''].join(' ').toLowerCase();
  const isVet     = VET_KEYWORDS.some(k => text.includes(k));
  const isGroomer = GROOMER_KEYWORDS.some(k => text.includes(k));
  if (isVet && !isGroomer) return 'vet';
  if (isGroomer)           return 'groomer';
  return 'unknown';
}

// ─── Templates ───────────────────────────────────────────────────────────────

function groomerTemplate(lead: Lead): string {
  const name      = lead.name.split(' ')[0];
  const reviewStr = lead.review_count
    ? `With ${lead.review_count} reviews and a ${lead.rating}-star rating`
    : 'With your outstanding reputation';
  return `Hi ${name},

${reviewStr}, your grooming salon clearly stands out in Delhi NCR — pet parents love what you do.

I noticed you don't yet have a dedicated website, which means many pet owners searching online may not be finding you. We help grooming businesses like yours get a professional website with online booking in under a week — no tech skills needed.

Would you be open to a quick 10-minute call this week to see if it's a fit?

Warm regards,
[Your Name]
[Your Phone]`;
}

function vetTemplate(lead: Lead): string {
  const name      = lead.name.split(' ')[0];
  const reviewStr = lead.review_count
    ? `${lead.review_count} happy pet families have already reviewed`
    : 'Your clients have reviewed';
  return `Hi Dr. / Team ${name},

${reviewStr} your clinic and the feedback is exceptional. It's clear you provide outstanding care.

One thing I noticed: you don't currently have a website, which means new pet owners in your area may be going to competitors who are easier to find online. We build clean, professional websites for vet clinics with appointment-request forms and a Google Maps listing boost — typically live within 5–7 days.

Would you have 10 minutes this week for a brief call?

Best regards,
[Your Name]
[Your Phone]`;
}

function unknownTemplate(lead: Lead): string {
  return `Hi ${lead.name} team,

We came across your business while researching top-rated pet service providers in Delhi NCR — your reviews are fantastic!

We noticed you don't currently have a website, and we'd love to help you establish an online presence that matches the quality of your service.

Would you be open to a quick conversation this week?

Best regards,
[Your Name]
[Your Phone]`;
}

function generateMessage(ctx: OutreachContext): string {
  switch (ctx.category) {
    case 'groomer': return groomerTemplate(ctx.lead);
    case 'vet':     return vetTemplate(ctx.lead);
    default:        return unknownTemplate(ctx.lead);
  }
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function escapeCsv(value: unknown): string {
  const str = String(value ?? '');
  return str.includes(',') || str.includes('\n') || str.includes('"')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function exportToCsv(leads: Lead[], outputPath: string): void {
  const headers = ['place_id', 'name', 'address', 'phone', 'rating', 'review_count', 'score', 'source_keyword', 'outreach_message'];
  const rows    = leads.map(l => headers.map(h => escapeCsv((l as unknown as Record<string, unknown>)[h])).join(','));
  fs.writeFileSync(outputPath, [headers.join(','), ...rows].join('\n'), 'utf-8');
  console.log(`[outreach] CSV exported to: ${outputPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('=== Outreach Message Generator ===');
  initDb();

  const leads = getScoredLeadsForOutreach();
  console.log(`Found ${leads.length} scored leads awaiting outreach messages`);

  if (leads.length === 0) {
    console.log('Nothing to process. Run `npm run score` first.');
    return;
  }

  const updates: OutreachUpdatePayload[] = [];
  const processed: Lead[]               = [];

  for (const lead of leads) {
    const category = classifyBusiness(lead);
    const message  = generateMessage({ lead, category });
    updates.push({ place_id: lead.place_id, outreach_message: message, status: 'outreach_ready' });
    processed.push({ ...lead, outreach_message: message });
  }

  for (const update of updates) updateLeadOutreach(update);

  const dataDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(dataDir, `outreach_${timestamp}.csv`);
  exportToCsv(processed, outputPath);

  const stats = getLeadStats();
  console.log(`\nGenerated messages for ${updates.length} leads.`);
  console.log(`DB totals — total: ${stats.total}, outreach_ready: ${stats.outreach_ready}`);
}

main();
