# KoreanSim

KoreanSim은 로컬에서 한국 시민 페르소나를 샘플링하고, Ollama LLM으로 정책 반응을 시뮬레이션하는 MVP입니다.

주요 구성:

- FastAPI backend: 페르소나 샘플링, Ollama 호출, SSE 스트리밍
- React/Vite frontend: 정책 입력, 실시간 LLM 입력/출력 확인, 응답/집계 표시
- Nemotron-Personas-Korea parquet dataset: 로컬 페르소나 데이터
- Ollama `qwen3.5:9b`: 기본 로컬 LLM

## Requirements

- Windows PowerShell 기준
- Python 3.11+
- Node.js 20+
- Ollama
- Git 또는 Hugging Face CLI

## Install

루트 의존성:

```powershell
npm install
```

백엔드 Python 환경:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

프론트엔드 의존성:

```powershell
npm --prefix frontend install
```

Ollama 모델:

```powershell
ollama pull qwen3.5:9b
```

## Download Persona Dataset

KoreanSim은 Hugging Face의 NVIDIA `Nemotron-Personas-Korea` 데이터셋을 사용합니다.

- Dataset: https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea
- Format: parquet
- Split: `train`
- Size: 약 1M rows
- License: CC BY 4.0

앱이 기대하는 로컬 경로:

```text
data/Nemotron-Personas-Korea/data/train-*.parquet
```

### Option A: Hugging Face CLI

```powershell
pip install -U huggingface_hub
huggingface-cli download nvidia/Nemotron-Personas-Korea `
  --repo-type dataset `
  --local-dir data/Nemotron-Personas-Korea
```

다운로드 후 parquet 파일이 아래에 있어야 합니다.

```powershell
Get-ChildItem data\Nemotron-Personas-Korea\data\train-*.parquet
```

### Option B: Git LFS

```powershell
git lfs install
git clone https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea data/Nemotron-Personas-Korea
```

### Option C: Python

```powershell
pip install -U huggingface_hub
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='nvidia/Nemotron-Personas-Korea', repo_type='dataset', local_dir='data/Nemotron-Personas-Korea')"
```

`datasets.load_dataset(...)`로 Hugging Face cache에만 받는 방식도 가능하지만, 이 앱은 parquet 파일을 직접 읽으므로 위 경로에 파일이 있어야 합니다.

## Run

Ollama가 이미 켜져 있다면:

```powershell
npm run dev
```

Ollama 서버 로그 창까지 같이 보고 싶다면:

```powershell
npm run dev:with-ollama-window
```

브라우저:

```text
http://localhost:5173
```

헬스체크:

```text
http://localhost:8000/healthz
```

## Run Separately

Backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
npm --prefix frontend run dev
```

Ollama:

```powershell
ollama serve
```

## Environment Variables

Backend:

```powershell
$env:OLLAMA_HOST="http://127.0.0.1:11434"
$env:OLLAMA_MODEL="qwen3.5:9b"
$env:CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

Agent response defaults:

```powershell
$env:OLLAMA_TEMPERATURE="0.65"
$env:OLLAMA_TOP_P="0.9"
$env:OLLAMA_REPEAT_PENALTY="1.1"
$env:OLLAMA_REPEAT_LAST_N="256"
$env:OLLAMA_NUM_PREDICT="500"
```

Summary defaults:

```powershell
$env:OLLAMA_SUMMARY_TEMPERATURE="0.45"
$env:OLLAMA_SUMMARY_TOP_K="20"
$env:OLLAMA_SUMMARY_TOP_P="0.95"
$env:OLLAMA_SUMMARY_REPEAT_PENALTY="1.15"
$env:OLLAMA_SUMMARY_PRESENCE_PENALTY="1.5"
$env:OLLAMA_SUMMARY_REPEAT_LAST_N="256"
$env:OLLAMA_SUMMARY_NUM_PREDICT="3000"
```

Frontend:

```powershell
$env:VITE_API_BASE_URL="http://localhost:8000"
```

## Usage

1. `http://localhost:5173`을 엽니다.
2. 정책 문장을 입력합니다.
3. 응답 인원 수를 선택합니다.
4. `시뮬레이션 실행`을 누릅니다.
5. 화면에서 다음 과정을 확인합니다.
   - 샘플링된 인원
   - LLM 입력 로그
   - LLM 실시간 출력
   - 개별 응답
   - 취합 요약 상태와 요약 LLM 출력
   - 전체 집계

## Tests

전체 테스트:

```powershell
npm test
```

프론트 빌드:

```powershell
npm run build
```

백엔드만:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest -q
```

프론트만:

```powershell
npm --prefix frontend test
npm --prefix frontend run build
```

## Notes

- 데이터셋은 로컬 parquet 파일에서 직접 읽습니다.
- 페르소나는 현재 균등 랜덤 샘플링으로 뽑습니다.
- 개별 응답은 `think=False`로 빠르게 JSON 응답을 받습니다.
- 취합 요약은 `think=True`로 실행하며, thinking은 화면 표시용이고 최종 JSON 파싱은 content만 사용합니다.
- 집계 count는 Python에서 결정적으로 계산합니다.
- LLM 요약이 실패해도 count 집계는 유지됩니다.
