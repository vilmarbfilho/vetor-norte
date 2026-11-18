// LGPD: personal data minimization in logs. Every text that goes to a log (console or database)
// passes through here. Masking keeps the first 3 and last 2 digits, enough to tell records apart
// without exposing the CPF: 529.982.247-25 -> 529.***.***-25.

// Formatted (529.982.247-25) or digits only (52998224725), but not part of a longer number
// (e.g. phone numbers like 5511999999999 are left alone).
const CPF = /(?<!\d)(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})(?!\d)/g;

export function mascararCpf(texto: string): string {
  return texto.replace(CPF, '$1.***.***-$2');
}

// Terminal color codes: Playwright error messages contain them, and they would show up as garbage in the dashboard.
const CORES_ANSI = /\x1b\[[0-9;]*m/g;

/** Masks, strips terminal colors and truncates, for free-text fields stored in the database. */
export function textoSeguro(texto: string, limite = 2000): string {
  const mascarado = mascararCpf(texto.replace(CORES_ANSI, ''));
  return mascarado.length > limite ? `${mascarado.slice(0, limite)}…` : mascarado;
}
