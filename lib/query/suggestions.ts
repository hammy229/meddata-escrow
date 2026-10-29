// Starter questions for the researcher's query box. Each dataset exposes a few
// numeric and group columns (a subset of the planner's whitelists), and the
// questions are built from them in wording the keyword planner and the privacy
// guard both accept, so a click always runs. (Avoid "age group" in an average
// question: the planner would read "age" as the field.)
import type { GROUP_FIELDS, NUMERIC_FIELDS } from "../ai/nl2query";

interface Columns {
  numeric: readonly (typeof NUMERIC_FIELDS)[number][];
  groups: readonly (typeof GROUP_FIELDS)[number][];
}

const COLUMNS: Record<string, Columns> = {
  ds_cardio_synthea_v1: {
    numeric: ["bmi", "age"],
    groups: ["diagnosis", "sex"],
  },
  ds_diabetes_synthea_v1: {
    numeric: ["value", "bmi"],
    groups: ["year", "sex"],
  },
};

// Unknown datasets still get questions, from the columns every dataset has.
const DEFAULT_COLUMNS: Columns = {
  numeric: ["age", "value"],
  groups: ["sex", "region"],
};

const spoken = (field: string) => field.replace(/_/g, " ");

/** Four aggregate questions that suit the dataset's columns. */
export function suggestQuestions(datasetId: string): string[] {
  const { numeric, groups } = COLUMNS[datasetId] ?? DEFAULT_COLUMNS;
  return [
    "How many patients are in this dataset?",
    `Count of patients by ${spoken(groups[0])}`,
    `Average ${spoken(numeric[0])} by ${spoken(groups[1])}`,
    `What is the highest ${spoken(numeric[1])}?`,
  ];
}
