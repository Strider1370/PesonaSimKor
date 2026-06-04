#!/usr/bin/env bash
# KoreanSim 배포 스크립트 (GCP VM: dashboard)
# 사용법: 서버에서  cd ~/koreansim && ./scripts/deploy.sh
#   - 최신 main 을 git pull
#   - 백엔드 의존성 동기화 + 프론트 빌드
#   - 정적파일을 /var/www/koreansim 으로 배포
#   - 백엔드 재시작 + nginx 리로드
# .env 등 gitignore 대상은 절대 건드리지 않음.
set -euo pipefail

REPO_DIR="$HOME/koreansim"
WWW_DIR="/var/www/koreansim"

cd "$REPO_DIR"

echo ">> [1/5] git pull"
git pull --ff-only

echo ">> [2/5] backend deps"
# pip 콘솔스크립트는 venv 경로 이동 시 shebang이 깨질 수 있으므로 python -m pip 사용
./backend/.venv/bin/python -m pip install -q -r backend/requirements.txt

echo ">> [3/5] frontend build"
( cd frontend && npm ci --no-audit --no-fund && npm run build )

echo ">> [4/5] deploy static -> $WWW_DIR"
sudo rm -rf "${WWW_DIR:?}"/*
sudo cp -r frontend/dist/* "$WWW_DIR"/
sudo chown -R www-data:www-data "$WWW_DIR"

echo ">> [5/5] restart backend + reload nginx"
sudo systemctl restart koreansim-backend
sudo nginx -t
sudo nginx -s reload

echo ">> waiting for backend..."
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1/healthz >/dev/null; then
    echo ">> healthz OK"
    break
  fi
  sleep 1
done

echo ">> DONE. exports:"
curl -s http://127.0.0.1/api/exports/csv
echo
