/**
 * Core domain types for relisting (see docs/glossary.md, docs/domain-model.md).
 * The POC has no server-side domain; these describe the client-side relist only.
 */

/** A row shown in the popup's "my ads" list. */
export interface ListingSummary {
  id: string;
  title: string;
  priceCents: number;
}

/** A single photo, captured so it can be re-uploaded onto the new ad. */
export interface Photo {
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/** Everything needed to re-create an identical ad. */
export interface ListingDraft {
  itemId: string;
  categoryId: string;
  categoryName: string;
  title: string;
  vipUrl: string;
  sVipUrl: string;
  highestBid: string;
  verticals: string[];
  primaryImageUrl: string;
  viewCount: number;
  closeDate: string;
  editableByUser: boolean;
  reserved: boolean;
  fotoknallerImages?: string[];
  priceCents: number;
  biddingEnabled: boolean;
  minimumBidPriceCents: number;
  upCallPhoneCode: string;
  hasAnyUpsellFeatureCampaignDiscount: boolean;
  urgencyOriginalFee: number;
  urgencyHasDiscount: boolean;
  etalageOriginalFee: number;
  etalageHasDiscount: boolean;
  dagTopper7DaysOriginalFee: number;
  dagTopper7DaysHasDiscount: boolean;
  dagTopperOriginalFee: number;
  dagTopperHasDiscount: boolean;
  phoneUpCallOriginalFee: number;
  phoneUpCallHasDiscount: boolean;
  upCallOriginalFee: number;
  upCallHasDiscount: boolean;
  urlOriginalFee: number;
  urlHasDiscount: boolean;
  dagTopper3DaysOriginalFee: number;
  dagTopper3DaysHasDiscount: boolean;
  extraImagesSnippetOriginalFee: number;
  extraImagesSnippetHasDiscount: boolean;
  urgencyFee: number;
  etalageFee: number;
  dagTopper7DaysFee: number;
  dagTopperFee: number;
  phoneUpCallFee: number;
  upCallFee: number;
  urlFee: number;
  dagTopper3DaysFee: number;
  extraImagesSnippetFee: number;
  urgencyAvailable: boolean;
  etalageAvailable: boolean;
  dagTopper7DaysAvailable: boolean;
  dagTopperAvailable: boolean;
  phoneUpCallAvailable: boolean;
  upCallAvailable: boolean;
  urlAvailable: boolean;
  dagTopper3DaysAvailable: boolean;
  extraImagesSnippetAvailable: boolean;
  packageFreeActive: boolean;
  expiring: boolean;
  durationInDays: number;
  status: string;
  showExtensionLink: boolean;
  extensionFeeForFreeCategory: number;
  extensionPending: boolean;
  nextExtensionPaidNotificationNeeded: boolean;
  microTipText: string | null;
  description: string;
  attributes: Record<string, string>;
  location: string;
}

/** The full capture of an existing ad, ready to be re-created. */
export interface CapturedAd {
  adFeatures: {
    active: boolean;
    discountPercentage: number;
    duration: number;
    effectivePrice: number;
    featureType: string;
    forSale: boolean;
    includedInSubscription: boolean;
    maxReplications: number;
    originalPrice: number;
    productType: string;
    reapplyAfter: number;
  }[],
  adViews: number;
  attributes: {
    attributeType: string;
    key: string;
    label: string;
    value: string;
    values: { key: string, value: string }
  }[],
  buyItNowEnabled: boolean;
  categoryInformation: {
    categoryId: number;
    categoryName: string;
    parentCategoryId: number;
    parentCategoryName: string;
    verticals: string[]
  },
  closeDate: number;
  deliveryMethod: string;
  description: string;
  editable: boolean;
  escrowAllowed: boolean;
  gallery: {
    imageUrls: string[];
  },
  isBuyerProtectionActiveOnListing: boolean;
  isCarAd: boolean;
  isMultiLingual: boolean;
  itemId: string;
  phoneUpcallAllowed: boolean;
  price: {
    biddingEnabled: boolean;
    priceCent: number;
    priceType: string;
  },
  reserved: boolean;
  shippingInformation: {
    augmentedLabels: {
      carrierId: string;
      labels: {
        carrierName: string;
        deliveryMethod: string;
        label: string;
        price: string;
      }[],
    }[],
    selectedShippingOptions: {
      id: string;
      carrierId: string;
      carrierName: string;
      code: string;
      cost: number;
      deliveryMethod: string;
      description: string;
      discountDetails: { discountType: string; originalCost: number };
      label: string;
      mostUsed: boolean;
      serviceType: string;
      termsAndConditionsUrl: string;
      weightInfo: { max: number; min: number; }
    }[]
  },
  shippingServices: {
    code: string;
    priceCent: number;
  }[],
  showTAMSurvey: boolean;
  startDate: number;
  suspended: boolean;
  title: string;
  bucketId: number;
  contactInformation: {
    name: string;
    postcode: string;
  }
}

/**
 * The result of capturing an ad: the ad itself plus its downloaded photos.
 *
 * `CapturedAd` is Marktplaats's own ad representation and carries no photo bytes
 * — the gallery holds URLs, which we fetch separately — so the pair travels
 * together as its own type rather than being pushed into `CapturedAd`.
 */
export interface CapturedListing {
  draft: CapturedAd;
  photos: Photo[];
}

/**
 * How far a relist has progressed. Delete-first (ADR-0003):
 *  - "captured": snapshot saved, the original may or may not be deleted yet.
 *  - "deleted": the original is confirmed gone; only re-create remains.
 */
export type SnapshotPhase = "captured" | "deleted";

/** The durable pre-delete snapshot persisted before anything is removed (ADR-0003). */
export interface AdSnapshot {
  /** id of the original listing being relisted. */
  listingId: string;
  /** The captured ad, re-submitted verbatim to createAd on restore. */
  draft: CapturedAd;
  photos: Photo[];
  phase: SnapshotPhase;
  createdAt: number;
  /**
   * The reservation the backend took when it authorized this relist (T26, #35) —
   * the `jti` its outcome is reported against.
   *
   * It rides in the snapshot because a relist can outlive the worker that started
   * it: an MV3 worker is evicted mid-flight, and the resume hours later is still
   * the same relist and still owes the same reservation an answer. Optional
   * because a snapshot written before this existed has none, and because a resume
   * that needs no fresh grant may have nothing to report against.
   */
  grantJti?: string | null;
}

export interface UploadPhoto {
  id: string;
  extraLargeImageUrl: string;
  imageUrl: string;
  largeImageUrl: string;
  valid: boolean;
}

export interface Bucket {
  id: number;
  name: string;
}

export interface Category {
  id: number;
  name: string;
  parentId: number;
  readOnly: boolean;
  shortName: string;
}

export interface RequestOptions {
  init?: RequestInit;
  listingId?: string; // Kept for backward compatibility
  pathParams?: Record<string, string | number>; // New generic parameter dictionary
  notFoundIsMissing?: boolean;
  queryParams?: Record<string, string | number>
}

export interface CreateAdPageOptions {
  reactData: {
    form: {
      signature: string;
      timestamp: number;
      tmsid: string;
    }

  }
}