import {
  loadEndpointConfig,
  saveEndpointConfig,
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
  input("listMyAds").value = config.listMyAds;
  input("captureAd").value = config.captureAd;
  input("deleteAd").value = config.deleteAd;
  input("createAd").value = config.createAd;
  input("uploadPhoto").value = config.uploadPhoto;
  select("csrfMode").value = config.csrf.mode;
  input("csrfName").value = config.csrf.name;
  input("csrfHeader").value = config.csrf.header;
}

function readForm(): EndpointConfig {
  return {
    listMyAds: input("listMyAds").value.trim(),
    captureAd: input("captureAd").value.trim(),
    deleteAd: input("deleteAd").value.trim(),
    createAd: input("createAd").value.trim(),
    uploadPhoto: input("uploadPhoto").value.trim(),
    csrf: {
      mode: select("csrfMode").value as CsrfMode,
      name: input("csrfName").value.trim(),
      header: input("csrfHeader").value.trim(),
    },
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
