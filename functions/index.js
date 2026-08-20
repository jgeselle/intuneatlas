// Cloudflare Pages Function — intercepts "/" and swaps the landing page's
// hardcoded version/star placeholders for live GitHub data, entirely at the
// edge. No client-side fetch, no CSP loosening: the browser gets the same
// plain static HTML it always did, just with real numbers baked in.
//
// Deliberately buffers the HTML to a string and does plain string
// replacement instead of streaming it through HTMLRewriter — the page is a
// few dozen KB, buffering it costs nothing, and it avoids any interaction
// between HTMLRewriter and the cloned fallback response that isn't worth
// re-litigating without real production logs to debug it against.

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

export async function onRequest(context) {
  const cache = caches.default;
  // Fixed synthetic key, not the real request URL — keeps the cache
  // insulated from any query-string variance on the incoming request.
  const cacheKey = new Request("https://intuneatlas-landing-cache.internal/home", context.request);

  const cached = await cache.match(cacheKey);
  if (cached) return withSecurityHeaders(cached);

  // context.next() falls through to the static asset server (there's no
  // other Function this route could match) — called exactly once.
  const assetResponse = await context.next();
  const originalHtml = await assetResponse.text();

  try {
    const [version, stars] = await Promise.all([fetchLatestVersion("v0.0.3"), fetchStarCount("1,284")]);

    let rewrittenHtml = replaceElementText(originalHtml, "live-version", "span", version);
    rewrittenHtml = replaceElementText(rewrittenHtml, "live-version-2", "span", version);
    rewrittenHtml = replaceElementText(rewrittenHtml, "live-stars", "b", stars);

    const html = new Response(rewrittenHtml, assetResponse);
    html.headers.set("Cache-Control", `public, max-age=${EDGE_CACHE_SECONDS}`);
    context.waitUntil(cache.put(cacheKey, html.clone()));

    return withSecurityHeaders(html);
  } catch (err) {
    // Never let this surface as a broken page — but silently falling back
    // with no trace makes a real bug indistinguishable from "GitHub had a
    // hiccup." Log it so it's visible in Workers Logs.
    console.error("Landing page live-data render failed, serving static fallback:", err);
    return withSecurityHeaders(new Response(originalHtml, assetResponse));
  }
}
