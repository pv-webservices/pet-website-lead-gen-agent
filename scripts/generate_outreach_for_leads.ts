import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  initDb,
  getScoredLeads,
  getLeadsWithOutreachIds,
  insertOutreachMessage,
} from '../src/db';
import type { Lead, BusinessCategory } from '../src/types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const LIMIT    = parseInt(process.env.LIMIT ?? '50', 10);
const CSV_FILE = path.resolve(__dirname, '../data/outreach_messages.csv');
const CSV_HEADER = 'lead_id,name,city,niche,channel,subject,message_text';

// ─── Template helpers (mirrors generate_outreach.ts logic) ───────────────────

function detectCategory(lead: Lead): BusinessCategory {
  const source = `${lead.niche} ${lead.name} ${lead.batch_keyword}`.toLowerCase();
  if (source.includes('groom')) return 'groomer';
  if (source.includes('vet') || source.includes('clinic') || source.includes('hospital')) return 'vet';
  return 'unknown';
}

function city(lead: Lead): string  { return lead.city?.trim() || 'your area'; }
function rating(lead: Lead): string {
  return `${(lead.rating ?? 0).toFixed(1)} stars from ${lead.review_count ?? 0} reviews`;
}

function buildWhatsapp(lead: Lead, cat: BusinessCategory): string {
  const service = cat === 'groomer' ? 'pet grooming business' : cat === 'vet' ? 'pet clinic' : 'pet business';
  const msg =
    `Hi ${lead.name}, I noticed your ${service} in ${city(lead)} has ${rating(lead)}. ` +
    `We help high-rated pet businesses turn Google visitors into bookings with a simple website and GBP improvements. Interested?`;
  return msg.length <= 160 ? msg : msg.slice(0, 157).trimEnd() + '...';
}

function buildEmailSubject(lead: Lead, cat: BusinessCategory): string {
  const prefix = cat === 'groomer' ? 'More grooming bookings' : 'More pet enquiries';
  const s = `${prefix} for ${lead.name}`;
  return s.length <= 60 ? s : s.slice(0, 57).trimEnd() + '...';
}

function buildEmailBody(lead: Lead, cat: BusinessCategory): string {
  const offer =
    cat === 'groomer' ? 'Google Business Profile plus website setup for grooming bookings' :
    cat === 'vet'     ? 'Google Business Profile plus website setup for clinic enquiries' :
                        'Google Business Profile plus website setup';
  return [
    `Hi ${lead.name},`,
    ``,
    `I came across your listing in ${city(lead)} and saw that you already have ${rating(lead)}, which is a strong sign that people trust your business.`,
    `Businesses like yours often lose potential bookings when customers cannot quickly view services, timings, pricing, or contact details on a dedicated site.`,
    `We help pet businesses with ${offer}, designed to turn profile views into more calls, WhatsApp messages, and appointments.`,
    `If you want, I can share a simple outline of what this could look like for ${lead.name}.`,
  ].join('\n');
}

// ─── CSV helper ───────────────────────────────────────────────────────────────

function esc(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function appendCsvRows(rows: string[][]): void {
  fs.mkdirSync(path.dirname(CSV_FILE), { recursive: true });
  const needsHeader = !fs.existsSync(CSV_FILE);
  const lines = rows.map(r => r.map(esc).join(','));
  const content = (needsHeader ? CSV_HEADER + '\n' : '') + lines.join('\n') + '\n';
  fs.appendFileSync(CSV_FILE, content, 'utf-8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  initDb();

  const candidates = getScoredLeads(LIMIT);
  const doneIds    = getLeadsWithOutreachIds();
  const leads      = candidates.filter(l => !doneIds.has(l.id));

  console.log(`=== Outreach Generator (templates) ===`);
  console.log(`Scored leads fetched: ${candidates.length} | Already processed: ${doneIds.size} | To process: ${leads.length}\n`);

  if (leads.length === 0) {
    console.log('Nothing to process. All scored leads already have outreach messages.');
    return;
  }

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const cat  = detectCategory(lead);

    const whatsapp     = buildWhatsapp(lead, cat);
    const emailSubject = buildEmailSubject(lead, cat);
    const emailBody    = buildEmailBody(lead, cat);

    insertOutreachMessage({ lead_id: lead.id, channel: 'whatsapp', subject: null,        message_text: whatsapp });
    insertOutreachMessage({ lead_id: lead.id, channel: 'email',    subject: emailSubject, message_text: emailBody });

    appendCsvRows([
      [String(lead.id), lead.name, lead.city ?? '', lead.niche, 'whatsapp', '',           whatsapp],
      [String(lead.id), lead.name, lead.city ?? '', lead.niche, 'email',    emailSubject, emailBody],
    ]);

    console.log(`[${i + 1}/${leads.length}] ${lead.name} — done`);
  }

  console.log(`\nGenerated outreach for ${leads.length} leads. Messages saved to DB and data/outreach_messages.csv`);
}

main().catch(err => {
  console.error('[outreach:generate] Fatal error:', err);
  process.exit(1);
});
