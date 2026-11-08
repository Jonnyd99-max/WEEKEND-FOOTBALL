# Weekend Predictor model review

This repository keeps a permanent audit trail so later chats can review the model using evidence rather than memory.

## Files to inspect

- `performance.json` is the quickest starting point. It contains each completed week's original Top 10, prediction, confidence, final score, result, and summaries by league, outcome and confidence band.
- `history.json` contains every saved fixture and the full model inputs that existed when the prediction was made.
- `app.js` contains the current Model V2 calculation.
- `scripts/update-data.mjs` collects fixtures, settles results and preserves history.

## Review policy

1. Treat 8/10 as a good week, not proof that every weight is correct.
2. Do not change the model because of one plausible upset. Football contains unavoidable variance.
3. Prefer at least 6-10 completed weeks before recalibrating a factor, unless a clear data or calculation bug is found.
4. Compare accuracy with average confidence. If 70% predictions win only 55% of the time over a useful sample, confidence is over-stated even if the selected outcome is often right.
5. Break results down by league, predicted outcome, confidence band and UK kickoff-time band. Require a reasonable sample before acting on a split.
6. Specifically compare early kickoffs (before 14:00 UK time) with afternoon and evening matches. Keep the exact kickoff visible: do not assume early games are less reliable unless the saved results support it.
7. Make one explainable model change at a time and record the reason below, so results before and after the change can be compared.

## Baseline on 8 November 2026

The first four completed Top 10 weeks scored 6/10, 6/10, 8/10 and 8/10: 28 correct from 40 selections (70%). This is encouraging but still too small a sample for automatic weight changes. `performance.json` is the live source of truth as further weeks are added.

## Suggested prompt for a future chat

> Review `performance.json`, `history.json`, `app.js` and `MODEL_ANALYSIS.md` in Jonnyd99-max/WEEKEND-FOOTBALL. Explain what the saved predictions are teaching us, identify patterns supported by adequate samples, and recommend no more than one model change unless you find a calculation bug. Do not treat ordinary football upsets as model failures.

## Change log

- 8 November 2026: Established the permanent performance audit. No model weights changed.

