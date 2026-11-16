import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every read and write of a user's data must be limited to that user. This
 * reads the server's source and fails when a query on a user-owned table or
 * view has no `userId` in it — the mistake that would show one person
 * another's ledger. (tests/integration/isolation.test.ts checks the behaviour.)
 */

const SERVER = path.join(process.cwd(), "src/lib/server");

/** Tables and views whose rows belong to a user. */
const OWNED_RELATIONS = new Set([
  "Account",
  "Category",
  "Transaction",
  "BalanceCheckpoint",
  "ScopeBudget",
  "ExchangeRate",
  "RecurringTransaction",
  "TransactionLeg",
  "LedgerEntry",
  "BalanceCorrection",
  "ExpenseEntry",
  "IncomeEntry",
]);
const OWNED_MODELS = ["account", "category", "transaction", "balanceCheckpoint", "scopeBudget", "exchangeRate", "recurringTransaction"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const files = sourceFiles(SERVER).map((file) => ({ file: path.relative(process.cwd(), file), source: readFileSync(file, "utf8") }));
const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/** The text of a template literal that starts at `start` (just after its opening backtick). */
function templateText(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source.startsWith("${", i)) depth++;
    else if (source[i] === "}" && depth > 0) depth--;
    else if (source[i] === "`" && depth === 0) return source.slice(start, i);
  }
  throw new Error("Unterminated template literal");
}

/** The text of a call that starts at `start` (just after its opening parenthesis). */
function callText(source: string, start: number): string {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(start, i);
  }
  throw new Error("Unterminated call");
}

describe("queries on a user's data are limited to that user", () => {
  it("raw SQL filters every user-owned table and view by userId", () => {
    const unfiltered: string[] = [];
    let checked = 0;
    for (const { file, source } of files) {
      for (const query of source.matchAll(/\$(?:queryRaw|executeRaw)(?:<[^`]*?>)?`/gs)) {
        const sql = templateText(source, query.index + query[0].length);
        // How many times each alias reads a user-owned relation in this statement.
        const reads = new Map<string, number>();
        // `${source}` is "ExpenseEntry" or "IncomeEntry" in analytics.ts.
        for (const from of sql.matchAll(/FROM (?:\$\{source\}|"(\w+)")(?: (\w+))?/g)) {
          const [, relation, word] = from;
          if (relation !== undefined && !OWNED_RELATIONS.has(relation)) continue;
          const alias = word && !["WHERE", "GROUP", "ORDER", "JOIN", "LEFT"].includes(word) ? word : "";
          reads.set(alias, (reads.get(alias) ?? 0) + 1);
          checked++;
        }
        // Each read needs its own filter: one branch of a UNION can't borrow another's.
        for (const [alias, count] of reads) {
          const filter = alias ? `${alias}."userId" = \${userId}` : ` "userId" = \${userId}`;
          const filters = sql.split(filter).length - 1;
          if (filters < count) {
            unfiltered.push(`${file}:${lineOf(source, query.index)} reads ${alias || "a table"} ${count}× but filters ${filter.trim()} ${filters}×`);
          }
        }
      }
    }
    expect(unfiltered).toEqual([]);
    // The check is looking at real queries.
    expect(checked).toBeGreaterThan(30);
  });

  it("Prisma calls on user-owned models name the user", () => {
    const unscoped: string[] = [];
    let checked = 0;
    const call = new RegExp(`\\b(?:prisma|tx|client)\\.(?:${OWNED_MODELS.join("|")})\\.\\w+\\(`, "g");
    // Arguments built with the user's id a few lines away: `where` comes from
    // buildTransactionWhere(userId, …), `key` holds the userId_… unique key,
    // and `data` / `row` / `feeRow` come from resolveEntry (which sets userId).
    const builtWithUser = /\bwhere(?:: key| \}|,|\])|\.\.\.(?:data|row|feeRow)\b/;
    for (const { file, source } of files) {
      for (const match of source.matchAll(call)) {
        const text = callText(source, match.index + match[0].length);
        checked++;
        if (!text.includes("userId") && !builtWithUser.test(text)) {
          unscoped.push(`${file}:${lineOf(source, match.index)} ${match[0]}…) has no userId`);
        }
      }
    }
    expect(unscoped).toEqual([]);
    expect(checked).toBeGreaterThan(50);
  });
});
