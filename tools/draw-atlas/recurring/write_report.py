"""Compose a local-language report exclusively from the supplied completed draws."""

from collections import Counter
from datetime import date
from pathlib import Path
import json


ML_GAMES = {
    "bhagyathara": "ഭാഗ്യതാര", "sthree-sakthi": "സ്ത്രീശക്തി", "dhanalekshmi": "ധനലക്ഷ്മി",
    "karunya-plus": "കാരുണ്യ പ്ലസ്", "suvarna-keralam": "സുവർണ കേരളം",
    "karunya": "കാരുണ്യ", "samrudhi": "സമൃദ്ധി",
}
EXTRA = {"powerball": "Powerball", "mega-millions": "Mega Ball", "daily-grand": "Grand Number",
         "euromillions": "Lucky Stars", "thunderball": "Thunderball",
         "saturday-lotto": "Supplementaries", "weekday-windfall": "Supplementaries",
         "millionaire-for-life": "Millionaire Ball"}


def name_for(game, lang):
    if lang == "fr":
        return {"lotto-649": "Lotto 6/49 – tirage classique", "daily-grand": "Grande Vie",
                "lotto-max": "Lotto Max"}[game["gameKey"]]
    if lang == "ml":
        return ML_GAMES[game["gameKey"]]
    return game["name"]


def localized(game, language, draws):
    lang = language.split("-")[0]
    current, previous = draws[:2]
    name = name_for(game, lang)
    day = current["date"]
    slot = current.get("drawSlot")
    edition = game["country"]
    identity = current.get("drawNo")
    sources = []
    source_name = {"us": "New York Lottery", "ca": "WCLC", "uk": "The National Lottery",
                   "au": "Lotterywest", "in": "കേരള സംസ്ഥാന ഭാഗ്യക്കുറി വകുപ്പ്",
                   "kr": "동행복권", "jp": "楽天銀行 宝くじ"}[edition]
    for event in (current, previous):
        url = event["sourceUrl"]
        if not any(s["url"] == url for s in sources):
            sources.append({"label": source_name + " · " + event["date"], "url": url})
    if lang == "ml":
        rows = [{"label": r["drawNo"] + " · " + r["date"], **r["ticket"]} for r in draws[:2]]
        ticket = rows[0]["series"] + " " + rows[0]["number"]
        return {"game": name, "language": language, "title": f"{name} {identity} ഫലം | {ticket}",
                "intro": f"{day}-ലെ {name} നറുക്കെടുപ്പിൽ ഒന്നാം സമ്മാനം ലഭിച്ച ടിക്കറ്റ് {ticket} ആണ്. ടിക്കറ്റ് പരിശോധിക്കുമ്പോൾ സീരീസും ആറക്ക നമ്പറും ഒരുമിച്ച് നോക്കുക.",
                "introEmphasis": ticket,
                "sections": [{"heading": "മുൻ നറുക്കെടുപ്പുമായി താരതമ്യം",
                              "text": f"മുൻ നറുക്കെടുപ്പിൽ ഒന്നാം സമ്മാനം ലഭിച്ചത് {rows[1]['series']} {rows[1]['number']} എന്ന ടിക്കറ്റിനായിരുന്നു. രണ്ട് ടിക്കറ്റുകളുടെയും അവസാന നാല് അക്കങ്ങളും സീരീസും പട്ടികയിൽ കാണാം."}],
                "sources": sources, "chart": {"ticketRows": rows}}
    main = sorted(current["rounds"][0]["main"])
    prior = previous["rounds"][0]["main"]
    repeats = sorted(set(main).intersection(prior))
    odd = sum(n % 2 for n in main)
    even = len(main) - odd
    line = " · ".join(map(str, main))
    both = ", ".join(map(str, repeats))
    round_one = len(current["rounds"]) > 1
    if lang == "ko":
        title = f"{name} {identity}회 당첨번호와 직전 회차 비교"
        intro = f"{identity}회 본번호는 {line}입니다. 홀수는 {odd}개, 짝수는 {even}개로 합계는 {sum(main)}입니다."
        heading = "지난 회차와 겹친 번호"
        detail = (f"두 회차에 모두 나온 본번호는 {both}입니다." if both else "두 회차에 공통으로 나온 본번호는 없습니다.")
        detail += " 보너스는 따로 표시했습니다."
        labels = ("본번호", "보너스")
    elif lang == "ja":
        title = f"{name} 第{identity}回の抽せん結果と前回の比較"
        intro = f"今回の本数字は {line} です。奇数は{odd}個、偶数は{even}個で、本数字の合計は{sum(main)}でした。"
        heading = "前回と重なった本数字"
        detail = (f"前回も出た本数字は {both} です。" if both else "前回と同じ本数字はありませんでした。")
        detail += "ボーナス数字は表の別の欄で確認できます。"
        labels = ("本数字", "ボーナス数字")
    elif lang == "fr":
        title = f"{name} du {day} | Résultats et comparaison des tirages"
        intro = f"Les numéros principaux du tirage sont {line}. Leur somme est de {sum(main)}."
        heading = "D’un tirage à l’autre"
        detail = (f"Numéros principaux présents dans les deux tirages : {both}." if both else "Aucun numéro principal ne figure dans les deux tirages.")
        detail += f" Le tirage précédent a eu lieu le {previous['date']}."
        labels = ("Numéros principaux", "Grand numéro" if game["gameKey"] == "daily-grand" else "Numéro complémentaire")
    else:
        detail_prefix = "Round 1 main numbers" if round_one else "Main numbers"
        slot_name = " (" + slot + ")" if slot else ""
        title = f"{name}{slot_name} results for {day} | Draw comparison"
        intro = f"{detail_prefix} for {day}{slot_name} were {line}. Together they add up to {sum(main)}."
        heading = "Which numbers appeared again?"
        if both:
            detail = f"In both the latest draw and the one on {previous['date']}, these main numbers appeared: {both}."
        else:
            detail = f"No main number carried over from the draw on {previous['date']}."
        if round_one:
            detail += " The table also shows Round 2, compared separately with the previous Round 2."
        labels = ("Main numbers", EXTRA.get(game["gameKey"], "Bonus"))
    rows = []
    for event in draws[:3]:
        for i, result in enumerate(event["rounds"], 1):
            label = event["date"]
            if event.get("drawSlot"):
                label += " · " + event["drawSlot"]
            if len(event["rounds"]) > 1:
                label += f" · Round {i}"
            rows.append({"label": label, "date": event["date"], "round": i,
                         "main": sorted(result["main"]), "extra": result["extra"]})
    chart = {"mainLabel": labels[0], "extraLabel": labels[1], "rows": rows}
    window = draws[:10]
    if len(window) >= 3:
        counts = Counter(n for r in window for n in r["rounds"][0]["main"])
        high = max(counts.values())
        top = [{"number": n, "count": high} for n in sorted(counts) if counts[n] == high]
        size = len(window)
        caption = {"ko": f"최근 {size}회 가장 자주 나온 본번호", "ja": f"直近{size}回で最も多く出た本数字",
                   "fr": f"Numéros principaux les plus fréquents sur {size} tirages",
                   "en": f"Most frequent {'Round 1 ' if round_one else ''}main numbers across {size} draws"}[lang]
        chart["history"] = {"count": size, "from": window[-1]["date"], "to": day, "hits": top, "label": caption}
    return {"language": language, "game": name, "title": title, "intro": intro, "introEmphasis": line,
            "sections": [{"heading": heading, "text": detail}], "chart": chart, "sources": sources}


def add_us_picks(report, game):
    """Only link an archived preview for the same game, prepared before this draw."""
    if game not in {"powerball", "mega-millions", "ny-lotto"}:
        return
    day = report["date"]
    file = Path(__file__).resolve().parents[3] / "data" / "posts" / game / (day + ".json")
    if not file.is_file():
        return
    post = json.loads(file.read_text(encoding="utf-8"))
    if (post.get("gameId") != game or post.get("targetDate") != day
            or not post.get("publishedDate") or date.fromisoformat(post["publishedDate"]) >= date.fromisoformat(day)
            or not post.get("sets")):
        return
    numbers = post["sets"][0]["white"]
    if not numbers or not all(type(n) is int and n > 0 for n in numbers):
        return
    display = " · ".join(map(str, numbers))
    report["sections"].append({"heading": "Before the draw", "emphasis": display,
        "text": f"The first example line in the pre-draw preview included {display} as its main numbers. The archived preview lists all the example lines for comparison."})
    report["sources"].append({"label": f"AI Lottery Hub · pre-draw preview for {day}",
                              "url": f"https://ssgpost.org/{game}/{day}/"})


def make_report(game, edition, draws):
    report = localized(game, edition["language"], draws)
    report.update(key=game["country"], gameKey=game["gameKey"], date=draws[0]["date"],
                  labels=[game["country"].upper(), name_for(game, edition["language"].split("-")[0])])
    if draws[0].get("drawSlot"):
        report["drawSlot"] = draws[0]["drawSlot"]
    if edition.get("also"):
        report["fr"] = localized(game, edition["also"], draws)
    if game["country"] == "us":
        add_us_picks(report, game["gameKey"])
    return report
