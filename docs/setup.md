# Set up every feature on your own copy

The public demo at <https://fire-septum.vercel.app> shows the recorded fire, live data, the forecaster, sealing and the scoreboard. It does **not** run the daily forecast register or post attestations on Base, because those need keys of their own. This page shows how to switch every feature on in your own fork or local copy. Each step is optional and independent.

| Feature | Needs | Step |
|---|---|---|
| App, recorded fire, examples, forecaster ("Tomorrow"), 3D, PDF brief, BMKG, carbon projects | nothing | [1](#1-run-it-locally) |
| Live satellite hotspots | free NASA FIRMS key | [2](#2-live-hotspots-nasa-firms-key) |
| Signed records, Bitcoin timestamps | a signing key (made for you) | [3](#3-signing-key-and-bitcoin-timestamps) |
| Hosted copy on Vercel | Vercel account | [4](#4-host-it-on-vercel) |
| Hosted writes (register, submissions) | Vercel Blob store, two tokens | [5](#5-hosted-writes-vercel-blob) |
| Daily forecast register on GitHub Actions | repository secrets | [6](#6-the-daily-forecast-register-github-actions) |
| Attestations on Base (EAS) | testnet wallet + free test ETH | [7](#7-attest-daily-roots-on-base-eas) |
| AI situation brief | any OpenAI-compatible endpoint | [8](#8-ai-situation-brief) |
| SiPongi hotspots and peat water table | written permission from Kemenhut | [9](#9-sipongi) |
| Re-running the science (burned area, forecaster training) | Python with `uv` | [10](#10-re-run-the-analyses) |

Keys go in `.env` or `.env.local` in the project root. Both are gitignored; never commit them. `.env.example` lists every variable.

## 1. Run it locally

Needs Node 20 or newer.

```bash
git clone https://github.com/aliefauzan/fire-septum.git
cd fire-septum
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

Everything in the first row of the table works now. Check your copy the way CI does:

```bash
npm test
npx tsx scripts/gen-docs.ts --check
```

## 2. Live hotspots (NASA FIRMS key)

1. Ask for a free MAP_KEY at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> (an email address is enough).
2. Put it in `.env`:
   ```
   FIRMS_MAP_KEY=your-key
   ```
3. Restart `npm run dev`. *Today's most active fire* and *Live fires* now load real VIIRS detections. The key stays on the server (`/api/firms`); the browser never sees it.

## 3. Signing key and Bitcoin timestamps

Nothing to do locally: the first time you seal a record, the dev server makes an Ed25519 key in `.cache/receipt-ed25519.pem` and reuses it. OpenTimestamps needs no account, wallet or fee.

To choose the key yourself (for example to share it between your laptop, Vercel and GitHub Actions, so all records carry the same key id):

```bash
mkdir -p .cache
openssl genpkey -algorithm ed25519 -out .cache/receipt-ed25519.pem
```

Treat this file like a password: anyone who has it can sign records as your instance.

Anyone can check a timestamp without Fire Septum:

```bash
pip install opentimestamps-client
ots upgrade proofs/<file>.ots   # once Bitcoin has confirmed it, a few hours after sealing
ots verify proofs/<file>.ots
```

## 4. Host it on Vercel

1. Import your fork at <https://vercel.com/new>. The defaults work: the build is `npm run build`, and the server routes run as one function from the committed `api/index.js`.
2. Add `FIRMS_MAP_KEY` and `RECEIPT_ED25519_KEY` under *Project → Settings → Environment Variables*. For the signing key, paste the whole PEM file, or the PEM with line breaks written as `\n`. Or push both from your local files with the Vercel CLI (it prints neither):
   ```bash
   npx vercel login
   VERCEL_SCOPE=<your team slug> VERCEL_PROJECT=<your project> sh scripts/vercel-env.sh
   ```
3. Redeploy. If you change anything under `server/`, run `npm run build:api` and commit `api/index.js`; CI checks that it is up to date.

Without step 5 the hosted register and submissions are read-only: they show what is committed in `data/`.

## 5. Hosted writes (Vercel Blob)

1. In the Vercel project, *Storage → Create → Blob*, and connect it to the project. Vercel adds `BLOB_READ_WRITE_TOKEN`. For a private store also set `BLOB_ACCESS=private`.
2. Make two long random tokens and add them as environment variables:
   ```bash
   openssl rand -hex 32   # REGISTER_TOKEN: needed to seal register entries on the hosted site
   openssl rand -hex 32   # SUBMISSIONS_TOKEN: optional; if set, outside submissions need it too
   ```
3. Redeploy. Writes are write-once. Scores are never accepted over HTTP on a hosted copy; only the register job writes them (step 6).

## 6. The daily forecast register (GitHub Actions)

The register job (`scripts/register-daily.ts`) scores forecasts whose 24 h window has closed, seals new forecasts for the top 3 fires per island, seals the forecaster for the same boxes, builds yesterday's Merkle batch, attests it when a key is set, and commits the new files to `main`.

**Try it locally first.** With `FIRMS_MAP_KEY` in `.env`:

```bash
npx tsx scripts/register-daily.ts --dry-run                 # computes and prints; signs and writes nothing
npx tsx scripts/register-daily.ts --allow-cache-key         # the real thing, signed with .cache/receipt-ed25519.pem
```

**Run it on GitHub Actions:**

1. In your fork, open the *Actions* tab and enable workflows (GitHub turns them off in forks).
2. Add the repository secrets (`gh` asks for each value, or use *Settings → Secrets and variables → Actions*):
   ```bash
   gh secret set FIRMS_MAP_KEY
   gh secret set RECEIPT_ED25519_KEY < .cache/receipt-ed25519.pem
   gh secret set BLOB_READ_WRITE_TOKEN   # optional: also pull what the hosted copy stored (step 5)
   gh secret set EAS_PRIVATE_KEY         # optional: attest on Base (step 7)
   ```
3. Run it once by hand: *Actions → Forecast register → Run workflow*, first with *Dry run* ticked, then without.
4. To run it every day, add the schedule back to `.github/workflows/register.yml`, under `on:`:
   ```yaml
   on:
     schedule:
       - cron: '0 10 * * *'   # 10:00 UTC, after the afternoon VIIRS passes are in FIRMS
     workflow_dispatch:
   ```
   GitHub may delay scheduled runs by some minutes, and pauses them after 60 days without commits on a public repository.

The job pushes to `main` with the built-in `GITHUB_TOKEN` (`permissions: contents: write`). If `main` is branch-protected, allow GitHub Actions to push, or the commit step fails. Each run also regenerates the numbers in `README.md` and `docs/submission.md`, so CI stays green.

## 7. Attest daily roots on Base (EAS)

Every day's records go into one Merkle root, timestamped on Bitcoin. EAS adds a public attestation of that root on Base. Start on the free testnet, Base Sepolia:

1. Make a throwaway wallet. The key goes into `.env.local` (gitignored); only the address is printed:
   ```bash
   npm run wallet:testnet
   ```
2. Get free test ETH: paste the address into a Base Sepolia faucet, for example the Coinbase Developer Platform faucet (<https://portal.cdp.coinbase.com/products/faucet>). Test ETH has no value.
3. See what would happen, with nothing sent:
   ```bash
   node scripts/attest.mjs 2026-10-20 --dry-run
   ```
4. Attest for real. The first run on a network registers the schema (`bytes32 merkleRoot, string day, uint32 records, string uri`) and writes its id to `data/batches/eas.json`; later runs only attest:
   ```bash
   node scripts/attest.mjs 2026-10-20     # one day
   node scripts/attest.mjs --all          # every batch not yet attested
   ```
   Each result links to the attestation on base-sepolia.easscan.org and is written into the batch file.
5. For the daily job, add the same key as the `EAS_PRIVATE_KEY` repository secret (step 6). Use a separate wallet for this, holding only test ETH.

Mainnet (`--network base`) costs real ETH and is never used unless you pass that flag. Commit `data/batches/` afterwards so others can check the attestations against the files.

## 8. AI situation brief

Any OpenAI-compatible chat-completions endpoint works. In `.env`:

```
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=your-key
LLM_MODEL=model-name
```

Only the simulated numbers, the resources you entered and the cited doctrine are sent. The model rewrites them as a brief; it makes no predictions. The PDF brief (*Brief → Download PDF brief*) works without this.

## 9. SiPongi

SiPongi (Kementerian Kehutanan) forbids access without written permission from the Ministry. If you hold that permission, set `SIPONGI_PERMISSION=granted`; `/api/sipongi/*` then answers and the map shows its hotspot labels and peat water-table stations. Otherwise leave it empty. BMKG's village forecast and fire-danger maps need no setup.

## 10. Re-run the analyses

Install [uv](https://docs.astral.sh/uv/). Each folder under `ml/` is its own Python project with a lockfile.

| What | Command | Notes |
|---|---|---|
| Measured burned area (Sentinel-2 dNBR, Sentinel-1 SAR) | `uv run --project ml/rs python ml/rs/burned_area.py` | keyless (Planetary Computer); `FIRMS_MAP_KEY` for the footprints; add `--only <event id>` for one fire. A fire becomes measurable a few days after it, once a clear or radar pass exists |
| Satellite emissions vs GFED | `uv run --project ml/rs python ml/rs/emissions_crosscheck.py` | [docs/emissions-crosscheck.md](emissions-crosscheck.md) |
| OSM canal and road snapshot | `uv run --project ml/osm python ml/osm/snapshot_barriers.py` | downloads Geofabrik extracts |
| FIRMS archive, split, ERA5 fire weather, fire history | `cd ml/forecast`, then `uv run python firms_archive.py`, `events.py`, `era5.py fetch`, `fire_history.py` | the published split ([docs/forecast-split.md](forecast-split.md)) is fixed and timestamped; rebuilding it changes its hash. `era5.py plan` shows the Open-Meteo call cost first |
| Forecaster training and evaluation | see [docs/forecaster.md](forecaster.md#reproduce) | `evaluate.py --final` opens the test split: run it once per model |
| Spread-simulation hindcast | `npm run hindcast` | [docs/hindcast.md](hindcast.md) |
| Same bits in every engine | `npx playwright install chromium firefox webkit && node scripts/determinism.mjs` | |

After any of these, refresh the numbers in the README and the submission text:

```bash
npx tsx scripts/gen-docs.ts
```
