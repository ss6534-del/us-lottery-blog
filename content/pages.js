// 정적 페이지 콘텐츠 (About / Methodology / Privacy / Disclaimer) — AdSense 심사 대비 포함.
import { SITE } from "../site.config.js";

export const STATIC_PAGES = [
  {
    slug: "about",
    title: `About ${SITE.title}`,
    description: `What ${SITE.title} is and how this site works.`,
    body: `
<h1>About ${SITE.title}</h1>
<p>${SITE.title} publishes automated, data-driven analysis for six New York–drawn lottery games:
<strong>Powerball, Mega Millions, NY Lotto, Take 5 (Midday &amp; Evening)</strong> and
<strong>Millionaire for Life</strong>.</p>
<p>Every article on this site is generated automatically within about an hour of the official drawing,
using publicly available results data from the
<a href="https://data.ny.gov" rel="noopener" target="_blank">New York Open Data portal</a>.
Each post recaps the latest winning numbers, charts hot / cold / overdue numbers over the recent
draw window, breaks down structural patterns (odd/even, low/high, sums, consecutive pairs), and
publishes AI-generated candidate number sets for the next drawing.</p>
<p>The same analysis engine powers our free Android app, <strong>${SITE.appName}</strong>, which adds
live draw alerts, an interactive AI number generator, and automatic winning-ticket checking.
<a href="${SITE.appUrl}" rel="noopener" target="_blank">Get it on Google Play</a>.</p>
<p>We are an independent publisher. This site is not affiliated with, sponsored by, or endorsed by
the New York Lottery, the Multi-State Lottery Association (MUSL), or any state gaming commission.</p>`,
  },
  {
    slug: "methodology",
    title: "Our Methodology — How the Analysis Works",
    description: "How our lottery statistics and AI predicted sets are generated.",
    body: `
<h1>Methodology</h1>
<p>Transparency matters, so here is exactly how every article on this site is produced.</p>
<h2>1. Data source</h2>
<p>All winning numbers come from the official New York Open Data (Socrata) datasets, the same public
feeds used by news organizations. We never transcribe numbers by hand.</p>
<h2>2. Statistical window</h2>
<p>Unless stated otherwise, statistics use the most recent <strong>${SITE.analysisWindow} draws</strong> of each game:
frequency counts (hot numbers), longest absence streaks (cold / overdue numbers), odd–even and
low–high splits, sum distributions, consecutive-pair rates and repeat rates.</p>
<h2>3. AI predicted sets</h2>
<p>Each article includes candidate number sets built by different strategies:</p>
<ul>
<li><strong>Hot Streak</strong> — samples numbers weighted by recent frequency.</li>
<li><strong>Balanced Mix</strong> — enforces the historically dominant odd/even and low/high structure and a typical sum range.</li>
<li><strong>Overdue Watch</strong> — boosts the longest-absent numbers over a hot-number core.</li>
<li><strong>Pattern Play</strong> — mirrors recent structural tendencies such as consecutive pairs and repeats.</li>
<li><strong>Wildcard</strong> — a uniform random line for contrast.</li>
</ul>
<h2>4. The honest part</h2>
<p><strong>Lottery drawings are independent random events.</strong> Past frequency does not change future
odds, and no method — statistical or AI — can genuinely predict a random draw. Our sets are a fun,
structured way to pick numbers, not a promise of results. Please read our
<a href="../disclaimer/">full disclaimer</a> and always play responsibly.</p>`,
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    description: `Privacy policy for ${SITE.title}.`,
    body: `
<h1>Privacy Policy</h1>
<p><em>Last updated: July 2026</em></p>
<p>${SITE.title} ("we", "this site") is a static, read-only website. We respect your privacy:</p>
<ul>
<li><strong>No accounts, no forms.</strong> We do not collect names, emails, or any personal information directly.</li>
<li><strong>Hosting logs.</strong> The site is hosted on GitHub Pages. GitHub may collect standard
server logs (IP address, user agent) as described in
<a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener" target="_blank">GitHub's privacy statement</a>.</li>
<li><strong>Analytics / advertising.</strong> If analytics or advertising services (such as Google
Analytics or Google AdSense) are enabled on this site, those third parties may use cookies or
similar technologies to serve and measure ads. You can opt out of personalized advertising at
<a href="https://adssettings.google.com" rel="noopener" target="_blank">Google Ads Settings</a>.</li>
<li><strong>External links.</strong> Links to Google Play or other external sites are governed by those sites' own policies.</li>
</ul>
<p>Questions? Contact the publisher via the Google Play listing for ${SITE.appName}.</p>`,
  },
  {
    slug: "disclaimer",
    title: "Full Disclaimer",
    description: `Legal disclaimer for ${SITE.title}.`,
    body: `
<h1>Full Disclaimer</h1>
<ul>
<li><strong>Entertainment only.</strong> All content on this site — including statistics, "hot/cold"
numbers and AI-generated number sets — is provided for entertainment and informational purposes only.</li>
<li><strong>No prediction is possible.</strong> Lottery drawings are random and independent. Nothing on
this site increases your odds of winning, and past results do not influence future draws.</li>
<li><strong>No guarantees, no liability.</strong> We make no warranty as to the accuracy, completeness
or timeliness of any data, and accept no liability for losses arising from the use of this site.
Always verify winning numbers with the official lottery operator before acting on them.</li>
<li><strong>Not affiliated.</strong> This site and the ${SITE.appName} app are not affiliated with,
sponsored by, or endorsed by the New York Lottery, MUSL, Powerball, Mega Millions, or any state
gaming authority. All game names and trademarks belong to their respective owners.</li>
<li><strong>Age &amp; responsible play.</strong> You must be 18 or older (21+ in some jurisdictions) to
purchase lottery tickets. Play only with money you can afford to lose. If gambling causes you
problems, call or text the National Problem Gambling Helpline: <strong>1-800-GAMBLER</strong>.</li>
</ul>`,
  },
];
