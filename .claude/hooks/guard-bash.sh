#!/usr/bin/env bash
# Garde-fou Sigma : bloque les commandes destructrices et refuse un commit
# tant que lint, typecheck et tests unitaires ne sont pas verts.
cmd=$(jq -r '.tool_input.command // ""')

block() { echo "BLOQUÉ par .claude/hooks/guard-bash.sh : $1" >&2; exit 2; }

# 1. Commandes destructrices (base de données, historique git, fichiers du projet)
grep -qE 'prisma +migrate +reset|db:reset|dropdb|DROP +(DATABASE|SCHEMA|TABLE)|TRUNCATE ' <<<"$cmd" \
  && block "suppression de données interdite sans l'accord explicite d'Amine."
grep -qE 'git +push.*(--force|-f( |$)|\+[a-zA-Z])' <<<"$cmd" && ! grep -q -- '--force-with-lease' <<<"$cmd" \
  && block "git push --force interdit (utiliser --force-with-lease après accord)."
grep -qE 'git +(reset +--hard|clean +-[a-z]*f|checkout +-- +\.|restore +\.)' <<<"$cmd" \
  && block "commande git qui efface du travail non commité."
grep -qE 'rm +-[a-zA-Z]*r[a-zA-Z]* +(/|~|\.|\./|\*|\.git|prisma|app|lib|components|tests|src)( |/?$)' <<<"$cmd" \
  && block "rm -r sur un dossier du projet."
grep -qE 'pkill +-f|killall' <<<"$cmd" && block "pkill -f / killall peut tuer Postgres ou l'agent."
grep -qE 'playwright +install' <<<"$cmd" && block "Chromium est déjà installé (/opt/pw-browsers)."

# 2. Pas de commit sans lint + typecheck + tests unitaires verts
if grep -qE '(^|[;&| ])git +commit' <<<"$cmd"; then
  cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
  if ! out=$( (pnpm -s lint && pnpm -s typecheck && pnpm -s test) 2>&1 ); then
    echo "$out" | tail -40 >&2
    block "commit refusé : lint, typecheck ou tests unitaires en échec. Corriger avant de commiter."
  fi
fi
exit 0
