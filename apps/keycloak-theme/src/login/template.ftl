<#--
  The shell every page of the sign-in flow is drawn in.

  This is the one template the theme replaces. Everything else — the sign-in form,
  registration, the reset-password chain, the error and info pages — is inherited
  from Keycloak's `base` theme and styled through the `kc…Class` hooks that
  `theme.properties` points at `@mprelist/ui`. Replacing those templates as well
  would be forking Keycloak's authentication screens to change their appearance,
  which is the thing the hooks exist to avoid.

  What is here is therefore layout and nothing else, with two exceptions that are
  both about not lying to the reader:

    * the heading is `properties.brandName`, the product's name from `brand.json`,
      where the base template renders `realm.displayName`. The realm's name is an
      administrator's label — it reads "Marktplaats Relist (development)" on a
      developer's stack — and a page that leads with "Marktplaats" is the one
      thing the Web Store's trademark policy forbids us (see `brand.json`);
    * the `<title>` is built from the page's own heading and the brand, because
      Keycloak's `title` is `msg("loginTitle", realm.displayName)` and carries the
      same label into the tab.

  The head is otherwise Keycloak's, script for script: the session poller, the
  auth-session check, the import map the passkey flows read and the once-only link
  handler are how these pages behave, not how they look, and a theme that quietly
  dropped one would break a flow nobody tests by looking at it.
-->
<#import "theme-resources.ftl" as themeResourceTags>

<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<#-- Rendered twice on purpose: once into the tab's title and once as the page's
     own heading. The section is a message lookup in every template that defines
     one, so asking for it twice costs nothing and keeps the two in step. -->
<#local pageHeading><#nested "header"></#local>
<#-- Captured output is FreeMarker's markup type, so it is already escaped; taken
     back to a string it can be trimmed, and handed back as markup it is not
     escaped a second time. Without it both the tab title and the heading below
     carry the template's own indentation. -->
<#local pageHeading = pageHeading?markup_string?trim?no_esc>
<!DOCTYPE html>
<html lang="${lang}"<#if realm.internationalizationEnabled> dir="${(locale.rtl)?then('rtl','ltr')}"</#if>>

<head>
    <meta charset="utf-8">
    <#-- The base theme has no viewport meta and is unreadable on a phone without
         one. Sign-in opens in a window Chrome sizes, so this is not hypothetical. -->
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${pageHeading} · ${properties.brandName!}</title>
    <link rel="icon" type="image/png" href="${url.resourcesPath}/img/favicon-32.png">
    <#if themeResources?? && themeResources.styles?has_content>
        <@themeResourceTags.renderStyles themeResources.styles url.resourcesPath />
    <#elseif properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if themeResources?? && themeResources.scripts?has_content>
        <@themeResourceTags.renderScripts themeResources.scripts url.resourcesPath "text/javascript" />
    <#elseif properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        <#outputformat "JavaScript">
        import { startSessionPolling } from ${(url.resourcesPath + "/js/authChecker.js")?c};

        startSessionPolling(
            ${url.ssoLoginInOtherTabsUrl?c}
        );
        </#outputformat>
    </script>
    <script type="module">
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a[data-once-link]");

            if (!link) {
                return;
            }

            if (link.getAttribute("aria-disabled") === "true") {
                event.preventDefault();
                return;
            }

            const { disabledClass } = link.dataset;

            if (disabledClass) {
                link.classList.add(...disabledClass.trim().split(/\s+/));
            }

            link.setAttribute("role", "link");
            link.setAttribute("aria-disabled", "true");
        });
    </script>
    <#if authenticationSession??>
        <script type="module">
            <#outputformat "JavaScript">
            import { checkAuthSession } from ${(url.resourcesPath + "/js/authChecker.js")?c};

            checkAuthSession(
                ${authenticationSession.authSessionIdHash?c}
            );
            </#outputformat>
        </script>
    </#if>
</head>

<body class="mp-root login-stage ${bodyClass}" data-page-id="login-${pageId}">
<div class="login-shell">
    <main class="mp-card login-card">
        <div class="login-ribbon" aria-hidden="true"></div>

        <#if realm.internationalizationEnabled && locale.supported?size gt 1>
            <div class="login-locale" id="kc-locale">
                <div id="kc-locale-dropdown" class="menu-button-links">
                    <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                    <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1">
                        <#assign i = 1>
                        <#list locale.supported as l>
                            <li role="none">
                                <a role="menuitem" id="language-${i}" href="${l.url}">${l.label}</a>
                            </li>
                            <#assign i++>
                        </#list>
                    </ul>
                </div>
            </div>
        </#if>

        <header class="login-head">
            <#-- The artwork itself, resized from `brand.json`'s master at build
                 time. `alt` is empty because the product's name is the next
                 element and a screen reader would otherwise read it twice. -->
            <img class="login-mark" alt="" width="48" height="48"
                 src="${url.resourcesPath}/img/logo-48.png"
                 srcset="${url.resourcesPath}/img/logo-48.png 1x, ${url.resourcesPath}/img/logo-96.png 2x">
            <span class="login-brand">${properties.brandName!}</span>
            <p class="login-tagline">${properties.brandTagline!}</p>
        </header>

        <div class="login-body">
            <#if auth?has_content && auth.showUsername() && !auth.showResetCredentials()>
                <#-- Which account this step belongs to, and the way back out of it. -->
                <div id="kc-username" class="login-attempted">
                    <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                    <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">${msg("restartLoginTooltip")}</a>
                </div>
            </#if>

            <h1 id="kc-page-title" class="login-title">${pageHeading}</h1>

            <#if displayRequiredFields>
                <p class="login-required-note"><span class="required">*</span> ${msg("requiredFields")}</p>
            </#if>

            <#-- App-initiated actions should not see warning messages about the need to complete the action
                 during login. The tone is the design system's note modifier, chosen from the same
                 `message.type` the base theme keys its icons off. -->
            <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                <#assign noteTone = { "error": "mp-note--error", "warning": "mp-note--warn", "success": "mp-note--ok" }>
                <div class="mp-note login-alert ${noteTone[message.type]!''}" role="alert">
                    ${kcSanitize(message.summary)?no_esc}
                </div>
            </#if>

            <#nested "form">

            <#if auth?has_content && auth.showTryAnotherWayLink()>
                <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                    <div class="login-options">
                        <input type="hidden" name="tryAnotherWay" value="on"/>
                        <a href="#" id="try-another-way"
                           onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                    </div>
                </form>
            </#if>

            <#if switchOrganizationEnabled?? && switchOrganizationEnabled>
                <form id="kc-switch-organization-form" action="${url.loginAction}" method="post">
                    <div class="login-options">
                        <input type="hidden" name="switchOrganization" value="true"/>
                        <a href="#" id="switch-organization"
                           onclick="document.forms['kc-switch-organization-form'].requestSubmit();return false;">${msg("doSwitchOrganization")}</a>
                    </div>
                </form>
            </#if>

            <#nested "socialProviders">

            <#if displayInfo>
                <div id="kc-info" class="login-aside">
                    <div id="kc-info-wrapper">
                        <#nested "info">
                    </div>
                </div>
            </#if>
        </div>
    </main>

    <#-- Under the card rather than in it: what somebody is agreeing to when they
         make an account, and where to write if this page will not let them in. -->
    <footer class="login-foot">
        <a href="https://${properties.brandDomain!}/privacy">Privacy</a>
        ·
        <a href="https://${properties.brandDomain!}/terms">Voorwaarden</a>
        ·
        <a href="mailto:${properties.brandSupportEmail!}">${properties.brandSupportEmail!}</a>
    </footer>
</div>
</body>
</html>
</#macro>
