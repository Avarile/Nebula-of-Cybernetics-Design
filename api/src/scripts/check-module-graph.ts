import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

/**
 * Assemble the real `AppModule` dependency graph and exit non-zero if it fails.
 *
 * Nothing else in the verification stack does this:
 *
 *  - `tsc --noEmit` cannot see the DI graph. It is decorator metadata, not
 *    types, so a module exporting a provider it no longer owns type-checks
 *    perfectly.
 *  - `nest build` compiles; it never instantiates a module.
 *  - the unit suite builds every subject with `new Service(mockA, mockB)`, so
 *    Nest's wiring is never exercised.
 *  - the e2e suites would catch it, but they need Postgres, Redis, MinIO and
 *    Meili to be up.
 *
 * That left a hole exactly the shape of "does the application actually boot",
 * and `SystemModule` fell through it: it kept exporting `SystemAuditService`
 * after that provider moved into `SystemAuditModule`, and the first sign was
 * `nest start` dying with `UnknownExportException`.
 *
 * Preview mode closes the hole cheaply. It resolves imports, validates exports
 * and wires dependencies across the whole graph while instantiating no
 * providers, opening no sockets and running no lifecycle hooks — so this needs
 * no infrastructure and finishes in seconds.
 *
 * Deliberately a ts-node script rather than a Jest spec: `@mastra/core` pulls
 * in a chain of ESM-only packages that Node loads natively but Jest's CJS
 * transform cannot, and widening `transformIgnorePatterns` to chase that chain
 * would slow every test run and break on any dependency bump. Running under
 * Node means this resolves modules exactly the way `nest start` does.
 *
 * `abortOnError: false` matters: the default makes NestFactory log and call
 * `process.exit(1)` itself, which would swallow the error we want to print.
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  await app.close();
  console.log('Module graph OK — AppModule assembles.');
}

main().catch((error: unknown) => {
  console.error(
    '\nModule graph check FAILED — the application would not start:\n',
  );
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
