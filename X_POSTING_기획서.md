# X(트위터) 자동 포스팅 — 기획서 / 인수인계 (현행본)

> X 포스팅을 수정하는 세션은 **이 파일을 가장 먼저 읽고** 진행하세요.
> 코드를 넘겨짚지 말 것 — 여기 적힌 함정들은 전부 실제로 밟았던 것들입니다.
> 최종 갱신: 2026-07-20 (스레드 도입 시점)

---

## 0. 무엇인가

메인 로또 블로그(ssgpost.org, 이 저장소)의 글과 **US WorkPay 앱** 홍보를
X 계정(@ijaehwa30508592, 개인 계정)에 **하루 1건** 자동 포스팅하는 시스템.

- 실행 주체: `.github/workflows/publish.yml` (매시 :20 cron) → `scripts/update.js` → `lib/social.js`
- 발사는 되돌릴 수 없는 외부 부수효과 + **건당 과금**이므로, 이 시스템의 모든 설계는
  "중복 발사 금지"와 "조용한 실패 금지"를 중심으로 되어 있다.

## 1. 파일 맵

| 파일 | 역할 |
|---|---|
| `lib/social.js` | 핵심. OAuth 1.0a 서명(직접 구현), 큐, 발사 게이트, 스레드/단발 발사, 미디어 업로드 |
| `lib/promo.js` | 앱 홍보 트윗 — APPS(현재 WorkPay 1개), 훅/이미지/스케줄·로테이션 |
| `lib/og.js` | 트윗 이미지 합성(sharp) — 블로그 og:image와 공유. 스레드용 역할별 이미지(ogThreadInfo) |
| `lib/prose.js` | 트윗 훅(HOOKS)·산문 풀 |
| `scripts/update.js` | 글 생성 후 `runSocial(newItems, state)` 호출 |
| `data/state.json` | `_social`(큐·발사 이력)·`_promo`(홍보 로테이션) — **봇 커밋으로 저장돼야 유효** |
| `assets/app-shots/` | WorkPay 홍보 이미지(workpay.jpg) |
| `scripts/make-workpay-card.mjs` / `make-workpay-shots.mjs` | WorkPay 이미지 생성/변환(1회성) |

## 2. 발사 규칙 (2026-07-20 현재)

- **하루 최대 1건** (`DAILY_LIMIT = 1`)
- **종류 교대**: 로또 글 ↔ WorkPay 홍보가 날마다 번갈아 (`state._social.lastKind`: `"post"`↔`"promo"`).
  요일 고정이 아님 — 아래 §7-1 "크론은 정시에 안 돈다" 때문에 일부러 이렇게 설계.
- **발사 창**: 미 동부(America/New_York) **아침 9~12시 / 저녁 19~22시** (`FIRE_WINDOWS = {morning:[9,13], evening:[19,23]}`).
  창 안에서 "그 슬롯이 아직 안 쏘였으면 첫 실행이 쏜다". `firedSlots`로 슬롯당 1건 보장.
  DST는 `Intl.DateTimeFormat(America/New_York)`로 자동 처리 — **UTC 오프셋 하드코딩 금지**.
- **큐**: 새 글은 `state._social.queue`에 적립(최대 20건, 3일 TTL). 우선순위 `rankOf()`:
  ①이변 뉴스(news) ②빅게임 결과(powerball/mega) ③기타 결과 ④analysis ⑤digest·recap.
  같은 게임 연속 회피(lastGameId), 아침=결과/뉴스 선호·저녁=예측 선호(matchesSlot).
- **재트윗 방지**: `postedSlugs` 롤링 100건 — 날짜가 바뀌어도 유지.

## 3. 트윗 형태

### 3-1. 로또 글 — kind `post`/`analysis` = **4트윗 스레드** (`THREAD_KINDS`)
글 JSON의 prose를 문장 단위로 응축해 만든다:
```
[1/4] 훅 + 인트로 요약 + Free Android app: <Play 링크>     🖼 당첨번호 카드
[2/4] 핫/콜드 상세 분석                                    🖼 핫/콜드 이중 차트
[3/4] 패턴·이월 분석 + 예측 세트 소개                       🖼 세트 카드 + 미출현 차트
[4/4] 마무리 + Full breakdown: <블로그 링크> + 앱 링크 + 해시태그
```
- **링크 배치는 사용자 확정 사항**: 앱 링크 = 상단(1)+하단(4), 블로그 링크 = 하단(4)에만. 바꾸지 말 것.
- 재료(prose)가 부족한 트윗은 자동 탈락 → 3트윗으로 축소. 글 JSON이 없으면 단발 폴백.
- 체인: `POST /2/tweets` body의 `reply.in_reply_to_tweet_id`. 트윗 간 1.5초 대기.

### 3-2. 로또 글 — kind `news`/`digest`/`recap` = 단발
`훅 → Free Android app: <앱링크> → Full story: <블로그링크> → 해시태그` (앱이 위, 블로그가 아래 — 사용자 확정).
이미지: news 2장, 나머지 1장 (`composePostImages`).

### 3-3. WorkPay 앱 홍보 = 단발 (lib/promo.js)
- **홍보 대상은 WorkPay 하나뿐** (사용자 결정 2026-07-18). 로또 앱 app1~10은 홍보하지 않는다 —
  `LOTTO_APPS`에 보관만. 되살리려면 항목을 `APPS`로 옮기면 된다.
- 링크는 블로그가 아니라 **Play 스토어 직접**(사용자 지시: 블로그 링크 생략).
  Play 링크에 utm을 붙일 땐 반드시 `&referrer=encodeURIComponent(utm...)` — 경로 끝에 `/`를 붙이면 깨진다(§7-5).
- 이미지: `shots: ["workpay.jpg"]` 1장(데모 데이터가 채워진 피처 그래픽).
  home/stats/ledger 실제 스크린샷은 **$0.00 빈 상태라 홍보 역효과로 제외**(사용자 결정).
  → 채워진 화면으로 재캡처하면: `store_assets`에 넣고 `node scripts/make-workpay-shots.mjs` → `shots` 배열에 추가.
- 훅 문구는 **실제 앱 기능 기준**(project/USworktracer 소스 확인)으로만 쓴다. §7-6 참조.

## 4. 문구 규칙 (전 종류 공통)

- **금칙어 절대 금지**: `win/winning/won/winner/odds/guaranteed/jackpot` 등 (`BANNED` 정규식).
  단어 경계(\b)로만 검사 — substring 검사는 "following"의 win을 오탐한다.
  당첨 보장·확률 향상 암시 금지, entertainment 톤. 트윗·이미지 텍스트 모두 적용.
- 280자 제한, **URL은 길이 무관 t.co 23자로 가중 계산**(`weightedLength`).
- post 글의 훅 날짜는 `publishedDate`(결과일) — `date`는 예측 대상일(아직 추첨 전)이라 쓰면 오보가 된다(§7-4).

## 5. 상태 스키마 (data/state.json)

```jsonc
"_social": {
  "date": "2026-07-20",        // ET 기준 오늘 (count 리셋 기준)
  "count": 1,                  // 오늘 발사 수 (/DAILY_LIMIT)
  "firedSlots": ["morning"],   // 오늘 소진한 슬롯
  "lastKind": "post",          // 직전 발사 종류 → 다음은 promo 차례
  "lastGameId": "powerball",
  "postedSlugs": ["...(롤링 100)"],
  "queue": [ { kind, slug, gameId, gameName, date, publishedDate, rank } ]
},
"_promo": { "week": "2026-W30", "weekCount": n, "postedAppIds": [], "lastAppId": "workpay" }
```
- 스레드 발사 시 **리드 트윗 성공 즉시** posted/count/lastKind 기록(§7-3).
- state는 워크플로의 봇 커밋으로 저장된다 — 커밋/푸시 단계는 `pull --rebase` + 3회 재시도 + 실패 시 `::error`(§7-2).

## 6. 비용 (X Pay-Per-Use — 2026년 신규 개발자는 무료 등급 없음)

| 항목 | 단가 |
|---|---|
| 트윗(링크 포함) | **$0.20/건** — 링크가 1개든 2개든 동일 |
| 트윗(링크 없음) | $0.015/건 |
| 미디어 업로드 | 크레딧 있으면 v2 무과금~미미, **크레딧 없어도 v1.1은 동작**(폴백) |

- 스레드 1건 = 링크 2 + 무링크 2 ≈ **$0.43**. 격일 교대 기준 **월 ~$10**.
- 크레딧 소진 시: 402 에러 로그만 남고 블로그 발행은 정상. X 콘솔에서 충전.
- 실패한 요청은 과금되지 않는다.

## 7. ⚠️ 설계 결정·함정 이력 (전부 실제로 겪은 것)

1. **GitHub Actions 크론은 정시에 안 돈다.** 매시 :20으로 걸어도 무료 저장소에선
   2.4~3.5시간 간격(하루 ~8회)으로 실행된다. "ET 9시 정각 한 시간"만 발사 조건으로
   뒀다가 슬롯을 통째로 놓쳤다(2026-07-15). → 창(window)+슬롯 플래그 방식으로 전환.
   **요일·시각을 정확히 못 박는 로직은 전부 이 함정에 걸린다.**
2. **트윗은 나갔는데 state 저장 실패 = 재트윗.** 봇 push가 bare `git push`였을 때,
   그 사이 누가 main에 푸시하면 non-fast-forward로 실패 → postedSlugs 미저장 →
   다음 실행이 같은 글 재트윗. → push 단계에 `pull --rebase`+3회 재시도+`::error`.
3. **스레드는 리드 성공 즉시 기록.** 후속 트윗이 실패해도 다음 실행이 같은 글로
   스레드를 재시작(=중복)하면 안 된다. 후속 실패는 `::warning` 로그만.
4. **date vs publishedDate.** post 글의 `date`=예측 대상일(추첨 전), `publishedDate`=근거
   결과일. 훅/이미지 라벨에 date를 쓰면 "아직 추첨 안 된 회차의 결과"처럼 읽힌다.
   이 혼용 버그를 문구·썸네일에서 각각 한 번씩 잡았다.
5. **Play 링크 UTM.** `...details?id=pkg` 뒤에 `/`를 붙이거나 `?utm=`을 그냥 붙이면
   링크가 깨지거나 추적이 안 된다. 반드시 `&referrer=<encodeURIComponent(utm...)>`.
6. **앱 홍보 문구는 실물 확인 후 작성.** 앱 이름만 보고 넘겨짚었다가 사용자에게
   지적받았다("무슨 앱인지 알고 구현을 해?"). 랜딩 테마와 실제 앱이 다른 경우도
   많다. 반드시 소스/스크린샷/스토어를 직접 보고 쓸 것.
7. **SOCIAL_DRY_RUN은 큐 적립을 저장해야 한다.** 초기 구현이 dry-run에서 state를
   안 건드려서, 그 시각에 잡힌 새 글이 큐에 못 들어간 채 회차만 소비돼 영영
   트윗되지 않았다. 발사만 건너뛰고 `commit()`은 해야 한다.
8. **미디어 업로드 인증.** v2(`api.x.com/2/media/upload`)는 크레딧 필요(402 CreditsDepleted),
   v1.1(`upload.twitter.com`)은 크레딧 없이도 OAuth 1.0a로 동작. v2→v1.1→텍스트 폴백 순서 유지.
9. **duplicate content.** X는 같은 문구 재게시를 403 처리할 수 있다. 훅을 시드 회전시키는
   이유 중 하나. 같은 글 재발사(위 2·3번)가 터지면 이 403으로 위장되어 나타날 수 있다.

## 8. 테스트·운영 (Actions → "Auto-publish lottery analysis" → Run workflow)

| 입력 | 효과 | 과금 |
|---|---|---|
| `social_dry_run` | 발사 창 무시, 선택될 글·문구(스레드면 전체)·이미지 목록만 로그 출력 | 0 |
| `social_media_test` | 트윗 없이 이미지 업로드만 1회 시도(자격증명·업로드 경로 확인) | 0~미미 |
| `social_force_fire` | 창·슬롯 무시하고 **실제 발사** 1건(스레드면 스레드) | 발생 |
| `promo_force` | 게이트 무시하고 **앱 홍보 실제 발사** 1건 | 발생 |

로컬 검증: `SOCIAL_DRY_RUN=1 node scripts/update.js` (실행 후 `git checkout -- data && git clean -fd data`로 원복 필수 —
update가 실데이터로 글을 생성한다). 실제 트윗·업로드는 로컬에서 불가(키는 GitHub Secrets에만 있음).

**Secrets** (이 저장소 ss6534-del/us-lottery-blog에 등록됨): `X_API_KEY` `X_API_SECRET` `X_ACCESS_TOKEN` `X_ACCESS_SECRET`
(X 개발자 콘솔 OAuth 1.0 키 — 앱 권한 "읽기 및 쓰기" 필수. 계정 교체 시 새 계정으로 키 재발급 후 Secrets만 교체).

## 9. 자주 하게 될 수정 — 어디를 고치나

| 하고 싶은 것 | 위치 |
|---|---|
| 트윗 문구(로또) 수정 | `lib/social.js` `HOOKS` / 스레드 본문은 `buildThread`의 prose 응축부 |
| WorkPay 문구/이미지 수정 | `lib/promo.js` `APPS[0]`의 `hooks`/`shots` |
| 하루 발사 수 변경 | `DAILY_LIMIT` (2로 올리면 교대 로직 재검토 필요 — 현재 lastKind 교대는 1건/일 전제) |
| 발사 시간대 변경 | `FIRE_WINDOWS` (창 폭은 크론 지연 3.5시간을 흡수할 만큼 넓게) |
| 스레드 켜고 끄기 | `THREAD_KINDS` Set에서 kind 추가/제거 |
| 홍보 앱 추가/교체 | `lib/promo.js` `APPS` 배열 (§7-6 절차 준수) |
| 해시태그 | `lib/social.js` `hashtagsFor` / promo는 `APPS[].tags`+`BASE_TAGS` |

## 10. 관련 시스템 (다른 저장소)

- **promo-site**(ss6534-del/appfactory, `promo-site/blog/social.mjs`): app1~10 블로그용 트윗 코드가
  있으나 **X 키 미등록으로 잠자는 상태**. ⚠️ 켜기 전에 반드시 고칠 것: 발사 게이트가
  "ET 9/19 정각"이라 §7-1 함정 그대로 + 하루 카운터만 있고 슬롯 상태가 없어 같은 시간대
  2회 실행 시 하루치가 30분 만에 소진된다. 이 저장소의 창+firedSlots 방식을 이식해야 한다.
- 메모리 파일: `~/.claude/projects/.../memory/us-lottery-blog-x-social.md` (요약본. 이 기획서가 상세본)
