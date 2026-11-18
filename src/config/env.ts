// Carrega e valida as variáveis de ambiente (.env) uma única vez.

try {
  process.loadEnvFile(); // nativo do Node, lê ./.env
} catch {
  // Sem .env: segue com as variáveis do ambiente (útil em Docker/CI).
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
} as const;
