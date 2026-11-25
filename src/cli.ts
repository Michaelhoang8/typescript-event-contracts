import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {EventStream} from './contracts.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node dist/cli.js INPUT.jsonl|- [--skip-invalid]\nValidate order.placed v1/v2/v3 events and emit canonical v3 JSONL.\nIdentical canonical event IDs are emitted once; conflicting IDs fail.\nExit: 0 successful processing; 2 input/validation failure.');
} else {
  const file = args.shift();
  if (!file || args.some(arg => arg !== '--skip-invalid')) {
    console.error('provide an input file; use --help'); process.exitCode = 2;
  } else {
    const seen = new EventStream();
    let lineNumber = 0, emitted = 0, duplicate = 0, rejected = 0;
    const input = file === '-' ? process.stdin : createReadStream(file, {encoding:'utf8'});
    const lines = createInterface({input, crlfDelay:Infinity});
    try {
      for await (const line of lines) {
        lineNumber++;
        try {
          if (Buffer.byteLength(line, 'utf8') > 1048576) throw new Error('record exceeds 1 MiB');
          const event = seen.accept(JSON.parse(line));
          if (event) { console.log(JSON.stringify(event)); emitted++; } else duplicate++;
        } catch (error) {
          rejected++;
          console.error(`line ${lineNumber}: ${(error as Error).message}`);
          if (!args.includes('--skip-invalid')) { process.exitCode = 2; break; }
        }
      }
    } catch (error) { console.error((error as Error).message); process.exitCode = 2; }
    finally { lines.close(); if (file !== '-') input.destroy(); }
    console.error(JSON.stringify({read:lineNumber, emitted, duplicate, rejected}));
  }
}
