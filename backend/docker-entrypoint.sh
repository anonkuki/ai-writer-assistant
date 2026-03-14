#!/bin/sh
set -eu

if [ -d "/app/prisma/migrations" ] && [ "$(find /app/prisma/migrations -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
  echo "Applying Prisma migrations..."
  npx prisma migrate deploy
else
  echo "No Prisma migrations found, syncing schema with prisma db push..."
  npx prisma db push --accept-data-loss
fi

exec node dist/main.js