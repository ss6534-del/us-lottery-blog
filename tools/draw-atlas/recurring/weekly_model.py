"""Build one factual, localized weekly brief from completed official draws."""

from collections import Counter
from datetime import date, timedelta
from hashlib import sha256
import random

from discover_asia import JP_BALLS
from discover_west import AU_RULES, CA_RULES, US_RULES
from write_report import localized, name_for


WEEKLY_LABELS = {
    "en": "Weekly brief",
    "fr": "Bilan hebdomadaire",
    "ko": "주간 분석",
    "ja": "週間分析",
    "ml": "പ്രതിവാര അവലോകനം",
}

SET_LABELS = {
    "en": ("Frequency mix", "Balanced mix", "Random example"),
    "fr": ("Mélange de fréquences", "Combinaison équilibrée", "Exemple aléatoire"),
    "ko": ("최근 빈도 조합", "균형 조합", "무작위 예시"),
    "ja": ("出現頻度の組み合わせ", "バランスの組み合わせ", "ランダムな例"),
}

SET_DESCRIPTIONS = {
    "en": (
        "Uses the most frequent main numbers in the observed window.",
        "Keeps the odd/even split and sum close to the observed range.",
        "Drawn uniformly from the full allowed number pool.",
    ),
    "fr": (
        "Utilise les numéros principaux les plus fréquents de la période observée.",
        "Reste proche de la répartition pair/impair et de la somme observées.",
        "Tirée uniformément parmi tous les numéros autorisés.",
    ),
    "ko": (
        "관찰한 회차에서 자주 나온 본번호를 반영했습니다.",
        "관찰한 회차의 홀짝 구성과 번호 합계에 가깝게 골랐습니다.",
        "허용된 번호 범위에서 균일하게 골랐습니다.",
    ),
    "ja": (
        "集計した回で出現回数が多い本数字を組み合わせました。",
        "集計した回の奇数・偶数の構成と合計に近づけました。",
        "対象の番号から一様に選んだ例です。",
    ),
}

DISCLAIMERS = {
    "en": "Example combinations based on past results. They do not predict a future draw or improve the chance of winning.",
    "fr": "Combinaisons données à titre d’exemple à partir des résultats passés. Elles ne prédisent pas le prochain tirage et n’augmentent pas les chances de gagner.",
    "ko": "과거 결과를 참고한 예시 조합입니다. 다음 추첨을 예측하거나 당첨 확률을 높이지 않습니다.",
    "ja": "過去の結果を参考にした組み合わせ例です。次回の結果を予測したり、当せん確率を高めたりするものではありません。",
}


def _rules(game):
    country, key = game["country"], game["gameKey"]
    if country == "us":
        _, main_count, main_max, extra_count, extra_max = US_RULES[key]
        same_pool = key == "ny-lotto"
    elif country == "ca":
        main_count, main_max, extra_count, extra_max = CA_RULES[key]
        same_pool = key != "daily-grand"
    elif country == "uk":
        main_count, main_max, extra_count, extra_max = {
            "lotto": (6, 59, 1, 59),
            "euromillions": (5, 50, 2, 12),
            "thunderball": (5, 39, 1, 14),
        }[key]
        same_pool = key == "lotto"
    elif country == "au":
        main_count, main_max, extra_count, extra_max = AU_RULES[game["archive"]]
        same_pool = key != "powerball"
    elif country == "kr":
        main_count, main_max, extra_count, extra_max, same_pool = 6, 45, 1, 45, True
    elif country == "jp":
        main_count, extra_count, main_max = JP_BALLS[game["archive"]]
        extra_max, same_pool = main_max, True
    else:
        raise ValueError("Ticket games do not have drawable number combinations")
    return main_count, main_max, extra_count, extra_max, same_pool


def _valid_balls(values, count, maximum):
    return (isinstance(values, list) and len(values) == count and
            all(type(number) is int and 1 <= number <= maximum for number in values) and
            len(set(values)) == count)


def _validate(game, draws, week_start):
    if not isinstance(week_start, date) or week_start.weekday() != 0:
        raise ValueError("week_start must be the local Monday")
    if len(draws) < (2 if game["country"] == "in" else 3):
        raise ValueError("Not enough completed draws for a weekly comparison")
    dates = [date.fromisoformat(row["date"]) for row in draws]
    stamps = [(row["date"], row.get("drawSlot", "")) for row in draws]
    if stamps != sorted(set(stamps), reverse=True):
        raise ValueError("Draws must be newest first with no duplicate identity")
    if dates[0] < week_start - timedelta(days=7) or dates[0] > week_start + timedelta(days=6):
        raise ValueError("Latest confirmed result is outside this brief's date range")
    for row in draws:
        if not row.get("sourceUrl", "").startswith("https://"):
            raise ValueError("Each draw needs a verified HTTPS publisher URL")
        if game["country"] == "in":
            ticket = row.get("ticket", {})
            if (len(ticket.get("series", "")) != 2 or not ticket["series"].isalpha() or
                    not ticket["series"].isupper() or
                    len(ticket.get("number", "")) != 6 or not ticket["number"].isdigit()):
                raise ValueError("Kerala first-prize ticket must be hydrated from its PDF")
            continue
        rules = _rules(game)
        for result in row.get("rounds", []):
            if (not _valid_balls(result.get("main"), rules[0], rules[1]) or
                    not _valid_balls(result.get("extra"), rules[2], rules[3]) or
                    rules[4] and set(result["main"]) & set(result["extra"])):
                raise ValueError("Archived result does not follow this game's number rules")
        if not row.get("rounds"):
            raise ValueError("Archived result has no completed round")


def _lead(language, repeated, consecutive, hot, count):
    if repeated:
        number = ", ".join(map(str, repeated))
        return {
            "ko": f"최근 회차와 직전 회차에 공통으로 나온 본번호는 {number}입니다.",
            "ja": f"直近の本数字 {number} は前回にも出ています。",
            "fr": f"Les numéros principaux {number} figurent aussi dans le tirage précédent.",
            "en": f"The latest draw and the previous draw shared these main numbers: {number}.",
        }[language]
    if consecutive:
        pair = f"{consecutive[0]}–{consecutive[1]}"
        return {
            "ko": f"최근 본번호에 연속 번호 {pair}가 포함됐습니다.",
            "ja": f"直近の本数字には連続する {pair} が含まれています。",
            "fr": f"Le dernier tirage comprend deux numéros consécutifs : {pair}.",
            "en": f"The latest draw included a consecutive pair: {pair}.",
        }[language]
    number, hits = hot[0]["number"], hot[0]["count"]
    return {
        "ko": f"최근 {count}회에서 본번호 {number}가 {hits}회 나왔습니다.",
        "ja": f"直近{count}回では本数字 {number} が{hits}回出ています。",
        "fr": f"Sur les {count} derniers tirages, le numéro principal {number} est sorti {hits} fois.",
        "en": f"Main number {number} appeared {hits} times across the last {count} draws.",
    }[language]


def _sample_lines(game, week_start, stats, language):
    main_count, main_max, extra_count, extra_max, same_pool = _rules(game)
    seed = int.from_bytes(sha256(f"{game['country']}:{game['gameKey']}:{week_start}".encode()).digest()[:8], "big")
    rng = random.Random(seed)
    labels, descriptions = SET_LABELS[language], SET_DESCRIPTIONS[language]
    all_main = range(1, main_max + 1)
    frequency = stats["frequency"]
    newest_odd = stats["oddEven"]["odd"]
    average_sum = stats["sum"]["average"]

    hot = [entry["number"] for entry in stats["hot"][:2]]
    weighted = {number: frequency.get(number, 0) + 1 for number in all_main}

    def finish(main):
        pool = [number for number in range(1, extra_max + 1)
                if not same_pool or number not in main]
        extra = sorted(rng.sample(pool, extra_count))
        return sorted(main), extra

    first = list(hot)
    while len(first) < main_count:
        pool = [number for number in all_main if number not in first]
        first.append(rng.choices(pool, weights=[weighted[n] for n in pool])[0])
    first = finish(first)

    # The best of a bounded sample remains an example, with no statistical edge.
    candidates = [rng.sample(all_main, main_count) for _ in range(180)]
    balanced = min(candidates, key=lambda line: (
        abs(sum(n % 2 for n in line) - newest_odd) * 8 +
        abs(sum(line) - average_sum), sorted(line)))
    balanced = finish(balanced)

    random_line = finish(rng.sample(all_main, main_count))
    lines = [first, balanced, random_line]
    # Repeated examples obscure the intended comparison between methods.
    for index in range(1, len(lines)):
        while any(lines[index][0] == previous[0] for previous in lines[:index]):
            lines[index] = finish(rng.sample(all_main, main_count))
    return [{"label": labels[i], "description": descriptions[i],
             "main": line[0], "extra": line[1]} for i, line in enumerate(lines)]


def _ball_report(game, draws, week_start, language):
    lang = language.split("-")[0]
    base = localized(game, language, draws)
    window = draws[:10]
    rows = [sorted(row["rounds"][0]["main"]) for row in window]
    frequency = Counter(number for line in rows for number in line)
    hot = [{"number": number, "count": hits} for number, hits in
           sorted(frequency.items(), key=lambda item: (-item[1], item[0]))[:6]]
    repeated = sorted(set(rows[0]) & set(rows[1]))
    consecutive = next(((a, b) for a, b in zip(rows[0], rows[0][1:]) if b == a + 1), None)
    sums = [sum(line) for line in rows]
    odd = sum(number % 2 for number in rows[0])
    stats = {
        "count": len(window), "from": window[-1]["date"], "to": window[0]["date"],
        "hot": hot, "frequency": dict(sorted(frequency.items())),
        "oddEven": {"odd": odd, "even": len(rows[0]) - odd},
        "overlap": {"count": len(repeated), "numbers": repeated},
        "sum": {"min": min(sums), "max": max(sums), "average": round(sum(sums) / len(sums), 1)},
    }
    stats["lead"] = _lead(lang, repeated, consecutive, hot, len(window))
    game_name = name_for(game, lang)
    week = week_start.isoformat()
    if lang == "ko":
        title = f"{game_name} 주간 번호 노트 | {week} 주"
        intro = f"{game_name}의 최근 {len(window)}회 추첨({stats['from']}~{stats['to']})을 살폈습니다. {stats['lead']}"
        section = f"최근 {len(window)}회 본번호의 출현 횟수와 직전 회차의 홀짝 구성, 합계를 비교했습니다. 아래 번호 조합은 과거 결과를 참고한 예시입니다."
        heading = "최근 추첨에서 보인 흐름"
    elif lang == "ja":
        title = f"{game_name} 今週の数字ノート | {week}週"
        intro = f"{game_name}の直近{len(window)}回（{stats['from']}〜{stats['to']}）を集計しました。{stats['lead']}"
        section = f"直近{len(window)}回の本数字の出現回数と、前回との共通数字・奇数と偶数の構成を整理しました。以下は過去の結果を参考にした組み合わせ例です。"
        heading = "直近の結果から見えること"
    elif lang == "fr":
        title = f"{game_name} | Bilan de la semaine du {week}"
        intro = f"Nous avons examiné les {len(window)} tirages de {game_name} du {stats['from']} au {stats['to']}. {stats['lead']}"
        section = f"Les fréquences des numéros principaux, la répartition pair/impair et les numéros communs aux deux derniers tirages sont calculés à partir de ces {len(window)} résultats. Les combinaisons ci-dessous sont des exemples tirés des données passées."
        heading = "Ce que montrent les tirages récents"
    else:
        title = f"{game_name} weekly number notebook | Week of {week}"
        intro = f"We reviewed {len(window)} completed {game_name} draws from {stats['from']} to {stats['to']}. {stats['lead']}"
        section = f"The main-number frequencies, odd/even split and overlap with the previous draw come from these {len(window)} results. The combinations below are examples drawn from the past results."
        heading = "What the recent draws show"
    base.update(title=title, intro=intro, introEmphasis="", sections=[{"heading": heading, "text": section}],
                stats=stats, exampleSets=_sample_lines(game, week_start, stats, lang),
                disclaimer=DISCLAIMERS[lang])
    return base


def _ticket_report(game, draws, week_start):
    base = localized(game, "ml", draws)
    window = draws[:6]
    tickets = [{"date": row["date"], "drawNo": row["drawNo"],
                "series": row["ticket"]["series"], "number": row["ticket"]["number"],
                "last4": row["ticket"]["number"][-4:],
                "last2": row["ticket"]["number"][-2:]} for row in window]
    name = name_for(game, "ml")
    latest = tickets[0]
    lead = (f"{latest['date']}-ലെ {name} നറുക്കെടുപ്പിൽ ഒന്നാം സമ്മാനം ലഭിച്ചത് "
            f"{latest['series']} {latest['number']} എന്ന ടിക്കറ്റിനാണ്.")
    base.update(
        title=f"{name} പ്രതിവാര ഫല അവലോകനം | {week_start.isoformat()}",
        intro=lead + " സീരീസും ആറക്ക നമ്പറും ഒത്തുനോക്കുമ്പോഴേ ടിക്കറ്റ് ഫലം സ്ഥിരീകരിക്കാനാകൂ.",
        introEmphasis="",
        sections=[{"heading": "അടുത്ത കാലത്തെ ഫലങ്ങൾ",
                   "text": f"{tickets[-1]['date']} മുതൽ {latest['date']} വരെയുള്ള {len(tickets)} ഔദ്യോഗിക നറുക്കെടുപ്പുകളുടെ ഒന്നാം സമ്മാന ടിക്കറ്റ് വിവരങ്ങളാണ് താഴെ. അവസാന നാല് അക്കങ്ങൾ താരതമ്യം ചെയ്യാൻ കാണിച്ചിട്ടുണ്ട്."}],
        chart={"ticketRows": [{"label": row["drawNo"] + " · " + row["date"],
                               "series": row["series"], "number": row["number"]} for row in tickets]},
        stats={"count": len(tickets), "from": tickets[-1]["date"], "to": latest["date"],
               "lead": lead, "ticketSuffixes": tickets},
        exampleSets=[], disclaimer="",
    )
    return base


def make_weekly_report(game, edition, draws, week_start):
    """Return a weekly brief for one country's selected game.

    ``draws`` are verified, newest-first archive rows. Kerala rows must first be
    hydrated from the published department PDF by ``discover_asia.hydrate``.
    """
    _validate(game, draws, week_start)
    country = game["country"]
    report = (_ticket_report(game, draws, week_start) if country == "in" else
              _ball_report(game, draws, week_start, edition["language"]))
    report.update(key=country, gameKey=game["gameKey"], date=draws[0]["date"],
                  weekStart=week_start.isoformat(),
                  weeklyId=f"atlas-{country}-weekly-{week_start.isoformat()}",
                  labels=[country.upper(), WEEKLY_LABELS[edition["language"].split("-")[0]]])
    if edition.get("also"):
        report["fr"] = _ball_report(game, draws, week_start, edition["also"])
    # Every statistic above is calculated from this same bounded archive window.
    # Distinct URLs keep the article traceable to the official source documents.
    source_rows = draws[:6 if country == "in" else 10]
    seen = set()
    report["sources"] = []
    french_sources = []
    for row in source_rows:
        url = row["sourceUrl"]
        if url not in seen:
            report["sources"].append({"label": f"{name_for(game, edition['language'].split('-')[0])} · {row['date']}",
                                      "url": url})
            if "fr" in report:
                french_sources.append({"label": f"{name_for(game, 'fr')} · {row['date']}", "url": url})
            seen.add(url)
    if "fr" in report:
        report["fr"]["sources"] = french_sources
    return report
