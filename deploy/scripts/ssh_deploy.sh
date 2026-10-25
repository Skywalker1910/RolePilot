#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${LIGHTSAIL_HOST:?Missing production host}"
: "${LIGHTSAIL_USER:?Missing production user}"
: "${LIGHTSAIL_SSH_KEY:?Missing deployment identity}"
: "${LIGHTSAIL_SSH_HOST_KEY:?Missing trusted host key}"
[[ $LIGHTSAIL_HOST =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || exit 2
[[ $LIGHTSAIL_USER == rolepilot-deploy ]] || exit 2
[[ ${RELEASE_SHA:-} =~ ^[0-9a-f]{40}$ && ${RELEASE_SEQUENCE:-} =~ ^[1-9][0-9]*$ ]] || exit 2
checksum=$(tr -d '\r\n' < artifacts/release.tar.gz.sha256)
[[ $checksum =~ ^[0-9a-f]{64}$ ]] || exit 2
actual=$(sha256sum artifacts/release.tar.gz)
[[ ${actual%% *} == "$checksum" ]] || { echo 'Archive checksum mismatch' >&2; exit 1; }
keydir=$(mktemp -d)
trap 'rm -rf -- "$keydir"' EXIT
printf '%s\n' "$LIGHTSAIL_SSH_KEY" > "$keydir/identity"
printf '%s\n' "$LIGHTSAIL_SSH_HOST_KEY" > "$keydir/known_hosts"
unset LIGHTSAIL_SSH_KEY LIGHTSAIL_SSH_HOST_KEY
ssh-keygen -F rolepilot-production -f "$keydir/known_hosts" >/dev/null
options=(-i "$keydir/identity" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$keydir/known_hosts"
  -o HostKeyAlias=rolepilot-production -o ConnectTimeout=15
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o LogLevel=ERROR)
remote="$LIGHTSAIL_USER@$LIGHTSAIL_HOST"
ssh "${options[@]}" "$remote" true
upload="/var/lib/rolepilot-deploy/incoming/$RELEASE_SHA-$RELEASE_SEQUENCE.tar.gz"
scp "${options[@]}" artifacts/release.tar.gz "$remote:$upload"
ssh "${options[@]}" "$remote" \
  "sudo -n /usr/local/sbin/rolepilot-deploy $RELEASE_SHA $RELEASE_SEQUENCE $checksum" || {
    echo "Deployment failed. Inspect protected server logs for commit $RELEASE_SHA, run $RELEASE_SEQUENCE." >&2
    exit 1
  }
echo "Production deployment verified for $RELEASE_SHA (run $RELEASE_SEQUENCE)."
