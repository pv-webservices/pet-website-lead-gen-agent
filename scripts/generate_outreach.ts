import Anthropic from '@anthropic-ai/sdk';
import * as fs   from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { initDb, getDb } from '../src/db';
import type { Lead } from '../src/types';
import { SQLInputValue } from 'node:sqlite';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TOP_N    = parseInt(process.env.TOP_N ?? '10', 10);
const MODEL    = 'claude-sonnet-4-6';
const OUT_FILE = path.resolve(__dirname, '../data/outreach_messages.csv');

const anthropic = new Anthropic();   // reads ANTHROPIC_API_KEY from env

// ─── DB query ─────────────────────────────────────────────────────────────────

function getTopScoredLeads(limit: number): Lead[] {
  return getDb().prepare(`
    SELECT * FROM leads
    WHERE score > 0
    ORDER BY score DESC, created_at ASC
    LIMIT @limit
  `).all({ limit } as unknown as Record<string, SQLInputValue>) as unknown as Lead[];
}

// ─── Lead context object (compact — only what Claude needs) ───────────────────

interface LeadCtx {
  name:         string;
  city:         string | null;
  rating:       number | null;
  review_count: number | null;
  niche:        string;
}

function ctx(lead: Lead): LeadCtx {
  return {
    name:         lead.name,
    city:         lead.city,
    rating:       lead.rating,
    review_count: lead.review_count,
    niche:        lead.niche,
  };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

// System prompt is identical for every lead → cache it with cache_control.
// On the second lead onwards, this block is served from cache (~0.1× cost).
const SYSTEM_TEXT =
  `You are a specialist copywriter for a local SEO agency targeting high-rated ` +
  `veterinary clinics and pet groomers in India that lack websites. ` +
  `Write concise, conversion-focused WhatsApp and email outreach for a ` +
  `GBP (Google Business Profile) + website bundle pitch. ` +
  `Use only the facts given. Do not invent names, awards, or claims.`;

function userPrompt(lead: Lead): string {
  return (
    `Lead data: ${JSON.stringify(ctx(lead))}\n\n` +
    `Return ONLY valid JSON — no markdown fences, no explanation:\n` +
    `{"whatsapp":"<≤160 chars, reference rating & reviews>",` +
    `"email":{"subject":"<≤60 chars>","body":"<3–4 sentences>"}}`
  );
}

// ─── Claude call ──────────────────────────────────────────────────────────────

interface OutreachResult {
  whatsapp: string;
  email: { subject: string; body: string };
}

async function generate(lead: Lead): Promise<OutreachResult> {
  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 512,
    system: [
      {
        type:          'text',
        text:          SYSTEM_TEXT,
        cache_control: { type: 'ephemeral' },   // cached for ~5 min across all leads
      },
    ],
    messages: [{ role: 'user', content: userPrompt(lead) }],
  });

  const raw  = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  // Strip markdown fences if present (defensive)
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(json) as OutreachResult;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

type CsvRow = { lead_id: number; channel: string; subject: string; message: string };

function esc(v: string): string {
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

function writeCsv(rows: CsvRow[], filePath: string): void {
  const header = 'lead_id,channel,subject,message';
  const lines  = rows.map(r =>
    [esc(String(r.lead_id)), esc(r.channel), esc(r.subject), esc(r.message)].join(',')
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, [header, ...lines].join('\n'), 'utf-8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`=== Outreach Generator (model: ${MODEL}) ===`);
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
    process.stdout.write(`[${i + 1}/${leads.length}] ${lead.name} (score ${lead.score}) … `);

    try {
      const result = await generate(lead);

      // Track cache hits for transparency
      // (cache_read_input_tokens > 0 means system prompt was served from cache)

      console.log('done');

      // ── Console output ──
      console.log(`\n  📱 WhatsApp:\n  ${result.whatsapp}`);
      console.log(`\n  📧 Email subject: ${result.email.subject}`);
      console.log(`  📧 Email body:\n  ${result.email.body.replace(/\n/g, '\n  ')}\n`);
      console.log('  ' + '─'.repeat(68));

      csvRows.push(
        { lead_id: lead.id, channel: 'whatsapp', subject: '',                      message: result.whatsapp         },
        { lead_id: lead.id, channel: 'email',    subject: result.email.subject,    message: result.email.body       },
      );
    } catch (err) {
      console.log(`ERROR — ${(err as Error).message}`);
    }

    // Small delay to stay within rate limits
    if (i < leads.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  if (csvRows.length > 0) {
    writeCsv(csvRows, OUT_FILE);
    console.log(`\nCSV written → ${OUT_FILE}`);
    console.log(`Rows: ${csvRows.length} (${csvRows.length / 2} leads × 2 channels)`);
  }
}

main().catch(err => {
  console.error('[outreach] Fatal error:', err);
  process.exit(1);
});
