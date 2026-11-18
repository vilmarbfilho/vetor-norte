// Standalone scraper CLI (no API), useful for debugging the portal automation.
//
// Usage (the portal password is asked at a hidden prompt, never passed as an argument):
//   npm run cli -- --email <e-mail> <cpf>                    → list the CPF's protocols
//   npm run cli -- --email <e-mail> <cpf> <protocolo>        → list and download that protocol's PDF
//   npm run cli -- --email <e-mail> --protocolo <protocolo>  → search by protocol number only and download the PDF

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from '../config/env.ts';
import { perguntarOculto } from './prompt.ts';
import { cpfValido, somenteDigitos } from '../utils/cpf.ts';
import {
  abrirBroker,
  baixarPdfProposta,
  buscarProtocolos,
  login,
  prepararContexto,
  type FiltrosBusca,
  type Protocolo,
} from '../scraper/portal.ts';

// ---- arguments ----
const USO = 'Uso: npm run cli -- --email <e-mail> <cpf> [protocolo]  |  npm run cli -- --email <e-mail> --protocolo <protocolo>';
const args = process.argv.slice(2);
const posEmail = args.indexOf('--email');
const email = posEmail >= 0 ? args[posEmail + 1]?.trim() : undefined;
if (!email || !email.includes('@')) {
  console.error(USO);
  process.exit(1);
}
args.splice(posEmail, 2);
let filtros: FiltrosBusca;
let protocoloParaBaixar: string | undefined;

if (args[0] === '--protocolo' && args[1]) {
  protocoloParaBaixar = args[1].trim();
  filtros = { protocolo: protocoloParaBaixar };
} else if (args[0] && [11, 14].includes(somenteDigitos(args[0]).length)) {
  // Local validation before opening the browser: an invalid CPF never reaches the portal.
  if (somenteDigitos(args[0]).length === 11 && !cpfValido(args[0])) {
    console.error(`❌ CPF inválido: ${args[0]}`);
    process.exit(1);
  }
  filtros = { documento: args[0] };
  protocoloParaBaixar = args[1]?.trim();
} else {
  console.error(USO);
  process.exit(1);
}

const senha = await perguntarOculto('Senha do portal: ');
if (!senha) {
  console.error('❌ Senha não informada.');
  process.exit(1);
}

// ---- execution ----
const browser = await chromium.launch({ headless: config.headless });
const context = await browser.newContext();
await prepararContexto(context);
const inicio = Date.now();
const tempo = () => `${((Date.now() - inicio) / 1000).toFixed(1)}s`;

try {
  const page = await context.newPage();
  await login(page, config.portalUrl, email, senha);
  const broker = await abrirBroker(page);
  const protocolos = await buscarProtocolos(broker, filtros);

  const pastaDebug = path.join(config.downloadDir, 'debug');
  await mkdir(pastaDebug, { recursive: true });
  const chave = filtros.documento ? somenteDigitos(filtros.documento) : `protocolo_${filtros.protocolo}`;
  await writeFile(path.join(pastaDebug, `protocolos_${chave}.json`), JSON.stringify(protocolos, null, 2));

  console.log(`\n📋 ${protocolos.length} protocolo(s), listagem em ${tempo()}`);
  if (protocolos.length) {
    console.table(
      protocolos.map((p: Protocolo) => ({
        protocolo: p.protocolo,
        data: p.dataProtocolo,
        vigencia: `${p.vigenciaInicio} a ${p.vigenciaFim}`,
        segurado: p.seguradoNome,
        seguradora: p.seguradora,
        ramo: p.ramo,
        statusProtocolo: p.statusProtocolo,
        statusProposta: p.statusProposta,
        pdf: p.pdfUrl ? 'sim' : 'não',
      })),
    );
  }

  if (protocoloParaBaixar) {
    const alvo = protocolos.find((p) => p.protocolo === protocoloParaBaixar);
    if (!alvo) throw new Error(`Protocolo ${protocoloParaBaixar} não encontrado nesta busca.`);

    const conteudo = await baixarPdfProposta(context, alvo);
    await mkdir(config.downloadDir, { recursive: true });
    const arquivo = path.join(config.downloadDir, `proposta_${alvo.protocolo}.pdf`);
    await writeFile(arquivo, conteudo);
    console.log(`\n✅ PDF salvo em ${arquivo} (${(conteudo.length / 1024).toFixed(1)} KB)`);
  }

  console.log(`⏱  Tempo total: ${tempo()}`);
} catch (erro) {
  // On failure, save screenshots of every tab for diagnostics.
  const pastaErro = path.join(config.downloadDir, 'erros');
  await mkdir(pastaErro, { recursive: true });
  for (const [i, p] of context.pages().entries()) {
    await p.screenshot({ path: path.join(pastaErro, `aba${i}_${Date.now()}.png`), fullPage: true }).catch(() => {});
  }
  console.error(`\n❌ ${(erro as Error).message}`);
  console.error(`Screenshots salvos em ${pastaErro}/`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
