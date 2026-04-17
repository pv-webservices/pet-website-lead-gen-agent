import { ApifyClient } from 'apify-client';
import { APIFY_TOKEN, ACTOR_ID, DELHI_NCR_LOCATION, MAX_PLACES_PER_SEARCH } from '../src/config';
import { initDb, insertOrIgnoreLead, getLeadStats } from '../src/db';
import type { ApifyPlaceResult, InsertLeadPayload } from '../src/types';

// ─── Vet-specific queries for Delhi NCR ─────────────────────────────────────

const VET_QUERIES: string[] = [
  'veterinary clinic South Delhi',
  'vet clinic South Delhi',
  'animal hospital South Delhi',
  'pet clinic South Delhi',
  'veterinary doctor Delhi',
];

const MIN_RATING  = 4.5;
const MIN_REVIEWS = 100;

// ─── Apify client ────────────────────────────────────────────────────────────

const client = new ApifyClient({ token: APIFY_TOKEN });

// ─── Filter ──────────────────────────────────────────────────────────────────

function passesFilter(place: ApifyPlaceResult): boolean {
  const rating      = place.rating       ?? 0;
  const reviewCount = place.reviewsCount ?? 0;   // user_ratings_total in Maps API
  const noWebsite   = !place.website || place.website.trim() === '';
  return rating >= MIN_RATING && reviewCount >= MIN_REVIEWS && noWebsite;
}

// ─── Transform ───────────────────────────────────────────────────────────────

function toPayload(place: ApifyPlaceResult, query: string): InsertLeadPayload {
  return {
    place_id:      place.placeId,
    name:          place.title,
    address:       place.address       ?? null,
    city:          place.city          ?? null,
    lat:           place.location?.lat ?? null,
    lng:           place.location?.lng ?? null,
    rating:        place.rating        ?? null,
    review_count:  place.reviewsCount  ?? null,
    website_url:   null,                          // only no-website leads reach here
    phone:         place.phone         ?? null,
    niche:         'vet',
    batch_keyword: query,
  };
}

// ─── Per-query scrape ────────────────────────────────────────────────────────

async function scrapeQuery(query: string): Promise<{ fetched: number; inserted: number }> {
  console.log(`\n[scrape] "${query}"`);

  const run = await client.actor(ACTOR_ID).call({
    searchStringsArray:        [query],
    locationQuery:             DELHI_NCR_LOCATION,
    maxCrawledPlacesPerSearch: MAX_PLACES_PER_SEARCH,
    language:                  'en',
    scrapeSocialMediaProfiles: {
      facebooks:  false,
      instagrams: false,
      youtubes:   false,
      tiktoks:    false,
      twitters:   false,
    },
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const places    = items as unknown as ApifyPlaceResult[];
  console.log(`         fetched: ${places.length}`);

  const qualified = places.filter(passesFilter);
  console.log(`         qualified (rating≥${MIN_RATING}, reviews≥${MIN_REVIEWS}, no website): ${qualified.length}`);

  let inserted = 0;
  for (const place of qualified) {
    if (insertOrIgnoreLead(toPayload(place, query))) inserted++;
  }
  console.log(`         inserted: ${inserted}  (${qualified.length - inserted} duplicates skipped)`);

  return { fetched: places.length, inserted };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Vet Clinic Scraper — Delhi NCR (batch 2) ===');
  console.log(`Queries: ${VET_QUERIES.length}`);
  console.log(`Filters: rating ≥ ${MIN_RATING} | reviews ≥ ${MIN_REVIEWS} | no website\n`);

  initDb();

  let totalFetched  = 0;
  let totalInserted = 0;

  for (const query of VET_QUERIES) {
    try {
      const { fetched, inserted } = await scrapeQuery(query);
      totalFetched  += fetched;
      totalInserted += inserted;
      // Polite delay between actor runs
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[scrape] ERROR on query "${query}":`, err);
    }
  }

  const stats = getLeadStats();
  console.log('\n=== Done ===');
  console.log(`Raw results fetched : ${totalFetched}`);
  console.log(`New leads inserted  : ${totalInserted}`);
  console.log(`DB totals — total: ${stats.total} | new: ${stats.new} | scored: ${stats.scored}`);
}

main().catch(err => {
  console.error('[scrape] Fatal error:', err);
  process.exit(1);
});
