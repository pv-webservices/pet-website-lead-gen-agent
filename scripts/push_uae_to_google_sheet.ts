import * as path from 'path';
import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import { initDb, getUaeLeads } from '../src/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SHEET_ID    = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '';
const SA_EMAIL    = process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? '';
const PRIVATE_KEY = (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const SHEET_NAME  = 'UAE Leads';
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets';

// Exact column order per spec.
const HEADER = [
  'S.No',
  'Lead ID',
  'Name',
  'City',
  'Rating',
  'Review Count',
  'Niche',
  'Tier',
  'Phone',
  'Batch Keyword',
  'WhatsApp Message',   // left empty for UAE Tier A
  'Email Subject',      // left empty for UAE Tier A
  'Email Body',         // left empty for UAE Tier A
  'Instagram',
  'WhatsApp Link',
];

function validate(): void {
  if (!SHEET_ID)    throw new Error('Missing GOOGLE_SHEETS_SPREADSHEET_ID in .env');
  if (!SA_EMAIL)    throw new Error('Missing GOOGLE_SHEETS_CLIENT_EMAIL in .env');
  if (!PRIVATE_KEY) throw new Error('Missing GOOGLE_SHEETS_PRIVATE_KEY in .env');
}

async function ensureSheetExists(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some(s => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
    console.log(`[uae:sheet] Created new tab: "${SHEET_NAME}"`);
  }
}

async function main(): Promise<void> {
  validate();
  initDb();

  const auth = new google.auth.JWT({
    email:  SA_EMAIL,
    key:    PRIVATE_KEY,
    scopes: [SCOPE],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  await ensureSheetExists(sheets, SHEET_ID);

  const leads = getUaeLeads();
  console.log(`Building UAE sheet rows for ${leads.length} leads...`);

  const rows: string[][] = leads.map((l, i) => [
    String(i + 1),                                           // S.No
    String(l.id),                                            // Lead ID
    l.name,
    l.city          ?? '',
    l.rating        != null ? String(l.rating)        : '',
    l.review_count  != null ? String(l.review_count)  : '',
    l.niche,
    l.tier          ?? 'A',                                  // always A for this batch
    l.phone         ?? '',
    l.batch_keyword,
    '',                                                      // WhatsApp Message (empty)
    '',                                                      // Email Subject (empty)
    '',                                                      // Email Body (empty)
    l.instagram     ?? '',
    l.whatsapp_link ?? '',
  ]);

  // Clear data rows only (preserve manual edits to other sheets).
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range:         `${SHEET_NAME}!A2:O`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId:     SHEET_ID,
    range:             `${SHEET_NAME}!A1`,
    valueInputOption:  'RAW',
    requestBody:       { values: [HEADER, ...rows] },
  });

  console.log(`Pushed ${rows.length} UAE leads to Google Sheet (tab: "${SHEET_NAME}")`);
}

main().catch(err => {
  console.error('[uae:sheet] Fatal error:', err);
  process.exit(1);
});
