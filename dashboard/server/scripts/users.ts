// Dashboard user management CLI. Passwords are typed at a hidden prompt (never passed as arguments,
// so they don't end up in shell history or the process list).
//
// Usage (locally: inside dashboard/; on the VPS: docker compose exec dashboard npm run usuarios -- ...):
//   npm run usuarios -- criar --nome "<name>" --email <e-mail> --perfil admin|corretor
//     (a corretor starts with no screens and no API permissions: an admin grants them in the dashboard)
//   npm run usuarios -- listar
//   npm run usuarios -- redefinir-senha <e-mail>
//   npm run usuarios -- desativar <e-mail>      (also ends the user's open sessions)
//   npm run usuarios -- ativar <e-mail>

import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { PERFIS, type Perfil } from '../auth/access.ts';
import { hashSenha, SENHA_MIN } from '../auth/passwords.ts';
// Only load.ts: this tool needs DATABASE_URL, not the server config.
import { obrigatoria } from '../config/load.ts';
import { conectarBanco } from '../db/client.ts';

const USO = `Uso:
  npm run usuarios -- criar --nome "<nome>" --email <e-mail> --perfil admin|corretor
  npm run usuarios -- listar
  npm run usuarios -- redefinir-senha <e-mail>
  npm run usuarios -- desativar <e-mail>
  npm run usuarios -- ativar <e-mail>`;

function falhar(mensagem: string): never {
  console.error(`${mensagem}\n\n${USO}`);
  process.exit(1);
}

// One readline for the whole run, with a line queue: with piped input all lines arrive at once,
// and a line read before the next question is asked must not be lost.
type ComSaida = { _writeToOutput: (s: string) => void };
let rl: ReturnType<typeof createInterface> | undefined;
let ocultar = false;
const linhasPendentes: string[] = [];
let aguardando: ((linha: string) => void) | undefined;

function abrirLeitor(): void {
  rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const original = (rl as unknown as ComSaida)._writeToOutput.bind(rl);
  // While a password is typed, echo nothing but the line break.
  (rl as unknown as ComSaida)._writeToOutput = (s: string) => {
    if (!ocultar) original(s);
    else if (s.includes('\n') || s.includes('\r')) original('\n');
  };
  const entregar = (linha: string) => {
    if (!aguardando) return void linhasPendentes.push(linha);
    const resolver = aguardando;
    aguardando = undefined;
    ocultar = false;
    resolver(linha);
  };
  rl.on('line', entregar);
  rl.on('close', () => entregar('')); // end of input: never hang waiting
}

/** Reads a line without echoing it (TTY). Without a TTY (piped input), reads a plain line. */
function perguntarOculto(pergunta: string): Promise<string> {
  if (!rl) abrirLeitor();
  process.stdout.write(pergunta);
  const pendente = linhasPendentes.shift();
  if (pendente !== undefined) {
    process.stdout.write('\n');
    return Promise.resolve(pendente);
  }
  ocultar = true;
  return new Promise((ok) => (aguardando = ok));
}

async function lerNovaSenha(): Promise<string> {
  const senha = await perguntarOculto('Senha: ');
  if (senha.length < SENHA_MIN) falhar(`A senha deve ter pelo menos ${SENHA_MIN} caracteres.`);
  const confirmacao = await perguntarOculto('Confirme a senha: ');
  if (senha !== confirmacao) falhar('As senhas não conferem.');
  return senha;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { nome: { type: 'string' }, email: { type: 'string' }, perfil: { type: 'string' } },
});
const [comando, argumento] = positionals;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sql = conectarBanco(obrigatoria('DATABASE_URL'));
try {
  switch (comando) {
    case 'criar': {
      const nome = values.nome?.trim();
      const email = values.email?.trim().toLowerCase();
      if (!nome) falhar('Informe --nome.');
      if (!email || !EMAIL.test(email)) falhar('Informe um --email válido.');
      const perfil = values.perfil as Perfil | undefined;
      if (!perfil || !PERFIS.includes(perfil)) falhar(`Informe --perfil (${PERFIS.join(' ou ')}).`);
      const [existente] = await sql`SELECT 1 FROM usuarios WHERE lower(email) = ${email}`;
      if (existente) falhar(`Já existe um usuário com o e-mail ${email}.`);
      const senhaHash = await hashSenha(await lerNovaSenha());
      // The password was typed here (not generated), so no forced change at the first login.
      await sql`INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (${nome}, ${email}, ${senhaHash}, ${perfil})`;
      console.log(`Usuário "${nome}" <${email}> criado (${perfil}).`);
      break;
    }
    case 'listar': {
      const linhas = await sql<
        { nome: string; email: string; perfil: string; ativo: boolean; idioma: string; criado_em: Date; ultimo_login: Date | null }[]
      >`SELECT nome, email, perfil, ativo, idioma, criado_em, ultimo_login FROM usuarios ORDER BY criado_em`;
      if (linhas.length === 0) console.log('Nenhum usuário cadastrado.');
      const data = (d: Date | null) => (d ? d.toLocaleString('pt-BR') : '-');
      console.table(
        linhas.map((l) => ({
          nome: l.nome, email: l.email, perfil: l.perfil, status: l.ativo ? 'ativo' : 'desativado', idioma: l.idioma,
          criado: data(l.criado_em), 'último login': data(l.ultimo_login),
        })),
      );
      break;
    }
    case 'redefinir-senha': {
      if (!argumento) falhar('Informe o e-mail.');
      const [u] = await sql<{ id: string }[]>`SELECT id FROM usuarios WHERE lower(email) = lower(${argumento})`;
      if (!u) falhar(`Usuário ${argumento} não encontrado.`);
      const senhaHash = await hashSenha(await lerNovaSenha());
      await sql`UPDATE usuarios SET senha_hash = ${senhaHash}, trocar_senha = false WHERE id = ${u.id}`;
      // A password reset usually means the old one may be known: end every open session.
      await sql`DELETE FROM sessoes WHERE usuario_id = ${u.id}`;
      console.log(`Senha de ${argumento} redefinida. Sessões abertas foram encerradas.`);
      break;
    }
    case 'desativar':
    case 'ativar': {
      if (!argumento) falhar('Informe o e-mail.');
      const ativo = comando === 'ativar';
      const r = await sql`UPDATE usuarios SET ativo = ${ativo} WHERE lower(email) = lower(${argumento}) RETURNING id`;
      if (r.count === 0) falhar(`Usuário ${argumento} não encontrado.`);
      if (!ativo) await sql`DELETE FROM sessoes WHERE usuario_id = ${r[0]!.id}`;
      console.log(`Usuário ${argumento} ${ativo ? 'ativado' : 'desativado (sessões encerradas)'}.`);
      break;
    }
    default:
      falhar(comando ? `Comando desconhecido: ${comando}` : 'Informe um comando.');
  }
} finally {
  rl?.close();
  await sql.end({ timeout: 5 });
}
