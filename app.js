const CONFIG = {
  recentFormWeight: 0.7,
  headToHeadWeight: 0.3,
  homeAdvantage: 0.65,
  drawThreshold: 0.85,
  minimumConfidence: 52,
  maximumConfidence: 89,
  venuePriorMatches: 5,
};

let fixtures = [];
let currentLeague = "all";

const points = result => result === "W" ? 3 : result === "D" ? 1 : 0;
const total = results => results.reduce((sum, result) => sum + points(result), 0);
const opposite = result => result === "W" ? "L" : result === "L" ? "W" : "D";

function legacyPredict(fixture) {
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
  return { label, confidence, homeForm, awayForm, homeH2h, homeRating: homeRating.toFixed(2), awayRating: awayRating.toFixed(2), gap: gap.toFixed(2), modelVersion: 1 };
}

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const factorial = number => number < 2 ? 1 : Array.from({ length: number }, (_, index) => index + 1).reduce((product, value) => product * value, 1);
const poisson = (goals, expected) => Math.exp(-expected) * expected ** goals / factorial(goals);

function predict(fixture) {
  if (fixture.model?.version !== 2) return legacyPredict(fixture);
  const leagueHome = fixture.model.league.avgHomeGoals || 1.4;
  const leagueAway = fixture.model.league.avgAwayGoals || 1.1;
  const prior = CONFIG.venuePriorMatches;
  const homePlayed = fixture.home.venuePlayed || 0;
  const awayPlayed = fixture.away.venuePlayed || 0;
  const homeForRate = (fixture.home.venueGoalsFor + leagueHome * prior) / (homePlayed + prior);
  const homeAgainstRate = (fixture.home.venueGoalsAgainst + leagueAway * prior) / (homePlayed + prior);
  const awayForRate = (fixture.away.venueGoalsFor + leagueAway * prior) / (awayPlayed + prior);
  const awayAgainstRate = (fixture.away.venueGoalsAgainst + leagueHome * prior) / (awayPlayed + prior);
  const formDifference = (fixture.home.adjustedForm ?? 0.5) - (fixture.away.adjustedForm ?? 0.5);
  const restDifference = clamp((fixture.home.restDays ?? 6) - (fixture.away.restDays ?? 6), -5, 5);
  const h2hHome = fixture.h2h.length ? total(fixture.h2h) / (fixture.h2h.length * 3) : 0.5;
  const h2hAdjustment = (h2hHome - 0.5) * 0.1;
  const momentumAdjustment = clamp(formDifference * 0.18 + restDifference * 0.01, -0.16, 0.16);
  const currentPpgDifference = (fixture.home.pointsPerGame ?? 1.35) - (fixture.away.pointsPerGame ?? 1.35);
  const currentStrengthAdjustment = clamp(currentPpgDifference / 3 * 0.08, -0.06, 0.06);
  const previousAverageGoals = fixture.model.league.previousAverageGoals || (leagueHome + leagueAway) / 2;
  const baselineWeight = clamp(0.8 * (1 - Math.max(fixture.home.played || 0, fixture.away.played || 0) / 12), 0, 0.8);
  const baselineAttack = team => team.baseline ? clamp(team.baseline.goalsForPerGame / previousAverageGoals, 0.65, 1.55) : 1;
  const baselineDefence = team => team.baseline ? clamp(team.baseline.goalsAgainstPerGame / previousAverageGoals, 0.65, 1.55) : 1;
  const homeBaselineFactor = (baselineAttack(fixture.home) * baselineDefence(fixture.away)) ** baselineWeight;
  const awayBaselineFactor = (baselineAttack(fixture.away) * baselineDefence(fixture.home)) ** baselineWeight;
  let expectedHome = leagueHome * (homeForRate / leagueHome) * (awayAgainstRate / leagueHome);
  let expectedAway = leagueAway * (awayForRate / leagueAway) * (homeAgainstRate / leagueAway);
  expectedHome = clamp(expectedHome * homeBaselineFactor * (1 + momentumAdjustment + h2hAdjustment + currentStrengthAdjustment), 0.2, 4);
  expectedAway = clamp(expectedAway * awayBaselineFactor * (1 - momentumAdjustment - h2hAdjustment - currentStrengthAdjustment), 0.2, 4);

  let homeProbability = 0;
  let drawProbability = 0;
  let awayProbability = 0;
  for (let homeGoals = 0; homeGoals <= 8; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 8; awayGoals += 1) {
      const probability = poisson(homeGoals, expectedHome) * poisson(awayGoals, expectedAway);
      if (homeGoals > awayGoals) homeProbability += probability;
      else if (homeGoals < awayGoals) awayProbability += probability;
      else drawProbability += probability;
    }
  }
  const probabilityTotal = homeProbability + drawProbability + awayProbability;
  homeProbability /= probabilityTotal;
  drawProbability /= probabilityTotal;
  awayProbability /= probabilityTotal;
  const outcomes = [
    { key: "home", probability: homeProbability, label: `${fixture.home.name} win` },
    { key: "draw", probability: drawProbability, label: "Draw expected" },
    { key: "away", probability: awayProbability, label: `${fixture.away.name} win` },
  ];
  const winner = outcomes.sort((a, b) => b.probability - a.probability)[0];
  const likelyHomeGoals = Math.min(6, Math.floor(expectedHome));
  const likelyAwayGoals = Math.min(6, Math.floor(expectedAway));
  const reasons = [];
  if ((fixture.home.venuePointsPerGame ?? 1.35) > (fixture.away.venuePointsPerGame ?? 1.35) + 0.35) reasons.push("stronger home record");
  else if ((fixture.away.venuePointsPerGame ?? 1.35) > (fixture.home.venuePointsPerGame ?? 1.35) + 0.35) reasons.push("stronger away record");
  if (Math.abs(formDifference) > 0.18) reasons.push(formDifference > 0 ? `${fixture.home.short} have stronger recent form` : `${fixture.away.short} have stronger recent form`);
  if (Math.abs(restDifference) >= 3) reasons.push(restDifference > 0 ? `${fixture.home.short} are better rested` : `${fixture.away.short} are better rested`);
  if (!reasons.length) reasons.push("season strength and venue performance are closely matched");
  return {
    label: winner.label,
    confidence: Math.round(winner.probability * 100),
    expectedScore: `${likelyHomeGoals}–${likelyAwayGoals}`,
    expectedHome: expectedHome.toFixed(2),
    expectedAway: expectedAway.toFixed(2),
    probabilities: { home: Math.round(homeProbability * 100), draw: Math.round(drawProbability * 100), away: Math.round(awayProbability * 100) },
    baselineWeight: Math.round(baselineWeight * 100),
    reason: reasons.slice(0, 2).join(" · "),
    homeForm: total(fixture.home.form),
    awayForm: total(fixture.away.form),
    homeH2h: total(fixture.h2h),
    modelVersion: 2,
  };
}

const pill = result => `<span class="form-pill form-${result.toLowerCase()}" title="${result === "W" ? "Win" : result === "D" ? "Draw" : "Loss"}">${result}</span>`;

function card(fixture) {
  const result = predict(fixture);
  const explanation = result.modelVersion === 2 ? `<div class="breakdown">
        <div><span>Expected goals</span><strong>${result.expectedHome} — ${result.expectedAway}</strong></div><div><span>Likely score</span><strong>${result.expectedScore}</strong></div>
        <div><span>Home / draw / away</span><strong>${result.probabilities.home}% / ${result.probabilities.draw}% / ${result.probabilities.away}%</strong></div><div><span>Venue PPG</span><strong>${fixture.home.venuePointsPerGame} — ${fixture.away.venuePointsPerGame}</strong></div>
        <div><span>League position</span><strong>${fixture.home.position || "—"} — ${fixture.away.position || "—"}</strong></div><div><span>Rest days</span><strong>${fixture.home.restDays ?? "—"} — ${fixture.away.restDays ?? "—"}</strong></div>
      </div><p class="formula">Model V2 · ${result.baselineWeight}% previous-season baseline + current attack and defence + home/away record + opponent-adjusted form + rest + 5% head-to-head</p>` : `<div class="breakdown">
        <div><span>Home form</span><strong>${result.homeForm}<small>/15</small></strong></div><div><span>Away form</span><strong>${result.awayForm}<small>/15</small></strong></div>
        <div><span>Home H2H</span><strong>${result.homeH2h}<small>/12</small></strong></div><div><span>Home boost</span><strong>+${CONFIG.homeAdvantage}</strong></div>
        <div><span>Final rating</span><strong>${result.homeRating} — ${result.awayRating}</strong></div><div><span>Rating gap</span><strong>${result.gap}</strong></div>
      </div><p class="formula">Legacy model · 70% recent form + 30% head-to-head + ${CONFIG.homeAdvantage} home advantage</p>`;
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
      <div><span class="eyebrow">OUR PREDICTION${result.modelVersion === 2 ? ` · EXPECTED ${result.expectedScore}` : ""}</span><strong>${result.label}</strong><span class="reason">${result.reason || "Based on recent form and head-to-head"}</span></div>
      <div class="confidence"><div class="confidence-ring" style="--confidence:${result.confidence * 3.6}deg"><span>${result.confidence}%</span></div><small>confidence</small></div>
    </div>
    <details><summary>How we calculated this <span>＋</span></summary>
      ${explanation}
    </details>
  </article>`;
}

let currentFilter = "all";
function render() {
  let visible = fixtures.filter(fixture => {
    const matchesDay = currentFilter === "all" || currentFilter === "top" || fixture.day === currentFilter;
    const matchesLeague = currentLeague === "all" || (fixture.competition?.code || "PL") === currentLeague;
    return matchesDay && matchesLeague;
  });
  if (currentFilter === "top") visible = visible.sort((a, b) => predict(b).confidence - predict(a).confidence || new Date(a.utcDate) - new Date(b.utcDate)).slice(0, 10);
  document.querySelector("#fixture-count").textContent = visible.length;
  document.querySelector("#match-list").innerHTML = currentFilter === "top" ? topPicksTable(visible) : visible.map(card).join("") || '<div class="empty">No fixtures found for this day.</div>';
}

function topPicksTable(picks) {
  if (!picks.length) return '<div class="empty">No predictions are currently available.</div>';
  const rows = picks.map(fixture => {
    const result = predict(fixture);
    return `<article class="top-pick-row">
      <div class="top-pick-match">
        <span class="top-pick-league">${fixture.competition?.name || "Premier League"}</span>
        <div class="top-pick-teams"><strong>${fixture.home.name}</strong><span>vs</span><strong>${fixture.away.name}</strong></div>
        <span class="top-pick-kickoff">${fixture.date}</span>
      </div>
      <div class="top-pick-call">
        <div><span class="eyebrow">OUR PREDICTION</span><strong>${result.label}</strong></div>
        <div class="top-pick-score"><b>${result.confidence}%</b><small>confidence</small></div>
      </div>
    </article>`;
  }).join("");
  return `<div class="top-picks-wrap"><div class="top-picks-heading"><div><span class="section-kicker">HIGHEST-CONFIDENCE FORECASTS</span><h2>Top picks</h2><p>The ten strongest calls across your selected leagues.</p></div><span class="threshold">Top 10</span></div><div class="top-picks-list">${rows}</div></div>`;
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

