// Cloudflare Pages Function — intercepts "/" and swaps the landing page's
// hardcoded version/star placeholders for live GitHub data, entirely at the
// edge. No client-side fetch, no CSP loosening: the browser gets the same
// plain static HTML it always did, just with real numbers baked in.
//
// The static markup itself is NEVER cached here — every request calls
// context.next() to get whatever's actually deployed right now (Cloudflare's
// own asset-serving layer already caches that correctly, invalidated per
// deploy). An earlier version of this file cached the *rendered page* under
// a fixed synthetic key, decoupled from both the request hostname and the
// deploy — which meant every deployment and every preview URL under this
// project shared one cache slot, and once it was written it never got
// re-rendered from a fresh deploy again, only ever re-stamped with new
// numbers on top of whatever markup happened to be cached first. That's why
// pushing markup changes appeared to silently not take effect. Caching only
// the small GitHub data below avoids that failure mode entirely: the page
// structure always reflects the real current deploy, and only the two
// numbers get a stale-while-revalidate cache.
//
// Stale-while-revalidate for that data: a visitor always gets whatever
// numbers are already cached, instantly. If they're due for a refresh, that
// happens in the background for the *next* visitor (context.waitUntil) —
// nobody's page load ever waits on GitHub except the very first request
// ever, with nothing cached yet at all.

const REPO = "jgeselle/intuneatlas";

// GitHub's unauthenticated API is capped at 60 req/hour per caller — real
// traffic only triggers a background refresh roughly this often, nowhere
// close to that limit regardless of visitor volume.
const REFRESH_AFTER_SECONDS = 900; // 15 minutes
// The data cache entry gets a long Cache-Control so the Cache API itself
// never evicts it out from under us on its own schedule — staleness is
// tracked and acted on ourselves via the cachedAt field instead.
const STORED_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours
// Bounds the one case that *can* still make a visitor wait: a true cold
// start (nothing cached yet). Never worth more than a couple seconds.
const GITHUB_FETCH_TIMEOUT_MS = 3000;

// _headers rules don't apply to Pages Functions responses at all (this
// route bypasses that file entirely by existing) — so the site's security
// headers have to be re-applied here by hand, or the homepage would
// silently lose them. Keep this in sync with /_headers.
const RESPONSE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=(), interest-cohort=()",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  // Browser always revalidates with Cloudflare — freshness comes from the
  // edge cache above, not from letting a visitor's browser hold onto a
  // stale star count on its own.
  "Cache-Control": "public, max-age=0, must-revalidate",
};

// Fixed synthetic key for the *data* cache only — deliberately decoupled
// from both the request hostname and CF_PAGES_COMMIT_SHA. Tying it to the
// commit SHA was tried and reverted: it forced a live GitHub fetch after
// every single deploy, even ones that never touched this file, multiplying
// how often a routine push happens to land on a transient GitHub hiccup.
// That's safe to do for the numbers (they're the same regardless of which
// deploy served the request) in a way it was never safe to do for the
// markup itself.
const DATA_CACHE_KEY = new Request("https://intuneatlas-landing-cache.internal/live-data");

async function fetchGitHub(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      "User-Agent": "intuneatlas-landing-page",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API ${path} returned ${res.status}`);
  return res.json();
}

// Fallback is last known good data — a better degradation than reverting to
// the static default just because one refresh had a hiccup.
async function fetchStarCount(fallback) {
  try {
    const data = await fetchGitHub(`/repos/${REPO}`);
    return typeof data.stargazers_count === "number" ? data.stargazers_count.toLocaleString("en-US") : fallback;
  } catch (err) {
    console.error("fetchStarCount failed, using fallback:", err);
    return fallback;
  }
}

async function fetchLatestVersion(fallback) {
  try {
    const data = await fetchGitHub(`/repos/${REPO}/releases/latest`);
    return data.tag_name || fallback;
  } catch (err) {
    console.error("fetchLatestVersion failed, using fallback:", err);
    return fallback;
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replaceElementText(html, id, tag, text) {
  const pattern = new RegExp(`(<${tag} id="${id}">)[^<]*(</${tag}>)`);
  return html.replace(pattern, `$1${escapeHtml(text)}$2`);
}

function withSecurityHeaders(response) {
  const withHeaders = new Response(response.body, response);
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
    withHeaders.headers.set(name, value);
  }
  return withHeaders;
}

async function fetchLiveData(fallbackVersion, fallbackStars) {
  const [version, stars] = await Promise.all([
    fetchLatestVersion(fallbackVersion),
    fetchStarCount(fallbackStars),
  ]);
  return { version, stars, cachedAt: Date.now() };
}

async function storeLiveData(cache, data) {
  const response = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${STORED_MAX_AGE_SECONDS}`,
    },
  });
  await cache.put(DATA_CACHE_KEY, response);
}

export async function onRequest(context) {
  const cache = caches.default;

  // Always the real, currently-deployed markup — this is never cached by
  // us, only by Cloudflare's own deploy-aware asset serving.
  const assetResponse = await context.next();
  const baseHtml = await assetResponse.text();

  const cachedData = await cache.match(DATA_CACHE_KEY);
  let data = cachedData ? await cachedData.json() : null;

  if (!data) {
    // True cold start for the data cache — nobody has ever computed this
    // yet. Bounded to a few seconds by GITHUB_FETCH_TIMEOUT_MS.
    data = await fetchLiveData("v0.0.3", "1,284");
    context.waitUntil(storeLiveData(cache, data));
  } else {
    const ageSeconds = (Date.now() - data.cachedAt) / 1000;
    if (ageSeconds > REFRESH_AFTER_SECONDS) {
      // Never awaited: this request doesn't wait on it, the *next* visitor
      // benefits from whatever it finds.
      context.waitUntil(fetchLiveData(data.version, data.stars).then((fresh) => storeLiveData(cache, fresh)));
    }
  }

  let bodyHtml = baseHtml;
  bodyHtml = replaceElementText(bodyHtml, "live-version", "span", data.version);
  bodyHtml = replaceElementText(bodyHtml, "live-version-2", "span", data.version);
  bodyHtml = replaceElementText(bodyHtml, "live-stars", "b", data.stars);

  const html = new Response(bodyHtml, assetResponse);
  return withSecurityHeaders(html);
}
