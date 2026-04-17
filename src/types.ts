// ─── Apify Actor Response Shape ─────────────────────────────────────────────

export interface ApifyPlaceResult {
  placeId:      string;
  title:        string;
  address:      string | null;
  phone:        string | null;
  rating:       number | null;
  reviewsCount: number | null;
  website:      string | null;
  categoryName: string | null;
  categories:   string[] | null;
  location?: {
    lat: number;
    lng: number;
  };
  [key: string]: unknown;
}

// ─── Database Row Shape ──────────────────────────────────────────────────────

export interface Lead {
  id:               number;
  place_id:         string;
  name:             string;
  address:          string | null;
  phone:            string | null;
  rating:           number | null;
  review_count:     number | null;
  categories:       string | null;   // JSON-serialised string[]
  website:          string | null;
  source_keyword:   string;
  score:            number | null;
  outreach_message: string | null;
  status:           LeadStatus;
  created_at:       string;
  updated_at:       string;
}

export type LeadStatus =
  | 'new'
  | 'scored'
  | 'outreach_ready'
  | 'contacted'
  | 'converted'
  | 'rejected';

// ─── Insert / Update Payloads ────────────────────────────────────────────────

export type InsertLeadPayload = Omit<
  Lead,
  'id' | 'score' | 'outreach_message' | 'status' | 'created_at' | 'updated_at'
>;

export interface ScoreUpdatePayload {
  place_id: string;
  score:    number;
  status:   'scored';
}

export interface OutreachUpdatePayload {
  place_id:         string;
  outreach_message: string;
  status:           'outreach_ready';
}

// ─── Scoring Intermediates ───────────────────────────────────────────────────

export interface ScoringInput {
  place_id:     string;
  name:         string;
  rating:       number | null;
  review_count: number | null;
  website:      string | null;
  categories:   string | null;
}

export interface ScoredLead extends ScoringInput {
  score:           number;
  score_breakdown: {
    rating_score:     number;
    review_score:     number;
    no_website_bonus: number;
  };
}

// ─── Outreach ────────────────────────────────────────────────────────────────

export type BusinessCategory = 'groomer' | 'vet' | 'unknown';

export interface OutreachContext {
  lead:     Lead;
  category: BusinessCategory;
}
