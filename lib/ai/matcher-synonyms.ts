// A small medical synonym map for the offline matcher.
//
// Researchers describe a population in their own words ("kids with wheezing",
// "Lou Gehrig's disease") and a listing uses clinical ones. Word matching
// cannot bridge that. Each concept here says: if the study contains any of
// these phrases, it means these words in the catalog's vocabulary.
//
// A triggered phrase is REPLACED by its aliases (so the unmatched phrase does
// not drag the score down) and the aliases share one unit of weight (so a
// concept with four aliases does not outvote a plain word). Aliases must be
// words the catalog already uses; a test enforces that.
//
// Provenance, stated plainly: this map was written by the author with the nine
// current listings in mind, after the first retrieval eval showed the paraphrase
// queries failing. The golden-set gain from it is therefore in-sample. The
// held-out set (evals/golden/matcher-heldout.json) was written after this map
// was frozen and is the fairer number. It is not a general medical thesaurus;
// a new listing means new aliases here.
import type { CatalogEntry, DatasetMatch } from "./matcher";
import {
  bm25RankItems,
  mergeItems,
  rawWords,
  stem,
  type QueryItem,
} from "./matcher-bm25";

export interface Concept {
  /** Phrases (lowercase, words only) that trigger the concept. */
  triggers: string[];
  /** Catalog-vocabulary words the concept stands for. */
  aliases: string[];
}

export const CONCEPTS: Concept[] = [
  {
    // ALS
    triggers: [
      "lou gehrig",
      "lou gehrigs",
      "motor neuron disease",
      "motor neurone disease",
      "motoneuron disease",
      "mnd",
      "charcot disease",
    ],
    aliases: ["als", "amyotrophic", "lateral", "sclerosis"],
  },
  {
    triggers: [
      "neurodegenerative",
      "neurodegeneration",
      "neuromuscular",
      "muscle weakness",
      "muscle wasting",
    ],
    aliases: ["als", "neurology"],
  },
  {
    triggers: ["forced vital capacity", "vital capacity"],
    aliases: ["fvc"],
  },
  {
    triggers: ["mortality", "time to death", "lifespan", "life expectancy"],
    aliases: ["survival", "death"],
  },
  {
    // heart failure and readmission
    triggers: ["congestive heart failure", "chf", "cardiac failure"],
    aliases: ["heart", "failure"],
  },
  {
    triggers: [
      "hospital return",
      "hospital returns",
      "returned to hospital",
      "back to hospital",
      "bounced back to hospital",
      "bounce back",
      "bounced back",
      "rehospitalization",
      "rehospitalisation",
      "readmitted",
    ],
    aliases: ["readmission", "hospital"],
  },
  {
    // cardiology
    triggers: [
      "heart attack",
      "myocardial infarction",
      "coronary",
      "angina",
      "atherosclerosis",
      "cardiac",
      "heart disease",
    ],
    aliases: ["cardiology", "cardiovascular"],
  },
  {
    // hypertension
    triggers: [
      "high blood pressure",
      "elevated blood pressure",
      "hypertensive",
      "htn",
    ],
    aliases: ["hypertension", "blood", "pressure"],
  },
  {
    // diabetes
    triggers: [
      "blood sugar",
      "blood glucose",
      "glucose",
      "glycemic",
      "glycaemic",
      "insulin",
      "hyperglycemia",
      "diabetic",
      "diabetics",
      "t2dm",
      "t2d",
      "type two",
    ],
    aliases: ["diabetes", "hba1c", "endocrinology"],
  },
  {
    triggers: ["a1c"],
    aliases: ["hba1c"],
  },
  {
    // asthma and children
    triggers: [
      "wheezing",
      "wheeze",
      "wheezy",
      "rescue inhaler",
      "rescue inhalers",
      "bronchospasm",
      "breathing problems",
    ],
    aliases: ["asthma", "respiratory"],
  },
  {
    triggers: [
      "kids",
      "kid",
      "children",
      "child",
      "childhood",
      "infants",
      "adolescent",
      "adolescents",
      "paediatric",
    ],
    aliases: ["pediatric"],
  },
  {
    // COPD and general lung
    triggers: [
      "emphysema",
      "chronic bronchitis",
      "smoker",
      "smokers",
      "smoking",
      "airflow obstruction",
    ],
    aliases: ["copd", "pulmonary", "respiratory"],
  },
  {
    triggers: ["lung disease", "lung function", "lung", "lungs", "airway"],
    aliases: ["respiratory", "pulmonology"],
  },
  {
    triggers: ["drug", "drugs", "pharmacotherapy", "prescribed"],
    aliases: ["medication", "prescription"],
  },
];

/** Lowercase, possessives and punctuation removed, padded with single spaces. */
function normalize(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .match(/[a-z0-9]+/g);
  return ` ${(words ?? []).join(" ")} `;
}

// Longest triggers first, so "high blood pressure" wins over "blood pressure".
const TRIGGERS = CONCEPTS.flatMap((concept) =>
  concept.triggers.map((t) => ({ phrase: normalize(t), concept })),
).sort((a, b) => b.phrase.length - a.phrase.length);

/** Query items with every known phrase translated into catalog words. */
export function synonymItems(query: string): QueryItem[] {
  let text = normalize(query);
  const items: QueryItem[] = [];
  const fired = new Set<Concept>();
  for (const { phrase, concept } of TRIGGERS) {
    if (!text.includes(phrase)) continue;
    text = text.split(phrase).join(" ");
    // A concept counts once, however many of its phrases the study uses.
    if (fired.has(concept)) continue;
    fired.add(concept);
    const aliases = [...new Set(concept.aliases.map((a) => stem(a)))];
    for (const a of aliases) {
      items.push({
        stem: a,
        weight: 1 / aliases.length,
        label: phrase.trim(),
      });
    }
  }
  for (const w of rawWords(text)) {
    items.push({ stem: stem(w), weight: 1, label: w });
  }
  return mergeItems(items);
}

/** BM25 over the translated query (see ./matcher-bm25). */
export function synonymRank(
  query: string,
  catalog: CatalogEntry[],
): DatasetMatch[] {
  return bm25RankItems(synonymItems(query), catalog);
}
