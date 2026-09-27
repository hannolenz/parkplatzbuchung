// Intentionally no password argument or environment variable. Pipe from a hidden prompt.
import { hashPassword } from '../lib/auth/core.mjs';
try {
  if (process.stdin.isTTY) throw new Error();
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk;
    if (Buffer.byteLength(value) > 1026) throw new Error();
  }
  console.log(await hashPassword(value.replace(/\r?\n$/, '')));
} catch { console.error('Passwort über stdin erwartet: mindestens 16 Zeichen, höchstens 1024 Bytes.'); process.exitCode = 1; }
