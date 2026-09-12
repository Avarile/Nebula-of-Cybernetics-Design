import type {
  Actor,
  CallOptions,
  CallResponse,
  CheckResult,
  Principal,
  RawBody,
} from './types';

/**
 * HTTP client for the live API suite.
 *
 * Three things it does that a bare `fetch` does not:
 *
 *  1. **Self-paces against the throttler.** The app registers ThrottlerGuard
 *     globally (THROTTLE_LIMIT requests per THROTTLE_TTL seconds, per IP). A
 *     comprehensive sweep issues far more than that, so without pacing the run
 *     would report a wall of 429s that say nothing about the endpoints. The
 *     client keeps a sliding window and sleeps before it would exceed the
 *     budget; a 429 that slips through anyway is retried after `Retry-After`.
 *  2. **Records every call against its OpenAPI template**, so the run can end
 *     with a coverage number rather than a vibe.
 *  3. **Carries per-actor tokens**, so `actor: 'user'` and `actor: 'admin'`
 *     hit the same helper without threading headers through every call site.
 */
export class ApiClient {
  readonly results: CheckResult[] = [];
  private readonly principals = new Map<Actor, Principal>();
  private suite = 'unassigned';
  private window: number[] = [];

  /**
   * Paths that carry their own, much tighter `@Throttle` budget. The global
   * pacing cannot see these, and burning through one costs 15s of backoff per
   * call — enough, on a full run, to push the whole suite past its own access
   * token lifetime.
   */
  private readonly pathBudgets: Array<{
    match: string;
    limit: number;
    ttlMs: number;
    window: number[];
  }> = [
    { match: '/auth/login', limit: 5, ttlMs: 60_000, window: [] },
    { match: '/auth/forgot-password', limit: 3, ttlMs: 900_000, window: [] },
    { match: '/auth/reset-password', limit: 10, ttlMs: 900_000, window: [] },
  ];

  constructor(
    private readonly baseUrl: string,
    private readonly rate: { limit: number; ttlMs: number },
    private readonly verbose: boolean,
  ) {}

  /**
   * Registers a principal, stored by reference rather than copied.
   *
   * That matters: a `renew` callback closes over the principal object to read
   * the current refresh token, and the client writes the rotated token back
   * onto it. A copy here would leave the callback replaying a spent token,
   * which the server reads as theft and answers by revoking the whole family.
   */
  setPrincipal(actor: Actor, principal: Principal): void {
    principal.expiresAt = expiryOf(principal.accessToken);
    this.principals.set(actor, principal);
  }

  hasPrincipal(actor: Actor): boolean {
    return this.principals.has(actor);
  }

  principal(actor: Actor): Principal {
    const p = this.principals.get(actor);
    if (!p) throw new Error(`No principal registered for actor "${actor}"`);
    return p;
  }

  /** Rotate a principal's access token in place (after refresh/password change). */
  updateTokens(
    actor: Actor,
    tokens: { accessToken: string; refreshToken?: string },
  ): void {
    const p = this.principal(actor);
    p.accessToken = tokens.accessToken;
    p.expiresAt = expiryOf(tokens.accessToken);
    if (tokens.refreshToken) p.refreshToken = tokens.refreshToken;
  }

  /**
   * Renews a principal's access token when it is close to expiring.
   *
   * Renewal is a plain fetch rather than a recorded check: it is bookkeeping the
   * suite does to stay logged in, not a claim about the API, and counting it
   * would inflate both the results and the coverage numbers.
   */
  private async ensureFresh(actor: Actor): Promise<void> {
    const p = this.principals.get(actor);
    if (!p?.renew || p.expiresAt === undefined) return;

    const secondsLeft = p.expiresAt - Math.floor(Date.now() / 1000);
    if (secondsLeft > RENEW_MARGIN_SECONDS) return;

    const renewed = await p.renew().catch(() => null);
    if (!renewed) return;

    p.accessToken = renewed.accessToken;
    p.expiresAt = expiryOf(renewed.accessToken);
    if (renewed.refreshToken) p.refreshToken = renewed.refreshToken;
    if (this.verbose) console.log(`  … renewed the ${actor} access token`);
  }

  beginSuite(name: string): void {
    this.suite = name;
  }

  /** Record a check that was deliberately not executed, with the reason. */
  skip(name: string, template: string, method: string, reason: string): void {
    this.results.push({
      suite: this.suite,
      name,
      method,
      template,
      url: template,
      actor: 'anon',
      expected: [],
      status: 0,
      ok: true,
      skipped: true,
      ms: 0,
      detail: reason,
    });
    if (this.verbose) console.log(`  ○ ${name} — skipped: ${reason}`);
  }

  /**
   * Record a verdict the suite reached without a further HTTP call — a claim
   * about a response already in hand, checked after the call that produced it.
   */
  assert(
    name: string,
    method: string,
    template: string,
    failure?: string,
  ): void {
    this.results.push({
      suite: this.suite,
      name,
      method,
      template,
      url: template,
      actor: 'anon',
      expected: [],
      status: failure ? 0 : 200,
      ok: !failure,
      ms: 0,
      detail: failure,
    });
    if (this.verbose) {
      console.log(
        `  ${failure ? '✗' : '✓'} ${name}${failure ? `\n      ${failure}` : ''}`,
      );
    }
  }

  async call<T = any>(opts: CallOptions): Promise<CallResponse<T>> {
    const actor = opts.actor ?? 'admin';
    const expected = normalizeExpect(opts.expect);

    // The agent principal only exists once the auth suite has exchanged a
    // service credential for a token. Running a later suite on its own is a
    // normal thing to do while iterating, so degrade to a skip rather than
    // failing checks that were never really attempted.
    if (actor !== 'anon' && actor !== 'raw' && !this.hasPrincipal(actor)) {
      this.skip(
        opts.name,
        opts.path,
        opts.method,
        `no "${actor}" principal in this run`,
      );
      return {
        status: 0,
        body: undefined as T,
        headers: new Headers(),
        ok: false,
      };
    }

    const url = this.buildUrl(opts);

    if (actor !== 'anon' && actor !== 'raw') await this.ensureFresh(actor);
    await this.pace(opts.path);

    const started = Date.now();
    let res: Response;
    let body: any;

    try {
      ({ res, body } = await this.send(opts, url, actor));

      // The throttler is per-IP and shared with anything else touching this
      // server, and `/auth/login` carries its own far tighter budget (5/min)
      // that the global pacing cannot see. Back off on the server's own terms
      // rather than reporting a 429 as an endpoint failure.
      //
      // The wait is capped. Client-side windows reset with the process but the
      // server's live in Redis, so a second run inside fifteen minutes meets
      // `/auth/forgot-password` (3 per 15 min) still exhausted and asks us to
      // wait the better part of an hour. Obeying that literally hung the run;
      // giving up and saying so is far more useful than a suite that appears
      // to have frozen.
      for (let attempt = 0; res.status === 429 && attempt < 3; attempt += 1) {
        const header = Number(res.headers.get('retry-after'));
        const advised =
          Number.isFinite(header) && header > 0 ? header * 1000 : 15_000;
        const waitMs = Math.min(advised, MAX_THROTTLE_WAIT_MS);
        if (this.verbose) {
          console.log(
            `  … 429 on ${opts.path}, waiting ${Math.ceil(waitMs / 1000)}s` +
              (advised > waitMs
                ? ` (server asked for ${Math.ceil(advised / 1000)}s)`
                : ''),
          );
        }
        await sleep(waitMs + 500);
        this.window.length = 0;
        for (const b of this.pathBudgets) b.window.length = 0;
        ({ res, body } = await this.send(opts, url, actor));
      }

      // Still throttled after backing off: the endpoint was never exercised,
      // so record that rather than a verdict the response cannot support.
      if (res.status === 429) {
        this.skip(
          opts.name,
          opts.path,
          opts.method,
          'still rate-limited after backoff — a previous run consumed this endpoint’s window',
        );
        return {
          status: 429,
          body: body as T,
          headers: res.headers,
          ok: false,
        };
      }
    } catch (err) {
      const ms = Date.now() - started;
      this.record(opts, actor, expected, 0, ms, url, String(err));
      return {
        status: 0,
        body: undefined as T,
        headers: new Headers(),
        ok: false,
      };
    }

    const ms = Date.now() - started;
    const statusOk =
      expected.length === 0
        ? res.status >= 200 && res.status < 300
        : expected.includes(res.status);

    let detail: string | undefined;
    if (!statusOk) detail = describeMismatch(expected, res.status, body);
    else if (opts.assert) {
      const failure = opts.assert(body, res);
      if (failure) detail = `assertion failed: ${failure}`;
    }

    this.record(opts, actor, expected, res.status, ms, url, detail);
    return {
      status: res.status,
      body: body as T,
      headers: res.headers,
      ok: !detail,
    };
  }

  private async send(
    opts: CallOptions,
    url: string,
    actor: Actor,
  ): Promise<{ res: Response; body: any }> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };

    if (actor === 'raw' && opts.token) {
      headers.authorization = `Bearer ${opts.token}`;
    } else if (actor !== 'anon') {
      headers.authorization = `Bearer ${this.principal(actor).accessToken}`;
    }

    let payload: RawBody | undefined;
    if (opts.rawBody !== undefined) {
      payload = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(opts.body);
    }

    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: payload as never,
    });
    const body = await parseBody(res);
    return { res, body };
  }

  private record(
    opts: CallOptions,
    actor: Actor,
    expected: number[],
    status: number,
    ms: number,
    url: string,
    detail?: string,
  ): void {
    const ok = !detail;
    this.results.push({
      suite: this.suite,
      name: opts.name,
      method: opts.method,
      template: opts.path,
      url,
      actor,
      expected,
      status,
      ok,
      ms,
      detail,
      soft: opts.soft,
    });
    if (this.verbose) {
      const mark = ok ? '✓' : opts.soft ? '!' : '✗';
      const line = `  ${mark} ${opts.method.padEnd(6)} ${opts.path} → ${status} (${ms}ms) ${opts.name}`;
      console.log(detail ? `${line}\n      ${detail}` : line);
    }
  }

  private buildUrl(opts: CallOptions): string {
    let path = opts.path;
    for (const [key, value] of Object.entries(opts.params ?? {})) {
      path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
    const missing = path.match(/\{[^}]+\}/);
    if (missing) {
      throw new Error(
        `Unresolved path parameter ${missing[0]} in ${opts.path}`,
      );
    }

    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value === undefined || value === null) continue;
      qs.append(key, String(value));
    }
    const suffix = qs.toString();
    return `${this.baseUrl}${path}${suffix ? `?${suffix}` : ''}`;
  }

  /**
   * Sliding-window pacing. Keeps the run just under the server's throttle
   * budget so 429s are the exception rather than the rule.
   */
  private async pace(path: string): Promise<void> {
    const scoped = this.pathBudgets.find((b) => path === b.match);
    if (scoped)
      await this.paceWindow(scoped.window, scoped.limit, scoped.ttlMs, path);
    await this.paceWindow(
      this.window,
      this.rate.limit - 5,
      this.rate.ttlMs,
      'global',
    );
  }

  private async paceWindow(
    window: number[],
    rawLimit: number,
    ttlMs: number,
    label: string,
  ): Promise<void> {
    const budget = Math.max(1, rawLimit);
    for (;;) {
      const now = Date.now();
      // Mutate in place: the caller holds this array.
      const live = window.filter((t) => now - t < ttlMs);
      window.length = 0;
      window.push(...live);

      if (window.length < budget) {
        window.push(now);
        return;
      }
      const waitMs = ttlMs - (now - window[0]) + 100;
      if (this.verbose) {
        console.log(
          `  … ${label} throttle budget reached, waiting ${Math.ceil(waitMs / 1000)}s`,
        );
      }
      await sleep(waitMs);
    }
  }
}

function normalizeExpect(expect: CallOptions['expect']): number[] {
  if (expect === undefined) return [];
  return Array.isArray(expect) ? expect : [expect];
}

async function parseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return undefined;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function describeMismatch(
  expected: number[],
  status: number,
  body: any,
): string {
  const want = expected.length ? expected.join('|') : '2xx';
  const envelope = body?.error;
  const because = envelope
    ? `${envelope.code}: ${envelope.message}${
        envelope.details ? ` ${JSON.stringify(envelope.details)}` : ''
      }`
    : typeof body === 'string'
      ? body.slice(0, 200)
      : JSON.stringify(body ?? null).slice(0, 300);
  return `expected ${want}, got ${status} — ${because}`;
}

/**
 * Longest the client will sit on a 429 before giving up on that check.
 *
 * Long enough to ride out the global per-minute budget, short enough that an
 * endpoint with a fifteen-minute window cannot stall the whole run.
 */
const MAX_THROTTLE_WAIT_MS = 65_000;

/** Renew once the token has less than this long to live. */
const RENEW_MARGIN_SECONDS = 120;

/** The `exp` claim of a JWT, in unix seconds, or undefined if unreadable. */
function expiryOf(token: string): number | undefined {
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    ) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
