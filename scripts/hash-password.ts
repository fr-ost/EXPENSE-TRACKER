/**
 * Generate an Argon2id hash for ADMIN_PASSWORD_HASH.
 *
 *   npm run hash-password
 *
 * The password is read from the terminal without echo and is never written
 * anywhere. Only the hash is printed.
 */
import { hash } from "@node-rs/argon2";
import { stdin, stdout } from "node:process";

function prompt(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      // Non-interactive: read the first line from stdin (e.g. a pipe).
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolve(data.split(/\r?\n/)[0] ?? ""));
      stdin.on("error", reject);
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (char: string) => {
      if (char === "\r" || char === "\n" || char === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (char === "\u0003") {
        stdout.write("\n");
        process.exit(130);
      } else if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const password = await prompt("New password: ");
  if (stdin.isTTY) {
    const confirmation = await prompt("Repeat password: ");
    if (confirmation !== password) {
      console.error("Passwords don't match.");
      process.exit(1);
    }
  }
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }

  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  console.log("\nSet this as the ADMIN_PASSWORD_HASH environment variable:\n");
  console.log(passwordHash);
  console.log("\nIf your platform mangles '$' characters, use the base64 form instead:\n");
  console.log(`base64:${Buffer.from(passwordHash).toString("base64")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
