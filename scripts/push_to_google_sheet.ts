import * as path from 'path';
import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import { initDb, getLeadsWithLatestOutreach } from '../src/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SHEET_ID    = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '';
const SA_EMAIL    = process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? '';
const PRIVATE_KEY = (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const SHEET_NAME  = 'Leads';
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets';

const HEADER = [
  'Lead ID', 'Name', 'City', 'Rating', 'Review Count',
  'Niche', 'Tier', 'Phone', 'Batch Keyword',
  'WhatsApp Message', 'Email Subject', 'Email Body',
];

function validate(): void {
  if (!SHEET_ID)    throw new Error('Missing GOOGLE_SHEETS_SPREADSHEET_ID in .env');
  if (!SA_EMAIL)    throw new Error('Missing GOOGLE_SHEETS_CLIENT_EMAIL in .env');
  if (!PRIVATE_KEY) throw new Error('Missing GOOGLE_SHEETS_PRIVATE_KEY in .env');
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

  const leads = getLeadsWithLatestOutreach();
  console.log(`Building sheet rows for ${leads.length} leads…`);

  const rows: string[][] = leads.map(l => [
    String(l.id),
    l.name,
    l.city         ?? '',
    l.rating       != null ? String(l.rating) : '',
    l.review_count != null ? String(l.review_count) : '',
    l.niche,
    l.tier         ?? '',
    l.phone        ?? '',
    l.batch_keyword,
    l.whatsapp_text ?? '',
    l.email_subject ?? '',
    l.email_body    ?? '',
  ]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range:         `${SHEET_NAME}!A2:L`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId:     SHEET_ID,
    range:             `${SHEET_NAME}!A1`,
    valueInputOption:  'RAW',
    requestBody:       { values: [HEADER, ...rows] },
  });

  console.log(`Pushed ${rows.length} leads to Google Sheet (sheet: ${SHEET_NAME})`);
}

main().catch(err => {
  console.error('[sheet:push] Fatal error:', err);
  process.exit(1);
});
