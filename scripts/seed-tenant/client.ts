// Write-capable Microsoft Graph client for seeding test data into a
// dedicated test tenant. Deliberately NOT built on src/graph.ts, which is
// GET-only and part of the shipped, read-only product — this file must
// never be imported from src/ or cliMain.ts. Nothing in scripts/bundle.mjs
// ever pulls this in (its entryPoint is dist/cli.js), but the separation
// is enforced by not being reachable from that import graph at all, not
// just by the bundler happening not to find it.
//
// Required environment variables (never write these to a file):
//   SEED_TENANT         tenant id or domain to authenticate against
//   SEED_CLIENT_ID      a SEPARATE app registration from IntuneAtlas's own,
//                        with write Application permissions
//                        (DeviceManagementConfiguration.ReadWrite.All,
//                        Group.ReadWrite.All)
//   SEED_CLIENT_SECRET  that app's client secret
//
// Safety net for a wrong-tenant credential lives in the flow, not a second
// env var: before any real write, this resolves the *actual* connected
// tenant from a live /organization call and makes you confirm it
// interactively. A second pre-typed "expected tenant" env var was tried
// and dropped — it's just as easy to fat-finger as SEED_TENANT itself, so
// it wouldn't catch the mistake it exists to catch. Showing you what
// Graph actually resolved, in the moment, does.
import { createInterface } from "node:readline/promises";
import { createClientCredentialsAuth } from "../../src/auth/clientCredentials.js";

export const GRAPH_V1_BASE = "https://graph.microsoft.com/v1.0";
export const GRAPH_BETA_BASE = "https://graph.microsoft.com/beta";

// Every object this toolkit creates carries this in its display name, so
// teardown.ts can find (and only touch) what it created.
export const TEST_TAG = "[intuneatlas-test]";

export function taggedName(label: string): string {
  return `${TEST_TAG} ${label}`;
}

export interface SeedClient {
  readonly dryRun: boolean;
  get<T>(path: string, base?: string, headers?: Record<string, string>): Promise<T>;
  getAll<T>(path: string, base?: string, headers?: Record<string, string>): Promise<T[]>;
  post<T>(path: string, body: unknown, base?: string): Promise<T>;
  patch(path: string, body: unknown, base?: string): Promise<void>;
  del(path: string, base?: string): Promise<void>;
}

interface ODataPage<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See scripts/seed-tenant/README.md.`);
  }
  return value;
}

/**
 * Builds a write-capable client, or a dry-run stand-in that logs every
 * mutating call instead of making it. Always resolves the real connected
 * tenant first (a read-only /organization call) and prints it; for a
 * real (non-dry-run) run, also requires you to type "yes" to confirm
 * that's the tenant you meant before returning a client capable of
 * writing anything.
 */
export async function createSeedClient(options: { dryRun: boolean }): Promise<SeedClient> {
  const tenant = requiredEnv("SEED_TENANT");
  const clientId = requiredEnv("SEED_CLIENT_ID");
  const clientSecret = requiredEnv("SEED_CLIENT_SECRET");

  const auth = createClientCredentialsAuth({ tenantId: tenant, clientId, clientSecret });
  const token = await auth.getToken();

  const org = await resolveOrganization(token);
  console.log(`Connected tenant: id ${org.id}, domains: ${org.domains.join(", ") || "none"}`);

  if (!options.dryRun) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('This will make real writes to the tenant above. Type "yes" to continue: ');
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      throw new Error("Aborted — tenant not confirmed.");
    }
  }

  async function request<T>(
    method: string,
    path: string,
    base: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T | undefined> {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    if (method !== "GET" && options.dryRun) {
      console.log(`[dry-run] ${method} ${url}${body ? `\n  ${JSON.stringify(body)}` : ""}`);
      return undefined;
    }

    // 429 is routine at any real volume against this toolkit's own
    // concurrency (confirmed live: bulk-importing ~1500 settings tripped
    // it repeatedly) — retry with the server's own Retry-After rather than
    // failing the whole run over a transient rate limit.
    const MAX_ATTEMPTS = 6;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfterSeconds = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Graph ${method} ${url} failed: ${res.status} ${res.statusText}\n${text}`);
      }
      if (res.status === 204) return undefined;
      const text = await res.text();
      return text ? (JSON.parse(text) as T) : undefined;
    }
    // Unreachable: the loop always returns or throws before MAX_ATTEMPTS is exhausted without a final non-429 response.
    throw new Error(`Graph ${method} ${url} failed: exhausted retries`);
  }

  return {
    dryRun: options.dryRun,
    async get<T>(path: string, base = GRAPH_V1_BASE, headers?: Record<string, string>): Promise<T> {
      return (await request<T>("GET", path, base, undefined, headers)) as T;
    },
    async getAll<T>(path: string, base = GRAPH_V1_BASE, headers?: Record<string, string>): Promise<T[]> {
      const items: T[] = [];
      let next: string | undefined = path;
      while (next) {
        const page = (await request<ODataPage<T>>("GET", next, base, undefined, headers)) as ODataPage<T>;
        items.push(...page.value);
        next = page["@odata.nextLink"];
      }
      return items;
    },
    async post<T>(path: string, body: unknown, base = GRAPH_V1_BASE): Promise<T> {
      // In dry-run mode there's no real response — callers that chain off
      // a created object's id (e.g. assigning a just-created policy) need
      // to tolerate this; scenario builders check `client.dryRun` before
      // relying on a returned id.
      return (await request<T>("POST", path, base, body)) as T;
    },
    async patch(path: string, body: unknown, base = GRAPH_V1_BASE): Promise<void> {
      await request("PATCH", path, base, body);
    },
    async del(path: string, base = GRAPH_V1_BASE): Promise<void> {
      await request("DELETE", path, base);
    },
  };
}

interface OrganizationResponse {
  value: Array<{ id: string; verifiedDomains?: Array<{ name: string }> }>;
}

async function resolveOrganization(token: string): Promise<{ id: string; domains: string[] }> {
  const res = await fetch(`${GRAPH_V1_BASE}/organization`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Tenant resolution failed: GET /organization returned ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as OrganizationResponse;
  const org = body.value[0];
  if (!org) {
    throw new Error("Tenant resolution failed: /organization returned no tenant.");
  }
  return { id: org.id, domains: org.verifiedDomains?.map((d) => d.name) ?? [] };
}
