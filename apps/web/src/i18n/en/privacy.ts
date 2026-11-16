import type { CatalogOf } from "@mprelist/contracts";

import type { LegalDocument } from "../../public/legal";
import type { privacy as nl } from "../nl/privacy";

/**
 * The privacy page in English (ADR-0043), paragraph for paragraph with the Dutch
 * and of equal standing: no sentence in either says which one governs. Every
 * claim is the Dutch page's, which `../../public/legal.tsx` holds to the code.
 */
export const privacy = {
  title: "Privacy",
  updated: "22 September 2026",
  sections: [
    {
      heading: "What we keep",
      body: [
        "Your email address and an account id from our sign-in service, the plan you are on, and a count of the reposts you have made. That is the whole list.",
      ],
    },
    {
      heading: "What we never see",
      body: [
        "Your Marktplaats password, your Marktplaats session and the content of your ads. Reposting happens entirely in your own browser under your own Marktplaats login — the text and the photos go from Marktplaats to Marktplaats and never reach us. All we receive is the id of an ad you have reposted.",
      ],
    },
    {
      heading: "Payments",
      body: [
        "Your payment details go straight to Stripe, the payment service we use, and to the payment method you choose there. {{brand}} never processes them itself. We keep the customer reference Stripe gives us, so that we know which plan you are on.",
      ],
    },
    {
      heading: "Who else gets it",
      body: ["Nobody. We sell no data, and there is no analytics or advertising code in the extension."],
    },
    {
      heading: "Deleting your account",
      body: [
        "Email us and everything above is deleted. Your Marktplaats ads are left alone — they were never ours.",
      ],
    },
  ],
} satisfies LegalDocument & CatalogOf<typeof nl>;
