/**
 * JSON text for a jsonb column. Bound as an untyped text parameter, which
 * Postgres coerces to the column's jsonb type (add `::jsonb` when the target
 * is not a column). Unlike `PgTypes.jsonb`, this stores the JSON value `null`
 * as jsonb `'null'` instead of SQL NULL, which the NOT NULL payload columns
 * require and the `Schema.Json` domain fields allow.
 */
export const jsonb = (value: unknown): string => JSON.stringify(value);
