/**
 * Convention shared by every CRUD service that distinguishes builtin from user records
 * (proof rules, validation profiles, …). Builtin records ship with the application code
 * via the BUILTIN_* seed lists; user records are created via the admin pane.
 *
 * The id-prefix encoding is deliberate — it survives DB serialisation without needing
 * an extra `source` column on every table.
 */

export const BUILTIN_RECORD_ID_PREFIX = "global-";

export const isBuiltinRecordId = (id: string): boolean => id.startsWith(BUILTIN_RECORD_ID_PREFIX);
