-- A tier may be sold at more than one billing interval (T62, #128). ADR-0019 named this as the thing its own
-- `UNIQUE` constraint blocked -- "a tier cannot have both a monthly and an annual Price" -- and named this
-- table as the fix. Monthly and annual Pro are one plan somebody chooses a rhythm for, not two plans.
--
-- A table rather than the nullable second column that ADR also offered. A column fixes the answer at two, and
-- the *other* thing that ADR's "revisit if" names is regional pricing, which is N prices per tier and cannot
-- be a column at all. The join costs one index hit, which is what the single column cost.
create table tier_price (
    id                uuid        primary key default gen_random_uuid(),
    tier_id           uuid        not null references tier (id) on delete cascade,
    -- Globally unique, exactly as `tier.stripe_price_id` was: two tiers pointing at one Price would make the
    -- webhook's Price -> Tier lookup ambiguous, which is the reverse direction the mirror depends on.
    stripe_price_id   text        not null unique,
    -- Stripe's own vocabulary: day, week, month, year. Stored here and nowhere else, which is a departure
    -- from ADR-0014's "Stripe owns amount, currency and interval" and a narrow one: the *amount* is still
    -- never stored. What is stored is which of a tier's prices is which, because a row has to be keyed on
    -- something and "the annual one" is the only handle a buyer or an operator ever uses.
    billing_interval  text        not null,
    created_at        timestamptz not null default now(),
    -- One price per interval per tier. This is what makes repricing an *update* rather than an accumulation:
    -- a new monthly Price tagged `pro` replaces the monthly row and leaves the annual one alone.
    unique (tier_id, billing_interval)
);

-- What `tier_soldAs` reads on every subscription event.
create index tier_price_by_tier on tier_price (tier_id);

-- Move what the single column held. Every such row is monthly: no deployment has ever had a tier price that
-- was not (the seed ships none at all, and the only ones that exist locally were created monthly), and the
-- interval was not stored to be read back. A row that is actually annual is corrected by the next
-- `price.updated` Stripe sends for it, which now carries the interval.
insert into tier_price (tier_id, stripe_price_id, billing_interval)
select id, stripe_price_id, 'month'
  from tier
 where stripe_price_id is not null;

-- V5's constraint cannot survive as a `check`: it now spans two tables, and a check constraint may not.
-- Dropped and replaced by a trigger rather than left to the readers, for the reason V5 gave for writing it at
-- all -- "an invariant a query has to remember is one a later query forgets" -- and because the readers here
-- are now three: the admin edit, the sync, and whatever T62 has not written yet.
alter table tier drop constraint tier_is_published_only_with_a_price;
alter table tier drop column stripe_price_id;

create function tier_published_needs_a_price() returns trigger
language plpgsql as $$
declare
    offending uuid;
begin
    -- Both directions of the same rule: publishing a tier that has no price, and removing the last price from
    -- a tier that is published. The second is the one a `check` could never have caught even before this.
    select t.id into offending
      from tier t
     where t.published
       and not exists (select 1 from tier_price p where p.tier_id = t.id)
     limit 1;

    if offending is not null then
        -- Names itself, because the name is what a reader has to search for: this replaces a check
        -- constraint whose violation used to carry it automatically, and both an operator reading a log and
        -- a test asserting the invariant identify it by that string.
        raise exception 'tier_is_published_only_with_a_price: tier % is published and has no Stripe Price '
            'to charge against', offending
            using errcode = 'check_violation';
    end if;
    return null;
end;
$$;

-- `initially immediate`, so a violation arrives on the statement that caused it rather than at commit.
-- `deferred` was tried first and is wrong twice over: a transaction that rolls back never commits, so the
-- check never runs and a test asserting the invariant passes having checked nothing -- which is what
-- `BaselineSchemaTest` found -- and in the application the exception would surface from a commit, a long way
-- from the statement a caller could report on.
--
-- Nothing here needs deferral: every writer creates the price before it publishes. A future one that does not
-- can `SET CONSTRAINTS ... DEFERRED` for its own transaction, which is what `deferrable` keeps available.
create constraint trigger tier_is_published_only_with_a_price
    after insert or update of published on tier
    deferrable initially immediate
    for each row execute function tier_published_needs_a_price();

create constraint trigger tier_price_is_not_the_last_of_a_published_tier
    after delete or update of tier_id on tier_price
    deferrable initially immediate
    for each row execute function tier_published_needs_a_price();
