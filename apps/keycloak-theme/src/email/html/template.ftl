<#--
  The shell every mail this realm sends is drawn in.

  This is the one template the `email` type replaces, and it is the whole of what
  "the mail is ours" can mean structurally: `base/email/html/template.ftl` is a
  macro that emits `<html><body>` and nests the message into it, and the default
  `keycloak` email theme is `parent=base` plus a handful of message overrides. So
  there is nothing here to undo — only a frame to put around what Keycloak sends.

  What it is NOT is the sign-in page's trick one surface over. That page is ours
  because `base/login` writes every control `class="${properties.kcInputClass!}"`
  and a theme decides what those classes are. `base/email` has no such hooks, and
  no stylesheet reaches an inbox — Gmail keeps no `:root` rule and resolves no
  custom property — so this frame is inline declarations, and the body inside it
  is a message bundle of ours. ADR-0035 carries the argument.

  Every value below arrives as a theme property, the same crossing `brandName`
  makes. Nothing in this file is a colour, a size or a name: a committed template
  holding `#1d63ef` would be the copy `brand.json` exists to not have, and one
  holding the product's name would be the copy T48 removed. `src/email/styles.ts`
  derives them from `@mprelist/ui`, rule by rule, against the sheet's own.

  **Tables, and no `<style>` block.** Not nostalgia: Outlook's engine is Word's,
  and a `<style>` is discarded outright by several clients — including Gmail for
  anything it cannot resolve. A table with inline declarations is the one layout
  every client agrees about. The card is `max-width` and has no MSO conditional,
  so Outlook draws it across the reading pane; that is wide rather than broken,
  and a second copy of the layout is not worth one client's proportions.
-->
<#macro emailLayout>
<!DOCTYPE html>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <#-- The mail is drawn from the light half of the palette and says so, which
         is what stops Apple Mail re-colouring it on a reader whose system is
         dark. Gmail and Outlook ignore this and force their own inversion; a
         light card with a coloured button is a well-understood result either
         way, and `BRAND_MARK` is deliberately the same colour in both themes. -->
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
</head>

<body style="${properties.mailBodyStyle!}">
<#-- The stage colour is painted twice on purpose: several clients drop styles on
     `<body>` and render the mail inside a container of their own. -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${properties.mailPageStyle!}">
    <tr>
        <td align="center" style="${properties.mailGutterStyle!}">

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${properties.mailCardStyle!}">
                <#-- The mark's own axis across the top of the card, as on the
                     sign-in page. It carries no text and never will: white on
                     `brand-from` is 1.27:1. The cell needs something in it —
                     an empty one collapses in several clients. -->
                <tr>
                    <td style="${properties.mailRibbonStyle!}">&nbsp;</td>
                </tr>
                <tr>
                    <td style="${properties.mailHeadStyle!}">
                        <#-- The wordmark, and no image. A mail cannot serve a
                             theme resource — there is no `url` in an email
                             template's attributes — so a mark here would be an
                             absolute link to `brandDomain`. That was the
                             objection while `brandDomain` carried a VPS IP
                             address and a sent mail is permanent; T56 retired it
                             on 2026-09-23 and ADR-0035 is amended. What keeps
                             this a wordmark now is scope, not permanence. -->
                        <span style="${properties.mailBrandStyle!}">${properties.brandName!}</span>
                        <p style="${properties.mailTaglineStyle!}">${properties.brandTagline!}</p>
                    </td>
                </tr>
                <tr>
                    <td style="${properties.mailContentStyle!}"><#nested></td>
                </tr>
            </table>

            <#-- Under the card rather than in it, exactly as on the sign-in
                 page: where to read what this account is subject to, and where
                 to write if the mail itself is the problem. -->
            <p style="${properties.mailFootStyle!}">
                <a href="https://${properties.brandDomain!}/privacy" style="${properties.mailFootLinkStyle!}">Privacy</a>
                ·
                <a href="https://${properties.brandDomain!}/terms" style="${properties.mailFootLinkStyle!}">Voorwaarden</a>
                ·
                <a href="mailto:${properties.brandSupportEmail!}" style="${properties.mailFootLinkStyle!}">${properties.brandSupportEmail!}</a>
            </p>

        </td>
    </tr>
</table>
</body>

</html>
</#macro>
