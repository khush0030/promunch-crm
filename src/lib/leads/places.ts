// Google Places API (New) Text Search — one 20-result page per call.
// Field mask keeps billing at the Pro tier (websiteUri is the expensive field we need).

export interface PlaceResult {
  id: string;
  displayName?: { text?: string };
  websiteUri?: string;
  formattedAddress?: string;
  types?: string[];
}

export interface PlacesPage {
  places: PlaceResult[];
  nextPageToken?: string;
}

const FIELD_MASK =
  'places.id,places.displayName,places.websiteUri,places.formattedAddress,places.types,nextPageToken';

export async function searchTextPage(query: string, pageToken?: string): Promise<PlacesPage> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set');

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(pageToken ? { textQuery: query, pageToken } : { textQuery: query }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places searchText ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { places?: PlaceResult[]; nextPageToken?: string };
  return { places: json.places ?? [], nextPageToken: json.nextPageToken };
}

/** Normalized hostname for a website URL ('https://www.acme.in/x' -> 'acme.in'). */
export function websiteToDomain(website: string | undefined | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}
