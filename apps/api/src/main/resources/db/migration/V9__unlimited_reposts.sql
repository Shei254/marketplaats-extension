-- A tier may grant reposts without a cap (T73, #160), and the sentinel is `null` (ADR-0029).
--
-- The obvious spelling -- let 0 mean unlimited -- is rejected there, because 0 is already load-bearing in
-- three places none of which an operator chose it for: `V5__tier_publication.sql` adopts a draft at it,
-- ADR-0019 spells "there is no free tier" as it, and the auto-publish below tests against it. Under
-- `0 = unlimited` the documented way to withdraw the free tier would hand every new account unlimited
-- reposts. `relist_quota_per_period = 0` reads as "no reposts" to somebody who has never opened an ADR, and
-- 0 reads as "unlimited" to nobody -- so the rare meaning gets the sentinel that has to be taught.
alter table tier
    alter column relist_quota_per_period drop not null;

-- The `>= 0` check stays and stays honest: `null >= 0` is unknown, which a check constraint passes, so an
-- unlimited tier is allowed through and a negative one is still refused.


-- A published tier grants something -- the half of the original proposal that was right, moved to where it
-- belongs (ADR-0029). It is a rule about *publishing*, not about what 0 means.
--
-- It closes a live gap rather than inventing one: the `> 0` guard existed only on the sync's auto-publish
-- path (`update tier set published = true where ... and relist_quota_per_period > 0`), so an operator could
-- hand-publish a zero-grant tier through `PUT /api/admin/tiers/{code}` and a buyer could pay for it. The two
-- publish paths agree for the first time.
--
-- Written at V7's three layers, and this is the first: a trigger, then a typed `TierEdited.NothingToGrant`
-- so the one writer with a human in front of it can say what happened, then a restatement in
-- `CatalogEntry`'s constructor so a test standing a row up by hand cannot make one the database refuses.
create function tier_published_grants_something() returns trigger
language plpgsql as $$
begin
    if new.published and new.relist_quota_per_period = 0 then
        -- Names itself, for the reason V7's does: the name is what a reader has to search for, and both an
        -- operator reading a log and a test asserting the invariant identify it by that string.
        raise exception 'tier_is_published_only_when_it_grants_something: tier % is published and grants no '
            'reposts', new.id
            using errcode = 'check_violation';
    end if;
    return null;
end;
$$;

-- `null` is unlimited and passes: `null = 0` is unknown, and the `if` above takes only the true branch. A
-- row trigger rather than a check constraint for consistency with the rule it sits beside -- V7 had to
-- become one because its rule spans two tables, and two invariants over the same column reported two
-- different ways is a thing a reader has to learn twice.
create constraint trigger tier_is_published_only_when_it_grants_something
    after insert or update of published, relist_quota_per_period on tier
    deferrable initially immediate
    for each row execute function tier_published_grants_something();
