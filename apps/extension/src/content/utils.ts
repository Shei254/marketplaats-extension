import type {CapturedAd, CreateFormAttributes, UploadPhoto} from "../domain/types";

export function buildCreateForm(
    draft: CapturedAd,
    uploadedMedia: UploadPhoto[],
    csrfToken: string,
    formAttributes: CreateFormAttributes,
): URLSearchParams {
    // CRITICAL FIX: Use URLSearchParams for application/x-www-form-urlencoded
    const form = new URLSearchParams();

    uploadedMedia.forEach((media) => {
        form.append("images.ids", media.id);
        form.append("images.urls", media.imageUrl);
    });

    if (uploadedMedia.length) {
        form.append("images.ids", "");
    }

    form.append("title_nl-NL", draft.title || "");
    form.append("description_nl-NL", draft.description || "");

    // MOVED: Placed up here to match the working payload order
    form.append("url", "");
    form.append("url-input", "");

    // An ad in a category with no attributes is an ad with nothing to send here.
    (draft.attributes ?? []).forEach((attr) => {
        if (attr.attributeType == "SINGLE_SELECT") {
            form.append(`singleSelectAttribute[${attr.key}]`, attr.value);
        } else if (attr.attributeType == "MULTI_SELECT") {
            (attr.values ?? []).forEach((val) => {
                form.append(`multiSelectAttribute[${attr.key}]`, val.value);
            });
        } else if (attr.attributeType == "NUMERIC") {
            form.append(`numericAttribute[${attr.key}]`, attr.value);
        } else if (attr.attributeType == "TEXT") {
            form.append(`textAttribute[${attr.key}]`, attr.value);
        }
    });

    if (draft.deliveryMethod) form.append("deliveryMethod", draft.deliveryMethod);

    if (draft.isBuyerProtectionActiveOnListing) {
        form.append("buyerProtectionAllowed", "on");
    }

    const shippingInformation = draft.shippingInformation?.selectedShippingOptions;

    // `?.length`, not truthiness: an ad with no carrier selected arrives as an
    // empty array as readily as a missing field, and `[]` is truthy — which sent
    // an empty `shippingDetails.price` and made the drop-off fallback below
    // unreachable for the exact case it exists for.
    let maxWeight = -1;
    if (shippingInformation?.length) {
        const uniqueShippingInfo = [...new Map(shippingInformation.map((info) => [info.carrierId, info])).values()];
        uniqueShippingInfo.forEach((info) => {
            form.append("shippingMethod", info.carrierId.toLowerCase());
        });

        let minPrice = shippingInformation[0]?.cost || 0;
        const len = shippingInformation.length;

        for (let i = 1; i < len; i++) {
            if (Number(shippingInformation[i]?.cost || 0) < Number(minPrice)) {
                minPrice = shippingInformation[i]?.cost || 0;
            }
        }

        maxWeight = shippingInformation[0]?.weightInfo?.max ?? -1;
        form.append("shippingDetails.price", String(minPrice));
        form.append("shippingDetails.provider", "other");
    } else {
        (draft.shippingInformation?.augmentedLabels ?? []).forEach((label) => {
            if (label.carrierId == null) {
                form.append("shippingMethod", "diy");
                form.append("othersPrice", label.labels?.[0]?.price || "");
            }
        });
    }

    if (maxWeight != -1) {
        if (maxWeight == 2_000) form.append("packageSize", "XS");
        else if (maxWeight == 3_000) form.append("packageSize", "S");
        else if (maxWeight == 10_000) form.append("packageSize", "M");
        else if (maxWeight == 23_000) form.append("packageSize", "L");
    } else {
        form.append("packageSize", "M");
    }

    const dropOffCode = draft.contactInformation?.postcode;
    if (dropOffCode) {
        form.append("dropOffLocationCode", dropOffCode);
    }

    if (draft.price) {
        const priceType = draft.price.priceType;

        // One `Dropdown-prijstype`, and for a minimum-bid ad it is FIXED: the
        // dropdown carries the form's own mode while `price.typeValue` keeps naming
        // the price type. It used to be appended twice, MIN_BID then FIXED.
        form.append("Dropdown-prijstype", priceType === "MIN_BID" ? "FIXED" : priceType);
        form.append("price.typeValue", priceType);

        if (priceType != "FREE" && priceType != "SEE_DESCRIPTION") {
            // `Number(…) > 0` and not truthiness: the capture carries its cents as a
            // **string**, and `"0"` is truthy. Guarding on the raw value sent
            // `price.minimumBidPrice=0,00` for every ad without a floor — a floor the
            // seller never set, posted onto the ad we are re-creating for them.
            if (Number(draft.price.minimumBidPriceCent) > 0) {
                form.append(
                    "price.minimumBidPrice",
                    (Number(draft.price.minimumBidPriceCent) / 100).toLocaleString("nl-NL", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    }),
                );
            }
            if (draft.price.priceCent) {
                form.append(
                    "price.value",
                    (Number(draft.price.priceCent) / 100).toLocaleString("nl-NL", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    }),
                );
            }
        }

        form.append("previousPriceType", "");

        // Always sent, both ways round: the form carries the switch's state rather
        // than its presence, which is what the live payload does.
        if (draft.price.biddingEnabled) {
            form.append("price.biddingEnabled", "on");
        } else {
            form.append("price.biddingEnabled", "off");
        }
    }

    form.append("contactInformation.sellerName", draft.contactInformation.name || "");
    // The switch is sent both ways round, like the bidding one above: the live form
    // carries its state rather than its presence. The number only rides along with a
    // `true`, and only when the capture actually has one — a switch turned on over an
    // empty field is a payload the site refuses, so a capture with no number on file
    // posts the ad without the up-call rather than not at all.
    if (draft.phoneUpcallAllowed && draft.contactInformation.phone) {
        form.append("contactInformation.phoneNumberSwitch", "true");
        form.append("contactInformation.phoneNumber", draft.contactInformation.phone);
    } else {
        form.append("contactInformation.phoneNumberSwitch", "false");
    }
    form.append("syi-address-radio-home", "syi-address-nl");
    form.append("address-index-filter", "syi-address-nl");
    form.append("contactInformation.postCode", draft.contactInformation.postcode || "");
    form.append("bundle-selection", "FREE");
    form.append("selectedBundle", "FREE");

    if (csrfToken) form.append("xsrf.token", csrfToken);

    if (draft.categoryInformation) {
        form.append("l1", String(draft.categoryInformation.parentCategoryId));
        // MOVED: Bucket must be grouped with the category IDs
        form.append("bucket", String(draft.bucketId || 9));
        form.append("l2", String(draft.categoryInformation.categoryId));
        form.append("l2CategoryFullName", draft.categoryInformation.categoryName || "");
    }

    // Reordered to strictly match the working payload's exact sequence
    form.append("tmsid", formAttributes.tmsid);
    form.append("timestamp", String(formAttributes.timestamp));
    form.append("signature", formAttributes.signature);

    return form;
}