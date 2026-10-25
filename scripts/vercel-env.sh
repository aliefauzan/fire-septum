#!/bin/sh
# Push the two server secrets to the Vercel project without printing them.
#   FIRMS_MAP_KEY        from .env           (NASA FIRMS, live hotspots)
#   RECEIPT_ED25519_KEY  from .cache/receipt-ed25519.pem (the same signing key as the local
#                        instance, so hosted receipts carry the same keyId as the register)
# Needs a logged-in Vercel CLI: `npx vercel login`. Run from the project root.
# For your own deployment: VERCEL_SCOPE=<team slug> VERCEL_PROJECT=<project> sh scripts/vercel-env.sh
set -e
cd "$(dirname "$0")/.."
SCOPE=${VERCEL_SCOPE:-afindomi01-gmailcoms-projects}
PROJECT=${VERCEL_PROJECT:-fire-septum}
npx -y vercel@latest link --yes --project "$PROJECT" --scope "$SCOPE" >/dev/null
for ENV in production preview; do
  grep '^FIRMS_MAP_KEY=' .env | cut -d= -f2- | npx -y vercel@latest env add FIRMS_MAP_KEY "$ENV" --force --scope "$SCOPE"
  npx -y vercel@latest env add RECEIPT_ED25519_KEY "$ENV" --force --scope "$SCOPE" < .cache/receipt-ed25519.pem
done
echo "Env vars set. Redeploying production so the function picks them up."
npx -y vercel@latest redeploy "${VERCEL_DOMAIN:-$PROJECT.vercel.app}" --scope "$SCOPE"
