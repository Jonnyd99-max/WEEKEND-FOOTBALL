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

function resultFor(match, teamId) {
  const home = match.homeTeam.id === teamId;
  const scored = home ? match.score.fullTime.home : match.score.fullTime.away;
  const conceded = home ? match.score.fullTime.away : match.score.fullTime.home;
  return scored > conceded ? "W" : scored < conceded ? "L" : "D";
}

function formatKickoff(utcDate) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(utcDate)).replace(" at ", " · ");
}

const { from, to } = nextWeekend();
const fixtures = [];
for (const competition of COMPETITIONS) {
  console.log(`Fetching ${competition.name}…`);
  const upcoming = await api(`/competitions/${competition.code}/matches?dateFrom=${from}&dateTo=${to}`);
  const matches = upcoming.matches ?? [];
  const teamIds = [...new Set(matches.flatMap(match => [match.homeTeam.id, match.awayTeam.id]))];
  const forms = new Map();
  for (const teamId of teamIds) {
    const history = await api(`/teams/${teamId}/matches?competitions=${competition.code}&status=FINISHED&limit=5`);
    const previous = [...(history.matches ?? [])].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)).slice(-5);
    forms.set(teamId, previous.map(match => resultFor(match, teamId)));
  }
  for (const match of matches) {
    const h2hData = await api(`/matches/${match.id}/head2head?limit=4`);
    const h2h = [...(h2hData.matches ?? [])].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)).slice(-4).map(previous => resultFor(previous, match.homeTeam.id));
    const londonDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(new Date(match.utcDate)).toLowerCase();
    fixtures.push({
      id: match.id,
      competition,
      day: londonDay,
      date: formatKickoff(match.utcDate),
      utcDate: match.utcDate,
      venue: match.venue || "Venue TBC",
      home: { id: match.homeTeam.id, name: match.homeTeam.name, short: match.homeTeam.tla || match.homeTeam.shortName.slice(0, 3).toUpperCase(), form: forms.get(match.homeTeam.id) ?? [] },
      away: { id: match.awayTeam.id, name: match.awayTeam.name, short: match.awayTeam.tla || match.awayTeam.shortName.slice(0, 3).toUpperCase(), form: forms.get(match.awayTeam.id) ?? [] },
      h2h,
    });
  }
}

if (!fixtures.length) throw new Error(`No selected-league fixtures found from ${from} to ${to}`);
fixtures.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

await writeFile("data.json", `${JSON.stringify({ updatedAt: new Date().toISOString(), source: "football-data.org", fixtures }, null, 2)}\n`);
console.log(`Updated ${fixtures.length} fixtures across ${COMPETITIONS.length} leagues (${from} to ${to}).`);
