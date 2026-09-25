/**
 * The listing, by the id the Store gave the draft (T56). The id never changes, so
 * the link is right from the day the listing is approved, and a `404` until then.
 *
 * Its own module since T85, because the success page now links it too — a buyer
 * who paid on the site may not have installed the extension yet.
 */
export const STORE_URL =
  "https://chromewebstore.google.com/detail/cefnlogjhmeceojlaoionfjpdkklmnaf";
