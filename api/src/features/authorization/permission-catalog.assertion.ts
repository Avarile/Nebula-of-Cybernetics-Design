import { Logger, type INestApplication } from '@nestjs/common';
import { forEachControllerHandler } from '../../common/controller-scan';
import { PERMISSIONS_KEY } from './require-permission.decorator';
import { PermissionRepository } from './permission.repository';

const logger = new Logger('PermissionCatalog');

/**
 * Refuse to boot when a route requires a permission that does not exist.
 *
 * `@RequirePermission('projct.read')` — a typo — would otherwise resolve to a
 * key nobody holds, silently denying every caller including admins-by-role, and
 * the failure would surface as an unexplained 403 in production rather than as
 * a startup error.
 *
 * The mirror check (a seeded permission no route uses) is reported as a warning
 * rather than a failure: an unused permission is untidy, not dangerous, and may
 * legitimately be granted ahead of the feature that consumes it.
 */
export async function assertPermissionCatalogIsComplete(
  app: INestApplication,
): Promise<void> {
  const repo = app.get(PermissionRepository, { strict: false });
  const known = new Set(await repo.allPermissionKeys());

  const used = new Set<string>();
  const unknown = new Map<string, string>();

  forEachControllerHandler(app, ({ controllerName, methodName, handler }) => {
    const required = Reflect.getMetadata(PERMISSIONS_KEY, handler) as
      string[] | undefined;
    if (!required) return;
    for (const key of required) {
      used.add(key);
      if (!known.has(key)) {
        unknown.set(key, `${controllerName}.${methodName}`);
      }
    }
  });

  if (unknown.size > 0) {
    const detail = [...unknown.entries()]
      .map(([key, where]) => `"${key}" (${where})`)
      .join(', ');
    throw new Error(
      `Unknown permission(s) required by routes: ${detail}. ` +
        `Add them to the permission catalog seeder, or fix the spelling.`,
    );
  }

  const unused = [...known].filter((key) => !used.has(key));
  if (unused.length > 0) {
    logger.debug(
      `${unused.length} seeded permission(s) are not required by any route yet`,
    );
  }
  logger.log(
    `Permission catalog verified (${used.size} in use, ${known.size} defined)`,
  );
}
