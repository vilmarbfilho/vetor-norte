// Hidden terminal prompt for passwords (never accepted as command-line arguments: they end up in shell history).

import { createInterface } from 'node:readline';

/** Reads one line without echoing it (TTY). Without a TTY (piped input), reads a plain line. */
export function perguntarOculto(pergunta: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const saida = rl as unknown as { _writeToOutput: (s: string) => void };
  const original = saida._writeToOutput.bind(rl);
  let ocultar = false;
  // While the password is typed, echo nothing but the line break.
  saida._writeToOutput = (s: string) => {
    if (!ocultar) original(s);
    else if (s.includes('\n') || s.includes('\r')) original('\n');
  };
  return new Promise((ok) => {
    let lida = '';
    rl.once('line', (linha) => {
      lida = linha;
      rl.close();
    });
    rl.once('close', () => ok(lida));
    rl.setPrompt(pergunta);
    rl.prompt();
    ocultar = true;
  });
}
