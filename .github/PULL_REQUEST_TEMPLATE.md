## What changed and why

<!-- One paragraph. Link the issue if there is one. -->

## Kind of change

- [ ] Structural move: files, names or imports only; no tool, storage, HTTP or event contract changes
- [ ] Behaviour change: what a user, the model or the benchmark observes is different (say what)

## Checks run

<!-- Say which checks ran: https://github.com/nemofq/open-finance-agent/blob/main/CONTRIBUTING.md#checks -->

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- [ ] `pnpm test:browser`
- [ ] The extra checks CONTRIBUTING.md lists for the paths this touches, or none apply

<!-- For a benchmark run, give agent, judge, thinking level and scores before and after: https://github.com/nemofq/open-finance-agent/blob/main/evals/README.md#comparing-runs -->

## Checklist

- [ ] No credentials, local data (`config.json`, `auth.json`, sessions, portfolio) or eval results are in the diff
