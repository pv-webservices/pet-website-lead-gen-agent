import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── Apify ───────────────────────────────────────────────────────────────────

export const APIFY_TOKEN: string = (() => {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error('APIFY_TOKEN is not set. Copy .env.example to .env and fill it in.');
  }
  return token;
})();

export const ACTOR_ID = 'compass/crawler-google-places';

// ─── Database ────────────────────────────────────────────────────────────────

export const DB_PATH: string =
  process.env.DB_PATH ?? path.resolve(__dirname, '../db/leads.db');

export const SCHEMA_PATH: string =
  path.resolve(__dirname, '../db/schema.sql');

// ─── Search Parameters ───────────────────────────────────────────────────────

export const DELHI_NCR_LOCATION = 'Delhi NCR, India';

export const KEYWORDS: string[] = [
  'pet groomer Delhi',
  'dog groomer Delhi',
  'cat groomer Delhi',
  'pet salon Delhi',
  'pet groomer Gurgaon',
  'pet groomer Noida',
  'dog groomer Gurgaon',
  'dog groomer Noida',
  'veterinary clinic Delhi',
  'specialized vet clinic Delhi',
  'exotic animal vet Delhi',
  'orthopedic vet Delhi',
  'veterinary specialist Gurgaon',
  'veterinary specialist Noida',
  'animal hospital Delhi NCR',
];

// ─── Quality Filters ─────────────────────────────────────────────────────────

export const MIN_RATING: number  = parseFloat(process.env.MIN_RATING  ?? '4.5');
export const MIN_REVIEWS: number = parseInt(process.env.MIN_REVIEWS   ?? '100', 10);
export const MAX_PLACES_PER_SEARCH = 50;

// ─── Scoring Weights (must sum to 100) ───────────────────────────────────────

export const SCORE_WEIGHTS = {
  rating:     40,
  reviews:    40,
  no_website: 20,
} as const;

export const REVIEW_SCORE_CEILING = 500;
export const RATING_MAX           = 5.0;
