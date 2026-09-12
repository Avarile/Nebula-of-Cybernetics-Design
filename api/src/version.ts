/**
 * Build identity — what code this process is actually running.
 *
 * Deliberately NOT read from `.env`. A version identifies a build artifact, not
 * an environment: a value kept in `.env` drifts per machine, so the same commit
 * reports one number locally and another in production and nothing ever catches
 * the disagreement. `package.json` moves with the commit, so it cannot drift.
 *
 * The relative path resolves from both `src/` (ts-node, jest) and `dist/`
 * (`node dist/main`) because both sit directly under the package root — the
 * same reason `cli/src/main.ts` can read its version this way. Note that
 * `process.env.npm_package_version` is NOT an option here: it only exists when
 * the process was started by a package-manager script, which is exactly what
 * `start:prod` under an orchestrator is not.
 */
import { version } from '../package.json';

export const VERSION: string = version;

/**
 * The git commit, when something stamped it.
 *
 * This is the one piece `package.json` cannot carry, and the piece an incident
 * actually needs: two builds of `0.0.1` are indistinguishable without it. It
 * comes from the environment because it is baked into the image at BUILD time
 * (a Docker `ARG` promoted to `ENV`, or the CI job's env) — that is a property
 * of the artifact, not of the deployment, so it does NOT belong in `.env`.
 */
const stamped = process.env.GIT_SHA?.trim();
export const GIT_SHA: string | null = stamped ? stamped.slice(0, 7) : null;

/**
 * Sentry's release identifier, in its conventional `name@version` form, with
 * the build appended when known. This is the string that has to match whatever
 * a source-map upload is tagged with for stack traces to resolve.
 */
export const RELEASE = GIT_SHA
  ? `cybernetics@${VERSION}+${GIT_SHA}`
  : `cybernetics@${VERSION}`;

export interface BuildInfo {
  version: string;
  sha: string | null;
}

export const BUILD_INFO: BuildInfo = { version: VERSION, sha: GIT_SHA };
