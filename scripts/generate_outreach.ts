import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { SQLInputValue } from 'node:sqlite';
import { initDb, getDb } from '../src/db';
import type { Lead, BusinessCategory } from '../src/types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TOP_N = parseInt(process.env.TOP_N ?? '10', 10);
const OUT_FILE = path.resolve(__dirname, '../data/outreach_messages.csv');

type CsvRow = { lead_id: number; channel: string; subject: string; message: string };

interface OutreachResult {
  whatsapp: string;
  email: { subject: string; body: string };
}

function getTopScoredLeads(limit: number): Lead[] {
  return getDb().prepare(`
    SELECT * FROM leads
    WHERE score > 0
    ORDER BY score DESC, created_at ASC
    LIMIT @limit
  `).all({ limit } as unknown as Record<string, SQLInputValue>) as unknown as Lead[];
}

function detectCategory(lead: Lead): BusinessCategory {
  const source = `${lead.niche} ${lead.name} ${lead.batch_keyword}`.toLowerCase();
  if (source.includes('groom')) return 'groomer';
  if (source.includes('vet') || source.includes('clinic') || source.includes('hospital')) return 'vet';
  return 'unknown';
}

function serviceLabel(category: BusinessCategory): string {
  if (category === 'groomer') return 'pet grooming business';
  if (category === 'vet') return 'pet clinic';
  return 'pet business';
}

function offerLabel(category: BusinessCategory): string {
  if (category === 'groomer') return 'Google Business Profile plus website setup for grooming bookings';
  if (category === 'vet') return 'Google Business Profile plus website setup for clinic enquiries';
  return 'Google Business Profile plus website setup';
}

function cityLabel(lead: Lead): string {
  return lead.city?.trim() || 'your area';
}

function ratingLabel(lead: Lead): string {
  const rating = lead.rating ?? 0;
  const reviews = lead.review_count ?? 0;
  return `${rating.toFixed(1)} stars from ${reviews} reviews`;
}

function whatsappText(lead: Lead, category: BusinessCategory): string {
  const city = cityLabel(lead);
  const label = ratingLabel(lead);
  const business = serviceLabel(category);
  const message =
    `Hi ${lead.name}, I noticed your ${business} in ${city} has ${label}. ` +
    `We help high-rated pet businesses turn Google visitors into bookings with a simple website and GBP improvements. Interested?`;
  return message.length <= 160 ? message : message.slice(0, 157).trimEnd() + '...';
}

function emailSubject(lead: Lead, category: BusinessCategory): string {
  const prefix = category === 'groomer' ? 'More grooming bookings' : 'More pet enquiries';
  const subject = `${prefix} for ${lead.name}`;
  return subject.length <= 60 ? subject : subject.slice(0, 57).trimEnd() + '...';
}

function emailBody(lead: Lead, category: BusinessCategory): string {
  const city = cityLabel(lead);
  const label = ratingLabel(lead);
  const offer = offerLabel(category);

  return [
    `Hi ${lead.name},`,
    ``,
    `I came across your listing in ${city} and saw that you already have ${label}, which is a strong sign that people trust your business.`,
    `Businesses like yours often lose potential bookings when customers cannot quickly view services, timings, pricing, or contact details on a dedicated site.`,
    `We help pet businesses with ${offer}, designed to turn profile views into more calls, WhatsApp messages, and appointments.`,
    `If you want, I can share a simple outline of what this could look like for ${lead.name}.`,
  ].join('\n');
}

function generate(lead: Lead): OutreachResult {
  const category = detectCategory(lead);
  return {
    whatsapp: whatsappText(lead, category),
    email: {
      subject: emailSubject(lead, category),
      body: emailBody(lead, category),
    },
  };
}

function esc(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function writeCsv(rows: CsvRow[], filePath: string): void {
  const header = 'lead_id,channel,subject,message';
  const lines = rows.map(row =>
    [esc(String(row.lead_id)), esc(row.channel), esc(row.subject), esc(row.message)].join(','),
  );

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, [header, ...lines].join('\n'), 'utf-8');
}

async function main(): Promise<void> {
  console.log('=== Outreach Generator (local templates) ===');
  initDb();

  const leads = getTopScoredLeads(TOP_N);
  console.log(`Top ${leads.length} scored leads (score > 0, ordered by score DESC)\n`);

  if (leads.length === 0) {
    console.log('No scored leads found. Run `npm run score` first.');
    return;
  }

  const csvRows: CsvRow[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const result = generate(lead);

    console.log(`[${i + 1}/${leads.length}] ${lead.name} (score ${lead.score})`);
    console.log(`\n  WhatsApp:\n  ${result.whatsapp}`);
    console.log(`\n  Email subject: ${result.email.subject}`);
    console.log(`  Email body:\n  ${result.email.body.replace(/\n/g, '\n  ')}\n`);
    console.log('  ' + '-'.repeat(68));

    csvRows.push(
      { lead_id: lead.id, channel: 'whatsapp', subject: '', message: result.whatsapp },
      { lead_id: lead.id, channel: 'email', subject: result.email.subject, message: result.email.body },
    );
  }

  writeCsv(csvRows, OUT_FILE);
  console.log(`\nCSV written -> ${OUT_FILE}`);
  console.log(`Rows: ${csvRows.length} (${csvRows.length / 2} leads x 2 channels)`);
}

main().catch(err => {
  console.error('[outreach] Fatal error:', err);
  process.exit(1);
});
