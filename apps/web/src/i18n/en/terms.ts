import type { CatalogOf } from "@mprelist/contracts";

import type { LegalDocument } from "../../public/legal";
import type { terms as nl } from "../nl/terms";

/**
 * The terms in English (ADR-0043): the operator's own Gebruiksvoorwaarden,
 * paragraph for paragraph and of equal standing — no sentence in either says
 * which one governs. Drafted here and **reviewed by the operator before it
 * ships**, since whoever publishes it stands behind it.
 *
 * It says what the Dutch says, including where the Dutch does not match this
 * build (a free trial, account settings): `../../public/legal.tsx` records why
 * those were left as written, and an English text that quietly corrected them
 * would make the two documents disagree.
 */
export const terms = {
  title: "Terms of use",
  updated: "22 September 2026",
  sections: [
    {
      heading: "Introduction",
      body: [
        "Welcome to {{brand}}, a browser extension for sellers on Marktplaats. By using our website, you agree to comply with these terms of use, which govern your access to and use of the platform.",
      ],
    },
    {
      heading: "Acceptance of the terms",
      body: [
        "By opening, viewing or using the {{brand}} website and its features, you acknowledge that you have read and understood these terms of use and that you are legally bound by them.",
        "If you do not agree with any part of these terms of use, you may not use or open the website. Your continued use of the {{brand}} website means that you agree to any changes or updates to these terms of use. Consult this document regularly to stay informed of any changes.",
      ],
    },
    {
      heading: "What {{brand}} does",
      body: [
        "{{brand}} deletes one of your Marktplaats ads and places it again straight away, so that it appears at the top of the recent ads again. That is the whole product.",
      ],
    },
    {
      heading: "This deletes your ad, and you need to know that",
      body: [
        "Reposting means the original ad is deleted. {{brand}} first saves every field and every photo and puts them back, but if Marktplaats refuses the new ad, the old one is already gone. Do not repost an ad you cannot afford to lose.",
      ],
    },
    {
      heading: "Registration and user account",
      body: [
        "To access certain features of the {{brand}} website, you may need to create an account by providing a valid email address. By registering, you agree to keep your account details accurate, complete and up to date.",
        "You are responsible for keeping your account details confidential, including your email address and any associated password. You agree not to share your account details with others and not to give others access to your account. Any unauthorised use of your account or any breach of security must be reported to us immediately.",
      ],
    },
    {
      heading: "Intellectual property rights",
      body: [
        "{{brand}} respects the intellectual property rights of others and expects users to do the same. Our website and the content on it, including but not limited to text, images, graphic elements and logos, are the property of {{brand}} or its licensors and are protected by copyright, trademark law and other laws on intellectual property.",
        "By using our website, you agree not to copy, reproduce, distribute or exploit our content, or third-party content available on our website, without the express written permission of {{brand}} or the relevant rights holder.",
      ],
    },
    {
      heading: "Termination and deletion of accounts",
      body: [
        "{{brand}} reserves the right, at its own discretion, to suspend or terminate your access to our website and services without prior notice, for any reason, including but not limited to:",
        [
          "Breach of these terms of use or of applicable laws or regulations;",
          "Providing false, misleading or incorrect information during registration or when creating an account;",
          "Carrying out fraudulent or illegal activities;",
          "Disrupting the operation of our website or services.",
        ],
        "On termination, your right to use our website and services ends immediately, and your account, together with its associated content, may be deleted. {{brand}} is not liable for any damage or loss arising from the termination of your account or the deletion of your content.",
        "If you wish to delete your account voluntarily, you can contact us at {{supportEmail}}. We will then help you with this process. Please note that deleting your account may lead to loss of access to certain features and to the deletion of content linked to your account.",
      ],
    },
    {
      heading: "Disputes and complaints",
      body: [
        "If you have concerns or disputes regarding our website, our services or these terms of use, we encourage you to contact us at {{supportEmail}}. We will do our best to address your concerns and to resolve problems fairly and in good time.",
      ],
    },
    {
      heading: "Disclaimer of warranties and limitation of liability",
      body: [
        "{{brand}} offers its website and services on an “as is” and “as available” basis, without any express or implied warranty, including but not limited to warranties of merchantability, fitness for a particular purpose or non-infringement of third-party rights.",
        "We do not guarantee that our website or services will be error-free, secure or uninterrupted, or that the content will be accurate or complete.",
        "To the maximum extent permitted by law, {{brand}} and its affiliates, officers, directors, employees and agents are not liable for any direct, indirect, incidental, special, consequential or punitive damages, including but not limited to loss of profits, data, use or goodwill, arising from your access to or use of, or inability to access or use, our website or services, whether or not we have been informed of the possibility of such damages.",
      ],
    },
    {
      heading: "Plans and limits",
      body: [
        "Every plan gives a number of reposts per month. Unused reposts do not carry over to the next period.",
        "If a paid plan ends, you go back to the free plan — you are never locked out of your own ads.",
      ],
    },
    {
      heading: "Payment, refunds, upgrades and downgrades",
      body: [
        "For our free trial, we state the length of the trial when you sign up. We do not ask for your credit card details and, as with customers who pay for our services, we do not sell your data.",
        "If you initiate a chargeback with your bank or card issuer, your account is suspended immediately. Access to the service is restored only once the full outstanding amount has been repaid, including any costs incurred as a result of the chargeback.",
        "If you move from a free trial to a paid plan, the amount is charged immediately and your billing cycle starts on the day of the upgrade.",
        "Paying customers are billed automatically per month or per year, depending on the plan chosen. Plans renew automatically at the end of each billing period (monthly or yearly) until they are cancelled. You can cancel your plan at any time through your account settings. The cancellation takes effect at the end of the current billing period.",
        "You can upgrade or downgrade your plan level at any time through your account settings. A downgrade may lead to loss of features or capacity within your account. {{brand}} accepts no responsibility for any such loss.",
        "Amounts paid are not refunded.",
      ],
    },
    {
      heading: "Right of withdrawal (EU consumers)",
      body: [
        "In accordance with European Directive 2011/83/EU on consumer rights, you have a right of withdrawal of 14 days from the date of subscribing, without having to give a reason.",
        "However, when you agree that access to the service starts immediately after you subscribe, you expressly acknowledge that you waive your right of withdrawal. This waiver is confirmed during the payment process and in the order confirmation email.",
        "If you have not agreed to the immediate start of the service, you can exercise your right of withdrawal by contacting us at {{supportEmail}} within 14 days of subscribing.",
      ],
    },
    {
      heading: "Changes to the service and prices",
      body: [
        "We reserve the right to change or discontinue any part of the service, temporarily or permanently, with or without prior notice, at any time and from time to time.",
        "We sometimes change the pricing structure of our products. When we do, we usually exempt existing customers from these changes. We may, however, choose to change prices for existing customers. In that case we will notify you at least 30 days in advance at the email address registered with us.",
        "{{brand}} is not liable to you or to any third party for any change, price change, suspension or termination of the service.",
      ],
    },
    {
      heading: "Your Marktplaats account is yours",
      body: [
        "You are responsible for how you use your own account, including Marktplaats's own terms. {{brand}} spaces out reposts to keep the behaviour reasonable, but cannot promise that Marktplaats will not object to it.",
      ],
    },
    {
      heading: "Relationship with Marktplaats",
      body: [
        "We are not affiliated with or certified by Marktplaats. Marktplaats is a registered trademark of ©Marktplaats. We are not responsible for problems that may arise with Marktplaats or any other third party.",
      ],
    },
    {
      heading: "Changes to the terms of use",
      body: [
        "{{brand}} reserves the right to change or amend these terms of use at any time and at its own discretion. All changes take effect immediately once the updated terms of use are published on our website.",
        "Your continued use of our website and services after changes are published means that you accept the updated terms.",
        "We recommend that you consult these terms of use regularly to stay informed of any updates. If you do not agree with the updated terms, you must stop using our website and services.",
      ],
    },
  ],
} satisfies LegalDocument & CatalogOf<typeof nl>;
