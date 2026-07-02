# US Lottery Blog — AI Lottery Hub 홍보용 자동 분석 블로그

매 회차 추첨 직후 **자동으로** 영어 분석 글(핫/콜드 번호, 패턴 통계, AI 예상 조합)을
발행하는 정적 블로그. 모든 글 하단에 [AI Lottery Hub 앱](https://play.google.com/store/apps/details?id=appfactory.US.lottery.usailottery)
설치 CTA가 붙는다.

## 구조

| 대상 | 발행 방식 |
|---|---|
| Powerball / Mega Millions / NY Lotto | 회차마다 개별 분석 글 |
| Take 5 (Mid/Eve) + Millionaire for Life | 하루 1건 "NY Daily Digest" |

- 데이터: NY Open Data (앱과 동일한 SODA 데이터셋, 무료·키 불필요)
- 글 생성: 템플릿 + 시드 고정 문장 로테이션 (LLM 미사용, 비용 0)
- 예상 조합: 시드 고정(게임+대상 회차) → 재빌드해도 번호 안 바뀜
- 자동화: GitHub Actions가 매시간 새 회차 확인 → 새 글 커밋 → Pages 재배포

```
site.config.js      사이트/게임 설정 (단일 진실 원천)
lib/soda.js         SODA fetch·파싱·날짜 유틸
lib/stats.js        최근 50회차 통계 분석
lib/predict.js      전략별 예상 조합 (시드 RNG)
lib/prose.js        영어 문장 로테이션 풀
lib/charts.js       SVG 차트·히어로 배너
lib/html.js         페이지 템플릿
content/pages.js    About/Methodology/Privacy/Disclaimer
scripts/update.js   새 회차 감지 → data/에 글 JSON 생성
scripts/build.js    data/ → dist/ 정적 사이트 렌더링
data/               생성된 글 JSON + state.json (커밋됨 = 글 아카이브)
```

## 배포 절차 (1회만)

1. GitHub에 **공개** 저장소 생성 (예: `us-lottery-blog`) 후 이 폴더를 푸시.
2. [site.config.js](site.config.js)의 `baseUrl`을 실제 주소로 변경:
   `https://<유저명>.github.io/<저장소명>` (뒤 슬래시 없이)
3. 저장소 **Settings → Pages → Source**를 **"GitHub Actions"** 로 설정.
4. **Actions 탭 → "Auto-publish lottery analysis" → Run workflow** 로 1회 수동 실행
   → 부트스트랩(전 게임 최신 회차 글 생성) + 첫 배포.
5. 이후는 매시간 cron이 알아서 발행. 손댈 것 없음.

## 로컬 테스트

```bash
node scripts/update.js   # 새 회차 확인 + 글 생성 (data/)
node scripts/build.js    # dist/ 렌더링
node scripts/serve.js    # 미리보기 서버 → http://localhost:8080
```

> ⚠️ `dist/index.html`을 파일로 직접 열면(file://) 폴더 링크에서 index.html을
> 자동으로 못 찾아 디렉터리 색인이 뜬다. 반드시 serve.js로 확인할 것.
> (GitHub Pages 배포에서는 당연히 정상 동작)

## 이후 확장 아이디어

- 게임별 히어로 PNG(og:image)를 Recraft/Replicate로 생성해 `assets/`에 추가
- Google Search Console 등록 + `sitemap.xml` 제출 (SEO 필수)
- 커스텀 도메인 연결 (`baseUrl`만 바꾸면 됨)
- 서두/총평 문단만 LLM(Claude API) 생성으로 업그레이드 (하이브리드)
- AdSense 승인 신청 (Privacy/Disclaimer 페이지는 이미 준비됨)
