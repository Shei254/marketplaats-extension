package com.mprelist.catalog;

/**
 * The free thing a visitor can honestly be promised: sign in and you land on it (T84, glossary).
 *
 * <p>The <strong>Free tier</strong> — the one row with no Price (ADR-0031) — when it is also the
 * <strong>Default tier</strong> and grants something. A free tier that is not the default is reachable by
 * nobody, and a default at quota {@code 0} is ADR-0019's spelling of "there is no free tier", so neither is
 * one of these. Its grant is carried whole, so an unlimited free tier (ADR-0029) is a {@code null} quota here
 * exactly as it is everywhere else.
 *
 * <p><strong>Never a {@link SellablePlan}</strong>, which is the reason this is its own record: a Plan always
 * has a price, and this is the one tier that can never be one.
 */
public record FreeTierOnOffer(TierName tier, Entitlement grants) {

	public FreeTierOnOffer {
		if (tier == null || grants == null) {
			throw new IllegalArgumentException("A free tier on offer needs a name and a grant");
		}
	}

}
