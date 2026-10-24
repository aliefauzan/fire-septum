// Make a fresh wallet for attesting on Base Sepolia (testnet).
//
//   node scripts/new-testnet-wallet.mjs
//
// Writes EAS_PRIVATE_KEY to .env.local (gitignored, mode 600) only if it is not there yet, and
// prints only the address. The private key is never printed. Use this wallet for the testnet;
// it holds free test ETH from a faucet and nothing of value.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const FILE = join(process.cwd(), '.env.local');
const current = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';
const line = current.split(/\r?\n/).find((l) => l.startsWith('EAS_PRIVATE_KEY='));

let address;
if (line) {
  const pk = line.slice('EAS_PRIVATE_KEY='.length).trim().replace(/^["']|["']$/g, '');
  address = privateKeyToAccount(pk).address;
  console.log('.env.local already has EAS_PRIVATE_KEY; leaving it unchanged.');
} else {
  const pk = generatePrivateKey();
  address = privateKeyToAccount(pk).address;
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  writeFileSync(FILE, `${current}${sep}# Base Sepolia testnet wallet for scripts/attest.mjs (made ${new Date().toISOString()})\nEAS_PRIVATE_KEY=${pk}\n`);
  console.log('New wallet created. Its private key is in .env.local (never commit or share that file).');
}
chmodSync(FILE, 0o600);

console.log(`
Address: ${address}

Next steps:
  1. Get free Base Sepolia test ETH for this address. Paste the address into one faucet:
       https://portal.cdp.coinbase.com/products/faucet      (Coinbase Developer Platform; choose Base Sepolia)
       https://www.alchemy.com/faucets/base-sepolia
       https://docs.base.org/base-chain/tools/network-faucets   (list of other faucets)
     Some faucets ask you to sign in. A few cents' worth is plenty: one attestation costs far less than 0.001 test ETH.
  2. Check that it arrived:
       https://sepolia.basescan.org/address/${address}
  3. Try it without sending anything:
       node scripts/attest.mjs --all --dry-run
  4. Attest for real on the testnet (registers the schema the first time):
       node scripts/attest.mjs --all
`);
