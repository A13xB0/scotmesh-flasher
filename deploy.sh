#!/usr/bin/env bash
# Deploy the flasher to box 4 (rnode.scotmesh.net). Keeps /firmware/ (the
# mirror) and backs up the previous page to /var/www/rnode.bak-<date>.
set -euo pipefail
HOST=${HOST:-ubuntu@44.31.241.113}
cd "$(dirname "$0")"
rsync -az --delete --exclude .git --exclude firmware --exclude deploy.sh --exclude '*.md' . "$HOST:/tmp/scotmesh-flasher/"
ssh "$HOST" 'set -e
  d=/var/www/rnode
  if [ ! -e $d/.scotmesh-flasher ]; then sudo cp -a $d /var/www/rnode.bak-$(date +%Y%m%d-%H%M); fi
  sudo find $d -mindepth 1 -maxdepth 1 ! -name firmware -exec rm -rf {} +
  sudo cp -a /tmp/scotmesh-flasher/. $d/ && sudo touch $d/.scotmesh-flasher
  sudo chown -R www-data:www-data $d
  rm -rf /tmp/scotmesh-flasher
  echo deployed; ls $d'
