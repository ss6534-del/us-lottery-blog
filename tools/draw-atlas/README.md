# Draw Atlas 회차 발행

매일 한국시간 14시 37분에 7개국 25개 종목의 결과를 확인하고 Draw Atlas에 새 회차를 발행한다. 실행 시각은 GitHub 대기열에 따라 늦어질 수 있다. 워크플로 파일이 변경된 경우에는 공개 자료로 미리보기만 수행한다. Actions의 **Draw Atlas daily Blogger reports → Run workflow**에서 직접 확인할 수도 있다. 실제 발행 시에는 **Publish new draws**를 선택한다.

## 최초 연결

1. Google Cloud에서 이 블로그용 프로젝트의 **Blogger API v3**를 사용 설정하고, Google Auth Platform에서 데스크톱 앱용 OAuth 클라이언트 JSON을 내려받는다. 이 파일은 저장소 밖에 보관한다. 외부 앱의 OAuth 동의 화면이 테스트 모드이면 Blogger 갱신 토큰이 7일 후 만료될 수 있다.
2. 로컬에 Python 3와 GitHub CLI를 설치하고 `gh auth login`으로 이 저장소의 Actions 시크릿을 관리할 계정에 로그인한다.
3. 저장소 루트에서 `python tools/draw-atlas/setup_blogger.py "클라이언트 JSON의 경로"`를 실행하고 Draw Atlas를 관리하는 Google 계정으로 승인한다. 도구가 해당 블로그와 권한을 확인한 뒤 GitHub Actions 시크릿 `BLOGGER_CLIENT_ID`, `BLOGGER_CLIENT_SECRET`, `BLOGGER_REFRESH_TOKEN`을 등록한다.
4. Actions에서 첫 실제 발행을 실행한다. 실행 요약에서 `published` 및 `errors`를 보고, 로그의 공개 글 링크를 확인한다. 기존 로컬 발행 예약을 사용한다면 GitHub 발행을 확인한 뒤 로컬 예약을 일시 중지한다.

## 발행 기준

공식 추첨 결과와 기존 회차가 확인된 글만 발행한다. 미국 Take 5는 같은 날짜의 낮·저녁을 구분하고, 영국 Lotto는 두 라운드를 각각 비교한다. 케랄라는 공식 PDF로 1등 시리즈와 여섯 자리 번호를 검증한다. 캐나다 글에는 영어와 프랑스어를 함께 넣고 일본은 글만 발행한다. 앱 소개와 앱 링크는 기존 Blogger 테마가 국가 라벨을 읽어 표시한다.

이미 공개·예약·초안 상태인 같은 회차는 다시 만들지 않는다. 한 종목의 자료 검증이 실패하면 해당 종목을 실행 요약에 표시하고 나머지 종목을 계속 처리한다. 다음 실행은 Blogger에 저장된 회차를 기준으로 재확인한다. 운영기관의 자료가 사라져 마지막 확인 회차와 연결되지 않으면 해당 종목은 수동 확인이 필요하다.
