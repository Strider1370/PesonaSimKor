# Occupation Mapping Draft Audit

This is a local heuristic draft for reviewing the occupation-stratum approach. It is not a runtime contract yet.

- Rows: 1,000,000
- Distinct occupations: 2,120
- Non-other row coverage: 97.11%
- Other row share: 2.89%
- Other distinct occupations: 250

## Row Distribution

| stratum | label | rows | row_share | distinct |
|---|---:|---:|---:|---:|
| professional_managerial | 전문·관리 | 124,603 | 12.46% | 320 |
| office_admin | 사무·행정 | 127,130 | 12.71% | 48 |
| service_sales | 서비스·판매 | 119,780 | 11.98% | 118 |
| transport | 운전·운송 | 46,510 | 4.65% | 57 |
| production_craft | 기능·생산 | 87,414 | 8.74% | 322 |
| simple_labor | 단순노무 | 67,816 | 6.78% | 20 |
| self_employed | 자영·영세 | 6,253 | 0.63% | 3 |
| unemployed | 무직 | 391,562 | 39.16% | 982 |
| other | 기타/검토 | 28,932 | 2.89% | 250 |

## Top Other Occupations

| occupation | count | cumulative_share |
|---|---:|---:|
| 범용 소프트웨어 프로그래머 | 2,929 | 64.95% |
| 육군 장교 | 1,461 | 74.29% |
| 그 외 제품 디자이너 | 1,213 | 76.17% |
| 가스 점검원 | 984 | 79.39% |
| 검표원 | 969 | 79.58% |
| 모바일 애플리케이션 프로그래머 | 928 | 80.15% |
| 웹 프로그래머 | 778 | 81.63% |
| 투자 권유 대행인 | 540 | 85.57% |
| 산업 특화 소프트웨어 프로그래머 | 539 | 85.68% |
| 구급 요원 | 470 | 87.13% |
| 언어재활사 | 406 | 88.21% |
| 농약 및 비료 시험원 | 388 | 88.45% |
| 산후조리 종사원 | 379 | 88.72% |
| 게임 프로그래머 | 374 | 88.87% |
| 무대 및 세트 디자이너 | 345 | 89.73% |
| 의상 디자이너 | 332 | 90.06% |
| 화학 시험원 | 301 | 90.67% |
| 그 외 피부 및 체형 관리 종사원 | 263 | 91.64% |
| 공군 장교 | 257 | 91.80% |
| 환경 검사원 | 235 | 92.71% |
| 장례 지도사 | 234 | 92.78% |
| 의복 수선원 | 232 | 92.87% |
| 그 외 공학 관련 기술자 및 시험원 | 231 | 92.89% |
| 스포츠 감독 | 223 | 93.10% |
| 손톱 관리사 | 212 | 93.31% |
| 출판물 편집자 | 212 | 93.34% |
| 건축 석공 | 205 | 93.63% |
| 그 외 시각 디자이너 | 204 | 93.67% |
| 그 외 생명과학 시험원 | 195 | 94.01% |
| 직물 패턴사 | 194 | 94.05% |
| 게임 그래픽 디자이너 | 187 | 94.22% |
| 번역가 | 185 | 94.24% |
| 방송 및 시나리오 작가 | 185 | 94.26% |
| 석재 부설원 | 183 | 94.33% |
| 연예인 매니저 | 182 | 94.35% |
| 금속공학 시험원 | 181 | 94.40% |
| 구두 미화원 | 175 | 94.53% |
| 기자 | 173 | 94.60% |
| 스포츠 매니저 | 162 | 94.84% |
| 미장공 | 160 | 94.89% |

## Top Rule Hits

| rule | rows |
|---|---:|
| exact:unemployed | 367,349 |
| suffix:사무원 | 90,261 |
| exact | 59,283 |
| contains:경비원 | 30,337 |
| no_rule | 28,932 |
| contains:운전원 | 25,644 |
| contains:서비스 | 24,966 |
| contains:구직중 | 24,213 |
| contains:조작원 | 22,955 |
| suffix:연구원 | 22,161 |
| suffix:전문가 | 21,851 |
| contains:청소 | 20,801 |
| contains:판매 | 20,244 |
| contains:조리사 | 16,948 |
| contains:설치 | 15,374 |
| contains:영업 | 15,259 |
| suffix:교사 | 14,571 |
| suffix:비서 | 14,361 |
| contains:단순 | 13,380 |
| contains:상담원 | 12,128 |
| suffix:관리자 | 9,042 |
| suffix:보조원 | 8,338 |
| contains:철도 | 7,035 |
| contains:경영자 | 4,694 |
| contains:컨설턴트 | 4,614 |
| contains:제조 | 4,508 |
| contains:용접 | 4,334 |
| contains:가공 | 3,823 |
| contains:배관 | 3,574 |
| contains:조립 | 3,491 |
| suffix:간호사 | 3,326 |
| contains:설계 | 3,232 |
| contains:택배 | 2,832 |
| suffix:강사 | 2,745 |
| suffix:기술자 | 2,651 |
| contains:부사관 | 2,636 |
| contains:생산 | 2,372 |
| contains:금형 | 2,344 |
| contains:물품 이동 장비 | 2,316 |
| contains:건설 | 2,199 |
