// Cloudflare Pages Function — intercepts "/" and swaps the landing page's
// hardcoded version/star placeholders for live GitHub data, entirely at the
// edge. No client-side fetch, no CSP loosening: the browser gets the same
// plain static HTML it always did, just with real numbers baked in.

const REPO = "jgeselle/intuneatlas";

// GitHub's unauthenticated API is capped at 60 req/hour per caller — this
// cache means we hit it a handful of times an hour regardless of site
// traffic, and it's what makes nearly every real visitor a fast edge-cache
// hit instead of waiting on two GitHub round trips.
const EDGE_CACHE_SECONDS = 900; // 15 minutes

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
  // stale star count for 15 minutes on its own.
  "Cache-Control": "public, max-age=0, must-revalidate",
};

class TextReplacer {
  constructor(text) {
    this.text = text;
  }
  element(element) {
    element.setInnerContent(this.text);
  }
}

async function fetchGitHub(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      "User-Agent": "intuneatlas-landing-page",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} returned ${res.status}`);
  return res.json();
}

// Fallback is whatever's already baked into the static HTML — a GitHub
// hiccup degrades to "shows the last shipped static text," never a blank
// or broken badge.
async function fetchStarCount(fallback) {
  try {
    const data = await fetchGitHub(`/repos/${REPO}`);
    return typeof data.stargazers_count === "number" ? data.stargazers_count.toLocaleString("en-US") : fallback;
  } catch {
    return fallback;
  }
}

async function fetchLatestVersion(fallback) {
  try {
    const data = await fetchGitHub(`/repos/${REPO}/releases/latest`);
    return data.tag_name || fallback;
  } catch {
    return fallback;
  }
}

function withSecurityHeaders(response) {
  const withHeaders = new Response(response.body, response);
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
    withHeaders.headers.set(name, value);
  }
  return withHeaders;
}

export async function onRequest(context) {
  const cache = caches.default;
  // Fixed synthetic key, not the real request URL — keeps the cache
  // insulated from any query-string variance on the incoming request.
  const cacheKey = new Request("https://intuneatlas-landing-cache.internal/home", context.request);

  const cached = await cache.match(cacheKey);
  if (cached) return withSecurityHeaders(cached);

  // context.next() falls through to the static asset server (there's no
  // other Function this route could match) — called exactly once, and a
  // clone of its result is always the safe fallback below, so a failure
  // anywhere past this point can never throw a broken page at a visitor.
  const assetResponse = await context.next();
  const fallback = assetResponse.clone();

  try {
    const [version, stars] = await Promise.all([fetchLatestVersion("v0.0.3"), fetchStarCount("1,284")]);

    const rewritten = new HTMLRewriter()
      .on("#live-version", new TextReplacer(version))
      .on("#live-version-2", new TextReplacer(version))
      .on("#live-stars", new TextReplacer(stars))
      .transform(assetResponse);

    const html = new Response(rewritten.body, rewritten);
    html.headers.set("Cache-Control", `public, max-age=${EDGE_CACHE_SECONDS}`);
    context.waitUntil(cache.put(cacheKey, html.clone()));

    return withSecurityHeaders(html);
  } catch {
    return withSecurityHeaders(fallback);
  }
}
