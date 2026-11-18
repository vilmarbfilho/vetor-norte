// Loads ./.env into process.env once (imported for its side effect). Existing env vars win.

try {
  process.loadEnvFile();
} catch {
  // No .env: fall back to process environment variables (Docker/CI).
}

/** Reads a required environment variable or throws a readable error. */
export function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ausente: ${nome} (veja .env.example)`);
  return valor;
}
