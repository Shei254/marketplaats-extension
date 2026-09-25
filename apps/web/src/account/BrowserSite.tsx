import type { JSX } from "react";

import { deployedConfig } from "../admin/deployed-config";
import type { LoadPlans } from "../public/plans-on-offer";
import { pageFor } from "../routes";
import { Site } from "../Site";
import { customerArriving } from "./customer-session";
import { useAccount } from "./useAccount";

/**
 * The public site with its visitor attached (T85, ADR-0036) — the one place the
 * browser's storage, navigation and `fetch` are handed to the customer session,
 * so that `Site` and everything under `public/` stay functions of their props.
 */
export function BrowserSite({ loadPlans }: { loadPlans: LoadPlans }): JSX.Element {
  const config = deployedConfig(window.__MPRELIST_WEB_CONFIG__, location.origin);
  const account = useAccount(
    {
      config,
      http: (url, init) => fetch(url, init),
      session: sessionStorage,
      local: localStorage,
      navigate: (url) => location.assign(url),
      replaceUrl: (url) => history.replaceState(null, "", url),
      apiBaseUrl: config.apiBaseUrl,
      fetch: (url, init) => fetch(url, init),
      search: location.search,
    },
    pageFor(location.pathname) === "landing",
  );
  return <Site pathname={location.pathname} year={new Date().getFullYear()} loadPlans={loadPlans} account={account} />;
}

/**
 * Whether this load is Keycloak answering the customer session rather than the
 * admin corner. Both land on `/`; which in-flight record is waiting is the
 * difference.
 */
export function isCustomerArrival(search: string): boolean {
  try {
    return customerArriving(search, sessionStorage);
  } catch {
    return false;
  }
}
