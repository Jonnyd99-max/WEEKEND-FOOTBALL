import { writeFile } from "node:fs/promises";

const API_ROOT = "https://api.football-data.org/v4";
const token = process.env.FOOTBALL_DATA_API_KEY;
if (!token) throw new Error("FOOTBALL_DATA_API_KEY is not configured");

const COMPETITIONS = [
  { code: "PL", name: "Premier League" },
  { code: "ELC", name: "Championship" },
  { code: "BL1", name: "Bundesliga" },
  { code: "PD", name: "La Liga" },
  { code: "SA", name: "Serie A" },
];

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
let lastRequestAt = 0;

async function api(path) {
  const wait = Math.max(0, 6500 - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  const response = await fetch(`${API_ROOT}${path}`, { headers: { "X-Auth-Token": token } });
  lastRequestAt = Date.now();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function nextWeekend(now = new Date()) {
  const saturday = new Date(now);
  const daysUntilSaturday = (6 - saturday.getUTCDay() + 7) % 7 || 7;
  saturday.setUTCDate(saturday.getUTCDate() + daysUntilSaturday);
  const sunday = new Date(saturday);
  sunday.setUTCDate(saturday.getUTCDate() + 1);
  return { from: saturday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

function scoreFor(match, teamId) {
  const home = match.homeTeam.id === teamId;
  return {
    home,
    scored: home ? match.score.fullTime.home : match.score.fullTime.away,
    conceded: home ? match.score.fullTime.away : match.score.fullTime.home,
    opponentId: home ? match.awayTeam.id : match.homeTeam.id,
  };
}

function resultFor(match, teamId) {
  const { scored, conceded } = scoreFor(match, teamId);
  return scored > conceded ? "W" : scored < conceded ? "L" : "D";
}

const resultPoints = result => result === "W" ? 3 : result === "D" ? 1 : 0;

function formatKickoff(utcDate) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(utcDate)).replace(" at ", " · ");
}

function buildTable(matches) {
  const table = new Map();
  const row = team => {
    if (!table.has(team.id)) table.set(team.id, { id: team.id, name: team.name, played: 0, points: 0, goalsFor: 0, goalsAgainst: 0 });
    return table.get(team.id);
  };
  for (const match of matches) {
    const home = row(match.homeTeam);
    const away = row(match.awayTeam);
    const homeGoals = match.score.fullTime.home;
    const awayGoals = match.score.fullTime.away;
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;
    if (homeGoals > awayGoals) home.points += 3;
    else if (homeGoals < awayGoals) away.points += 3;
    else { home.points += 1; away.points += 1; }
  }
  const ordered = [...table.values()].sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor);
  ordered.forEach((team, index) => { team.position = index + 1; team.pointsPerGame = team.played ? team.points / team.played : 1.35; });
  return table;
}

function describeTeam(teamId, fixtureDate, venue, matches, table, previousTable) {
  const previous = matches.filter(match => new Date(match.utcDate) < fixtureDate && (match.homeTeam.id === teamId || match.awayTeam.id === teamId)).sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const recentMatches = previous.slice(-5);
  const form = recentMatches.map(match => resultFor(match, teamId));
  const recencyWeights = [0.55, 0.65, 0.75, 0.88, 1].slice(-recentMatches.length);
  let weightedPoints = 0;
  let totalWeight = 0;
  for (const [index, match] of recentMatches.entries()) {
    const { opponentId } = scoreFor(match, teamId);
    const opponentPpg = table.get(opponentId)?.pointsPerGame ?? 1.35;
    const opponentWeight = clamp(0.75 + opponentPpg / 3 * 0.5, 0.75, 1.25);
    const weight = recencyWeights[index];
    weightedPoints += resultPoints(form[index]) / 3 * opponentWeight * weight;
    totalWeight += weight;
  }
  const venueMatches = previous.filter(match => venue === "HOME" ? match.homeTeam.id === teamId : match.awayTeam.id === teamId);
  const venueTotals = venueMatches.reduce((totals, match) => {
    const score = scoreFor(match, teamId);
    totals.goalsFor += score.scored;
    totals.goalsAgainst += score.conceded;
    totals.points += resultPoints(resultFor(match, teamId));
    return totals;
  }, { goalsFor: 0, goalsAgainst: 0, points: 0 });
  const tableRow = table.get(teamId) ?? { played: 0, pointsPerGame: 1.35, position: null };
  const previousRow = previousTable.get(teamId);
  const lastPlayed = previous.at(-1)?.utcDate;
  return {
    form,
    played: tableRow.played,
    position: tableRow.position,
    pointsPerGame: Number(tableRow.pointsPerGame.toFixed(2)),
    venuePlayed: venueMatches.length,
    venueGoalsFor: venueTotals.goalsFor,
    venueGoalsAgainst: venueTotals.goalsAgainst,
    venuePointsPerGame: Number((venueMatches.length ? venueTotals.points / venueMatches.length : 1.35).toFixed(2)),
    adjustedForm: Number((totalWeight ? weightedPoints / totalWeight : 0.5).toFixed(3)),
    restDays: lastPlayed ? Math.max(0, Math.floor((fixtureDate - new Date(lastPlayed)) / 86400000)) : null,
    baseline: previousRow ? {
      played: previousRow.played,
      pointsPerGame: Number(previousRow.pointsPerGame.toFixed(2)),
      goalsForPerGame: Number((previousRow.goalsFor / Math.max(1, previousRow.played)).toFixed(3)),
      goalsAgainstPerGame: Number((previousRow.goalsAgainst / Math.max(1, previousRow.played)).toFixed(3)),
    } : null,
  };
}

const { from, to } = nextWeekend();
const fixtures = [];
for (const competition of COMPETITIONS) {
  console.log(`Fetching ${competition.name}…`);
  const upcoming = await api(`/competitions/${competition.code}/matches?dateFrom=${from}&dateTo=${to}`);
  const completed = await api(`/competitions/${competition.code}/matches?status=FINISHED`);
  const matches = upcoming.matches ?? [];
  const currentSeason = Number(matches[0]?.season?.startDate?.slice(0, 4) ?? (new Date(from).getUTCMonth() >= 6 ? new Date(from).getUTCFullYear() : new Date(from).getUTCFullYear() - 1));
  const previous = await api(`/competitions/${competition.code}/matches?season=${currentSeason - 1}&status=FINISHED`);
  const finishedMatches = (completed.matches ?? []).filter(match => Number.isFinite(match.score?.fullTime?.home) && Number.isFinite(match.score?.fullTime?.away));
  const previousMatches = (previous.matches ?? []).filter(match => Number.isFinite(match.score?.fullTime?.home) && Number.isFinite(match.score?.fullTime?.away));
  const table = buildTable(finishedMatches);
  const previousTable = buildTable(previousMatches);
  const league = {
    avgHomeGoals: Number((finishedMatches.reduce((sum, match) => sum + match.score.fullTime.home, 0) / Math.max(1, finishedMatches.length)).toFixed(3)),
    avgAwayGoals: Number((finishedMatches.reduce((sum, match) => sum + match.score.fullTime.away, 0) / Math.max(1, finishedMatches.length)).toFixed(3)),
    completedMatches: finishedMatches.length,
    previousAverageGoals: Number((previousMatches.reduce((sum, match) => sum + match.score.fullTime.home + match.score.fullTime.away, 0) / Math.max(1, previousMatches.length * 2)).toFixed(3)),
  };

  for (const match of matches) {
    const fixtureDate = new Date(match.utcDate);
    const homeStats = describeTeam(match.homeTeam.id, fixtureDate, "HOME", finishedMatches, table, previousTable);
    const awayStats = describeTeam(match.awayTeam.id, fixtureDate, "AWAY", finishedMatches, table, previousTable);
    const h2hData = await api(`/matches/${match.id}/head2head?limit=4`);
    const h2h = [...(h2hData.matches ?? [])].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)).slice(-4).map(previous => resultFor(previous, match.homeTeam.id));
    const londonDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(fixtureDate).toLowerCase();
    fixtures.push({
      id: match.id,
      competition,
      day: londonDay,
      date: formatKickoff(match.utcDate),
      utcDate: match.utcDate,
      venue: match.venue || "Venue TBC",
      model: { version: 2, league },
      home: { id: match.homeTeam.id, name: match.homeTeam.name, short: match.homeTeam.tla || match.homeTeam.shortName.slice(0, 3).toUpperCase(), ...homeStats },
      away: { id: match.awayTeam.id, name: match.awayTeam.name, short: match.awayTeam.tla || match.awayTeam.shortName.slice(0, 3).toUpperCase(), ...awayStats },
      h2h,
    });
  }
}

if (!fixtures.length) throw new Error(`No selected-league fixtures found from ${from} to ${to}`);
fixtures.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

await writeFile("data.json", `${JSON.stringify({ updatedAt: new Date().toISOString(), source: "football-data.org", modelVersion: 2, fixtures }, null, 2)}\n`);
console.log(`Updated ${fixtures.length} Model V2 fixtures across ${COMPETITIONS.length} leagues (${from} to ${to}).`);

