// Mirrors public/data/index.json, produced by scripts/build_dataset.py.
// Every number is a percent of requests within the stated filter.

export type Code = "200" | "402" | "403" | "404" | "429";
export type Rates = Record<Code, number>;
export type Groups = { "2xx": number; "3xx": number; "403": number; "402": number; "429": number; other: number };
export type Pair = { "403": number | null; "402": number | null };

export interface Industry {
  name: string;
  agentTrafficShare: number | null;
  lowVolume: boolean;
  agents: Rates;
  trainers: Rates | null;
  agentGroups: Groups;
  trainerGroups: Groups | null;
  shareOfAgent403: number;
  shareOfAgent402: number;
  shareOfAgent429: number;
  /** Monthly agent 403/402 rates; only for the industries with the most agent traffic. */
  monthly: { month: string; "403": number; "402": number }[] | null;
  note: string | null;
  label: { desc: string; source: "linkedin" | "cloudflare"; linkedinName: string | null } | null;
}

export interface Bot {
  name: string;
  trafficShare: number;
  shareOfAgent402: number | null;
  shareOfAgent403: number | null;
  rates: Partial<Rates> | null;
}

export interface Dataset {
  meta: {
    title: string;
    source: string;
    sourceUrl: string;
    unit: string;
    definitions: { agents: string; trainers: string; allBots: string };
    windows: { ytd: { start: string; end: string; label: string }; monthly: { start: string; end: string } };
    updated: string;
    inputFile: string;
    sources: string[];
    radarNotes: { description: string; start: string; end: string }[];
    failedRequests: number;
    monthsPending: string[];
    lowVolumeThresholdPct: number;
    hasIndustryTrends: boolean;
  };
  overall: {
    agents: Rates;
    trainers: Rates;
    agentGroups: Groups;
    trainerGroups: Groups;
    crawlPurpose: Record<string, number>;
    industrySites?: Pair;
  };
  monthly: { month: string; agents: Rates; allBots: Rates; training: Rates | null; industrySites?: Pair | null }[];
  industries: Industry[];
  bots: Bot[];
  verticals402: { name: string; shareOfAgent402: number }[];
  verticals403: { name: string; shareOfAgent403: number }[];
}

export interface Verification {
  verifiedAt: string;
  pull: string;
  recompute: { checked: number; mismatches: number };
  sanity: { checked: number; failures: number };
  crossChecks: Record<string, { n?: number; months?: number; medianAbsDiffPP?: number | null; within1pp?: number; populationFactor?: number; coveredPopulationRate?: number; overallRate?: number }>;
  liveCheck?: { checkedAt: string; results: { window: string; code: string; published: number; requeriedDirect: number | null; independentRoute: number | null; diffPP: number | null }[] };
}
