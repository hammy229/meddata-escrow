import { Listing } from "./types";

// Demo catalog. In production these come from DynamoDB.
export const LISTINGS: Listing[] = [
  {
    listing_id: "l1",
    title: "De-identified ICU vitals, 10k patients",
    description:
      "Continuous time-series vital signs (HR, SpO2, BP, respiration) from 10,000 ICU stays. HIPAA de-identified.",
    price: "250.00",
    tags: ["icu", "vitals", "time-series", "critical-care"],
  },
  {
    listing_id: "l2",
    title: "Labeled chest X-ray imaging set",
    description:
      "15,000 chest radiographs with radiologist labels for pneumonia, effusion, and cardiomegaly.",
    price: "500.00",
    tags: ["radiology", "xray", "imaging", "pneumonia"],
  },
  {
    listing_id: "l3",
    title: "Type 2 diabetes longitudinal cohort",
    description:
      "8-year longitudinal records for 5,000 T2D patients: labs, medications, outcomes.",
    price: "400.00",
    tags: ["diabetes", "endocrine", "longitudinal", "labs"],
  },
];

export function getListing(id: string): Listing | undefined {
  return LISTINGS.find((l) => l.listing_id === id);
}
