import { ApifyClient } from 'apify-client';
import {
  APIFY_TOKEN, ACTOR_ID, MAX_PLACES_PER_SEARCH,
  UAE_MIN_RATING, UAE_MIN_REVIEWS, UAE_TIER_A_JOBS,
} from '../src/config';
import { initDb, insertOrIgnoreLead, getLeadStats } from '../src/db';
import type { ApifyPlaceResult, InsertLeadPayload } from '../src/types';

const client = new ApifyClient({ token: APIFY_TOKEN });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRating(place: ApifyPlaceResult): number {
  return place.rating ?? place.totalScore ?? 0;
}

function hasNoWebsite(place: ApifyPlaceResult): boolean {
  return !place.website || place.website.trim() === '';
}

/** Tier A: rating >= 4.3, reviews >= 50, NO website. */
function passesUaeTierA(place: ApifyPlaceResult): boolean {
  return (
    getRating(place) >= UAE_MIN_RATING &&
    (place.reviewsCount ?? 0) >= UAE_MIN_REVIEWS &&
    hasNoWebsite(place)
  );
}

/**
 * Best-effort Instagram URL from whatever Apify returns.
 * The actor can expose socialProfiles (if enabled) or additionalInfo.
 * Falls back to null - the export script will leave the cell empty.
 */
function extractInstagram(place: ApifyPlaceResult): string | null {
  // Apify "Google Places Crawler" can return socialProfiles.instagram
  const socials = (place as Record<string, unknown>)['socialProfiles'] as
    | Record<string, string>
    | undefined;
  if (socials?.instagram) return socials.instagram;

  // Some actor versions surface it under additionalInfo.Instagram
  const info = (place as Record<string, unknown>)['additionalInfo'] as
    | Record<string, unknown>
    | undefined;
  const ig = info?.['Instagram'] ?? info?.['instagram'];
  if (typeof ig === 'string' && ig.trim()) return ig.trim();

  return null;
}

/**
 * Best-effort WhatsApp wa.me link.
 * Checks socialProfiles, additionalInfo, and the raw phone number.
 */
function extractWhatsApp(place: ApifyPlaceResult): string | null {
  const socials = (place as Record<string, unknown>)['socialProfiles'] as
    | Record<string, string>
    | undefined;
  if (socials?.whatsapp) return socials.whatsapp;

  const info = (place as Record<string, unknown>)['additionalInfo'] as
    | Record<string, unknown>
    | undefined;
  const wa = info?.['WhatsApp'] ?? info?.['whatsapp'];
  if (typeof wa === 'string' && wa.trim()) return wa.trim();

  // Derive from phone if it looks like a UAE mobile (05x)
  const phone = place.phone?.replace(/\D/g, '') ?? '';
  if (phone.startsWith('971') && phone.length >= 11) return `https://wa.me/${phone}`;
  if (phone.startsWith('05') && phone.length === 10) {
    return `https://wa.me/971${phone.slice(1)}`;
  }

  return null;
}

// ─── Per-job Scrape ───────────────────────────────────────────────────────────

interface JobResult { fetched: number; qualified: number; inserted: number }

async function scrapeUaeJob(job: (typeof UAE_TIER_A_JOBS)[number]): Promise<JobResult> {
  console.log(`\n[uae:scrape] Query="${job.query}" | Location="${job.location}" | Niche=${job.niche}`);

  const run = await client.actor(ACTOR_ID).call({
    searchStringsArray:        [job.query],
    locationQuery:             job.location,
    maxCrawledPlacesPerSearch: MAX_PLACES_PER_SEARCH,
    language:                  'en',
    scrapeSocialMediaProfiles: {
      facebooks:  false,
      instagrams: true,   // enable for UAE - we want Instagram if available
      youtubes:   false,
      tiktoks:    false,
      twitters:   false,
    },
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const places = items as unknown as ApifyPlaceResult[];
  const qualified = places.filter(passesUaeTierA);

  console.log(`[uae:scrape]   fetched=${places.length} tier_a=${qualified.length}`);

  let inserted = 0;
  for (const place of qualified) {
    const payload: InsertLeadPayload = {
      place_id:      place.placeId,
      name:          place.title,
      address:       place.address ?? null,
      city:          job.city,
      lat:           place.location?.lat ?? null,
      lng:           place.location?.lng ?? null,
      rating:        getRating(place) || null,
      review_count:  place.reviewsCount ?? null,
      website_url:   null,             // Tier A = no website
      phone:         place.phone ?? null,
      niche:         job.niche,
      batch_keyword: `${job.query} | ${job.location}`,
      instagram:     extractInstagram(place),
      whatsapp_link: extractWhatsApp(place),
    };
    if (insertOrIgnoreLead(payload)) inserted++;
  }

  console.log(`[uae:scrape]   inserted=${inserted} duplicates_skipped=${qualified.length - inserted}`);
  return { fetched: places.length, qualified: qualified.length, inserted };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== UAE Tier A Lead Gen Scraper ===');
  console.log(`Jobs: ${UAE_TIER_A_JOBS.length}`);
  console.log(`Filters: rating >= ${UAE_MIN_RATING}, reviews >= ${UAE_MIN_REVIEWS}, no website`);

  initDb();

  let totalFetched = 0, totalQualified = 0, totalInserted = 0;

  for (const job of UAE_TIER_A_JOBS) {
    try {
      const { fetched, qualified, inserted } = await scrapeUaeJob(job);
      totalFetched    += fetched;
      totalQualified  += qualified;
      totalInserted   += inserted;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`[uae:scrape] ERROR on query "${job.query}" at "${job.location}":`, err);
    }
  }

  const stats = getLeadStats();
  console.log('\n=== UAE Scrape Complete ===');
  console.log(`Raw places fetched : ${totalFetched}`);
  console.log(`Tier A leads       : ${totalQualified}`);
  console.log(`New leads inserted : ${totalInserted}`);
  console.log(`DB totals - total: ${stats.total}, new: ${stats.new}, scored: ${stats.scored}`);
}

main().catch(err => {
  console.error('[uae:scrape] Fatal error:', err);
  process.exit(1);
});
