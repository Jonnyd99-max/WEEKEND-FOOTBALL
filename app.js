const CONFIG = {
  recentFormWeight: 0.7,
  headToHeadWeight: 0.3,
  homeAdvantage: 0.65,
  drawThreshold: 0.85,
  minimumConfidence: 52,
  maximumConfidence: 89,
};

let fixtures = [];
let currentLeague = "all";

const points = result => result === "W" ? 3 : result === "D" ? 1 : 0;
const total = results => results.reduce((sum, result) => sum + points(result), 0);
const opposite = result => result === "W" ? "L" : result === "L" ? "W" : "D";

function predict(fixture) {
  const homeForm = total(fixture.home.form);
  const awayForm = total(fixture.away.form);
  const homeH2h = total(fixture.h2h);
  const awayH2h = total(fixture.h2h.map(opposite));
  const formHomeMaximum = Math.max(1, fixture.home.form.length * 3);
  const formAwayMaximum = Math.max(1, fixture.away.form.length * 3);
  const h2hMaximum = Math.max(1, fixture.h2h.length * 3);
  const homeRating = (homeForm / formHomeMaximum * 10 * CONFIG.recentFormWeight) + (homeH2h / h2hMaximum * 10 * CONFIG.headToHeadWeight) + CONFIG.homeAdvantage;
  const awayRating = (awayForm / formAwayMaximum * 10 * CONFIG.recentFormWeight) + (awayH2h / h2hMaximum * 10 * CONFIG.headToHeadWeight);
  const gap = Math.abs(homeRating - awayRating);
  let label = "Draw expected";
  if (gap >= CONFIG.drawThreshold) label = homeRating > awayRating ? `${fixture.home.name} win` : `${fixture.away.name} win`;
  const confidence = Math.round(Math.min(CONFIG.maximumConfidence, CONFIG.minimumConfidence + gap / 5 * (CONFIG.maximumConfidence - CONFIG.minimumConfidence)));
  return { label, confidence, homeForm, awayForm, homeH2h, homeRating: homeRating.toFixed(2), awayRating: awayRating.toFixed(2), gap: gap.toFixed(2) };
}

const pill = result => `<span class="form-pill form-${result.toLowerCase()}" title="${result === "W" ? "Win" : result === "D" ? "Draw" : "Loss"}">${result}</span>`;

function card(fixture) {
  const result = predict(fixture);
  return `<article class="match-card">
    <div class="card-topline"><span>${fixture.date}<span class="competition-tag">${fixture.competition?.name || "Premier League"}</span></span><span class="venue">${fixture.venue}</span></div>
    <div class="teams">
      <div class="team"><span class="crest crest-home">${fixture.home.short[0]}</span><div><small>HOME</small><h2>${fixture.home.name}</h2></div></div>
      <div class="versus">VS</div>
      <div class="team team-away"><div><small>AWAY</small><h2>${fixture.away.name}</h2></div><span class="crest crest-away">${fixture.away.short[0]}</span></div>
    </div>
    <div class="form-grid">
      <div><span class="form-label">${fixture.home.short} form</span><div class="form-row">${fixture.home.form.map(pill).join("")}</div></div>
      <div class="h2h"><span class="form-label">H2H · home view</span><div class="form-row">${fixture.h2h.map(pill).join("")}</div></div>
      <div class="away-form"><span class="form-label">${fixture.away.short} form</span><div class="form-row">${fixture.away.form.map(pill).join("")}</div></div>
    </div>
    <div class="prediction-panel">
      <div><span class="eyebrow">OUR PREDICTION</span><strong>${result.label}</strong><span class="reason">Based on recent form and head-to-head</span></div>
      <div class="confidence"><div class="confidence-ring" style="--confidence:${result.confidence * 3.6}deg"><span>${result.confidence}%</span></div><small>confidence</small></div>
    </div>
    <details><summary>How we calculated this <span>＋</span></summary>
      <div class="breakdown">
        <div><span>Home form</span><strong>${result.homeForm}<small>/15</small></strong></div><div><span>Away form</span><strong>${result.awayForm}<small>/15</small></strong></div>
        <div><span>Home H2H</span><strong>${result.homeH2h}<small>/12</small></strong></div><div><span>Home boost</span><strong>+${CONFIG.homeAdvantage}</strong></div>
        <div><span>Final rating</span><strong>${result.homeRating} — ${result.awayRating}</strong></div><div><span>Rating gap</span><strong>${result.gap}</strong></div>
      </div><p class="formula">70% recent form + 30% head-to-head + ${CONFIG.homeAdvantage} home advantage</p>
    </details>
  </article>`;
}

let currentFilter = "all";
function render() {
  const visible = fixtures.filter(fixture => (currentFilter === "all" || fixture.day === currentFilter) && (currentLeague === "all" || (fixture.competition?.code || "PL") === currentLeague));
  document.querySelector("#fixture-count").textContent = visible.length;
  document.querySelector("#match-list").innerHTML = visible.map(card).join("") || '<div class="empty">No fixtures found for this day.</div>';
}

function renderLeaguePicker() {
  const leagues = [...new Map(fixtures.map(fixture => [fixture.competition?.code || "PL", fixture.competition?.name || "Premier League"])).entries()];
  const options = [["all", "All leagues"], ...leagues];
  document.querySelector("#league-tabs").innerHTML = options.map(([code, name]) => `<button data-league="${code}" class="${currentLeague === code ? "active" : ""}">${name}</button>`).join("");
  document.querySelectorAll("[data-league]").forEach(button => button.addEventListener("click", () => {
    currentLeague = button.dataset.league;
    renderLeaguePicker();
    render();
  }));
}

document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  currentFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("active", item === button));
  render();
}));

document.querySelector("#refresh").addEventListener("click", event => {
  event.currentTarget.classList.add("spinning");
  setTimeout(() => { render(); event.currentTarget.classList.remove("spinning"); }, 450);
});

async function loadFixtures() {
  try {
    const response = await fetch(`data.json?v=${Date.now()}`);
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    const data = await response.json();
    fixtures = data.fixtures;
    renderLeaguePicker();
    document.querySelector("#data-status").textContent = "Live weekly data · football-data.org";
    if (fixtures.length) {
      const first = new Date(fixtures[0].utcDate);
      const last = new Date(fixtures[fixtures.length - 1].utcDate);
      document.querySelector("#weekend-days").textContent = `${first.getDate()}—${last.getDate()}`;
      document.querySelector("#weekend-month").textContent = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(first).toUpperCase();
    }
    document.querySelector(".notice").innerHTML = `<span>✓</span>Updated ${new Date(data.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · football-data.org`;
    render();
  } catch (error) {
    document.querySelector("#data-status").textContent = "Football data unavailable";
    document.querySelector("#match-list").innerHTML = '<div class="empty">Fixture data is temporarily unavailable. Please try again shortly.</div>';
    console.error(error);
  }
}

loadFixtures();
