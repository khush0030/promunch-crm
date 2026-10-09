// Pure: is this Postgres/PostgREST error "a newer migration is not applied yet"?

type PgError = { code?: string; message?: string } | null | undefined;

/** True when the error means a column / function / table from a newer migration is missing. */
export function isMissingSchema(error: PgError): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  // 42703 undefined column, 42883 undefined function, 42P01 undefined table,
  // PGRST202 function not in schema cache, PGRST204 column not in schema cache,
  // PGRST200 relationship not found.
  if (['42703', '42883', '42P01', 'PGRST202', 'PGRST204', 'PGRST200'].includes(code)) return true;
  return /does not exist|schema cache|could not find/i.test(error.message ?? '');
}
