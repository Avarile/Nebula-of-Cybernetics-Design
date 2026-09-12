import { Logger, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';
import { forEachControllerHandler, hasMetadata } from './controller-scan';

/**
 * Third-party controllers that cannot carry our decorators.
 *
 * Both come from `@mastra/nestjs` and are mounted under the adapter's
 * `/api/agent-core` prefix. The global `JwtAuthGuard` still applies to them
 * (it is an `APP_GUARD`, so it covers every controller in the graph) and the
 * adapter adds its own `MastraRouteGuard` — but neither declares `@Roles`, so
 * they are reachable by ANY authenticated principal, including `agent`-role
 * service credentials. That is a deliberate exemption, not an endorsement:
 * revisit it if the adapter starts exposing anything owner-scoped.
 *
 * Keep this list short and justified. An entry here is a hole in the guarantee
 * the rest of this function provides.
 */
const EXEMPT_CONTROLLERS = new Set(['MastraController', 'SystemController']);

/**
 * Controllers that claim a catch-all route and must therefore be registered
 * last, or they intercept everything declared after them.
 */
const CATCH_ALL_CONTROLLERS = new Set(['MastraController']);

/**
 * Report — but do not enforce — what `AppModule`'s comment only asserted.
 *
 * `MastraModule` mounts a catch-all controller and "MUST remain last"; nothing
 * checked it, so a routine alphabetise-the-imports would silently swallow the
 * routes of every module after it.
 *
 * This is a warning rather than a boot failure, deliberately. Registration
 * order is inferred from `ModulesContainer` insertion order, and whether
 * `MastraController` lands last also depends on the order `@mastra/nestjs`
 * happens to list its own controllers in — both are third-party implementation
 * details that a patch release may change. Refusing to start on a heuristic
 * about a convention is a worse failure than the one being prevented, so we
 * surface the signal and let the process boot.
 *
 * Returns a warning message, or `null` when the ordering looks correct.
 */
export function checkCatchAllIsLast(app: INestApplication): string | null {
  const order: string[] = [];
  forEachControllerHandler(app, (entry) => {
    if (!order.includes(entry.controllerName)) order.push(entry.controllerName);
  });
  const offenders = [...CATCH_ALL_CONTROLLERS]
    .map((name) => ({ name, index: order.indexOf(name) }))
    .filter(({ index }) => index >= 0 && index !== order.length - 1);

  if (offenders.length === 0) return null;

  return (
    `Catch-all controller(s) may not be registered last, in which case they ` +
    `intercept routes declared after them: ` +
    offenders
      .map(
        ({ name, index }) =>
          `${name} (position ${index + 1} of ${order.length}; ` +
          `followed by ${order.slice(index + 1).join(', ')})`,
      )
      .join('; ') +
    ` — if routes are 404ing unexpectedly, move the owning module to the end ` +
    `of AppModule's imports.`
  );
}

/**
 * Refuse to boot if any route declares neither `@Public()` nor `@Roles(...)`.
 *
 * `RolesGuard` lets an undeclared route through, so "no decorator" silently
 * meant "open to every authenticated principal". That is precisely how
 * `SearchQueryController` ended up serving every user's documents and every
 * inbound email body to anyone with a token — no one had to make a wrong
 * decision, only to omit one. After this, omitting the decision is a crash on
 * startup rather than a quiet default.
 *
 * Call during bootstrap, before `listen()`.
 */
export function assertEveryRouteDeclaresPolicy(app: INestApplication): void {
  const orderingWarning = checkCatchAllIsLast(app);
  if (orderingWarning) {
    new Logger('RoutePolicyAudit').warn(orderingWarning);
  }

  const reflector = app.get(Reflector);
  const undeclared: string[] = [];

  forEachControllerHandler(app, (entry) => {
    if (EXEMPT_CONTROLLERS.has(entry.controllerName)) return;
    const declared =
      hasMetadata(reflector, IS_PUBLIC_KEY, entry) ||
      hasMetadata(reflector, ROLES_KEY, entry);
    if (!declared) {
      undeclared.push(`${entry.controllerName}.${entry.methodName}`);
    }
  });

  if (undeclared.length > 0) {
    throw new Error(
      `Route policy audit failed — ${undeclared.length} route(s) declare neither ` +
        `@Public() nor @Roles(...), and would therefore be reachable by every ` +
        `authenticated principal:\n` +
        undeclared.map((r) => `  - ${r}`).join('\n') +
        `\n\nAdd @Roles(...) (or @Public() for a genuinely unauthenticated route) ` +
        `to each. Ownership checks still belong in the service layer — @Roles is ` +
        `the coarse gate, not the whole policy.`,
    );
  }
}
