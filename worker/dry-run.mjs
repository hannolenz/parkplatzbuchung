// Backward-compatible command name, now with mandatory explicit mode and owner.
import { main } from './main.mjs';
await main(['--once', ...process.argv.slice(2)]);
