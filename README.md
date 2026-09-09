# Weekend Predictor

A dependency-free, responsive weekend football prediction dashboard covering five leagues.

## Features

- Saturday, Sunday, and full-weekend filters
- Recent and opponent-adjusted form indicators
- Season-long attacking and defensive strength
- Separate home and away performance
- Expected goals, likely score, and home/draw/away probabilities
- Rest-day adjustments and lightly weighted head-to-head history
- Top picks ranking of the ten highest-confidence fixtures
- Expandable calculation details
- Automated real-world fixtures and form for the Premier League, Championship, Bundesliga, La Liga, and Serie A

## Run locally

Open `index.html` in a modern web browser.

## GitHub Pages

This static app can be hosted directly with GitHub Pages. In repository **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

Fixture and Model V2 inputs are stored in `data.json`. A GitHub Actions workflow updates them every Wednesday at 09:00 Europe/London using football-data.org. The API token is stored privately as the `FOOTBALL_DATA_API_KEY` repository secret and is never exposed to the browser.

Model V2 uses a smoothed Poisson expected-goals calculation. It combines season attack and defence, venue-specific performance, recency- and opponent-adjusted form, recovery time, and a small head-to-head adjustment. Early in the season it also uses a previous-season attack/defence baseline, which fades to zero after 12 current-season matches. Its confidence is the estimated probability of the selected home, draw, or away outcome—not a guarantee.

This is an analysis tool, not a betting service. Predictions are indicative only.

