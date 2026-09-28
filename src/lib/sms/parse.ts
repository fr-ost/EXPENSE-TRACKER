/**
 * Reads bank and mobile-wallet SMS alerts: amount, direction (money in or
 * out), bank or wallet, account digits, date and time, fee, balance and who
 * the money went to or came from.
 *
 * Pure and dependency-free so it runs instantly in the browser as you paste.
 * Everything it returns is a suggestion; nothing is saved until the entries
 * built from it (see suggest.ts) pass the normal transaction validation.
 */
import { addDays, isValidISODate, makeISODate, parseISODate, type ISODate } from "@/lib/dates";
import { normalizeMoney, toMinor, type Money } from "@/lib/money";
import { detectProviders, type Provider } from "./providers";

export type SmsDirection = "debit" | "credit";

export type SmsChannel =
  | "atm"
  | "cash_out"
  | "cash_in"
  | "add_money"
  | "salary"
  | "refund"
  | "cashback"
  | "remittance"
  | "interest"
  | "recharge"
  | "bill"
  | "send_money"
  | "payment"
  | "transfer"
  | "deposit"
  | "received"
  | "debited"
  | "unknown";

/** Why a message won't become a transaction. */
export type SmsIgnoreReason = "otp" | "promo" | "failed" | "reminder" | "no_amount";

export const IGNORE_REASON_LABELS: Record<SmsIgnoreReason, string> = {
  otp: "Verification code — not a transaction",
  promo: "Looks like an offer or advert",
  failed: "The transaction failed or was declined",
  reminder: "A reminder or statement, not a completed transaction",
  no_amount: "No transaction amount found",
};

export interface ParsedSms {
  /** The message as given (trimmed). */
  text: string;
  direction: SmsDirection | null;
  channel: SmsChannel;
  amount: Money | null;
  /** ISO code, e.g. "BDT". */
  currency: string | null;
  fee: Money | null;
  /** Balance or available limit reported after the transaction. */
  balance: Money | null;
  provider: Provider | null;
  /** Another bank or wallet named in the message (e.g. "from City Bank" in a bKash alert). */
  otherProvider: Provider | null;
  /** Last digits of your account or card, when the message shows them. */
  accountDigits: string | null;
  /** Last digits of the other side's account (e.g. a fund transfer between your own accounts). */
  counterpartyDigits: string | null;
  isCard: boolean;
  date: ISODate | null;
  /** "HH:MM", 24-hour. */
  time: string | null;
  counterparty: string | null;
  reference: string | null;
  /** Suggested description, e.g. "Sent to 01712345678" or "Daraz". */
  description: string;
  /** Category names to try, best first (matched case-insensitively against yours). */
  categoryHints: string[];
  ignored: SmsIgnoreReason | null;
  confidence: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bengali digits to ASCII, odd spaces to plain ones, line endings unified. */
export function normalizeSmsText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)))
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

const CURRENCY_ALIASES: Array<[string, string]> = [
  ["৳", "BDT"],
  ["tk.", "BDT"],
  ["tk", "BDT"],
  ["taka", "BDT"],
  ["bdt", "BDT"],
  ["টাকা", "BDT"],
  ["us$", "USD"],
  ["usd", "USD"],
  ["$", "USD"],
  ["inr", "INR"],
  ["rs.", "INR"],
  ["rs", "INR"],
  ["₹", "INR"],
  ["eur", "EUR"],
  ["€", "EUR"],
  ["gbp", "GBP"],
  ["£", "GBP"],
  ["aed", "AED"],
  ["sar", "SAR"],
  ["myr", "MYR"],
  ["sgd", "SGD"],
  ["cad", "CAD"],
  ["aud", "AUD"],
  ["pkr", "PKR"],
];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CURRENCY = `(?<![A-Za-z])(?:${CURRENCY_ALIASES.map(([alias]) => escape(alias)).join("|")})(?![A-Za-z])`;
const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?!\d)|\d+(?:\.\d{1,2})?(?!\d)`;
/** "Tk 1,250.00", "BDT500", "Tk.20", "৳ 45" */
const CURRENCY_FIRST = new RegExp(`(${CURRENCY})\\s*[:.]?\\s*(${NUMBER})`, "gi");
/** "500.00 BDT", "২৫০ টাকা", "1,000 Taka" (codes and words only; "500 $" isn't a thing) */
const CURRENCY_LAST = new RegExp(`(${NUMBER})\\s*(?:\\/-)?\\s*((?<![A-Za-z])(?:bdt|taka|টাকা|tk|usd|inr|eur|gbp|aed|sar|myr|sgd|cad|aud|pkr)(?![A-Za-z]))`, "gi");

function currencyCode(token: string): string {
  const lower = token.toLowerCase();
  return CURRENCY_ALIASES.find(([alias]) => alias === lower)?.[1] ?? "BDT";
}

type AmountLabel = "amount" | "balance" | "fee" | "cashback" | "due";

interface AmountMatch {
  value: Money;
  currency: string;
  index: number;
  end: number;
  label: AmountLabel;
}

/** Words right before an amount that say what it is. */
const LABELS: Array<[RegExp, AmountLabel]> = [
  [/(?:\bbal(?:ance)?|\bavl\.?\s*bal\w*|ব্যালেন্স|\b(?:available|avl\.?|credit)\s+limit|\blimit)\s*(?:is|was|of|now)?\s*[:=-]?\s*$/i, "balance"],
  [/\b(?:fee|fees|charge|charges|service\s+charge|vat|commission)\s*(?:is|of|amount)?\s*[:=-]?\s*$/i, "fee"],
  [/\bcash\s*-?back\s*(?:of)?\s*[:=-]?\s*$/i, "cashback"],
  [/\b(?:due|payable|outstanding|min(?:imum)?\.?\s*(?:amount\s*)?due)\s*(?:is|of)?\s*[:=-]?\s*$/i, "due"],
];

function labelBefore(text: string, index: number): AmountLabel {
  const window = text.slice(Math.max(0, index - 36), index);
  // Only the current clause counts ("… successful. Balance Tk 12" labels 12, not the first amount).
  const clause = window.split(/[\n;]|[.,](?!\d)/).pop() ?? "";
  for (const [pattern, label] of LABELS) if (pattern.test(clause)) return label;
  return "amount";
}

function toMoney(raw: string): Money | null {
  const cleaned = raw.replace(/,/g, "");
  try {
    return normalizeMoney(cleaned);
  } catch {
    return null;
  }
}

function findAmounts(text: string): AmountMatch[] {
  const found: AmountMatch[] = [];
  const add = (index: number, end: number, rawNumber: string, currencyToken: string, labelIndex: number) => {
    const value = toMoney(rawNumber);
    if (!value || found.some((m) => index < m.end && end > m.index)) return;
    found.push({ value, currency: currencyCode(currencyToken), index, end, label: labelBefore(text, labelIndex) });
  };
  for (const match of text.matchAll(CURRENCY_FIRST)) {
    add(match.index, match.index + match[0].length, match[2], match[1], match.index);
  }
  for (const match of text.matchAll(CURRENCY_LAST)) {
    add(match.index, match.index + match[0].length, match[1], match[2], match.index);
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Amount without a currency, e.g. "debited by 500.00" or "Amount: 500". */
const UNANCHORED_AMOUNT =
  /\b(?:amount|amt|debited\s+(?:by|with|for)|credited\s+(?:by|with)|withdrawn|deposited|paid|received|sent)\s*(?:of)?\s*[:=-]?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d:/-])/i;

// ---------------------------------------------------------------------------
// Direction and channel
// ---------------------------------------------------------------------------

const DIRECTION_RULES: Array<{ pattern: RegExp; direction: SmsDirection; weight: number }> = [
  { pattern: /\b(?:has|have)\s+been\s+debited\b|\bis\s+debited\b|\bdebited\s+(?:by|with|for|from)\b/gi, direction: "debit", weight: 5 },
  { pattern: /\b(?:has|have)\s+been\s+credited\b|\bis\s+credited\b|\bcredited\s+(?:by|with|to|into|in)\b/gi, direction: "credit", weight: 5 },
  { pattern: /\bdebited\b|\bdebit\s+alert\b/gi, direction: "debit", weight: 3 },
  { pattern: /\bcredited\b|\bcredit\s+alert\b/gi, direction: "credit", weight: 3 },
  { pattern: /\bcash\s*-?\s*out\b/gi, direction: "debit", weight: 4 },
  { pattern: /\bcash\s*-?\s*in\b/gi, direction: "credit", weight: 4 },
  { pattern: /\b(?:you\s+have\s+)?received\b|\bmoney\s+received\b/gi, direction: "credit", weight: 3 },
  { pattern: /\bsend\s+money\b|\byou\s+have\s+sent\b|\bsent\b/gi, direction: "debit", weight: 3 },
  { pattern: /\bwithdrawn\b|\bwithdrawal\b|\bwithdraw\b/gi, direction: "debit", weight: 3 },
  { pattern: /\bpurchase[ds]?\b|\bspent\b|\bpos\b|\bcharged\b|\bused\s+(?:for|at)\b/gi, direction: "debit", weight: 3 },
  { pattern: /\bpayment\b|\bpaid\b|\bbill\s+pay(?:ment)?\b|\bbiller\b/gi, direction: "debit", weight: 2 },
  { pattern: /\b(?:got|received|earned|won)\b(?:[^.\n]|\.\d){0,30}\bcash\s*-?\s*back\b/gi, direction: "credit", weight: 5 },
  { pattern: /\bdeposit(?:ed)?\b/gi, direction: "credit", weight: 3 },
  { pattern: /\brefund(?:ed)?\b|\breversal\b|\breversed\b/gi, direction: "credit", weight: 3 },
  { pattern: /\badd(?:ed)?\s+money\b|\badded\s+to\b/gi, direction: "credit", weight: 3 },
  { pattern: /\bsalary\b|\bremittance\b|\binterest\b|\bprofit\s+(?:paid|credited)\b/gi, direction: "credit", weight: 2 },
  { pattern: /\brecharge[ds]?\b|\btop\s*-?\s*up\b|\bflexiload\b/gi, direction: "debit", weight: 2 },
  { pattern: /\bcash\s*-?\s*back\b/gi, direction: "credit", weight: 1 },
  { pattern: /\bfrom\s+(?:your|ur)\s+(?:a\/c|acc(?:oun)?t|card|wallet)\b/gi, direction: "debit", weight: 3 },
  { pattern: /\b(?:to|into|in)\s+(?:your|ur)\s+(?:a\/c|acc(?:oun)?t|card|wallet)\b/gi, direction: "credit", weight: 3 },
  { pattern: /\binward\b|\bincoming\b/gi, direction: "credit", weight: 2 },
  { pattern: /\boutward\b|\boutgoing\b/gi, direction: "debit", weight: 2 },
  { pattern: /(?<![A-Za-z])(?:dr)(?![A-Za-z])\.?/g, direction: "debit", weight: 2 },
  { pattern: /(?<![A-Za-z])(?:cr)(?![A-Za-z])\.?/g, direction: "credit", weight: 2 },
  { pattern: /জমা|পেয়েছেন|পেয়েছেন|প্রাপ্ত|গ্রহণ করেছেন|ক্রেডিট/g, direction: "credit", weight: 3 },
  { pattern: /উত্তোলন|খরচ|পরিশোধ|পাঠানো|পাঠিয়েছেন|পাঠিয়েছেন|কর্তন|ডেবিট/g, direction: "debit", weight: 3 },
];

function detectDirection(text: string, amountIndex: number): { direction: SmsDirection | null; margin: number } {
  let debit = 0;
  let credit = 0;
  for (const rule of DIRECTION_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      // Keywords close to the amount say more than ones in a trailing sentence.
      const near = amountIndex < 0 || Math.abs(match.index - amountIndex) <= 60;
      const score = rule.weight * (near ? 1.5 : 1);
      if (rule.direction === "debit") debit += score;
      else credit += score;
    }
  }
  if (debit === credit) return { direction: null, margin: 0 };
  return { direction: debit > credit ? "debit" : "credit", margin: Math.abs(debit - credit) };
}

const CHANNEL_RULES: Array<[RegExp, SmsChannel]> = [
  [/\batm\b|cash\s+withdrawal/i, "atm"],
  [/\bcash\s*-?\s*out\b/i, "cash_out"],
  [/\bcash\s*-?\s*in\b/i, "cash_in"],
  [/\badd(?:ed)?\s+money\b|\bi-?banking\b|internet\s+banking|\b(?:bank|card)\s+to\s+(?:bkash|nagad|rocket|upay|wallet)\b/i, "add_money"],
  [/\bsalary\b|\bpayroll\b/i, "salary"],
  [/\brefund(?:ed)?\b|\breversal\b|\breversed\b/i, "refund"],
  [/\bremittance\b|\bwage\s+earner\b/i, "remittance"],
  [/\binterest\b|\bprofit\s+(?:paid|credited)\b|\bmudaraba\s+profit\b/i, "interest"],
  [/\b(?:got|received|earned|won)\b(?:[^.\n]|\.\d){0,30}\bcash\s*-?\s*back\b|\bcash\s*-?\s*back\b(?:[^.\n]|\.\d){0,30}\b(?:credited|added)\b/i, "cashback"],
  [/\brecharge[ds]?\b|\btop\s*-?\s*up\b|\bairtime\b|\bflexiload\b/i, "recharge"],
  [/\bbill\b|\butility\b|\bdesco\b|\bdpdc\b|\bwasa\b|\btitas\b|\bnesco\b|\bpalli\s+bidyut\b|\belectricity\b/i, "bill"],
  [/\bsend\s+money\b|\bsent\s+to\b|\byou\s+have\s+sent\b|\bmoney\s+sent\b/i, "send_money"],
  [/\bpayment\b|\bpaid\b|\bpurchase[ds]?\b|\bpos\b|\bmerchant\b|\bused\s+(?:for|at)\b|\bspent\b|\bcharged\b|\be-?commerce\b/i, "payment"],
  [/\bcash\s*-?\s*back\b/i, "cashback"],
  [/\btransfer(?:red)?\b|\bnpsb\b|\bbeftn\b|\brtgs\b|\bfund\s+trf\b|\btrf\b/i, "transfer"],
  [/\bdeposit(?:ed)?\b/i, "deposit"],
  [/\breceived\b|\bcredited\b|\bdeposit(?:ed)?\b|জমা|পেয়েছেন|পেয়েছেন|ক্রেডিট/i, "received"],
  [/\bdebited\b|\bwithdrawn\b|উত্তোলন|খরচ|পরিশোধ|ডেবিট|কর্তন/i, "debited"],
];

function detectChannel(text: string): SmsChannel {
  for (const [pattern, channel] of CHANNEL_RULES) if (pattern.test(text)) return channel;
  return "unknown";
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?`;

const DATE_PATTERNS: Array<{ pattern: RegExp; read: (m: RegExpExecArray) => { y: number | null; m: number; d: number; numeric?: boolean } }> = [
  // 2026-09-28
  { pattern: /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/, read: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  // 28/09/2026, 28-09-26, 28.09.2026 (day first, as banks in Bangladesh write it)
  { pattern: /(?<!\d|\d[.,])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d|[.,]\d)/, read: (m) => ({ y: +m[3], m: +m[2], d: +m[1], numeric: true }) },
  // 28-SEP-26, 28 Sep 2026, 28SEP2026, 28th September
  { pattern: new RegExp(String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*${MONTH}(?:[\s\-/.,']*(\d{4}|\d{2}))?(?![\d:])`, "i"), read: (m) => ({ y: m[3] ? +m[3] : null, m: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, d: +m[1] }) },
  // Sep 28, 2026
  { pattern: new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, "i"), read: (m) => ({ y: +m[3], m: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, d: +m[2] }) },
];

function resolveYear(y: number | null, month: number, day: number, today: ISODate): number {
  const current = parseISODate(today).year;
  if (y === null) {
    // No year: the most recent such date that isn't in the future.
    const candidate = makeISODate(current, month, day);
    return candidate > addDays(today, 1) ? current - 1 : current;
  }
  return y < 100 ? 2000 + y : y;
}

function findDate(text: string, today: ISODate): ISODate | null {
  for (const { pattern, read } of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    let { y, m, d } = read(match);
    const { numeric } = read(match);
    // 09/28/2026 can only be month-first.
    if (numeric && m > 12 && d <= 12) [m, d] = [d, m];
    if (m < 1 || m > 12) continue;
    const year = resolveYear(y, m, d, today);
    y = year;
    const date = makeISODate(y, m, d);
    if (isValidISODate(date)) return date;
  }
  return null;
}

const TIME = /(?<![\d:.])([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.]([0-5]\d))?(?:\s*([ap])\.?\s*m\.?\b)?(?![\d:])/gi;

function findTime(text: string): string | null {
  for (const match of text.matchAll(TIME)) {
    const separator = match[0].includes(":") ? ":" : ".";
    // "14.30" only counts with am/pm or right after "at"; otherwise it's probably an amount.
    if (separator === "." && !match[4] && !/\bat\s*$/i.test(text.slice(Math.max(0, match.index - 4), match.index))) continue;
    let hour = Number(match[1]);
    const minute = match[2];
    const meridiem = match[4]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) continue;
      if (meridiem === "p" && hour !== 12) hour += 12;
      if (meridiem === "a" && hour === 12) hour = 0;
    }
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Accounts, references, counterparties
// ---------------------------------------------------------------------------

const ACCOUNT_REF =
  /\b(?:a\/c|acc(?:oun)?t|card)\.?\s*(?:no\.?|number|#)?\s*(?:ending\s*(?:with|in)?\s*)?[:#-]?\s*([0-9Xx*•.\-]{0,20}?)(\d{3,4})(?![\dXx*•]|[.\-][\dXx*•])/gi;
const CARD_ENDING = /\bending\s*(?:with|in)?\s*[:#-]?\s*[Xx*•]*(\d{3,4})(?!\d)/i;

function findAccountDigits(text: string, walletAlert: boolean): { own: string | null; other: string | null } {
  let own: string | null = null;
  let other: string | null = null;
  for (const match of text.matchAll(ACCOUNT_REF)) {
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    const yours = /\byour\s*$/i.test(before) || /\b(?:debited|credited|withdrawn|deposited|charged|deducted)\s+(?:from|to|into|in)\s*$/i.test(before);
    const theirs = !yours && /\b(?:from|to|sender|receiver|beneficiary)\s*$/i.test(before);
    // A full mobile number after "A/C" is the other party's wallet, not a masked account.
    const full = `${match[1]}${match[2]}`.replace(/[^0-9]/g, "");
    if (theirs || /^01\d{9}$/.test(full)) other ??= match[2];
    // Wallet alerts only show your own number as "your A/C"; other numbers are billers' customer ids.
    else if (!walletAlert || yours) own ??= match[2];
  }
  own ??= CARD_ENDING.exec(text)?.[1] ?? null;
  return { own, other };
}

const REFERENCE =
  /\b(?:trx\s*id|txn\s*id|trxid|txnid|tran(?:s(?:action)?)?\s*id|ref(?:erence)?\s*(?:no|number|#)|rrn|approval\s*code)\.?\s*[:#-]?\s*([A-Z0-9]{5,24})\b/i;

const PHONE = /(?:\+?88)?01[3-9]\d{8}\b/;

/** Words that end a name ("Daraz on 28 Sep", "01712345678 successful"). */
const NAME_END = String.raw`(?=\s*(?:\(|\)|,|;|\n|\.(?:\s|$)|$|\s+(?:on|at|is|was|has|successful(?:ly)?|ref|txn|trx|trxid|txnid|fee|bal|balance|avl|available|limit|via|from|for|with|dated|date)\b))`;
const NAME = String.raw`([A-Za-z0-9+][A-Za-z0-9&@.'’\-/ ]{0,48}?)`;

const COUNTERPARTY_PATTERNS: Array<{ pattern: RegExp; role: "to" | "from" | "at" | "label" }> = [
  { pattern: new RegExp(String.raw`\b(?:merchant|receiver|recipient|payee|beneficiary|biller|sender|agent)(?:\s+name)?\s*[:-]\s*${NAME}${NAME_END}`, "i"), role: "label" },
  { pattern: new RegExp(String.raw`(?:\b(?:at|pos(?:\s+purchase)?(?:\s+at)?)\s+|\bpos\s*[/:-]\s*|@\s+)${NAME}${NAME_END}`, "i"), role: "at" },
  { pattern: new RegExp(String.raw`\bto\s+(?:a\/c\s*[:#]?\s*)?${NAME}${NAME_END}`, "i"), role: "to" },
  { pattern: new RegExp(String.raw`\bfrom\s+(?:a\/c\s*[:#]?\s*)?${NAME}${NAME_END}`, "i"), role: "from" },
];

const NOT_A_NAME = /^(?:your|ur|you|the|a\/c|acc(?:oun)?t|card|wallet|bank|atm|agent|mobile|account|tk|bdt|taka)\b|^\d{1,2}[/.:-]\d{1,2}|^\d{1,2}\s*(?:am|pm)\b|^\d{1,2}(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/** "DARAZ BD" → "Daraz BD", "NETFLIX.COM" → "netflix.com"; short words stay as written (KFC, BD). */
function tidyName(name: string): string {
  const cleaned = name
    .replace(/\s+/g, " ")
    .replace(/[\s.,:;'’\-/]+$/, "")
    .replace(/^[\s.,:;'’\-/]+/, "")
    .trim();
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|bd|xyz)$/i.test(cleaned)) return cleaned.toLowerCase();
  if (cleaned !== cleaned.toUpperCase() || !/[A-Z]/.test(cleaned)) return cleaned;
  return cleaned.replace(/[A-Z][A-Z]{3,}/g, (word) => word[0] + word.slice(1).toLowerCase());
}

function findCounterparty(text: string, direction: SmsDirection | null): string | null {
  for (const { pattern, role } of COUNTERPARTY_PATTERNS) {
    if (direction === "credit" && role === "to") continue;
    if (direction === "debit" && role === "from") continue;
    const match = pattern.exec(text);
    if (!match) continue;
    const name = tidyName(match[1]);
    if (name.length < 2 || NOT_A_NAME.test(name) || !/[A-Za-z]/.test(name) && !PHONE.test(name)) continue;
    const phone = PHONE.exec(name);
    return phone && name.replace(/[^0-9]/g, "").length >= 11 ? phone[0].replace(/^\+?88/, "") : name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Messages that aren't transactions
// ---------------------------------------------------------------------------

const OTP = /\b(?:otp|one[\s-]?time\s*(?:pass(?:word|code)?|pin|code)|verification\s*code|security\s*code|passcode|auth(?:entication)?\s*code)\b/i;
const FAILED = /\b(?:failed|unsuccessful|declined|insufficient|not\s+successful|could\s*n[o']t|rejected|unable\s+to)\b/i;
const REMINDER =
  /\b(?:will\s+be\s+(?:debited|deducted|charged|credited)|due\s+date|payment\s+due|min(?:imum)?\.?\s*(?:amount\s*)?due|total\s+due|statement|upcoming|reminder|pay\s+by|is\s+due|please\s+pay)\b/i;
const PROMO_MARKERS =
  /\b(?:offer|discount|win|lucky|campaign|avail|enjoy|promo|coupon|voucher|click|download|hurry|register|subscribe|t&c|conditions\s+apply|get\s+up\s+to|up\s+to\s+\d+%|\d+%\s*(?:off|cash\s*back|discount))\b|https?:\/\/|www\.|\.com\/|dial\s*\*/gi;
const COMPLETED =
  /\b(?:debited|credited|received|you\s+have\s+sent|send\s+money|cash\s*-?\s*(?:out|in)|withdrawn|trx\s*id|txn\s*id|trxid|txnid|purchase\s+of|spent|charged|payment\s+(?:of\s+)?(?:tk|bdt)?\s*[\d,.]+[^.]{0,40}successful)\b/i;

function ignoreReason(text: string, hasAmount: boolean): SmsIgnoreReason | null {
  if (OTP.test(text)) return "otp";
  if (FAILED.test(text) && !/\brefund|\breversed|\bcredited\b/i.test(text)) return "failed";
  if (REMINDER.test(text) && !/\b(?:has|have)\s+been\s+(?:debited|credited)\b/i.test(text)) return "reminder";
  const promoMarkers = text.match(PROMO_MARKERS)?.length ?? 0;
  if (promoMarkers >= 2 && !COMPLETED.test(text)) return "promo";
  if (!hasAmount) return "no_amount";
  return null;
}

// ---------------------------------------------------------------------------
// Descriptions and categories
// ---------------------------------------------------------------------------

const MERCHANT_CATEGORIES: Array<[RegExp, string[]]> = [
  [/food\s*panda|pathao\s*food|hungry\s*naki|\bkfc\b|pizza|burger|restaurant|\bcafe\b|coffee|bakery|sweets|biryani|kacchi|chillox|domino|mcdonald|star\s*kabab|dine/i, ["Food", "Dining", "Restaurants"]],
  [/chaldal|shwapno|swapno|\bagora\b|meena\s*bazar|unimart|super\s*shop|grocer/i, ["Groceries", "Food"]],
  [/\buber\b|pathao|obhai|shohoz|\bbus\b|railway|\btrain\b|biman|us-?bangla|novoair|air\s*astra|\bfuel\b|petrol|octane|\bcng\b|parking|\btoll\b|metro\s*rail|rapid\s*pass/i, ["Transport"]],
  [/netflix|spotify|youtube|google|apple\.com|itunes|icloud|openai|chatgpt|microsoft|adobe|canva|hoichoi|chorki|\bbongo\b|prime\s*video|disney|github|notion|patreon/i, ["Subscriptions"]],
  [/daraz|aarong|\bbata\b|\bapex\b|yellow|ecstasy|rokomari|amazon|aliexpress|fashion|\bmall\b|lifestyle|sailor|richman|le\s*reve|shopping/i, ["Shopping"]],
  [/star\s*tech|ryans|techland|gadget|computer|electronics|walton|samsung|xiaomi/i, ["Technology"]],
  [/pharma|pharmacy|hospital|clinic|diagnostic|medical|medicine|labaid|popular\s*diag|ibn\s*sina|evercare|\bdoctor\b|health/i, ["Medical"]],
  [/school|college|university|tuition|coursera|udemy|10\s*minute\s*school|exam\s*fee|admission/i, ["Education"]],
  [/cineplex|cinema|blockbuster|\bsteam\b|playstation|\bgame\b|concert/i, ["Entertainment"]],
  [/\brent\b|house\s*rent|flat\s*rent/i, ["Housing", "Rent"]],
  [/desco|dpdc|wasa|titas|nesco|bpdb|palli\s*bidyut|electricity|gas\s*bill|water\s*bill|internet|broadband|link3|amber\s*it|carnival|grameenphone|\brobi\b|banglalink|teletalk|airtel/i, ["Bills", "Utilities"]],
];

export const FEE_CATEGORY_HINTS = ["Fees", "Fees & charges", "Charges", "Bank charges", "Bank fees", "Other"];

function categoryHintsFor(channel: SmsChannel, direction: SmsDirection | null, counterparty: string | null, text: string): string[] {
  if (direction === "credit") {
    switch (channel) {
      case "salary":
        return ["Salary"];
      case "interest":
        return ["Investment", "Interest"];
      case "remittance":
        return ["Remittance", "Gifts", "Other"];
      default:
        return ["Other"];
    }
  }
  const subject = `${counterparty ?? ""} ${text}`;
  for (const [pattern, hints] of MERCHANT_CATEGORIES) if (pattern.test(subject)) return hints;
  switch (channel) {
    case "recharge":
      return ["Mobile & internet", "Mobile", "Phone", "Bills"];
    case "bill":
      return ["Bills", "Utilities"];
    default:
      return ["Other"];
  }
}

function describe(parsed: {
  channel: SmsChannel;
  direction: SmsDirection | null;
  counterparty: string | null;
  provider: Provider | null;
  otherProvider: Provider | null;
  isCard: boolean;
  text: string;
}): string {
  const { channel, direction, counterparty: who, provider, otherProvider, isCard, text } = parsed;
  switch (channel) {
    case "atm":
      return "ATM withdrawal";
    case "cash_out":
      return "Cash out";
    case "cash_in":
      return "Cash in";
    case "add_money":
      return otherProvider ? `Add money from ${otherProvider.name}` : "Add money";
    case "salary":
      return who ? `Salary — ${who}` : "Salary";
    case "refund":
      return who ? `Refund from ${who}` : "Refund";
    case "cashback":
      return "Cashback";
    case "remittance":
      return who ? `Remittance from ${who}` : "Remittance";
    case "interest":
      return "Interest";
    case "recharge":
      return who ? `Mobile recharge ${who}` : "Mobile recharge";
    case "bill":
      return who ? `${who} bill` : "Bill payment";
    case "send_money":
      return who ? `Sent to ${who}` : "Send money";
    case "payment":
      return who ?? (isCard ? "Card payment" : "Payment");
    case "deposit":
      return /\bcash\b/i.test(text) ? "Cash deposit" : who ? `Deposit from ${who}` : "Deposit";
    case "transfer":
      if (direction === "credit") return who ? `Transfer from ${who}` : "Transfer received";
      return who ? `Transfer to ${who}` : "Fund transfer";
    case "received":
      return who ? `Received from ${who}` : "Money received";
    case "debited":
      return who ?? (provider ? `${provider.name} debit` : "Debit");
    default:
      return who ?? (provider ? `${provider.name} transaction` : "SMS transaction");
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export interface ParseOptions {
  /** "Today" in your timezone, for dates written without a year. */
  today: ISODate;
}

export function parseSms(input: string, { today }: ParseOptions): ParsedSms {
  const text = normalizeSmsText(input);
  const amounts = findAmounts(text);
  const channel = detectChannel(text);
  // In a "you got cashback" alert, the cashback is the transaction.
  const primary = amounts.find((a) => a.label === "amount") ?? (channel === "cashback" ? amounts.find((a) => a.label === "cashback") : undefined) ?? null;

  let amount = primary?.value ?? null;
  let amountIndex = primary?.index ?? -1;
  let currency = primary?.currency ?? null;
  let anchored = !!primary;
  if (!primary) {
    const loose = UNANCHORED_AMOUNT.exec(text);
    const value = loose ? toMoney(loose[1]) : null;
    if (loose && value && toMinor(value) > 0n) {
      amount = value;
      amountIndex = loose.index;
      currency = amounts[0]?.currency ?? null;
      anchored = false;
    }
  }
  if (amount && toMinor(amount) === 0n) amount = null;

  const feeMinor = amounts.filter((a) => a.label === "fee").reduce((sum, a) => sum + toMinor(a.value), 0n);
  const fee = feeMinor > 0n ? normalizeMoney(feeMinor) : null;
  const balance = amounts.find((a) => a.label === "balance" && a.index > amountIndex)?.value ?? amounts.find((a) => a.label === "balance")?.value ?? null;

  const { direction, margin } = detectDirection(text, amountIndex);
  const { provider, other: otherProvider } = detectProviders(text);
  const { own: accountDigits, other: counterpartyDigits } = findAccountDigits(text, provider?.kind === "MOBILE_WALLET");
  const counterparty = findCounterparty(text, direction);
  const reference = REFERENCE.exec(text)?.[1] ?? null;
  const date = findDate(text, today);
  const time = findTime(text);
  const isCard = /\b(?:card|visa|master\s*card|mastercard|amex|unionpay)\b/i.test(text);
  const ignored = ignoreReason(text, !!amount);

  const described = { channel, direction, counterparty, provider, otherProvider, isCard, text };
  const confidence: ParsedSms["confidence"] =
    !ignored && amount && anchored && direction && margin >= 3 && date && (provider || accountDigits)
      ? "high"
      : !ignored && amount && direction
        ? "medium"
        : "low";

  return {
    text: input.trim(),
    direction,
    channel,
    amount,
    currency,
    fee,
    balance,
    provider,
    otherProvider,
    accountDigits,
    counterpartyDigits,
    isCard,
    date,
    time,
    counterparty,
    reference,
    description: describe(described).slice(0, 140),
    categoryHints: categoryHintsFor(channel, direction, counterparty, text),
    ignored,
    confidence,
  };
}

/** A line that is a whole transaction alert on its own (so several can be pasted line by line). */
function isStandaloneAlert(line: string): boolean {
  const amounts = findAmounts(line);
  const primary = amounts.find((a) => a.label === "amount");
  return !!primary && detectDirection(line, primary.index).direction !== null;
}

/**
 * Split pasted text into messages: blank lines always separate messages, and
 * a block whose every line is a complete alert is split line by line. Bank
 * alerts that wrap over several lines stay together.
 */
export function splitMessages(input: string, limit = 50): string[] {
  const blocks = input
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  const messages: string[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1 && lines.every((line) => isStandaloneAlert(normalizeSmsText(line)))) messages.push(...lines);
    else messages.push(block);
  }
  return messages.slice(0, limit);
}
