import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const history = JSON.parse(await readFile("history.json", "utf8"));
const appSource = await readFile("app.js", "utf8");
const modelSource = appSource.split('document.querySelectorAll("[data-filter]")')[0];
const context = {};
vm.runInNewContext(`${modelSource}\nthis.__predict = predict;`, context);
const predict = context.__predict;

const predictedOutcome = prediction => ["home", "draw", "away"]
  .sort((a, b) => prediction.probabilities[b] - prediction.probabilities[a])[0];

const settled = (history.fixtures ?? []).filter(fixture => fixture.actual && fixture.predictionBatch);
const batches = [...new Set(settled.map(fixture => fixture.predictionBatch))].sort((a, b) => new Date(a) - new Date(b));

const weeks = batches.map(batch => {
  const ranked = settled
    .filter(fixture => fixture.predictionBatch === batch)
    .map(fixture => ({ fixture, prediction: predict(fixture) }))
    .sort((a, b) => b.prediction.confidence - a.prediction.confidence || new Date(a.fixture.utcDate) - new Date(b.fixture.utcDate));
  const picks = ranked.slice(0, 10).map(({ fixture, prediction }, index) => {
    const outcome = predictedOutcome(prediction);
    return {
      rank: index + 1,
      fixtureId: fixture.id,
      competition: fixture.competition,
      utcDate: fixture.utcDate,
      home: fixture.home.name,
      away: fixture.away.name,
      predictedOutcome: outcome,
      prediction: prediction.label,
      confidence: prediction.confidence,
      probabilities: prediction.probabilities,
      actualOutcome: fixture.actual.outcome,
      finalScore: `${fixture.actual.homeGoals}-${fixture.actual.awayGoals}`,
      correct: outcome === fixture.actual.outcome,
    };
  });
  const correct = picks.filter(pick => pick.correct).length;
  return {
    predictionBatch: batch,
    weekendStarting: ranked[0]?.fixture.utcDate?.slice(0, 10) ?? null,
    settledFixtures: ranked.length,
    top10Correct: correct,
    top10Accuracy: Number((correct / Math.max(1, picks.length) * 100).toFixed(1)),
    averageConfidence: Number((picks.reduce((sum, pick) => sum + pick.confidence, 0) / Math.max(1, picks.length)).toFixed(1)),
    picks,
  };
});

function groupedSummary(items, keyFor) {
  const groups = {};
  for (const item of items) {
    const key = keyFor(item);
    groups[key] ??= { predictions: 0, correct: 0, confidenceTotal: 0 };
    groups[key].predictions += 1;
    groups[key].correct += item.correct ? 1 : 0;
    groups[key].confidenceTotal += item.confidence;
  }
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, {
    predictions: value.predictions,
    correct: value.correct,
    accuracy: Number((value.correct / value.predictions * 100).toFixed(1)),
    averageConfidence: Number((value.confidenceTotal / value.predictions).toFixed(1)),
  }]));
}

const allPicks = weeks.flatMap(week => week.picks);
const confidenceBand = pick => `${Math.floor(pick.confidence / 10) * 10}-${Math.floor(pick.confidence / 10) * 10 + 9}%`;
const totalCorrect = allPicks.filter(pick => pick.correct).length;
const output = {
  generatedAt: new Date().toISOString(),
  modelVersion: 2,
  note: "Frozen weekly Top 10 predictions recomputed from their saved original model inputs. Use this file for model reviews; never tune from one surprising result.",
  overall: {
    completedWeeks: weeks.length,
    top10Predictions: allPicks.length,
    correct: totalCorrect,
    accuracy: Number((totalCorrect / Math.max(1, allPicks.length) * 100).toFixed(1)),
    averageConfidence: Number((allPicks.reduce((sum, pick) => sum + pick.confidence, 0) / Math.max(1, allPicks.length)).toFixed(1)),
  },
  byLeague: groupedSummary(allPicks, pick => pick.competition?.code || "UNKNOWN"),
  byPredictedOutcome: groupedSummary(allPicks, pick => pick.predictedOutcome),
  byConfidenceBand: groupedSummary(allPicks, confidenceBand),
  weeks,
};

await writeFile("performance.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(`Built performance audit: ${weeks.length} weeks, ${totalCorrect}/${allPicks.length} correct Top 10 picks.`);

