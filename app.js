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
let historyFixtures = [];
let performanceData = null;
let currentLeague = "all";
let selectedReviewWeek = "all";

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
  let over25Probability = 0;
  let bttsProbability = 0;
  for (let homeGoals = 0; homeGoals <= 8; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 8; awayGoals += 1) {
      const probability = poisson(homeGoals, expectedHome) * poisson(awayGoals, expectedAway);
      if (homeGoals > awayGoals) homeProbability += probability;
      else if (homeGoals < awayGoals) awayProbability += probability;
      else drawProbability += probability;
      if (homeGoals + awayGoals >= 3) over25Probability += probability;
      if (homeGoals > 0 && awayGoals > 0) bttsProbability += probability;
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
  const rankedOutcomes = [...outcomes].sort((a, b) => b.probability - a.probability);
  const winner = rankedOutcomes[0];
  const outcomeMargin = Math.round((rankedOutcomes[0].probability - rankedOutcomes[1].probability) * 100);
  const drawRisk = winner.key !== "draw" && winner.probability - drawProbability <= 0.1;
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
    outcomeMargin,
    drawRisk,
    goalMarkets: { over25: Math.round(over25Probability / probabilityTotal * 100), btts: Math.round(bttsProbability / probabilityTotal * 100) },
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
        <div><span>Outcome margin</span><strong>${result.outcomeMargin} points</strong></div><div><span>Over 2.5 / BTTS</span><strong>${result.goalMarkets.over25}% / ${result.goalMarkets.btts}%</strong></div>
        <div><span>League position</span><strong>${fixture.home.position || "—"} — ${fixture.away.position || "—"}</strong></div><div><span>Rest days · all comps</span><strong>${fixture.home.restDays ?? "—"} — ${fixture.away.restDays ?? "—"}</strong></div>
      </div><p class="formula">Model V2 · ${result.baselineWeight}% previous-season baseline + current attack and defence + home/away record + opponent-adjusted form + all-competition rest + 5% head-to-head</p>` : `<div class="breakdown">
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
  const isTop = currentFilter.startsWith("top");
  const isMarket = currentFilter.startsWith("market-");
  let visible = fixtures.filter(fixture => {
    const topDay = currentFilter === "top-saturday" ? "saturday" : currentFilter === "top-sunday" ? "sunday" : null;
    const matchesDay = currentFilter === "all" || currentFilter === "review" || isMarket || (isTop && (!topDay || fixture.day === topDay)) || fixture.day === currentFilter;
    const matchesLeague = currentLeague === "all" || (fixture.competition?.code || "PL") === currentLeague;
    return matchesDay && matchesLeague;
  });
  if (currentFilter === "top-filtered") visible = visible.filter(fixture => {
    const result = predict(fixture);
    return kickoffHour(fixture.utcDate) >= 14 && predictedOutcome(result) !== "away";
  });
  if (isTop) visible = visible.sort((a, b) => predict(b).confidence - predict(a).confidence || new Date(a.utcDate) - new Date(b.utcDate)).slice(0, ["top", "top-filtered"].includes(currentFilter) ? 10 : 5);
  document.querySelector("#fixture-count").textContent = currentFilter === "review" ? reviewCount() : visible.length;
  document.querySelector("#match-list").innerHTML = isTop ? topPicksTable(visible, currentFilter) : isMarket ? marketDashboard(visible, currentFilter === "market-over25" ? "over25" : "btts") : currentFilter === "review" ? reviewDashboard() : visible.map(card).join("") || '<div class="empty">No fixtures found for this day.</div>';
  if (currentFilter === "review") bindReviewControls();
}

function marketProbability(fixture, market) {
  return predict(fixture).goalMarkets[market];
}

function marketSelection(fixturesToRank, market, day, limit) {
  return fixturesToRank.filter(fixture => !day || fixture.day === day).sort((a, b) => marketProbability(b, market) - marketProbability(a, market) || new Date(a.utcDate) - new Date(b.utcDate)).slice(0, limit);
}

function marketTable(title, subtitle, picks, market) {
  const label = market === "over25" ? "Over 2.5 goals" : "Both teams to score";
  const rows = picks.map((fixture, index) => {
    const result = predict(fixture);
    const probability = result.goalMarkets[market];
    return `<article class="top-pick-row"><div class="top-pick-match"><span class="top-pick-league">${fixture.competition?.name || "League"}</span><div class="top-pick-teams"><strong>${fixture.home.name}</strong><span>vs</span><strong>${fixture.away.name}</strong></div><span class="top-pick-kickoff">${fixture.date}</span></div><div class="top-pick-call"><div><span class="eyebrow">${label.toUpperCase()}</span><strong>${probability >= 50 ? "Yes" : "Caution"}</strong><small>Expected score ${result.expectedScore}</small></div><div class="top-pick-score"><b>${probability}%</b><small>probability</small></div></div></article>`;
  }).join("");
  return `<section class="market-section"><div class="portfolio-heading"><div><span class="section-kicker">${subtitle}</span><h3>${title}</h3></div><span class="threshold">${picks.length} picks</span></div><div class="top-picks-list">${rows || `<div class="empty compact">No fixtures available.</div>`}</div></section>`;
}

function marketDashboard(visible, market) {
  const title = market === "over25" ? "Over 2.5 goals" : "Both teams to score";
  return `<div class="market-dashboard"><div class="top-picks-heading"><div><span class="section-kicker">GOAL-MARKET FORECASTS</span><h2>${title}</h2><p>Ranked independently by the model's calculated probability—not bookmaker odds.</p></div><span class="threshold">MODEL</span></div>${marketTable("Weekend Top 10", "ALL WEEKEND", marketSelection(visible, market, null, 10), market)}${marketTable("Saturday Top 5", "SATURDAY", marketSelection(visible, market, "saturday", 5), market)}${marketTable("Sunday Top 5", "SUNDAY", marketSelection(visible, market, "sunday", 5), market)}</div>`;
}

function strategyFor(week, strategy) {
  if (week.strategies) return week.strategies[strategy];
  return strategy === "top10" ? { picks: week.picks, correct: week.top10Correct, accuracy: week.top10Accuracy } : { picks: [], correct: 0, accuracy: 0 };
}

function reviewWeeks() {
  return [...(performanceData?.weeks ?? [])].reverse().map(week => {
    const strategies = Object.fromEntries(["top10", "filteredTop10", "saturdayTop5", "sundayTop5", "over25Top10", "over25SaturdayTop5", "over25SundayTop5", "bttsTop10", "bttsSaturdayTop5", "bttsSundayTop5"].map(name => {
      const source = strategyFor(week, name) ?? { picks: [] };
      const picks = (source.picks ?? []).filter(pick => currentLeague === "all" || (pick.competition?.code || "PL") === currentLeague);
      const settled = picks.filter(pick => pick.settled !== false && pick.actualOutcome);
      return [name, { picks, settled: settled.length, correct: settled.filter(pick => pick.correct).length }];
    }));
    return { ...week, reviewStrategies: strategies };
  });
}

function reviewCount() {
  return reviewWeeks().reduce((sum, week) => sum + week.reviewStrategies.top10.picks.length, 0);
}

function kickoffBand(utcDate) {
  const hour = kickoffHour(utcDate);
  return hour < 14 ? "Early · before 14:00" : hour < 17 ? "Afternoon · 14:00–16:59" : "Evening · 17:00+";
}

function kickoffHour(utcDate) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date(utcDate)).slice(0, 2));
}

function predictedOutcome(prediction) {
  return prediction.probabilities ? ["home", "draw", "away"].sort((a, b) => prediction.probabilities[b] - prediction.probabilities[a])[0] : null;
}

function cautionBadges({ utcDate, predictedOutcome: savedOutcome, confidence, probabilities }) {
  const outcome = savedOutcome ?? predictedOutcome({ probabilities });
  const cautions = [];
  if (kickoffHour(utcDate) < 14) cautions.push("Early kickoff");
  if (outcome === "away") cautions.push("Away win");
  if (confidence < 80) cautions.push("Under 80%");
  const drawProbability = probabilities?.draw;
  const selectedProbability = outcome && probabilities?.[outcome];
  if (outcome !== "draw" && selectedProbability != null && drawProbability != null && selectedProbability - drawProbability <= 10) cautions.push("Draw risk");
  return cautions.map(reason => `<span class="caution-chip">⚠ ${reason}</span>`).join("");
}

function formatReviewKickoff(utcDate) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(utcDate)).replace(" at ", " · ");
}

function pickRows(picks) {
  return picks.map(pick => {
    const pending = pick.settled === false || !pick.actualOutcome;
    return `<article class="review-row">
    <span class="review-rank">${pick.rank}</span>
    <div><span class="top-pick-league">${pick.competition?.name || "League"}</span><div class="review-match"><strong>${pick.home} ${pick.finalScore ?? "vs"} ${pick.away}</strong><small>${formatReviewKickoff(pick.utcDate)} · ${kickoffBand(pick.utcDate)}</small></div></div>
    <div class="review-call"><span>${pick.market ? "Market selection" : "Predicted"}</span><strong>${pick.marketLabel ?? pick.prediction}</strong><small>${pick.market ? pick.marketProbability : pick.confidence}% probability</small>${pick.market ? "" : `<div class="caution-list">${cautionBadges(pick)}</div>`}</div>
    <div class="review-result ${pending ? "is-pending" : pick.correct ? "is-correct" : "is-missed"}"><b>${pending ? "Pending" : pick.correct ? "✓ Correct" : "× Missed"}</b><small>${pending ? "Awaiting result" : pick.marketActual ?? pick.actualOutcome}</small></div>
  </article>`;
  }).join("");
}

function portfolioSummary(strategy) {
  const pending = strategy.picks.length - strategy.settled;
  const accuracy = strategy.settled ? Math.round(strategy.correct / strategy.settled * 100) : 0;
  return { pending, accuracy, score: `${strategy.correct}/${strategy.settled}` };
}

function portfolioSection(title, subtitle, strategy) {
  const summary = portfolioSummary(strategy);
  return `<section class="portfolio-section"><div class="portfolio-heading"><div><span class="section-kicker">${subtitle}</span><h3>${title}</h3></div><div class="portfolio-score"><strong>${summary.score}</strong><span>${summary.accuracy}% correct${summary.pending ? ` · ${summary.pending} pending` : ""}</span></div></div><div class="review-list">${strategy.picks.length ? pickRows(strategy.picks) : '<div class="empty compact">No qualifying picks for this day.</div>'}</div></section>`;
}

function weeklySummary(week) {
  const resultPortfolios = [
    ["Top 10", week.reviewStrategies.top10],
    ["Filtered Top 10", week.reviewStrategies.filteredTop10],
    ["Saturday Top 5", week.reviewStrategies.saturdayTop5],
    ["Sunday Top 5", week.reviewStrategies.sundayTop5],
  ].map(([name, strategy]) => ({ name, strategy, ...portfolioSummary(strategy) }));
  const completed = resultPortfolios.filter(portfolio => portfolio.strategy.settled > 0);
  const best = [...completed].sort((a, b) => b.accuracy - a.accuracy || b.strategy.settled - a.strategy.settled)[0];
  const top = resultPortfolios[0];
  const over25 = portfolioSummary(week.reviewStrategies.over25Top10);
  const btts = portfolioSummary(week.reviewStrategies.bttsTop10);
  const misses = week.reviewStrategies.top10.picks.filter(pick => pick.settled !== false && pick.actualOutcome && !pick.correct);
  const earlyMisses = misses.filter(pick => kickoffHour(pick.utcDate) < 14).length;
  const awayMisses = misses.filter(pick => pick.predictedOutcome === "away").length;
  const drawRiskMisses = misses.filter(pick => {
    const selected = pick.probabilities?.[pick.predictedOutcome];
    return pick.predictedOutcome !== "draw" && selected != null && pick.probabilities?.draw != null && selected - pick.probabilities.draw <= 10;
  }).length;
  const cautionText = !misses.length ? "No missed Top 10 calls to analyse." : [
    earlyMisses ? `${earlyMisses} involved an early kickoff` : "",
    awayMisses ? `${awayMisses} were away-win calls` : "",
    drawRiskMisses ? `${drawRiskMisses} carried draw risk` : "",
  ].filter(Boolean).join(" · ") || "The missed calls had no shared caution marker.";
  return `<section class="weekly-summary"><div><span class="section-kicker">WEEK AT A GLANCE</span><h3>${top.score} Top 10 selections correct</h3><p>${top.accuracy}% accuracy${top.pending ? ` with ${top.pending} still pending` : ""}. ${best ? `${best.name} was the strongest result portfolio at ${best.accuracy}%.` : "Results are still pending."}</p></div><div class="weekly-summary-stat"><span>OVER 2.5</span><strong>${over25.score}</strong><small>${over25.accuracy}% correct</small></div><div class="weekly-summary-stat"><span>BTTS</span><strong>${btts.score}</strong><small>${btts.accuracy}% correct</small></div><div class="weekly-summary-note"><span>WHAT STOOD OUT</span><p>${cautionText}</p></div></section>`;
}

function insightMetric(picks) {
  const settled = picks.filter(pick => pick.settled !== false && pick.actualOutcome);
  const correct = settled.filter(pick => pick.correct).length;
  const accuracy = settled.length ? Math.round(correct / settled.length * 100) : 0;
  return { settled: settled.length, correct, accuracy };
}

function insightPanel(title, subtitle, rows) {
  const content = rows.map(row => {
    const metric = insightMetric(row.picks);
    const evidence = metric.settled < 5 ? "Very small sample" : metric.settled < 10 ? "Early evidence" : "Useful sample";
    const detail = row.detail ? row.detail(metric) : `${metric.correct}/${metric.settled} correct`;
    return `<div class="insight-row"><div class="insight-row-label"><strong>${row.label}</strong><small>${detail}</small></div><div class="insight-bar"><span style="width:${metric.accuracy}%"></span></div><b>${metric.settled ? `${metric.accuracy}%` : "—"}</b><em class="${metric.settled < 10 ? "is-caution" : ""}">${evidence}</em></div>`;
  }).join("");
  return `<section class="insight-panel"><div class="insight-heading"><span class="section-kicker">${subtitle}</span><h3>${title}</h3></div><div class="insight-rows">${content || '<div class="empty compact">Not enough saved predictions yet.</div>'}</div></section>`;
}

function teamReliability(weeks) {
  const records = new Map();
  const add = (team, role, pick) => {
    if (!records.has(team)) records.set(team, { team, backed: [], opposed: [] });
    records.get(team)[role].push(pick);
  };
  for (const pick of weeks.flatMap(week => week.reviewStrategies.top10.picks)) {
    if (pick.predictedOutcome === "home") {
      add(pick.home, "backed", pick);
      add(pick.away, "opposed", pick);
    } else if (pick.predictedOutcome === "away") {
      add(pick.away, "backed", pick);
      add(pick.home, "opposed", pick);
    }
  }
  const teams = [...records.values()].map(record => {
    const backed = insightMetric(record.backed);
    const opposed = insightMetric(record.opposed);
    const total = insightMetric([...record.backed, ...record.opposed]);
    return { ...record, backed, opposed, total };
  }).filter(record => record.total.settled >= 2).sort((a, b) => b.total.settled - a.total.settled || b.total.accuracy - a.total.accuracy).slice(0, 12);
  const rows = teams.map(record => `<div class="team-reliability-row"><strong>${record.team}</strong><span>Backed <b>${record.backed.settled ? `${record.backed.correct}/${record.backed.settled}` : "—"}</b></span><span>Opposed <b>${record.opposed.settled ? `${record.opposed.correct}/${record.opposed.settled}` : "—"}</b></span><em class="${record.total.settled < 5 ? "is-caution" : ""}">${record.total.accuracy}% overall · ${record.total.settled} picks</em></div>`).join("");
  return `<section class="insight-panel team-reliability"><div class="insight-heading"><span class="section-kicker">CLUB-SPECIFIC EVIDENCE</span><h3>Team reliability</h3><p>Backed means the model selected that club to win. Opposed means it selected their opponent.</p></div><div class="team-reliability-list">${rows || '<div class="empty compact">No team has appeared enough times yet.</div>'}</div></section>`;
}

function monthlyTrends(weeks) {
  const months = new Map();
  for (const week of [...weeks].reverse()) {
    const date = new Date(`${week.weekendStarting}T12:00:00Z`);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!months.has(key)) months.set(key, { label: date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }), weeks: [] });
    months.get(key).weeks.push(week);
  }
  const cards = [...months.values()].map(month => {
    const metric = name => insightMetric(month.weeks.flatMap(week => week.reviewStrategies[name].picks));
    const top = metric("top10");
    const filtered = metric("filteredTop10");
    const over25 = metric("over25Top10");
    const btts = metric("bttsTop10");
    return `<article class="trend-card"><div><span>${month.weeks.length} WEEK${month.weeks.length === 1 ? "" : "S"}</span><h4>${month.label}</h4></div><dl><div><dt>Top 10</dt><dd>${top.accuracy}% <small>${top.correct}/${top.settled}</small></dd></div><div><dt>Filtered</dt><dd>${filtered.accuracy}% <small>${filtered.correct}/${filtered.settled}</small></dd></div><div><dt>Over 2.5</dt><dd>${over25.accuracy}% <small>${over25.correct}/${over25.settled}</small></dd></div><div><dt>BTTS</dt><dd>${btts.accuracy}% <small>${btts.correct}/${btts.settled}</small></dd></div></dl></article>`;
  }).join("");
  return `<section class="insight-panel monthly-trends"><div class="insight-heading"><span class="section-kicker">CHANGE OVER TIME</span><h3>Monthly trends</h3><p>Use several months—not a single weekend—to decide whether a portfolio is genuinely improving.</p></div><div class="trend-grid">${cards}</div></section>`;
}

function modelInsights(weeks) {
  const topPicks = weeks.flatMap(week => week.reviewStrategies.top10.picks);
  const leagues = [...new Map(topPicks.map(pick => [pick.competition?.code || "UNKNOWN", pick.competition?.name || "League"])).entries()];
  const leagueRows = leagues.map(([code, name]) => ({ label: name, picks: topPicks.filter(pick => (pick.competition?.code || "UNKNOWN") === code) }));
  const outcomeRows = [["Home wins", "home"], ["Draws", "draw"], ["Away wins", "away"]].map(([label, outcome]) => ({ label, picks: topPicks.filter(pick => pick.predictedOutcome === outcome) }));
  const confidenceRows = [
    { label: "Under 60%", minimum: 0, maximum: 59 },
    { label: "60–69%", minimum: 60, maximum: 69 },
    { label: "70–79%", minimum: 70, maximum: 79 },
    { label: "80%+", minimum: 80, maximum: 100 },
  ].map(band => {
    const picks = topPicks.filter(pick => pick.confidence >= band.minimum && pick.confidence <= band.maximum);
    return { label: band.label, picks, detail: metric => {
      const average = picks.length ? Math.round(picks.reduce((sum, pick) => sum + pick.confidence, 0) / picks.length) : 0;
      const gap = metric.settled ? metric.accuracy - average : 0;
      return metric.settled ? `${metric.correct}/${metric.settled} · model avg ${average}% · ${gap > 0 ? "+" : ""}${gap} pts` : "No settled picks";
    } };
  });
  const kickoffRows = [
    ["Early · before 14:00", pick => kickoffHour(pick.utcDate) < 14],
    ["Afternoon · 14:00–16:59", pick => kickoffHour(pick.utcDate) >= 14 && kickoffHour(pick.utcDate) < 17],
    ["Evening · 17:00+", pick => kickoffHour(pick.utcDate) >= 17],
  ].map(([label, test]) => ({ label, picks: topPicks.filter(test) }));
  const portfolios = [
    ["Top 10", "top10"], ["Filtered Top 10", "filteredTop10"], ["Saturday Top 5", "saturdayTop5"], ["Sunday Top 5", "sundayTop5"],
    ["Over 2.5 · Top 10", "over25Top10"], ["BTTS · Top 10", "bttsTop10"],
  ].map(([label, name]) => ({ label, picks: weeks.flatMap(week => week.reviewStrategies[name].picks) }));
  return `<section class="model-insights"><div class="model-insights-heading"><div><span class="section-kicker">MODEL INSIGHTS</span><h2>Where the predictor performs best</h2><p>Every percentage comes from saved pre-match selections. Treat fewer than 10 settled picks as provisional evidence.</p></div><span class="threshold">LIVE AUDIT</span></div><div class="insight-grid">${insightPanel("By league", "TOP 10 RESULTS", leagueRows)}${insightPanel("By prediction", "HOME · DRAW · AWAY", outcomeRows)}${insightPanel("Confidence calibration", "RESULTS VS DISPLAYED CONFIDENCE", confidenceRows)}${insightPanel("By kickoff time", "MATCH TIMING", kickoffRows)}${insightPanel("Portfolio comparison", "SAVED STRATEGIES", portfolios)}${teamReliability(weeks)}${monthlyTrends(weeks)}</div></section>`;
}

function weeklyReport(week, previousWeek) {
  const top = portfolioSummary(week.reviewStrategies.top10);
  const filtered = portfolioSummary(week.reviewStrategies.filteredTop10);
  const previous = previousWeek ? portfolioSummary(previousWeek.reviewStrategies.top10) : null;
  const date = new Date(week.weekendStarting).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const rows = week.reviewStrategies.top10.picks.map(pick => {
    const pending = pick.settled === false || !pick.actualOutcome;
    return `<article class="report-pick"><span class="report-rank">${pick.rank}</span><div><span>${pick.competition?.name || "League"} · ${formatReviewKickoff(pick.utcDate)}</span><strong>${pick.home} vs ${pick.away}</strong><small>${pick.reason || "Frozen Wednesday selection based on form, venue performance and team strength"}</small><div class="caution-list">${cautionBadges(pick)}</div></div><div class="report-call"><span>PREDICTION</span><strong>${pick.prediction}</strong><small>${pick.confidence}%${pick.expectedScore ? ` · expected ${pick.expectedScore}` : ""}</small></div><div class="report-outcome ${pending ? "is-pending" : pick.correct ? "is-correct" : "is-missed"}">${pending ? "Pending" : `${pick.finalScore} · ${pick.correct ? "Correct" : "Missed"}`}</div></article>`;
  }).join("");
  return `<section class="weekly-report"><div class="report-header"><div><span>JD MATCH PREDICTION · WEEKLY REPORT</span><h2>Weekend ${date}</h2><p>Frozen from the Wednesday 9am model run.</p></div><button id="print-weekly-report">Print / save PDF</button></div><div class="report-scoreboard"><div><span>TOP 10</span><strong>${top.score}</strong><small>${top.accuracy}% correct</small></div><div><span>FILTERED TOP 10</span><strong>${filtered.score}</strong><small>${filtered.accuracy}% correct</small></div><div><span>PREVIOUS WEEK</span><strong>${previous ? previous.score : "—"}</strong><small>${previous ? `${previous.accuracy}% correct` : "No earlier week"}</small></div></div><div class="report-picks">${rows}</div><p class="report-disclaimer">Built for analysis, not betting. Predictions are indicative only.</p></section>`;
}

function reviewDashboard() {
  const weeks = reviewWeeks();
  if (!weeks.length) return '<div class="empty"><strong>No completed review yet.</strong><br>The first report will appear after a completed weekend is settled.</div>';
  const allPicks = weeks.flatMap(week => week.reviewStrategies.top10.picks).filter(pick => pick.actualOutcome);
  const selected = selectedReviewWeek === "all" ? null : weeks.find(week => week.predictionBatch === selectedReviewWeek);
  const correct = allPicks.filter(pick => pick.correct).length;
  const accuracy = Math.round(correct / Math.max(1, allPicks.length) * 100);
  const averageConfidence = Math.round(allPicks.reduce((sum, pick) => sum + pick.confidence, 0) / Math.max(1, allPicks.length));
  const bands = ["Early · before 14:00", "Afternoon · 14:00–16:59", "Evening · 17:00+"];
  const bandCards = bands.map(band => {
    const picks = allPicks.filter(pick => kickoffBand(pick.utcDate) === band);
    const hits = picks.filter(pick => pick.correct).length;
    return `<div class="audit-card"><span>${band}</span><strong>${picks.length ? Math.round(hits / picks.length * 100) : 0}%</strong><small>${hits}/${picks.length} correct</small></div>`;
  }).join("");
  const options = [`<option value="all" ${selectedReviewWeek === "all" ? "selected" : ""}>All completed weeks</option>`, ...weeks.map(week => `<option value="${week.predictionBatch}" ${selectedReviewWeek === week.predictionBatch ? "selected" : ""}>Weekend ${new Date(week.weekendStarting).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</option>`)].join("");
  const weekCards = weeks.map(week => {
    const top = portfolioSummary(week.reviewStrategies.top10);
    const filtered = portfolioSummary(week.reviewStrategies.filteredTop10);
    const sat = portfolioSummary(week.reviewStrategies.saturdayTop5);
    const sun = portfolioSummary(week.reviewStrategies.sundayTop5);
    return `<button class="week-card" data-review-week="${week.predictionBatch}"><span>Weekend ${new Date(week.weekendStarting).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span><strong>${top.score}</strong><small>Top 10 · ${top.accuracy}%</small><em>Filtered ${filtered.score} · Sat ${sat.score} · Sun ${sun.score}</em></button>`;
  }).join("");
  const selectedIndex = selected ? weeks.findIndex(week => week.predictionBatch === selected.predictionBatch) : -1;
  const previousWeek = selectedIndex >= 0 ? weeks[selectedIndex + 1] : null;
  const detail = selected ? `<div class="review-detail-heading"><div><span class="section-kicker">SAVED PORTFOLIOS</span><h3>Weekend ${new Date(selected.weekendStarting).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</h3></div></div>${weeklyReport(selected, previousWeek)}${weeklySummary(selected)}${portfolioSection("Top 10 overall", "MATCH RESULT", selected.reviewStrategies.top10)}${portfolioSection("Filtered Top 10", "MATCH RESULT · FILTERED", selected.reviewStrategies.filteredTop10)}${portfolioSection("Saturday Top 5", "MATCH RESULT · SATURDAY", selected.reviewStrategies.saturdayTop5)}${portfolioSection("Sunday Top 5", "MATCH RESULT · SUNDAY", selected.reviewStrategies.sundayTop5)}<div class="review-market-divider"><span>GOAL MARKET</span><h3>Over 2.5 goals</h3></div>${portfolioSection("Weekend Top 10", "OVER 2.5 · ALL WEEKEND", selected.reviewStrategies.over25Top10)}${portfolioSection("Saturday Top 5", "OVER 2.5 · SATURDAY", selected.reviewStrategies.over25SaturdayTop5)}${portfolioSection("Sunday Top 5", "OVER 2.5 · SUNDAY", selected.reviewStrategies.over25SundayTop5)}<div class="review-market-divider"><span>GOAL MARKET</span><h3>Both teams to score</h3></div>${portfolioSection("Weekend Top 10", "BTTS · ALL WEEKEND", selected.reviewStrategies.bttsTop10)}${portfolioSection("Saturday Top 5", "BTTS · SATURDAY", selected.reviewStrategies.bttsSaturdayTop5)}${portfolioSection("Sunday Top 5", "BTTS · SUNDAY", selected.reviewStrategies.bttsSundayTop5)}` : `<div class="week-grid">${weekCards}</div>`;
  return `<div class="review-wrap"><div class="review-summary"><div><span class="section-kicker">PERFORMANCE AUDIT</span><h2>Interactive review</h2><p>Review the saved Top 10, Filtered Top 10 and both daily Top 5 portfolios.</p></div><div class="review-controls"><label>Review week<select id="review-week">${options}</select></label></div></div><div class="audit-grid"><div class="audit-card primary"><span>Top 10 record</span><strong>${correct}/${allPicks.length}</strong><small>${accuracy}% correct</small></div><div class="audit-card"><span>Average confidence</span><strong>${averageConfidence}%</strong><small>compare with ${accuracy}% results</small></div>${bandCards}</div>${modelInsights(weeks)}${detail}</div>`;
}

function bindReviewControls() {
  document.querySelector("#review-week")?.addEventListener("change", event => { selectedReviewWeek = event.target.value; render(); });
  document.querySelectorAll("[data-review-week]").forEach(button => button.addEventListener("click", () => { selectedReviewWeek = button.dataset.reviewWeek; render(); }));
  document.querySelector("#print-weekly-report")?.addEventListener("click", () => window.print());
}

function topPicksTable(picks, filter) {
  if (!picks.length) return '<div class="empty">No predictions are currently available.</div>';
  const rows = picks.map(fixture => {
    const result = predict(fixture);
    return `<article class="top-pick-row">
      <div class="top-pick-match">
        <span class="top-pick-league">${fixture.competition?.name || "Premier League"}</span>
        <div><div class="top-pick-teams"><strong>${fixture.home.name}</strong><span>vs</span><strong>${fixture.away.name}</strong></div><div class="caution-list">${cautionBadges({ utcDate: fixture.utcDate, confidence: result.confidence, probabilities: result.probabilities })}</div></div>
        <span class="top-pick-kickoff">${fixture.date}</span>
      </div>
      <div class="top-pick-call">
        <div><span class="eyebrow">OUR PREDICTION</span><strong>${result.label}</strong><small class="top-pick-reason">${result.reason || "Based on form, venue performance and team strength"}</small></div>
        <div class="top-pick-score"><b>${result.confidence}%</b><small>confidence</small></div>
      </div>
    </article>`;
  }).join("");
  const day = filter === "top-saturday" ? "Saturday" : filter === "top-sunday" ? "Sunday" : filter === "top-filtered" ? "Filtered" : "Weekend";
  const count = ["top", "top-filtered"].includes(filter) ? 10 : 5;
  const description = filter === "top-filtered" ? "Highest-confidence calls after removing early kickoffs and away-win predictions. Sub-80% calls remain marked." : `The ${count} strongest calls across your selected leagues.`;
  return `<div class="top-picks-wrap"><div class="top-picks-heading"><div><span class="section-kicker">HIGHEST-CONFIDENCE FORECASTS</span><h2>${day} top picks</h2><p>${description}</p></div><span class="threshold">Top ${count}</span></div><div class="top-picks-list">${rows}</div></div>`;
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
    try {
      const historyResponse = await fetch(`history.json?v=${Date.now()}`);
      if (historyResponse.ok) historyFixtures = (await historyResponse.json()).fixtures ?? [];
    } catch (historyError) {
      console.warn("Performance history is not available yet.", historyError);
    }
    try {
      const performanceResponse = await fetch(`performance.json?v=${Date.now()}`);
      if (performanceResponse.ok) performanceData = await performanceResponse.json();
    } catch (performanceError) {
      console.warn("Performance audit is not available yet.", performanceError);
    }
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

