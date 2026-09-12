import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Drift guard (source-based). Booting the full AppModule in Jest is not possible
 * (MastraModule's ESM-only dependency), so instead of inspecting the generated
 * OpenAPI document we statically assert the metadata bar on every controller:
 *
 *   - each `*.controller.ts` carries an `@ApiTags(...)` (Scalar sidebar group), and
 *   - every route handler (`@Get/@Post/@Put/@Patch/@Delete`) carries an
 *     `@ApiOperation(...)` (a human summary).
 *
 * When someone adds an endpoint without documenting it, this test fails.
 */

const SRC_DIR = join(__dirname, '..', '..');
const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete)\(/g;
const API_OPERATION = /@ApiOperation\(/g;

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findControllerFiles(full));
    } else if (
      entry.endsWith('.controller.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

const controllerFiles = findControllerFiles(SRC_DIR);

describe('OpenAPI metadata drift guard', () => {
  it('finds every feature controller', () => {
    // Sanity: the guard is actually scanning files.
    expect(controllerFiles.length).toBeGreaterThanOrEqual(15);
  });

  describe.each(controllerFiles.map((f) => [f.split('/src/')[1] ?? f, f]))(
    '%s',
    (_label, file) => {
      const src = readFileSync(file, 'utf8');
      const routeCount = (src.match(ROUTE_DECORATOR) ?? []).length;
      const apiOpCount = (src.match(API_OPERATION) ?? []).length;

      it('has an @ApiTags group', () => {
        expect(src).toMatch(/@ApiTags\(/);
      });

      it('documents every route handler with @ApiOperation', () => {
        expect(apiOpCount).toBeGreaterThanOrEqual(routeCount);
      });
    },
  );
});
