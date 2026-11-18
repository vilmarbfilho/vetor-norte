// Loads and validates environment variables (.env) once.

try {
  process.loadEnvFile(); // built into Node, reads ./.env
} catch {
  // No .env: fall back to process environment variables (useful in Docker/CI).
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ausente: ${nome} (veja .env.example)`);
  return valor;
}

export const config = {
  portalUrl: obrigatoria('PORTAL_URL'),
  email: obrigatoria('PORTAL_EMAIL'),
  senha: obrigatoria('PORTAL_SENHA'),
  headless: process.env.HEADLESS !== 'false',
  downloadDir: process.env.DOWNLOAD_DIR ?? 'downloads',
  porta: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
} as const;
