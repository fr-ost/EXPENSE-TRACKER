/**
 * Renders every app icon from the one logo below: the favicon (SVG + ICO),
 * the Apple touch icon, the install icons (regular and maskable), the
 * shortcut icons, and the Android app's icon, splash and notification icon
 * (android/app/src/main/res). Output is committed; run again only after
 * changing the logo.
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
const STEM = "M144 118V390";
const ARCH = "M144 292c0-52 32-82 76-82s74 30 74 82v98";
const STROKE = 54;
const DOT = { cx: 374, cy: 372, r: 32 };
const GLYPH = `<g fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"><path d="${STEM}"/><path d="${ARCH}"/></g><circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${EMERALD}"/>`;

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

// ---- Android -------------------------------------------------------------
// The same mark as vector drawables, so it is sharp on every screen.

const android = (file) => `android/app/src/main/res/${file}`;
const GENERATED = "<!-- Written by scripts/generate-icons.mjs: change the logo there, not here. -->";
const opaque = (hex) => `#FF${hex.slice(1).toUpperCase()}`;
const WHITE = "#FFFFFFFF";
const DOT_PATH = `M${DOT.cx - DOT.r} ${DOT.cy}a${DOT.r} ${DOT.r} 0 1 0 ${2 * DOT.r} 0a${DOT.r} ${DOT.r} 0 1 0 ${-2 * DOT.r} 0z`;
const TILE_PATH = "M116 0H396A116 116 0 0 1 512 116V396A116 116 0 0 1 396 512H116A116 116 0 0 1 0 396V116A116 116 0 0 1 116 0Z";

const stroked = (d, colour) =>
  `<path android:pathData="${d}" android:strokeColor="${colour}" android:strokeWidth="${STROKE}" android:strokeLineCap="round" android:strokeLineJoin="round" />`;
const filled = (d, colour) => `<path android:pathData="${d}" android:fillColor="${colour}" />`;

/** A vector drawable of the mark, `dp` wide, the mark scaled about the centre; `tile` puts the rounded tile behind it. */
function vector({ dp, scale, letter = WHITE, dot = opaque(EMERALD), tile = false }) {
  const mark = [stroked(STEM, letter), stroked(ARCH, letter), filled(DOT_PATH, dot)];
  return `<?xml version="1.0" encoding="utf-8"?>
${GENERATED}
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${dp}dp"
    android:height="${dp}dp"
    android:viewportWidth="512"
    android:viewportHeight="512">
${tile ? `    ${filled(TILE_PATH, opaque(INK))}\n` : ""}    <group
        android:pivotX="256"
        android:pivotY="256"
        android:scaleX="${scale}"
        android:scaleY="${scale}">
${mark.map((path) => `        ${path}`).join("\n")}
    </group>
</vector>
`;
}

write(
  android("values/colors.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
${GENERATED}
<resources>
    <color name="canvas">#FFFFFFFF</color>
    <color name="ink">${opaque(INK)}</color>
    <color name="emerald">${opaque(EMERALD)}</color>
</resources>
`,
);
// The launcher shows the middle 72dp of 108dp and may cut it to a circle of
// 66dp: at this scale the mark fills the tile as it does on the web icon.
write(android("drawable/ic_launcher_foreground.xml"), vector({ dp: 108, scale: 0.66 }));
write(android("drawable/ic_launcher_monochrome.xml"), vector({ dp: 108, scale: 0.66, dot: WHITE }));
write(
  android("mipmap-anydpi-v26/ic_launcher.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
${GENERATED}
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ink" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`,
);
// Android 7 (before adaptive icons) takes a picture.
for (const [density, size] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]]) {
  write(android(`mipmap-${density}/ic_launcher.png`), await png(rounded, size));
}
write(android("drawable/splash.xml"), vector({ dp: 112, scale: 1, tile: true }));
// Notifications draw the icon in one colour of the phone's choosing.
write(android("drawable/ic_notification.xml"), vector({ dp: 24, scale: 1.3, dot: WHITE }));

await browser.close();
