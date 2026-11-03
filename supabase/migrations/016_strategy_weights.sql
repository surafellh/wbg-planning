-- Weights across the Group strategy: each Group pillar's share of the strategy, and each unit goal's share of the Group goal it serves.
alter table group_pillars add column if not exists weight numeric;
alter table unit_goals add column if not exists contribution numeric;
