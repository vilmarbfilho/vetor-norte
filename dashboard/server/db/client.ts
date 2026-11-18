// PostgreSQL connection (postgres.js). The dashboard has very few users: a tiny pool is enough.

import postgres, { type Sql } from 'postgres';

export function conectarBanco(url: string): Sql {
  return postgres(url, { max: 5, connect_timeout: 5, onnotice: () => {} });
}
