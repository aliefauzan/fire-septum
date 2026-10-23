#!/bin/sh
# Push the two server secrets to the Vercel project without printing them.
#   FIRMS_MAP_KEY        from .env           (NASA FIRMS, live hotspots)
#   RECEIPT_ED25519_KEY  from .cache/receipt-ed25519.pem (the same signing key as the local
#                        instance, so hosted receipts carry the same keyId as the register)
# Needs a logged-in Vercel CLI: `npx vercel login`. Run from the project root.
set -e
cd "$(dirname "$0")/.."
SCOPE=afindomi01-gmailcoms-projects
npx -y vercel@latest link --yes --project fire-septum --scope "$SCOPE" >/dev/null
for ENV in production preview; do
  grep '^FIRMS_MAP_KEY=' .env | cut -d= -f2- | npx -y vercel@latest env add FIRMS_MAP_KEY "$ENV" --force --scope "$SCOPE"
  npx -y vercel@latest env add RECEIPT_ED25519_KEY "$ENV" --force --scope "$SCOPE" < .cache/receipt-ed25519.pem
done
echo "Env vars set. Redeploying production so the function picks them up."
npx -y vercel@latest redeploy fire-septum.vercel.app --scope "$SCOPE"
