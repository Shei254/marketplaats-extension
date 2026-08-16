-- The index #24's reconciliation sweeps on.
--
-- `refundAbandonedBefore` matches `status = 'RESERVED' and expires_at < ?`, and V1's only index on this
-- table leads with `app_user_id` — a column that statement does not constrain, since the job asks about
-- every user at once. So the sweep was a full scan of `usage_reservation`, taking row locks as it went,
-- every 5 minutes and forever: the table grows by a row per relist and never shrinks, while the rows the
-- job can actually move are only ever the handful currently in flight.
--
-- Partial on `status = 'RESERVED'`, which is the predicate the statement already carries and the reason
-- this index stays small no matter how large the table gets — a reservation leaves the index for good the
-- moment a report or this job resolves it. That is also why the two indexes do not collapse into one:
-- `usage_reservation_holding_a_unit` covers `status <> 'REFUNDED'`, which is nearly the whole table,
-- and it is read per-user by `reserved_at`; this one is read across all users by `expires_at`.
--
-- The status stays a literal in the statement that reads this, rather than a bound parameter, so that the
-- planner can always prove the statement's predicate implies this index's — see `ReservationStatus#inSql`.
create index usage_reservation_awaiting_a_report on usage_reservation (expires_at)
    where status = 'RESERVED';
