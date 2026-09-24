/* Free, no-signup address lookup for the "+ New" project form, scoped to Western Australia.
   Backed by OpenStreetMap Nominatim (nominatim.openstreetmap.org) — used through this Function,
   not directly from the browser, because Nominatim's usage policy asks for a real identifying
   User-Agent on every request (browsers won't let client-side JS set that header) and for
   requests to stay well under 1/sec, which this Function's server-side call satisfies.
   No API key, no billing — see https://operations.osmfoundation.org/policies/nominatim/ for the
   policy this Function follows. If Danjoo ever needs higher volume or more polished suggestions,
   swap this Function's internals for Google Places Autocomplete or Geoscape/PSMA without touching
   the dashboard's front-end code — it only ever calls GET /api/address-search?q=... */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Roughly encloses Western Australia (left, top, right, bottom = min_lon, max_lat, max_lon, min_lat).
const WA_VIEWBOX = "112.5,-13.5,129.5,-35.5";
const USER_AGENT = "DanjooConstructDashboard/1.0 (internal project dashboard; admin@danjooconstruct.com.au)";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function shortLabel(addr) {
  const streetLine = [addr.house_number, addr.road].filter(Boolean).join(" ");
  const suburb = addr.suburb || addr.town || addr.city || addr.village || addr.locality;
  return [streetLine, suburb, "WA", addr.postcode].filter(Boolean).join(", ");
}

export default async (request) => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  // Keep this to real, deliberate lookups — not one Nominatim request per keystroke.
  if (q.length < 3) {
    return json({ results: [] });
  }
  if (q.length > 200) {
    return json({ error: "Search text is too long" }, 400);
  }

  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "au",
    viewbox: WA_VIEWBOX,
    bounded: "1",
    limit: "8",
    q
  });

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-AU"
      }
    });

    if (!res.ok) {
      return json({ error: `Address lookup returned ${res.status}` }, 502);
    }

    const data = await res.json();
    const results = (Array.isArray(data) ? data : [])
      // Belt-and-braces on top of the WA viewbox: only keep results Nominatim itself tags as WA,
      // so a query near the NT/SA border doesn't leak a non-WA suggestion into the list.
      .filter(r => r.address && r.address.state === "Western Australia")
      .map(r => ({ label: shortLabel(r.address), lat: r.lat, lon: r.lon }))
      .filter(r => r.label);

    // De-duplicate identical labels (Nominatim sometimes returns the same address twice at
    // different precision levels).
    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      if (seen.has(r.label)) continue;
      seen.add(r.label);
      deduped.push(r);
    }

    return json({ results: deduped.slice(0, 6) });
  } catch (error) {
    console.error("address-search function error", error);
    return json({ error: "Address lookup failed" }, 500);
  }
};

export const config = {
  path: "/api/address-search"
};
