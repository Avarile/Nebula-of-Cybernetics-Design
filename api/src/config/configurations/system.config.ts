import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced config for the system-records module. Currently just the secret
 * encryption key + its version (used by EncryptionService). Kept in env — not
 * the DB — because it protects the DB-stored secrets.
 */
export const systemConfig = registerAs('system', () => {
  const env = validateEnv(process.env);
  return {
    encryptionKey: env.SYSTEM_ENCRYPTION_KEY,
    encryptionKeyVersion: env.SYSTEM_ENCRYPTION_KEY_VERSION,
    settingsCacheTtlMs: env.SYSTEM_SETTINGS_CACHE_TTL_MS,
    /**
     * Retired keys by version, so a rotation can still read what the previous
     * key wrote. `{"1":"<base64>"}` — empty when nothing has been rotated.
     */
    previousEncryptionKeys: parsePreviousKeys(
      env.SYSTEM_ENCRYPTION_KEYS_PREVIOUS,
    ),
  };
});

/** Parse the retired-key map, failing loudly rather than silently ignoring it. */
function parsePreviousKeys(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'SYSTEM_ENCRYPTION_KEYS_PREVIOUS must be JSON, e.g. {"1":"<base64 key>"}.',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'SYSTEM_ENCRYPTION_KEYS_PREVIOUS must be a JSON object of version -> base64 key.',
    );
  }
  const out: Record<string, string> = {};
  for (const [version, key] of Object.entries(parsed)) {
    if (typeof key !== 'string') {
      throw new Error(
        `SYSTEM_ENCRYPTION_KEYS_PREVIOUS["${version}"] must be a base64 string.`,
      );
    }
    out[version] = key;
  }
  return out;
}

export type SystemConfig = ReturnType<typeof systemConfig>;
