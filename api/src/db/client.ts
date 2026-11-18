// PostgreSQL connection (postgres.js). One small pool per process is plenty for this API.

import postgres, { type Sql } from 'postgres';

export function conectarBanco(url: string): Sql {
  return postgres(url, {
    max: 5,
    // Fail fast when the DB is unreachable instead of hanging the request.
    connect_timeout: 5,
    // Silence NOTICE messages (e.g. from migrations) in the API logs.
    onnotice: () => {},
  });
}
