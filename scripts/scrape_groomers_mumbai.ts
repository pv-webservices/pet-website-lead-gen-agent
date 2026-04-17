import { ApifyClient } from 'apify-client';
import { APIFY_TOKEN, ACTOR_ID, MAX_PLACES_PER_SEARCH, MIN_RATING, MIN_REVIEWS } from '../src/config';
import { initDb, insertOrIgnoreLead, getLeadStats } from '../src/db';
import type { ApifyPlaceResult, InsertLeadPayload } from '../src/types';

type Niche = 'groomer';

interface ScrapeJob {
  query: string;
  location: string;
  niche: Niche;
}

// 8 keyword variants to maximise unique place_id coverage for the 20-lead target.
// insertOrIgnoreLead deduplicates by place_id, so overlapping results are harmless.
const SCRAPE_JOBS: ScrapeJob[] = [
  { query: 'pet groomer',         location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
  { query: 'dog groomer',         location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
  { query: 'pet salon',           location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
  { query: 'dog grooming salon',  location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
  { query: 'pet grooming',        location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
  { query: 'dog salon',           location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
  { query: 'cat groomer',         location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
  { query: 'mobile pet groomer',  location: 'Mumbai, Maharashtra, India', niche: 'groomer' },
];

const client = new ApifyClient({ token: APIFY_TOKEN });

function getRating(place: ApifyPlaceResult): number {
  return place.rating ?? place.totalScore ?? 0;
}

function hasNoWebsite(place: ApifyPlaceResult): boolean {
  return !place.website || place.website.trim() === '';
}

function passesFilter(place: ApifyPlaceResult): boolean {
  const rating = getRating(place);
  const reviewCount = place.reviewsCount ?? 0;
  return rating >= MIN_RATING && reviewCount >= MIN_REVIEWS && hasNoWebsite(place);
}

function inferCity(place: ApifyPlaceResult, fallbackLocation: string): string | null {
  if (place.city?.trim()) return place.city.trim();
  const address = place.address?.toLowerCase() ?? '';
  if (address.includes('mumbai') || address.includes('bombay')) return 'Mumbai';
  if (address.includes('thane')) return 'Thane';
  if (address.includes('navi mumbai')) return 'Navi Mumbai';
  return fallbackLocation.split(',')[0]?.trim() ?? null;
}

function toPayload(place: ApifyPlaceResult, job: ScrapeJob): InsertLeadPayload {
  return {
    place_id:      place.placeId,
    name:          place.title,
    address:       place.address ?? null,
    city:          inferCity(place, job.location),
    lat:           place.location?.lat ?? null,
    lng:           place.location?.lng ?? null,
    rating:        place.rating ?? place.totalScore ?? null,
    review_count:  place.reviewsCount ?? null,
    website_url:   place.website?.trim() || null,
    phone:         place.phone ?? null,
    niche:         job.niche,
    batch_keyword: `${job.query} | ${job.location}`,
  };
}

async function scrapeJob(job: ScrapeJob): Promise<{ fetched: number; qualified: number; inserted: number }> {
  console.log(`\n[scrape] Query="${job.query}" | Location="${job.location}" | Niche=${job.niche}`);

  const run = await client.actor(ACTOR_ID).call({
    searchStringsArray:        [job.query],
    locationQuery:             job.location,
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
  const places = items as unknown as ApifyPlaceResult[];
  const qualified = places.filter(passesFilter);

  console.log(`[scrape]   fetched=${places.length} qualified=${qualified.length}`);

  let inserted = 0;
  for (const place of qualified) {
    if (insertOrIgnoreLead(toPayload(place, job))) inserted++;
  }

  console.log(`[scrape]   inserted=${inserted} duplicates_skipped=${qualified.length - inserted}`);
  return { fetched: places.length, qualified: qualified.length, inserted };
}

async function main(): Promise<void> {
  console.log('=== Mumbai Groomer Lead Scraper (target: 20 leads) ===');
  console.log(`Jobs: ${SCRAPE_JOBS.length}`);
  console.log(`Filters: rating >= ${MIN_RATING}, reviews >= ${MIN_REVIEWS}, no website`);

  initDb();

  let totalFetched = 0;
  let totalQualified = 0;
  let totalInserted = 0;

  for (const job of SCRAPE_JOBS) {
    try {
      const { fetched, qualified, inserted } = await scrapeJob(job);
      totalFetched += fetched;
      totalQualified += qualified;
      totalInserted += inserted;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`[scrape] ERROR on query "${job.query}" at "${job.location}":`, err);
    }
  }

  const stats = getLeadStats();
  console.log('\n=== Scrape Complete ===');
  console.log(`Raw places fetched : ${totalFetched}`);
  console.log(`Qualified leads    : ${totalQualified}`);
  console.log(`New leads inserted : ${totalInserted}`);
  console.log(`DB totals - total: ${stats.total}, new: ${stats.new}, scored: ${stats.scored}`);
}

main().catch(err => {
  console.error('[scrape] Fatal error:', err);
  process.exit(1);
});
