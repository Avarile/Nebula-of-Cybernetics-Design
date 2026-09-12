/**
 * Shared vocabulary for the live API suite.
 *
 * Everything here is transport-level on purpose: the suite talks to a running
 * server over HTTP and imports nothing from `src/`, so a passing run proves the
 * deployed process works rather than that the module graph compiles.
 */

/** Body payloads the client can send. Node's `fetch` accepts all of these. */
export type RawBody = string | Uint8Array | ArrayBuffer;

/** Who a request is sent as. Drives which bearer token the client attaches. */
export type Actor = 'admin' | 'user' | 'agent' | 'anon' | 'raw';

/** A single HTTP expectation and its outcome. */
export interface CheckResult {
  suite: string;
  name: string;
  method: string;
  /** OpenAPI-style template (`/users/{id}`) — the coverage key. */
  template: string;
  url: string;
  actor: Actor;
  expected: number[];
  status: number;
  ok: boolean;
  ms: number;
  /** Why it failed, or what a soft failure degraded to. */
  detail?: string;
  /** Set when the check was skipped rather than executed. */
  skipped?: boolean;
  /** Set when a failure is reported but must not fail the run (external deps). */
  soft?: boolean;
}

/** Options for a single call. */
export interface CallOptions {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Template path with `{param}` placeholders. */
  path: string;
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
  actor?: Actor;
  /** Accepted status codes. Defaults to "any 2xx". */
  expect?: number | number[];
  /** Extra assertion on the parsed body. Return a string to fail with it. */
  assert?: (body: any, res: Response) => string | void;
  /** A raw bearer token, used with `actor: 'raw'`. */
  token?: string;
  /**
   * Record the failure but do not fail the run. For endpoints that depend on
   * external systems the suite does not control (live SMTP/IMAP hosts, the AI
   * gateway).
   */
  soft?: boolean;
  /** Send no `content-type`/body serialization; used for multipart or blobs. */
  rawBody?: RawBody;
  headers?: Record<string, string>;
}

/** The response the client hands back to suites. */
export interface CallResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
  ok: boolean;
}

/** Identity + tokens for one principal. */
export interface Principal {
  email: string;
  password: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  role: string;
  /** Unix seconds at which `accessToken` expires, read from its `exp` claim. */
  expiresAt?: number;
  /**
   * Mints a replacement access token. The client calls this on its own when the
   * current one is close to expiring — a comprehensive run takes longer than
   * the 15-minute access TTL, so without it the tail of the run 401s.
   */
  renew?: () => Promise<{ accessToken: string; refreshToken?: string } | null>;
}
