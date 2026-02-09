# Task Store Prune Runbook

## Purpose

Use `store-prune` to remove old terminal-state tasks from `.orchestrator/tasks` and keep store size stable.

## Safe Defaults

```bash
npm run dev -- store-prune \
  --older-than-hours 168 \
  --states DONE,FAILED,CANCELLED \
  --dry-run
```

也可使用按天参数：`--older-than-days 7`。

Review output, then run without `--dry-run`.

## Production Usage

```bash
npm run dev -- store-prune \
  --older-than-days 7 \
  --states DONE,FAILED,CANCELLED \
  --limit 500 \
  --batch-size 100 \
  --preview 10
```

- `--limit`: cap deletions per run to avoid large spikes.
- `--batch-size`: number of files deleted concurrently per batch.
- `--preview`: include oldest matched tasks preview in output.
- `--include-running`: allow pruning active states; default is safe-off.
- 命令输出包含 `before/after` 状态分布摘要，可直接用于观察清理效果。

## Scheduling Example (cron)

```bash
0 * * * * cd /path/to/lucy-code && npm run dev -- store-prune --older-than-hours 168 --states DONE,FAILED,CANCELLED --limit 500 --batch-size 100
```

## Validation

1. Run `npm run dev -- list` and verify active tasks still exist.
2. Check logs for `task-store.prune` warnings about unreadable files.
3. For any warning files, inspect and remove manually if required.
