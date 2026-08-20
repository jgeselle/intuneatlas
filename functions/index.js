// Cloudflare Pages Function — intercepts "/" and swaps the landing page's
// hardcoded version/star placeholders for live GitHub data, entirely at the
// edge. No client-side fetch, no CSP loosening: the browser gets the same
// plain static HTML it always did, just with real numbers baked in.
//
// Stale-while-revalidate: a visitor always gets whatever's already cached,
// instantly. If it's due for a refresh, that happens in the background for
// the *next* visitor (context.waitUntil) — nobody's page load ever waits
// on GitHub except the very first request ever, right after a deploy, with
// nothing cached yet at all.
//
// Buffers the HTML to a string and does plain string replacement instead
// of streaming it through HTMLRewriter — the page is a few dozen KB,
// buffering it costs nothing, and it avoids any interaction between
// HTMLRewriter and a cloned response that wasn't worth re-litigating
// without real production logs to debug it against.

const REPO = "jgeselle/intuneatlas";

// GitHub's unauthenticated API is capped at 60 req/hour per caller — real
// traffic only triggers a background refresh roughly this often, nowhere
// close to that limit regardless of visitor volume.
const REFRESH_AFTER_SECONDS = 900; // 15 minutes
// Stored cache entries get a long Cache-Control so the Cache API itself
// never evicts them out from under us on its own schedule — staleness is
// tracked and acted on ourselves via the X-Cached-At header instead.
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

// Fallback is whatever's already in `baseHtml` — for a cold start that's
// the static default baked into the HTML; for a background refresh it's
// last time's live value, which is a better degradation than reverting to
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

// Renders live HTML starting from `baseHtml` (the id-tagged placeholders
// still need to exist in it, whatever their current text is), stores the
// result, and returns it. `templateResponse` only donates headers
// (content-type etc.) to the new Response — its body is never read here.
async function renderAndStore(baseHtml, templateResponse, cache, cacheKey) {
  let bodyHtml = baseHtml;
  try {
    const [version, stars] = await Promise.all([fetchLatestVersion("v0.0.3"), fetchStarCount("1,284")]);
    bodyHtml = replaceElementText(baseHtml, "live-version", "span", version);
    bodyHtml = replaceElementText(bodyHtml, "live-version-2", "span", version);
    bodyHtml = replaceElementText(bodyHtml, "live-stars", "b", stars);
  } catch (err) {
    // Never let this surface as a broken page — but silently falling back
    // with no trace makes a real bug indistinguishable from "GitHub had a
    // hiccup." Log it so it's visible in Workers Logs.
    console.error("Landing page live-data render failed, keeping previous values:", err);
  }

  const html = new Response(bodyHtml, templateResponse);
  html.headers.set("X-Cached-At", String(Date.now()));
  html.headers.set("Cache-Control", `public, max-age=${STORED_MAX_AGE_SECONDS}`);
  await cache.put(cacheKey, html.clone());
  return html;
}

export async function onRequest(context) {
  const cache = caches.default;
  // Fixed synthetic key, not the real request URL — keeps the cache
  // insulated from any query-string variance on the incoming request and,
  // deliberately, from which deploy is currently live: tying it to
  // CF_PAGES_COMMIT_SHA was tried and reverted — it forced a cold start
  // (a live GitHub fetch) after every single deploy, even ones that never
  // touched this file, which just multiplies how often a routine push
  // happens to land on a transient GitHub hiccup. The 15-minute background
  // refresh below already keeps data fresh on its own, independent of
  // deploys — that's the mechanism that should own freshness, not deploys.
  const cacheKey = new Request("https://intuneatlas-landing-cache.internal/home", context.request);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedAt = Number(cached.headers.get("X-Cached-At") ?? 0);
    const ageSeconds = (Date.now() - cachedAt) / 1000;
    if (ageSeconds > REFRESH_AFTER_SECONDS) {
      // Clone immediately, before returning anything to the visitor below
      // — refreshes off this clone, using its own already-rendered text as
      // the template (same ids, just old data) rather than re-fetching the
      // static asset. Never awaited: this request doesn't wait on it.
      const template = cached.clone();
      context.waitUntil(template.text().then((baseHtml) => renderAndStore(baseHtml, template, cache, cacheKey)));
    }
    return withSecurityHeaders(cached);
  }

  // True cold start: nothing cached yet at all. Someone has to pay for the
  // first live fetch — bounded to a few seconds by GITHUB_FETCH_TIMEOUT_MS
  // — and everyone after this is instant.
  const assetResponse = await context.next();
  const baseHtml = await assetResponse.text();
  const html = await renderAndStore(baseHtml, assetResponse, cache, cacheKey);
  return withSecurityHeaders(html);
}
