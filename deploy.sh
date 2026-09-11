#!/usr/bin/env bash
# Deploy the flasher to box 4 (rnode.scotmesh.net). Keeps /firmware/ (the
# mirror) and backs up the previous page to /var/www/rnode.bak-<date>.
set -euo pipefail
HOST=${HOST:-ubuntu@44.31.241.113}
cd "$(dirname "$0")"
tar czf - --exclude .git --exclude firmware --exclude deploy.sh . | ssh "$HOST" 'set -e
  d=/var/www/rnode
  rm -rf /tmp/scotmesh-flasher && mkdir -p /tmp/scotmesh-flasher && tar xzf - -C /tmp/scotmesh-flasher
  if [ ! -e $d/.scotmesh-flasher ]; then sudo cp -a $d /var/www/rnode.bak-$(date +%Y%m%d-%H%M); fi
  sudo find $d -mindepth 1 -maxdepth 1 ! -name firmware -exec rm -rf {} +
  sudo cp -a /tmp/scotmesh-flasher/. $d/ && sudo touch $d/.scotmesh-flasher
  sudo chown -R www-data:www-data $d
  rm -rf /tmp/scotmesh-flasher
  echo deployed; ls $d'
