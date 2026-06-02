# persona-prompt-input 진행 상태

- [x] Task 1~13 구현 완료
- [x] Task 14 자동 검증 완료
- Backend `pytest -q`: PASS (`91 passed`)
- Frontend `npx.cmd vitest run`: PASS (`11 passed`, `61 tests`)
- Frontend `npx.cmd tsc --noEmit`: PASS
- `depcruise`: 설정 파일 `.dependency-cruiser.*` 없음으로 실행 불가
- `knip`: 기존 e2e Playwright dependency 및 exported type 경고 보고, 새 `PersonaFieldsBadge` 미사용 경고 없음
- 통합 검증: backend SSE 테스트에서 `relevant_optional_fields`, `included_fields`, preview prompt, 실제 stream `optional_fields` tuple 전달 확인
