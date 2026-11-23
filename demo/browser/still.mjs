// still.mjs <html file> <png>: render a local HTML slide at 1280x720.
import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
const [src, out] = process.argv.slice(2);
const b = await chromium.launch({channel: 'chrome', headless: true});
const p = await b.newPage({viewport: {width: 1280, height: 720}});
await p.goto(pathToFileURL(src).href);
await p.waitForTimeout(300);
await p.screenshot({path: out});
await b.close();
