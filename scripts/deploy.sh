git fetch origin
git pull
npm ci --omit=dev
npm run build
pm2 reload lorislist
