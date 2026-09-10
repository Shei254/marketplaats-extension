-- The catalog carries an order, and it is the operator's (T75, #164; ADR-0030).
--
-- Until now the order of the plan cards was `order by relist_quota_per_period, code`, written twice -- in
-- `TierRows.published()` for the popup and in `TierRows.everyTier()` for `/admin`, deliberately identically so
-- the two screens read alike. Nobody chose it. `V2__seed_tier_catalog.sql` writes free 3, pro 50, power 200 in
-- that order, so on every deployment that exists grant order, creation order and the order somebody would have
-- picked are the same three rows; they come apart on the first tier granting 100, which lands between Pro and
-- Power however recently it was made and whatever it costs.
--
-- What no derived rule can express is *which plan you want bought*. Putting the middle plan first is an
-- editorial act about conversion, and it is not a function of quota, of amount or of code -- so ADR-0030 makes
-- the order stated rather than derived, and this column is where it is stated.
alter table tier
    add column position integer;

-- Backfilled from the clause it replaces, so the catalog on the far side of this migration is the catalog on
-- the near side and nothing moves on deploy. `nulls last` is Postgres's own default for an ascending order and
-- is written out here anyway: an unlimited tier's `null` quota (ADR-0029) sorted last under the old clause,
-- which is where the most generous plan belongs, and a backfill that silently reversed that would move a row
-- in the one migration whose whole promise is that nothing moves.
update tier
   set position = placed.place
  from (select id,
               row_number() over (order by relist_quota_per_period nulls last, code) as place
          from tier) placed
 where tier.id = placed.id;

alter table tier
    alter column position set not null;

-- A tier nobody placed goes last.
--
-- `not null` with no default, and the rule in a trigger rather than in the one insert that matters: there is
-- exactly one production path that creates a tier -- `TierRows.adopt`, taking a `price.created` for an unknown
-- `tier_code` -- and there are the seed, this file's own successors, and every test that stands a row up by
-- hand. Written in the insert, "last" would be true of the first and false of the rest, and a draft the sync
-- adopted while a test fixture held the table would be a row with no place at all. Written here it is true of
-- every writer, which is V1's argument and V5's and V7's: an invariant a query has to remember is one a later
-- query forgets.
--
-- **This is the one place the implementation reads differently from ADR-0030**, which describes the same
-- expression sitting in `TierRows`' insert. It is the same rule at a layer further down, for the reason above,
-- and the ADR's prose is a dated record and stays as written (see `docs/adr/README.md`).
--
-- Last and not first, because a draft is a thing to deal with rather than a thing to sell: it appears at the
-- bottom of the admin table, where a new job belongs, and it cannot reach the plan cards at all until somebody
-- publishes it. A `default 0` would have done the opposite -- filed every unplaced tier at the top of the
-- catalog, ahead of the plans somebody arranged -- which is the whole reason this column has no default.
create function tier_placed_last() returns trigger
language plpgsql as $$
begin
    -- Reads the table it is inserting into, which is safe precisely because `position` carries no `unique`:
    -- two concurrent adoptions may both read the same maximum and both land on it, and two rows sharing a
    -- position read as a stable alphabetical pair under `order by position, code` rather than as a list that
    -- reshuffles between requests. ADR-0030 argues the absent `unique` at length -- the only unwriteable
    -- version needs `deferrable initially deferred`, which V7 has already shown is a test that passes having
    -- checked nothing.
    new.position := coalesce((select max(t.position) from tier t), 0) + 1;
    return new;
end;
$$;

-- `before insert`, so the row that reaches the `not null` above already has a place: constraints are checked
-- after a `before` trigger has had the row, which is what lets a column with no default be mandatory and
-- still be omittable by every writer that has no opinion.
--
-- `when (new.position is null)` rather than an unconditional assignment, so a writer *with* an opinion keeps
-- it -- which is what a restore from a dump is, and what a future migration renumbering the catalog would be.
create trigger tier_is_placed_last
    before insert on tier
    for each row
    when (new.position is null)
    execute function tier_placed_last();
