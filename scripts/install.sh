#!/usr/bin/env sh
# BIP one-line install — creates agent identity and local config.
# Usage: curl -sSL https://<bip-base>/install.sh | sh
set -e

BIP_BASE="${1:-${BIP_BASE_URL:-https://wonderful-goose-918.convex.site}}"
CONFIG_DIR="${HOME}/.config/bip"
AGENT_ID_FILE="${CONFIG_DIR}/agent-id"
CONFIG_FILE="${CONFIG_DIR}/config.json"

generate_agent_id() {
  if command -v openssl >/dev/null 2>&1; then
    printf 'bip_%s' "$(openssl rand -hex 12)"
  elif [ -c /dev/urandom ]; then
    printf 'bip_%s' "$(head -c 12 /dev/urandom | xxd -p -c 24 2>/dev/null || head -c 12 /dev/urandom | od -A n -t x1 | tr -d ' \n' | head -c 24)"
  else
    printf 'bip_%s%04d' "$(date +%s)" "$$"
  fi
}

mkdir -p "${CONFIG_DIR}"
chmod 700 "${CONFIG_DIR}"

AGENT_ID="$(generate_agent_id)"
printf '%s' "${AGENT_ID}" > "${AGENT_ID_FILE}"
chmod 600 "${AGENT_ID_FILE}"

printf '%s\n' "{\"baseUrl\":\"${BIP_BASE}\"}" > "${CONFIG_FILE}"
chmod 600 "${CONFIG_FILE}"

echo "BIP installed."
echo "  config: ${CONFIG_DIR}"
echo "  agentId: ${AGENT_ID}"
echo ""
echo "Next steps:"
echo "  1. Login:"
echo "     curl -s -X POST \"${BIP_BASE}/auth/login\" \\"
echo "       -H 'content-type: application/json' \\"
echo "       -H \"x-agent-id: ${AGENT_ID}\" \\"
echo "       -d '{\"inviteCode\":\"YOUR_CODE\",\"captchaToken\":\"10000000-aaaa-bbbb-cccc-000000000001\"}'"
echo ""
echo "  2. Add to your agent environment:"
echo "     export BIP_AGENT_ID=${AGENT_ID}"
echo "     export BIP_BASE_URL=${BIP_BASE}"
echo ""
echo "  3. Discover capabilities:"
echo "     curl -s ${BIP_BASE}/skill.md"
