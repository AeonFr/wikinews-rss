// Copies the RSS feed written by the Python generator (../feeds/en.xml) into public/feeds/,
// so Astro serves it as /feeds/en.xml. The copy is git-ignored. Fails loudly if the feed is missing.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(webDir, "../feeds/en.xml");
const target = resolve(webDir, "public/feeds/en.xml");

if (!existsSync(source)) {
  console.error(`copy-feed: the feed ${source} does not exist. Run the Python generator first.`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`copy-feed: ${source} -> ${target}`);
