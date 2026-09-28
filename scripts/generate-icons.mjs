/**
 * Renders every app icon from the one logo below: the favicon (SVG + ICO),
 * the Apple touch icon, the install icons (regular and maskable) and the
 * shortcut icons. Output is committed; run again only after changing the logo.
 *
 *   node scripts/generate-icons.mjs
 *
 * Uses Playwright's Chromium; set CHROMIUM_PATH to use an installed one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const INK = "#0e0e12";
const EMERALD = "#2fbf71";

/** The mark: a lowercase "h" with an emerald full stop, on a 512 grid. Keep in sync with components/brand.tsx. */
const GLYPH = `<g fill="none" stroke="#fff" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"><path d="M144 118V390"/><path d="M144 292c0-52 32-82 76-82s74 30 74 82v98"/></g><circle cx="374" cy="372" r="32" fill="${EMERALD}"/>`;

/** Rounded tile (favicon, install icon). */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="${INK}"/>${GLYPH}</svg>`;

/** Full-bleed tile, glyph scaled into the safe zone (the OS applies its own mask). */
const fullBleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${INK}"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${GLYPH}</g></svg>`;

/** Shortcut icons: a Lucide glyph on the same tile. */
const shortcut = (paths) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${INK}"/><g transform="translate(24 24) scale(2)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;

const PLUS = '<path d="M5 12h14"/><path d="M12 5v14"/>';
const MESSAGE = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>';
const CHART = '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO container holding PNG images (supported everywhere that matters). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

const write = (file, data) => {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);
  console.log(`  ${file}`);
};

console.log("Writing icons:");
write("src/app/icon.svg", `${rounded}\n`);
write("src/app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) })))));
write("src/app/apple-icon.png", await png(fullBleed(0.78), 180));
write("public/icons/icon-192.png", await png(rounded, 192));
write("public/icons/icon-512.png", await png(rounded, 512));
write("public/icons/icon-maskable-512.png", await png(fullBleed(0.72), 512));
write("public/icons/shortcut-add.png", await png(shortcut(PLUS), 96));
write("public/icons/shortcut-sms.png", await png(shortcut(MESSAGE), 96));
write("public/icons/shortcut-reports.png", await png(shortcut(CHART), 96));

await browser.close();
