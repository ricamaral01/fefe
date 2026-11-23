#!/usr/bin/env bash
# Apaga TODOS os dados (uso em desenvolvimento) e recria com dados de demonstração
set -e
psql "${DATABASE_URL:-postgres://clinica:clinica@localhost:5432/clinica}" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
node "$(dirname "$0")/../server/seed.js"
