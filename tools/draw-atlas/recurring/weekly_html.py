"""Render a sourced weekly Draw Atlas brief for the existing Blogger theme."""

from datetime import date
from html import escape
from urllib.parse import urlsplit


COUNTRIES = {"us", "ca", "uk", "au", "in", "kr", "jp"}
WORDS = {
    "en": {
        "recent": "Recent draw results", "draw": "Draw", "main": "Main numbers",
        "extra": "Bonus", "stats": "The week in numbers", "window": "Draws reviewed",
        "odd_even": "Odd / even in the latest draw", "overlap": "Repeated from the previous draw",
        "sum": "Main-number sum range", "average": "Average", "frequent": "Most frequent main numbers",
        "examples": "Example combinations", "set": "Approach", "sources": "Sources",
        "news": "Official lottery news",
        "tickets": "Recent first-prize tickets", "series": "Series", "ticket": "Six-digit number",
        "suffixes": "Ticket endings (four / two digits)",
        "disclaimer": "These combinations are examples based on past results. Past results cannot predict the next draw.",
    },
    "fr": {
        "recent": "Résultats des tirages récents", "draw": "Tirage", "main": "Numéros principaux",
        "extra": "Numéro complémentaire", "stats": "La semaine en chiffres",
        "window": "Tirages examinés", "odd_even": "Impairs / pairs au dernier tirage",
        "overlap": "Repris du tirage précédent", "sum": "Fourchette de la somme des numéros",
        "average": "Moyenne", "frequent": "Numéros principaux les plus fréquents",
        "examples": "Combinaisons à titre d’exemple", "set": "Méthode", "sources": "Sources",
        "news": "Actualités officielles des loteries",
        "tickets": "Billets récents du premier prix", "series": "Série", "ticket": "Numéro à six chiffres",
        "suffixes": "Terminaisons (quatre / deux chiffres)",
        "disclaimer": "Ces combinaisons illustrent les résultats passés. Les tirages précédents ne permettent pas de prévoir le prochain.",
    },
    "ko": {
        "recent": "최근 추첨 결과", "draw": "회차", "main": "본번호", "extra": "보너스",
        "stats": "이번 주 숫자 분석", "window": "분석한 회차", "odd_even": "최신 회차 홀수 / 짝수",
        "overlap": "직전 회차와 겹친 본번호", "sum": "본번호 합계 범위", "average": "평균",
        "frequent": "가장 자주 나온 본번호", "examples": "참고용 번호 조합",
        "set": "조합 방식", "sources": "자료 출처", "tickets": "최근 1등 티켓",
        "news": "복권 공식 소식",
        "series": "시리즈", "ticket": "6자리 번호",
        "suffixes": "티켓 끝자리 (4자리 / 2자리)",
        "disclaimer": "과거 결과를 바탕으로 만든 참고용 조합입니다. 이전 결과로 다음 추첨번호를 예측할 수는 없습니다.",
    },
    "ja": {
        "recent": "最近の抽せん結果", "draw": "抽せん回", "main": "本数字",
        "extra": "ボーナス数字", "stats": "今週の数字分析", "window": "分析した回数",
        "odd_even": "最新回の奇数 / 偶数", "overlap": "前回と共通する本数字",
        "sum": "本数字の合計の範囲", "average": "平均", "frequent": "出現回数が多い本数字",
        "examples": "参考用の数字の組み合わせ", "set": "組み合わせ方",
        "sources": "出典", "tickets": "最近の1等当せん券", "series": "シリーズ",
        "news": "公式発表・お知らせ",
        "ticket": "6桁番号",
        "suffixes": "券番号の末尾（4桁 / 2桁）",
        "disclaimer": "過去の結果をもとにした参考用の組み合わせです。過去の結果から次回の抽せん数字を予測することはできません。",
    },
    "ml": {
        "recent": "സമീപകാല നറുക്കെടുപ്പ് ഫലങ്ങൾ", "draw": "നറുക്കെടുപ്പ്",
        "main": "പ്രധാന നമ്പറുകൾ", "extra": "ബോണസ്", "stats": "ഈ ആഴ്ചയിലെ കണക്കുകൾ",
        "window": "പരിശോധിച്ച നറുക്കെടുപ്പുകൾ", "odd_even": "ഒറ്റ / ഇരട്ട",
        "overlap": "മുൻ നറുക്കെടുപ്പിലും വന്നത്", "sum": "നമ്പറുകളുടെ ആകെ പരിധി", "average": "ശരാശരി",
        "frequent": "ഏറ്റവും കൂടുതൽ വന്ന നമ്പറുകൾ", "examples": "ഉദാഹരണ നമ്പറുകൾ",
        "set": "രീതി", "sources": "ഉറവിടങ്ങൾ", "tickets": "സമീപകാല ഒന്നാം സമ്മാന ടിക്കറ്റുകൾ",
        "news": "ഔദ്യോഗിക ലോട്ടറി വാർത്തകൾ",
        "series": "സീരീസ്", "ticket": "ആറക്ക നമ്പർ",
        "suffixes": "ടിക്കറ്റിന്റെ അവസാന അക്കങ്ങൾ (4 / 2)",
        "disclaimer": "ഇവ പഴയ ഫലങ്ങളെ അടിസ്ഥാനമാക്കിയുള്ള ഉദാഹരണങ്ങൾ മാത്രമാണ്. അടുത്ത നറുക്കെടുപ്പിന്റെ ഫലം പ്രവചിക്കാൻ കഴിയില്ല.",
    },
}


def _text(value):
    return escape(str(value), quote=True)


def _iso(value):
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError("Expected an ISO date")
    return value


def _numbers(values):
    if (not isinstance(values, list) or
            any(type(number) is not int or number < 1 for number in values) or
            len(values) != len(set(values))):
        raise ValueError("Expected distinct positive integer numbers")
    return values


def _balls(values, label, kind):
    numbers = _numbers(values)
    balls = "".join(
        f'<span class="atlas-ball atlas-ball-{kind} atlas-band-{(number + 9) // 10}" '
        f'data-number="{number}">{number}</span>' for number in numbers
    )
    return (f'<span class="atlas-ball-group atlas-{kind}-group" role="group" '
            f'aria-label="{_text(label)}" style="--atlas-count:{len(numbers)}">{balls}</span>')


def _paragraphs(value, css_class=""):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Expected article text")
    attr = f' class="{css_class}"' if css_class else ""
    return "".join(f"<p{attr}>{_text(part.strip())}</p>" for part in value.split("\n\n") if part.strip())


def _intro(value, emphasis):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Expected a weekly introduction")
    if emphasis and emphasis in value:
        start = value.index(emphasis)
        content = (_text(value[:start]) +
                   f'<strong class="atlas-report-emphasis">{_text(emphasis)}</strong>' +
                   _text(value[start + len(emphasis):]))
        return f'<p class="atlas-report-lead">{content}</p>'
    return _paragraphs(value, "atlas-report-lead")


def _draw_table(chart, words):
    if chart.get("ticketRows") is not None:
        headings = (words["draw"], words["series"], words["ticket"])
        body = []
        for row in chart["ticketRows"]:
            ticket = str(row["number"])
            if len(ticket) != 6 or not ticket.isdigit():
                raise ValueError("Expected a six-digit ticket result")
            body.append(
                f'<tr><th scope="row">{_text(row["label"])}</th>'
                f'<td class="atlas-series-cell" data-label="{_text(words["series"])}">'
                f'<span class="atlas-ticket-series">{_text(row["series"])}</span></td>'
                f'<td class="atlas-ticket-cell" data-label="{_text(words["ticket"])}">'
                f'<span class="atlas-ticket-number">{ticket}</span></td></tr>'
            )
        css_class = "atlas-report-draws atlas-ticket-draws"
        caption = words["tickets"]
    else:
        rows = chart["rows"]
        has_extra = any(row["extra"] for row in rows)
        headings = (words["draw"], chart.get("mainLabel", words["main"]))
        if has_extra:
            headings += (chart.get("extraLabel", words["extra"]),)
        body = []
        for row in rows:
            line = (f'<tr><th scope="row">{_text(row["label"])}</th>'
                    f'<td class="atlas-main-cell" data-label="{_text(headings[1])}">'
                    f'{_balls(row["main"], headings[1], "main")}</td>')
            if has_extra:
                line += (f'<td class="atlas-extra-cell" data-label="{_text(headings[2])}">'
                         f'{_balls(row["extra"], headings[2], "extra")}</td>')
            body.append(line + "</tr>")
        css_class = "atlas-report-draws" + ("" if has_extra else " atlas-no-extra")
        caption = words["recent"]
    header = "".join(f'<th scope="col">{_text(name)}</th>' for name in headings)
    return (f'<table class="{css_class}" style="width:100%;border-collapse:collapse">'
            f'<caption>{_text(caption)}</caption><thead><tr>{header}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table>')


def _statistics(stats, words, key):
    count = stats["count"]
    if type(count) is not int or count < 2:
        raise ValueError("A weekly brief needs at least two verified draws")
    period = f'{_text(_iso(stats["from"]))} – {_text(_iso(stats["to"]))}'
    metrics = [(words["window"], f"{count} · {period}")]
    if key != "in":
        odd_even = stats["oddEven"]
        overlap = stats["overlap"]
        sum_range = stats["sum"]
        metrics.extend([
            (words["odd_even"], f'{odd_even["odd"]} / {odd_even["even"]}'),
            (words["overlap"], ", ".join(map(str, overlap["numbers"])) or "—"),
            (words["sum"], f'{sum_range["min"]}–{sum_range["max"]} · '
                            f'{words["average"]} {sum_range["average"]}'),
        ])
    rows = "".join(
        f'<tr><th scope="row">{_text(label)}</th><td>{_text(value)}</td></tr>'
        for label, value in metrics
    )
    if key == "in":
        ticket_rows = stats.get("ticketSuffixes", [])
        if ticket_rows:
            rows += (f'<tr><th scope="row">{_text(words["suffixes"])}</th>'
                     f'<td>{_text(stats["from"])} – {_text(stats["to"])}</td></tr>')
        for ticket in ticket_rows:
            rows += (
                f'<tr><th scope="row">{_text(ticket["date"])} · {_text(ticket["drawNo"])}</th>'
                f'<td>{_text(ticket["series"])} · '
                f'…{_text(ticket["last4"])} / …{_text(ticket["last2"])}</td></tr>'
            )
    hot = stats.get("hot", [])
    frequent = ""
    if hot and key != "in":
        hits = " ".join(f'{_balls([hit["number"]], words["main"], "frequency")} '
                        f'<span>{_text(hit["count"])} / {count}</span>' for hit in hot)
        frequent = f'<p><strong>{_text(words["frequent"])}</strong> · {hits}</p>'
    return (f'<section class="atlas-report-section atlas-weekly-stats">'
            f'<h2>{_text(words["stats"])}</h2><table class="atlas-report-frequency">'
            f'<tbody>{rows}</tbody></table>{frequent}</section>')


def _examples(sets, words, disclaimer):
    if not sets:
        return ""
    has_extra = any(item["extra"] for item in sets)
    headers = (words["set"], words["main"]) + ((words["extra"],) if has_extra else ())
    head = "".join(f'<th scope="col">{_text(label)}</th>' for label in headers)
    rows = []
    for item in sets:
        label = _text(item["label"])
        description = _text(item["description"])
        line = (f'<tr><th scope="row">{label}<br/><small>{description}</small></th>'
                f'<td class="atlas-main-cell" data-label="{_text(words["main"])}">'
                f'{_balls(item["main"], words["main"], "main")}</td>')
        if has_extra:
            line += (f'<td class="atlas-extra-cell" data-label="{_text(words["extra"])}">'
                     f'{_balls(item["extra"], words["extra"], "extra")}</td>')
        rows.append(line + "</tr>")
    css_class = "atlas-report-draws atlas-weekly-examples" + ("" if has_extra else " atlas-no-extra")
    return (f'<section class="atlas-report-section"><h2>{_text(words["examples"])}</h2>'
            f'<p>{_text(disclaimer)}</p>'
            f'<table class="{css_class}" style="width:100%;border-collapse:collapse">'
            f'<thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></section>')


def _news(items, words, article_language):
    if not items:
        return ""
    if not isinstance(items, list):
        raise ValueError("Expected a list of official news items")
    stories = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Expected an official news item")
        title = item.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Official news needs a headline")
        day = _iso(item.get("date"))
        raw_url = item.get("url")
        if not isinstance(raw_url, str):
            raise ValueError("Official news needs a source link")
        url = urlsplit(raw_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("Expected an HTTPS official news link")
        source_language = item.get("language", article_language)
        if source_language not in {"en", "fr", "ko", "ja", "ml", "en-CA", "fr-CA"}:
            raise ValueError("Unexpected official news language")
        summary = item.get("summary")
        if summary is not None and not isinstance(summary, str):
            raise ValueError("Official news summary must be text")
        excerpt = f'<p>{_text(summary.strip())}</p>' if summary and summary.strip() else ""
        stories.append(
            f'<li class="atlas-weekly-news-item" lang="{_text(source_language)}" '
            f'style="overflow-wrap:anywhere">'
            f'<time datetime="{day}">{day}</time>'
            f'<h3><a href="{_text(raw_url)}" rel="noopener noreferrer">'
            f'{_text(title.strip())}</a></h3>{excerpt}</li>'
        )
    return (f'<section class="atlas-report-section atlas-weekly-news">'
            f'<h2>{_text(words["news"])}</h2><ul>{"".join(stories)}</ul></section>')


def _sources(items, words):
    if not items:
        raise ValueError("Weekly article needs at least one source")
    links = []
    for item in items:
        url = urlsplit(item["url"])
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("Expected an HTTPS source link")
        links.append(f'<li><a href="{_text(item["url"])}">{_text(item["label"])}</a></li>')
    return (f'<section class="atlas-report-sources"><h2>{_text(words["sources"])}</h2>'
            f'<ul>{"".join(links)}</ul></section>')


def _article(report, css_class):
    key = report["key"]
    language = report["language"]
    words = WORDS[language.split("-")[0]]
    title = (f'<h2 class="atlas-report-title">{_text(report["title"])}</h2>'
             if css_class == "atlas-lang-fr" else "")
    sections = "".join(
        f'<section class="atlas-report-section"><h2>{_text(section["heading"])}</h2>'
        f'{_paragraphs(section["text"])}</section>' for section in report["sections"]
    )
    observation = report["stats"].get("lead")
    lead = (f'<blockquote class="atlas-weekly-observation">{_text(observation)}</blockquote>'
            if observation and observation not in report["intro"] else "")
    return (f'<div class="atlas-report atlas-weekly atlas-edition-{_text(key)} '
            f'atlas-game-{_text(report["gameKey"])} {css_class}" lang="{_text(language)}" '
            f'data-country="{_text(key)}" data-game="{_text(report["gameKey"])}">'
            f'{title}{_intro(report["intro"], observation)}{lead}'
            f'{_draw_table(report["chart"], words)}'
            f'{_statistics(report["stats"], words, key)}'
            f'{_news(report.get("newsItems"), words, language)}{sections}'
            f'{_examples(report["exampleSets"], words, report.get("disclaimer") or words["disclaimer"])}'
            f'{_sources(report["sources"], words)}</div>')


def render_weekly(report):
    """Return a full Blogger body, with one stable identity for deduplication."""
    key = report["key"]
    if key not in COUNTRIES:
        raise ValueError("Unknown Draw Atlas edition")
    week_start = _iso(report["weekStart"])
    identity = f"atlas-{key}-weekly-{week_start}"
    if report["weeklyId"] != identity or report["labels"][0] != key.upper():
        raise ValueError("Unexpected weekly identity or country label")
    if key == "in" and report["exampleSets"]:
        raise ValueError("Do not present an invented Kerala ticket as a purchasable combination")
    if "fr" in report:
        if key != "ca":
            raise ValueError("French companion content is only configured for Canada")
        translated = {**report, **report["fr"], "key": key, "gameKey": report["gameKey"]}
        body = _article(report, "atlas-lang-en") + _article(translated, "atlas-lang-fr")
    else:
        body = _article(report, "")
    return f'<div class="atlas-draw {identity}" data-draw-atlas-id="{identity}">{body}</div>'
