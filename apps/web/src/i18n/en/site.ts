import type { CatalogOf } from "@mprelist/contracts";

import type { site as nl } from "../nl/site";

/**
 * **Our words** on the public site in English, held to the Dutch catalog's keys
 * (ADR-0043). *Repost* for *herplaatsen*; a tier's name and the brand are not
 * here, and money is written the Dutch way by `@mprelist/contracts`.
 */
export const site = {
  common: {
    tryAgain: "Try again",
    oneMoment: "One moment…",
    close: "Close",
    cancel: "Cancel",
    addToChrome: "Add to Chrome",
  },
  nav: {
    privacy: "Privacy",
    terms: "Terms",
    signIn: "Sign in",
    account: "My account",
    manageBilling: "Manage billing",
    signOut: "Sign out",
  },
  footer: {
    disclaimer: "{{brand}} is an independent product and is not affiliated with Marktplaats.",
  },
  pages: {
    clickTheIcon: "Click the <b>{{brand}}</b> icon in your toolbar",
    closeThisTab: "There is nothing to do here — you can close this tab.",
    success: {
      title: "You are all set",
      copy: "Your payment went through. Open the {{brand}} icon in your browser's toolbar — your new reposts are ready for you.",
      notInstalled: "Not installed yet? <a>Add to Chrome</a> — your plan is ready as soon as you sign in.",
    },
    cancel: {
      title: "Nothing was charged",
      copy: "You stopped at checkout, so nothing was paid and nothing changed. Your free reposts are still there.",
      tryAgain: "Try again from {{brand}} or from <a>the plans</a>",
    },
    billing: {
      title: "That is saved",
      copy: "Whatever you changed — how you pay, your plan, or cancelling — it is saved with Stripe, the payment service we use. Open the {{brand}} icon in your browser's toolbar to see what it means; a change can take a moment to show there.",
    },
    notFound: {
      title: "There is nothing at this address",
      copy: "{{brand}} lives in your browser's toolbar, not on this site. If you have just paid, that payment went through — this page is not part of it.",
    },
  },
  landing: {
    title: "Put your ad back on top",
    copy: "Repost it from your browser, with all its text and photos kept.",
    micro: "Free to install · works in Chrome",
    onToHowItWorks: "On to How it works",
    howItWorks: "How it works",
    steps: {
      open: { title: "Open Marktplaats", copy: "Go to your ads on the website." },
      signIn: { title: "Sign in to {{brand}}", copy: "Through the icon in your toolbar." },
      repost: { title: "Click <b>Repost</b>", copy: "Your ad is back on top." },
    },
    plans: "Plans",
    plansCopy: "Start for free, or choose a plan if you want to repost more often.",
    startFree: "Start for free",
    worksInChrome: "Works in Chrome",
    demo: {
      before: "After a few days",
      after: "After reposting",
      yours: "Your bike",
      fiveDays: "5 days",
      justNow: "just now",
      onTop: "On top",
      newlyPlaced: "Newly placed · {{when}}",
      today: "today",
      yesterday: "yesterday",
      twoDays: "2 days",
    },
  },
  plans: {
    // The operator's sentence, in the register English has: the Dutch is formal
    // (*u*) on the operator's request, which English cannot show.
    payWith:
      "Your payment is processed securely by Stripe. You can choose from several payment methods, including iDEAL | Wero, PayPal, credit card and debit card.",
    choose: "Choose {{plan}}",
    from: "From {{day}}",
    switchTo: "Switch to {{to}}",
    current: "Current plan",
    startFree: "Start for free",
    cancelPlan: "Cancel plan",
    unavailable: "The prices cannot be loaded right now. You can also find them in the extension, under <b>Choose a plan</b>.",
    rhythm: "Billing rhythm",
    monthly: "Monthly",
    yearly: "Yearly",
    rhythmWord: { month: "monthly", year: "yearly" },
    upTo: "up to −{{saving}}%",
    free: "Free",
    mostReposts: "Most reposts",
    perYear: "a year",
    perMonth: "a month",
    monthlyOnly: "Monthly only",
    aMonth: "{{price}} a month",
    aMonthSaving: "{{price}} a month · save {{saving}}%",
    undo: "Undo",
    pricing: "Fetching the amount…",
    nowLabel: "Now:",
    now: "Now",
    onLabel: "On {{day}}:",
    on: "On {{day}}",
    atRenewal: "At renewal",
    yourCurrentPlan: "your current plan",
    switching: "Your plan is being changed…",
    notForSale: "This plan is no longer offered. Refresh the page for what is on sale now.",
    switchFailed: "That did not work just now. Nothing changed; try again in a moment.",
  },
  account: {
    signInFailed: "Signing in did not work. Please try again.",
    notLoaded: "Your plan could not be loaded. Refresh the page to try again.",
    checkoutNotOpened: "Checkout could not be opened. Try again in a moment.",
    portalNotOpened: "The billing overview could not be opened. Try again in a moment.",
    settling: "Done. It can take a moment for your plan to show here.",
  },
  legal: {
    updated: "Last updated on {{date}}",
  },
} satisfies CatalogOf<typeof nl>;
