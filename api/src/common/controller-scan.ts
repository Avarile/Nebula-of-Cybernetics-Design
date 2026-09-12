import type { INestApplication } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';

/**
 * Whatever `Reflector.get` accepts as a metadata target, derived from its own
 * signature so this cannot drift if Nest changes it.
 */
type MetadataTarget = Parameters<Reflector['get']>[1];

/** One HTTP route handler discovered on a registered controller. */
export interface ControllerHandler {
  /** The controller class itself — read class-level metadata from this. */
  controllerClass: MetadataTarget;
  controllerName: string;
  methodName: string;
  /** The handler function — read method-level metadata from this. */
  handler: MetadataTarget;
}

/**
 * Walk every route handler on every registered controller.
 *
 * Extracted from `openapi.postprocess.ts`, which needed exactly this walk to
 * find `@Public()` operations, so the OpenAPI post-processor and the boot-time
 * route-policy audit cannot disagree about what the application's routes are.
 *
 * Only real routes are visited. `Object.getOwnPropertyNames` also yields helper
 * methods (TypeScript's `private` is erased at runtime, so the `ctx()` helpers
 * on the system controllers show up here too); a handler is a route only if Nest
 * stamped it with `PATH_METADATA`.
 */
export function forEachControllerHandler(
  app: INestApplication,
  visit: (entry: ControllerHandler) => void,
): void {
  const modules = app.get(ModulesContainer);

  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const { instance, metatype } = wrapper;
      if (!instance || typeof metatype !== 'function') {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;

      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === 'constructor') {
          continue;
        }
        const handler = prototype[methodName];
        if (typeof handler !== 'function') {
          continue;
        }
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) {
          continue; // not a route — a helper method on the controller
        }
        visit({
          controllerClass: metatype,
          controllerName: metatype.name,
          methodName,
          handler: handler as MetadataTarget,
        });
      }
    }
  }
}

/** True when `key` is set on the handler or on its controller class. */
export function hasMetadata(
  reflector: Reflector,
  key: string,
  entry: ControllerHandler,
): boolean {
  return (
    reflector.get(key, entry.handler) !== undefined ||
    reflector.get(key, entry.controllerClass) !== undefined
  );
}
