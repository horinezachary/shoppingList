git fetch origin
git pull
npm ci --omit=dev
pm2 reload lorislist
