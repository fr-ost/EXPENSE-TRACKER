/**
 * Banks and mobile wallets whose SMS alerts Hisab recognises. Detection uses
 * the name in the message first, then a few well-known message shapes for
 * wallets whose alerts never mention their own name.
 */
import type { AccountType } from "@/lib/domain";

export interface Provider {
  id: string;
  name: string;
  kind: Extract<AccountType, "BANK" | "MOBILE_WALLET">;
  /** Matched against the message (case-insensitive). Longer, more specific names come first in the list. */
  pattern: RegExp;
  /** Lower-case fragments that identify this provider in an account name, e.g. "City Bank ••4567". */
  aliases: string[];
}

export const PROVIDERS: Provider[] = [
  // Mobile financial services
  { id: "bkash", name: "bKash", kind: "MOBILE_WALLET", pattern: /\bb[\s-]?kash\b|বিকাশ/i, aliases: ["bkash", "b kash", "বিকাশ"] },
  { id: "nagad", name: "Nagad", kind: "MOBILE_WALLET", pattern: /\bnagad\b|নগদ/i, aliases: ["nagad", "নগদ"] },
  { id: "rocket", name: "Rocket", kind: "MOBILE_WALLET", pattern: /\brocket\b|dbbl\s+mobile\s+banking|রকেট/i, aliases: ["rocket", "রকেট"] },
  { id: "upay", name: "Upay", kind: "MOBILE_WALLET", pattern: /\bupay\b|উপায়/i, aliases: ["upay", "উপায়"] },
  { id: "cellfin", name: "CellFin", kind: "MOBILE_WALLET", pattern: /\bcellfin\b/i, aliases: ["cellfin"] },
  { id: "tap", name: "Tap", kind: "MOBILE_WALLET", pattern: /\btrust\s+axiata\b|\btap\s+(wallet|account)\b/i, aliases: ["tap", "trust axiata"] },
  { id: "okwallet", name: "OK Wallet", kind: "MOBILE_WALLET", pattern: /\bok\s*wallet\b/i, aliases: ["ok wallet", "okwallet"] },
  { id: "surecash", name: "SureCash", kind: "MOBILE_WALLET", pattern: /\bsure\s*cash\b/i, aliases: ["surecash", "sure cash"] },
  { id: "mcash", name: "mCash", kind: "MOBILE_WALLET", pattern: /\bm[\s-]?cash\b/i, aliases: ["mcash", "m-cash"] },

  // Banks (Islamic and "Bank of" names before shorter ones that they contain)
  { id: "sibl", name: "Social Islami Bank", kind: "BANK", pattern: /social\s+islami|\bsibl\b/i, aliases: ["social islami", "sibl"] },
  { id: "fsibl", name: "First Security Islami Bank", kind: "BANK", pattern: /first\s+security|\bfsibl\b/i, aliases: ["first security", "fsibl"] },
  { id: "sjibl", name: "Shahjalal Islami Bank", kind: "BANK", pattern: /shahjalal|\bsjibl\b/i, aliases: ["shahjalal", "sjibl"] },
  { id: "gib", name: "Global Islami Bank", kind: "BANK", pattern: /global\s+islami/i, aliases: ["global islami"] },
  { id: "aibl", name: "Al-Arafah Islami Bank", kind: "BANK", pattern: /al[\s-]?arafah|\baibl\b/i, aliases: ["al-arafah", "al arafah", "alarafah", "aibl"] },
  { id: "ibbl", name: "Islami Bank", kind: "BANK", pattern: /islami\s+bank|\bibbl\b/i, aliases: ["islami bank", "ibbl"] },
  { id: "dbbl", name: "Dutch-Bangla Bank", kind: "BANK", pattern: /dutch[\s-]?bangla|\bdbbl\b/i, aliases: ["dbbl", "dutch-bangla", "dutch bangla"] },
  { id: "city", name: "City Bank", kind: "BANK", pattern: /\bcity\s*bank\b|\bcbl\b|\bcitytouch\b/i, aliases: ["city bank", "citybank", "cbl"] },
  { id: "brac", name: "BRAC Bank", kind: "BANK", pattern: /\bbrac\s*bank\b|\bastha\b/i, aliases: ["brac"] },
  { id: "ebl", name: "Eastern Bank", kind: "BANK", pattern: /eastern\s+bank|\bebl\b/i, aliases: ["ebl", "eastern bank"] },
  { id: "scb", name: "Standard Chartered", kind: "BANK", pattern: /standard\s+chartered|\bscb\b|\bstanchart\b/i, aliases: ["standard chartered", "scb", "stanchart"] },
  { id: "hsbc", name: "HSBC", kind: "BANK", pattern: /\bhsbc\b/i, aliases: ["hsbc"] },
  { id: "citi", name: "Citibank", kind: "BANK", pattern: /\bciti\s*bank\b|\bcitibank\b/i, aliases: ["citibank", "citi bank"] },
  { id: "mtb", name: "Mutual Trust Bank", kind: "BANK", pattern: /mutual\s+trust|\bmtb\b/i, aliases: ["mtb", "mutual trust"] },
  { id: "ucb", name: "UCB", kind: "BANK", pattern: /united\s+commercial|\bucb\b|\bucbl\b/i, aliases: ["ucb", "united commercial"] },
  { id: "prime", name: "Prime Bank", kind: "BANK", pattern: /\bprime\s*bank\b/i, aliases: ["prime"] },
  { id: "pubali", name: "Pubali Bank", kind: "BANK", pattern: /\bpubali\b/i, aliases: ["pubali"] },
  { id: "sonali", name: "Sonali Bank", kind: "BANK", pattern: /\bsonali\b/i, aliases: ["sonali"] },
  { id: "janata", name: "Janata Bank", kind: "BANK", pattern: /\bjanata\b/i, aliases: ["janata"] },
  { id: "agrani", name: "Agrani Bank", kind: "BANK", pattern: /\bagrani\b/i, aliases: ["agrani"] },
  { id: "rupali", name: "Rupali Bank", kind: "BANK", pattern: /\brupali\b/i, aliases: ["rupali"] },
  { id: "bankasia", name: "Bank Asia", kind: "BANK", pattern: /\bbank\s*asia\b/i, aliases: ["bank asia", "bankasia"] },
  { id: "abbank", name: "AB Bank", kind: "BANK", pattern: /\bab\s*bank\b/i, aliases: ["ab bank", "abbank"] },
  { id: "ncc", name: "NCC Bank", kind: "BANK", pattern: /\bncc\s*bank\b|\bnccbl\b/i, aliases: ["ncc"] },
  { id: "southeast", name: "Southeast Bank", kind: "BANK", pattern: /south\s*east\s+bank/i, aliases: ["southeast", "south east"] },
  { id: "onebank", name: "ONE Bank", kind: "BANK", pattern: /\bone\s*bank\b/i, aliases: ["one bank", "onebank"] },
  { id: "trust", name: "Trust Bank", kind: "BANK", pattern: /\btrust\s*bank\b/i, aliases: ["trust bank"] },
  { id: "mercantile", name: "Mercantile Bank", kind: "BANK", pattern: /\bmercantile\b/i, aliases: ["mercantile"] },
  { id: "jamuna", name: "Jamuna Bank", kind: "BANK", pattern: /\bjamuna\s*bank\b/i, aliases: ["jamuna"] },
  { id: "premier", name: "Premier Bank", kind: "BANK", pattern: /\bpremier\s*bank\b/i, aliases: ["premier"] },
  { id: "dhaka", name: "Dhaka Bank", kind: "BANK", pattern: /\bdhaka\s*bank\b/i, aliases: ["dhaka bank"] },
  { id: "ific", name: "IFIC Bank", kind: "BANK", pattern: /\bific\b/i, aliases: ["ific"] },
  { id: "exim", name: "EXIM Bank", kind: "BANK", pattern: /\bexim\b/i, aliases: ["exim"] },
  { id: "uttara", name: "Uttara Bank", kind: "BANK", pattern: /\buttara\s*bank\b/i, aliases: ["uttara"] },
  { id: "midland", name: "Midland Bank", kind: "BANK", pattern: /\bmidland\b/i, aliases: ["midland"] },
  { id: "nrbc", name: "NRBC Bank", kind: "BANK", pattern: /\bnrbc\b/i, aliases: ["nrbc"] },
  { id: "nrb", name: "NRB Bank", kind: "BANK", pattern: /\bnrb\s*bank\b|\bnrbbl\b/i, aliases: ["nrb bank"] },
  { id: "sbac", name: "SBAC Bank", kind: "BANK", pattern: /\bsbac\b|south\s+bangla/i, aliases: ["sbac", "south bangla"] },
  { id: "meghna", name: "Meghna Bank", kind: "BANK", pattern: /\bmeghna\s*bank\b/i, aliases: ["meghna"] },
  { id: "modhumoti", name: "Modhumoti Bank", kind: "BANK", pattern: /\bmodhumoti\b/i, aliases: ["modhumoti"] },
  { id: "community", name: "Community Bank", kind: "BANK", pattern: /\bcommunity\s*bank\b/i, aliases: ["community"] },
  { id: "basic", name: "BASIC Bank", kind: "BANK", pattern: /\bbasic\s*bank\b/i, aliases: ["basic bank"] },
  { id: "padma", name: "Padma Bank", kind: "BANK", pattern: /\bpadma\s*bank\b/i, aliases: ["padma"] },
  { id: "union", name: "Union Bank", kind: "BANK", pattern: /\bunion\s*bank\b/i, aliases: ["union bank"] },
  { id: "bkb", name: "Bangladesh Krishi Bank", kind: "BANK", pattern: /krishi\s+bank|\bbkb\b/i, aliases: ["krishi", "bkb"] },
];

/**
 * Wallets whose alerts don't name themselves, recognised by message shape:
 * bKash ends with "TrxID ABC123XYZ9 at 28/09/2026 14:30", Nagad lists
 * "TxnID: 7A1B2C3D" beside "Balance: Tk", Rocket uses "TxnId:123 Date:28-SEP-26".
 */
const SIGNATURES: Array<{ id: string; pattern: RegExp }> = [
  { id: "bkash", pattern: /\bTrxID\s*:?\s*[A-Z0-9]{8,12}\s+at\s+\d{1,2}\/\d{1,2}\/\d{4}/i },
  { id: "rocket", pattern: /\bTxnId\s*:\s*\d{6,}.{0,40}\bDate\s*:\s*\d{1,2}-[A-Z]{3}-\d{2}/i },
  { id: "nagad", pattern: /\bTxnID\s*:\s*[A-Z0-9]{6,12}\b[\s\S]{0,80}\bBalance\s*:\s*Tk/i },
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * The bank or wallet a message comes from, and any other one it names.
 * "…from City Bank" in a bKash alert names the other side, so names right
 * after from/to/via don't count as the sender; a known message shape wins.
 */
export function detectProviders(text: string): { provider: Provider | null; other: Provider | null } {
  const mentions: Array<{ provider: Provider; index: number; end: number }> = [];
  for (const provider of PROVIDERS) {
    const match = provider.pattern.exec(text);
    if (!match) continue;
    const span = { provider, index: match.index, end: match.index + match[0].length };
    // "Social Islami Bank" must not also count as "Islami Bank".
    if (!mentions.some((m) => span.index < m.end && span.end > m.index)) mentions.push(span);
  }
  mentions.sort((a, b) => a.index - b.index);

  const namesOtherSide = (index: number) =>
    /\b(?:from|to|into|via|with|through)\s+(?:your\s+|the\s+|a\s+)?$/i.test(text.slice(Math.max(0, index - 18), index));
  const signature = SIGNATURES.find((s) => s.pattern.test(text));
  const provider =
    (signature ? providerById(signature.id) : undefined) ??
    mentions.find((m) => !namesOtherSide(m.index))?.provider ??
    null;
  const other = mentions.find((m) => m.provider.id !== provider?.id)?.provider ?? null;
  return { provider, other };
}
