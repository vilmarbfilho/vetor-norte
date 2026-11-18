// Loads ./.env into process.env once (imported for its side effect).
// Kept apart from env.ts so tools that only need the database (key CLI) don't require portal credentials.

try {
  process.loadEnvFile(); // built into Node, reads ./.env; existing env vars are not overwritten
} catch {
  // No .env: fall back to process environment variables (useful in Docker/CI).
}

/** Reads a required environment variable or throws a readable error. */
export function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ausente: ${nome} (veja .env.example)`);
  return valor;
}
