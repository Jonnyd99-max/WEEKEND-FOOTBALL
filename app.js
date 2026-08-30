const CONFIG = {
  recentFormWeight: 0.7,
  headToHeadWeight: 0.3,
  homeAdvantage: 0.65,
  drawThreshold: 0.85,
  minimumConfidence: 52,
  maximumConfidence: 89,
};

let fixtures = [];

const points = result => result === "W" ? 3 : result === "D" ? 1 : 0;
const total = results => results.reduce((sum, result) => sum + points(result), 0);
const opposite = result => result === "W" ? "L" : result === "L" ? "W" : "D";

function predict(fixture) {
  const homeForm = total(fixture.home.form);
  const awayForm = total(fixture.away.form);
  const homeH2h = total(fixture.h2h);
  const awayH2h = total(fixture.h2h.map(opposite));
  const homeRating = (homeForm / 15 * 10 * CONFIG.recentFormWeight) + (homeH2h / 12 * 10 * CONFIG.headToHeadWeight) + CONFIG.homeAdvantage;
  const awayRating = (awayForm / 15 * 10 * CONFIG.recentFormWeight) + (awayH2h / 12 * 10 * CONFIG.headToHeadWeight);
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
    <div class="card-topline"><span>${fixture.date}</span><span class="venue">${fixture.venue}</span></div>
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
  const visible = currentFilter === "all" ? fixtures : fixtures.filter(fixture => fixture.day === currentFilter);
  document.querySelector("#fixture-count").textContent = visible.length;
  document.querySelector("#match-list").innerHTML = visible.map(card).join("") || '<div class="empty">No fixtures found for this day.</div>';
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
    document.querySelector(".notice").innerHTML = `<span>✓</span>Updated ${new Date(data.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · football-data.org`;
    render();
  } catch (error) {
    document.querySelector("#match-list").innerHTML = '<div class="empty">Fixture data is temporarily unavailable. Please try again shortly.</div>';
    console.error(error);
  }
}

loadFixtures();
