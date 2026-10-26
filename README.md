# Auto ramp plan

A simple UI for entering the assumptions of an in-system project and forecasting its ramp: when the task target is
reached, how many contributors (CBs) that takes at each review layer, and the plan day by day. It works out the model
in [docs/in_system_ramp_plan.tex](docs/in_system_ramp_plan.tex).

## Run it

A static page with no build step and no dependencies:

```bash
python3 serve.py
```

Then open http://127.0.0.1:8785. Inputs are saved in the browser as you type.

## What's in it

- **Pipeline and yield**: the review layers in use (L0, L1, L4, L8, L10, any of them evals) and, for the tasks attempted
  in each layer, the share that moves to each layer next. Tasks sent back to L−1 are cleared. Super attempts: when
  CBs at L0 and above run out of review work and fall back to L−1, the tasks they create there go straight to a layer
  you pick (L12 by default).
- **Domains and targets**: one pool, or split by domain, each with its own task target and tasks already waiting.
- **Assumptions**: hours per contributor per day and hours per attempt in each layer, with per-domain overrides.
- **Ramp plan**: the day the target is reached, tasks done against the target, every Monday plus the final delivery,
  and a day-by-day timeline that marks bottlenecks, starved layers and conversions that came up short.
- **CB ramp**: new CBs join at L−1, a set number a day in each period. Review layers convert CBs up from the layer below:
  a set number a day, or enough to keep a % of L0's CBs (rounded to whole CBs, at least 1). At L0 itself, 100% holds it
  steady and more grows it.
- **Export**: an .xlsx for Google Sheets in which every equation is a live formula, with a sheet that explains each one.

## Share it

`python3 build_single.py` writes `dist/ramp-plan.html`, the whole app in one file for S3 or any static host.

## Tests

```bash
for f in tests/test_*.js; do node "$f"; done
```

The export test works out every formula in the exported workbook and compares it, day by day, with the app's plan.
