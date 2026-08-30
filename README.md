# Weekend Predictor

A dependency-free, responsive Premier League prediction dashboard.

## Features

- Saturday, Sunday, and full-weekend filters
- Recent form and head-to-head indicators
- A transparent 70% form / 30% head-to-head model
- Home advantage and confidence calculations
- Expandable calculation details
- Automated real-world fixtures and form from football-data.org

## Run locally

Open `index.html` in a modern web browser.

## GitHub Pages

This static app can be hosted directly with GitHub Pages. In repository **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

Fixture data is stored in `data.json`. A GitHub Actions workflow updates it every Wednesday at 09:00 Europe/London using football-data.org. The API token is stored privately as the `FOOTBALL_DATA_API_KEY` repository secret and is never exposed to the browser.

This is an analysis tool, not a betting service. Predictions are indicative only.
