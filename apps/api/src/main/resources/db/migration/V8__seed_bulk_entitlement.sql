-- The first feature flag any tier has ever carried: `bulk`, which #147 builds and ADR-0025 argues for.
-- Pro reposts ten ads in one act, Power twenty-five, free none.
--
-- **This file is the correction to a paragraph in V2 that stopped being true the moment it ran.**
-- `V2__seed_tier_catalog.sql` says of the `features` column that "the flags the domain model names — bulk,
-- scheduling — have no implementation and no ticket, and a seeded `"bulk": true` would be an entitlement to a
-- feature that does not exist". That was correct when it was written and half of it is now false: bulk has
-- both. V2 is not edited to say so, and the reason is the one V2 itself gives for existing at all — Flyway
-- validates the checksum of every file it has already run, and a comment is bytes like any other. Editing it
-- would stop every database that has already migrated from starting until somebody ran `flyway repair`, which
-- is a worse thing to deploy than a stale sentence. So the correction is here, in the file that made it stale,
-- and `apps/api/README.md` — the other place that paragraph was repeated, and one that *can* be edited — has
-- been rewritten to match. `scheduling` is still named, still unbuilt, and V2's sentence about it still holds.
--
-- Seeded, not owned, exactly as V2's catalog is (ADR-0014): this writes the flag only where nothing has said
-- anything about it, so an operator who has since tuned `upTo` keeps their number through a restored dump or a
-- hand-run. What it does *not* preserve is a flag taken off a tier entirely — a second application puts it
-- back, exactly as re-applying V2 would re-create a tier row somebody had deleted. That is the same shape of
-- promise and the same hole in it, and the way to take bulk off a tier for good is the admin edit ADR-0014
-- makes the catalog's owner rather than a migration nobody re-runs. `where features -> 'bulk' is null` is what makes
-- that true, and it is the `on conflict (code) do nothing` of a column that already exists. Written with `->`
-- rather than the `?` containment operator that reads more naturally, because `?` is JDBC's placeholder and
-- this file is also executed through a driver by TierCatalogSeedTest — the operator that says exactly what is
-- meant is not worth a statement that parses differently depending on who runs it. It says "the key is
-- absent", and a `{"bulk": null}` an operator wrote by hand is a value rather than a gap: `->` answers SQL
-- NULL only for a key that is not there.
--
-- **`upTo` is not enforced by this application and cannot be** (ADR-0025). `POST /api/relist/authorize` sees
-- one ad at a time and has nothing to count a batch with, so the number below is what the popup caps a
-- selection at; what the API reads is only whether the flag is there at all. A tier is free to carry a
-- different number and nothing here will disagree with it.
update tier
   set features = features || '{"bulk": {"upTo": 10}}'::jsonb
 where code = 'pro'
   and features -> 'bulk' is null;

-- Twenty-five is a ~2 hour unattended run across two burst waits, which ADR-0025 records as a cost it chose
-- with its eyes open rather than an oversight: Pro's ten is sized to fit one `mprelist.safety.burst-limit`
-- window exactly, so the tier most people are on never sleeps mid-run, and Power's number buys a headline at
-- the price of a run that often will not finish in one sitting.
update tier
   set features = features || '{"bulk": {"upTo": 25}}'::jsonb
 where code = 'power'
   and features -> 'bulk' is null;

-- Free is left at `{}` deliberately and is not a row this file forgot. A locked checkbox beside somebody's own
-- ads is the conversion surface ADR-0007 asks for, and it only exists because the tier genuinely does not
-- carry the flag — the popup draws the control from the entitlement rather than from a list of tier codes.
