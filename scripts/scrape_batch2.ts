import { ApifyClient } from 'apify-client';
import {
  APIFY_TOKEN,
  ACTOR_ID,
  KEYWORDS,
  DELHI_NCR_LOCATION,
  MAX_PLACES_PER_SEARCH,
  MIN_RATING,
  MIN_REVIEWS,
} from '../src/config';
import { initDb, insertLeadsBatch, getLeadStats } from '../src/db';
import type { ApifyPlaceResult, InsertLeadPayload } from '../src/types';

const client = new ApifyClient({ token: APIFY_TOKEN });

function passesQualityFilter(place: ApifyPlaceResult): boolean {
  const rating      = place.rating       ?? 0;
  const reviewCount = place.reviewsCount ?? 0;
  const hasNoWebsite = !place.website || place.website.trim() === '';
  return rating >= MIN_RATING && reviewCount >= MIN_REVIEWS && hasNoWebsite;
}

function toInsertPayload(place: ApifyPlaceResult, keyword: string): InsertLeadPayload {
  const cats: string[] = place.categories?.length
    ? place.categories
    : place.categoryName
      ? [place.categoryName]
      : [];
  return {
    place_id:       place.placeId,
    name:           place.title,
    address:        place.address        ?? null,
    phone:          place.phone          ?? null,
    rating:         place.rating         ?? null,
    review_count:   place.reviewsCount   ?? null,
    categories:     JSON.stringify(cats),
    website:        place.website        ?? null,
    source_keyword: keyword,
  };
}

async function scrapeKeyword(keyword: string): Promise<number> {
  console.log(`\n[scrape] Running actor for keyword: "${keyword}"`);

  const run = await client.actor(ACTOR_ID).call({
    searchStringsArray:        [keyword],
    locationQuery:             DELHI_NCR_LOCATION,
    maxCrawledPlacesPerSearch: MAX_PLACES_PER_SEARCH,
    language:                  'en',
    scrapeSocialMediaProfiles: false,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const places    = items as unknown as ApifyPlaceResult[];
  console.log(`[scrape]   Retrieved ${places.length} raw results`);

  const qualified = places.filter(passesQualityFilter);
  console.log(`[scrape]   ${qualified.length} pass filter (rating≥${MIN_RATING}, reviews≥${MIN_REVIEWS}, no website)`);

  if (qualified.length === 0) return 0;

  const payloads = qualified.map(p => toInsertPayload(p, keyword));
  const inserted = insertLeadsBatch(payloads);
  console.log(`[scrape]   ${inserted} new leads inserted (${qualified.length - inserted} duplicates skipped)`);
  return inserted;
}

async function main(): Promise<void> {
  console.log('=== Pet Lead Gen Scraper — Delhi NCR ===');
  console.log(`Filters: rating ≥ ${MIN_RATING}, reviews ≥ ${MIN_REVIEWS}, no website`);
  console.log(`Keywords: ${KEYWORDS.length}`);

  initDb();

  let totalInserted = 0;

  for (const keyword of KEYWORDS) {
    try {
      totalInserted += await scrapeKeyword(keyword);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[scrape] ERROR for keyword "${keyword}":`, err);
    }
  }

  const stats = getLeadStats();
  console.log('\n=== Scrape Complete ===');
  console.log(`New leads inserted this run: ${totalInserted}`);
  console.log(`DB totals — total: ${stats.total}, new: ${stats.new}, scored: ${stats.scored}`);
}

main().catch(err => {
  console.error('[scrape] Fatal error:', err);
  process.exit(1);
});
