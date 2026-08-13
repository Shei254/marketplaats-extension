import {
  loadEndpointConfig,
  saveEndpointConfig,
  type CsrfConfig,
  type CsrfMode,
  type EndpointConfig,
} from "../shared/endpoint-config";

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function select(id: string): HTMLSelectElement {
  return document.getElementById(id) as HTMLSelectElement;
}

async function init(): Promise<void> {
  const config = await loadEndpointConfig();
  // Endpoints are optional — an unset one renders as an empty field.
  input("listMyAds").value = config.listMyAds ?? "";
  input("captureAd").value = config.captureAd ?? "";
  input("deleteAd").value = config.deleteAd ?? "";
  input("createAd").value = config.createAd ?? "";
  input("uploadPhoto").value = config.uploadPhoto ?? "";
  select("csrfMode").value = config.csrf.mode;
  // Only the meta/cookie variants carry a name; "none" and "fetch" do not.
  input("csrfName").value = "name" in config.csrf ? config.csrf.name : "";
  input("csrfHeader").value = config.csrf.header;
}

/**
 * The form only expresses the none/meta/cookie modes. "fetch" — the mode actually
 * in use — needs a URL and an extractor this page has no fields for, so it is not
 * editable here. That gap is one reason this page is being replaced by
 * backend-served client config (ADR-0013).
 */
function readCsrf(): CsrfConfig {
  const mode = select("csrfMode").value as CsrfMode;
  const header = input("csrfHeader").value.trim();
  const name = input("csrfName").value.trim();
  switch (mode) {
    case "meta":
      return { mode, name, header };
    case "cookie":
      return { mode, name, header };
    default:
      return { mode: "none", header };
  }
}

function readForm(): EndpointConfig {
  return {
    listMyAds: input("listMyAds").value.trim(),
    captureAd: input("captureAd").value.trim(),
    deleteAd: input("deleteAd").value.trim(),
    createAd: input("createAd").value.trim(),
    uploadPhoto: input("uploadPhoto").value.trim(),
    csrf: readCsrf(),
  };
}

(document.getElementById("form") as HTMLFormElement).addEventListener("submit", (event) => {
  event.preventDefault();
  void saveEndpointConfig(readForm()).then(() => {
    const status = document.getElementById("status") as HTMLSpanElement;
    status.textContent = "Saved.";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});

void init();
