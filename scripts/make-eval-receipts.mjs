/*
 * Renders the generated receipts for the live eval (docs/AI.md §5): realistic UK receipts (a supermarket, a restaurant
 * with service, a pharmacy, a long one, a dim crumpled one, one in euros, one in yen…) drawn as HTML by the browser
 * and photographed as JPEG, each with its expected answer beside it. Run: node scripts/make-eval-receipts.mjs
 * (needs Playwright's Chromium; PW_CHROMIUM_PATH if it isn't the default). Output: tests/ai/eval/receipts/uk-NN.*
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'ai', 'eval', 'receipts');
const p = (pounds) => Math.round(pounds * 100);

/** Each receipt: shop, date, lines, extras; the expected answer is worked out from them (never typed twice). */
const RECEIPTS = [
  { shop: 'Tesco Express', town: 'Leeds', date: '2026-10-03', lines: [['Semi Skimmed Milk 4pt', 1.65], ['Hovis Wholemeal', 1.4], ['Bananas Loose', 0.86], ['Free Range Eggs 6', 2.1]], category: 'Groceries' },
  { shop: 'Sainsbury’s', town: 'Bristol', date: '2026-09-21', lines: [['Basmati Rice 1kg', 2.25], ['Chicken Breast 600g', 5.5], ['Broccoli', 0.69], ['Cheddar Mature 400g', 3.6], ['Orange Juice 1L', 1.85]], discount: 1.0, category: 'Groceries' },
  { shop: 'Boots', town: 'Manchester', date: '2026-10-11', lines: [['Paracetamol 16', 0.79], ['Toothpaste', 3.25], ['Plasters', 2.5]], category: 'Health' },
  { shop: 'Dishoom', town: 'London', date: '2026-10-17', lines: [['House Black Daal', 7.9], ['Chicken Ruby', 15.5], ['Garlic Naan', 3.9], ['Mango Lassi x2', 9.0]], service: 4.79, category: 'Eating out' },
  { shop: 'Pret A Manger', town: 'London', date: '2026-11-02', lines: [['Flat White', 3.6], ['Ham & Cheese Toastie', 5.25]], category: 'Eating out' },
  { shop: 'Waitrose', town: 'Oxford', date: '2026-08-30', lines: [['Sourdough', 3.0], ['Unsalted Butter', 2.4], ['Strawberries 400g', 3.5], ['Greek Yoghurt', 2.2], ['Coffee Beans', 6.5], ['Kitchen Roll', 3.25], ['Washing Up Liquid', 1.6], ['Tomatoes', 1.95], ['Avocado x2', 2.0], ['Pasta 500g', 1.1], ['Pesto', 2.75], ['Parmesan', 4.2]], discount: 2.5, category: 'Groceries', long: true },
  { shop: 'Shell', town: 'Reading', date: '2026-10-25', lines: [['Unleaded 32.10L', 47.82]], category: 'Transport' },
  { shop: 'IKEA', town: 'Wembley', date: '2026-07-12', lines: [['KALLAX Shelf', 45.0], ['FRAKTA Bag', 0.85], ['Tea Lights x100', 3.5]], category: 'Household' },
  { shop: 'The Red Lion', town: 'York', date: '2026-10-09', lines: [['Pint Lager x2', 11.4], ['Fish & Chips', 15.95], ['Burger', 14.5]], service: 4.19, category: 'Going out' },
  { shop: 'Lidl', town: 'Cardiff', date: '2026-10-28', lines: [['Milk 2L', 1.25], ['Bread', 0.75], ['Apples', 1.49], ['Cheese', 2.29], ['Crisps', 1.15]], category: 'Groceries', dim: true },
  { shop: 'Superdrug', town: 'Glasgow', date: '2026-09-05', lines: [['Shampoo', 4.5], ['Razors', 6.99]], discount: 1.5, category: 'Health' },
  { shop: 'Costa Coffee', town: 'Brighton', date: '2026-11-01', lines: [['Latte Medium', 3.85], ['Cappuccino Medium', 3.75], ['Croissant', 2.45]], category: 'Eating out', dim: true },
  { shop: 'B&Q', town: 'Swindon', date: '2026-06-14', lines: [['Paint 2.5L White', 18.0], ['Roller Set', 7.5], ['Masking Tape', 3.0]], category: 'Household' },
  { shop: 'M&S Food', town: 'Bath', date: '2026-10-19', lines: [['Dine In Meal Deal', 15.0], ['Bottle of Wine', 9.0], ['Flowers', 6.0]], category: 'Groceries' },
  { shop: 'Wagamama', town: 'Nottingham', date: '2026-09-27', lines: [['Chicken Katsu Curry', 14.95], ['Yaki Soba', 13.5], ['Gyoza', 6.5], ['Iced Tea x2', 7.9]], service: 4.29, category: 'Eating out' },
  { shop: 'Asda', town: 'Sheffield', date: '2026-10-14', lines: [['Nappies', 9.0], ['Baby Wipes', 2.0], ['Rice Cakes', 1.1], ['Formula', 12.5]], discount: 3.0, category: 'Groceries', dim: true },
  { shop: 'National Rail', town: 'London Euston', date: '2026-10-05', lines: [['Off-Peak Return x2', 98.4]], category: 'Transport' },
  { shop: 'Carrefour', town: 'Paris', date: '2026-08-04', currency: 'EUR', lines: [['Baguette', 1.2], ['Fromage', 4.8], ['Vin Rouge', 7.5], ['Eau Minerale', 0.9]], category: 'Groceries' },
  { shop: 'ローソン 渋谷店', town: 'Tokyo', date: '2026-04-11', currency: 'JPY', lines: [['おにぎり 鮭', 180], ['お茶 500ml', 160], ['からあげクン', 308]], category: 'Groceries' },
  { shop: 'Greggs', town: 'Newcastle', date: '2026-11-04', lines: [['Sausage Roll x2', 2.7], ['Steak Bake', 2.15], ['Coffee', 1.9]], category: 'Eating out' },
];

const symbol = { GBP: '£', EUR: '€', JPY: '¥' };
function money(v, cur) {
  if (cur === 'JPY') return `¥${v.toLocaleString('en-GB')}`;
  return `${symbol[cur] ?? '£'}${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const cents = (v, cur) => (cur === 'JPY' ? v * 100 : p(v));

function html(r) {
  const cur = r.currency ?? 'GBP';
  const lines = r.lines.map(([l, v]) => `<tr><td>${l}</td><td class="r">${money(v, cur)}</td></tr>`).join('');
  const sub = r.lines.reduce((t, [, v]) => t + cents(v, cur), 0);
  const total = sub - (r.discount ? cents(r.discount, cur) : 0) + (r.service ? cents(r.service, cur) : 0);
  const extra = [
    r.discount ? `<tr><td>Offers / savings</td><td class="r">-${money(r.discount, cur)}</td></tr>` : '',
    r.service ? `<tr><td>Service charge 12.5%</td><td class="r">${money(r.service, cur)}</td></tr>` : '',
  ].join('');
  const [y, m, d] = r.date.split('-');
  const tilt = r.dim ? 'transform: rotate(-3deg); filter: brightness(0.62) contrast(0.8) blur(0.4px);' : 'transform: rotate(0.6deg);';
  return {
    total,
    page: `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#8a7f72;display:flex;justify-content:center;padding:40px">
<div style="background:#fbfaf6;width:420px;padding:28px 26px;font:15px/1.5 'DejaVu Sans Mono',monospace;color:#222;box-shadow:0 4px 18px rgba(0,0,0,.35);${tilt}">
<div style="text-align:center;font-weight:bold;font-size:20px">${r.shop}</div>
<div style="text-align:center">${r.town}</div>
<div style="text-align:center;margin-bottom:12px">VAT No. GB 123 4567 89</div>
<table style="width:100%;border-collapse:collapse"><style>.r{text-align:right}</style>
${lines}<tr><td colspan=2><hr></td></tr>${extra}
<tr style="font-weight:bold;font-size:18px"><td>TOTAL</td><td class="r">${money(total / 100, cur)}</td></tr>
<tr><td>CARD</td><td class="r">${money(total / 100, cur)}</td></tr></table>
<div style="margin-top:12px">${d}/${m}/${y} 14:${String(10 + (r.lines.length * 7) % 50).padStart(2, '0')}</div>
<div>Card ************ ****</div>
<div style="text-align:center;margin-top:10px">Thank you for shopping with us</div></div></body>`,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 520, height: 900 }, deviceScaleFactor: 1.5 });
  for (const [i, r] of RECEIPTS.entries()) {
    const name = `uk-${String(i + 1).padStart(2, '0')}`;
    const { page: doc, total } = html(r);
    await page.setContent(doc);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 80, fullPage: true });
    const cur = r.currency ?? 'GBP';
    fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify({
      source: 'generated (scripts/make-eval-receipts.mjs)', merchant: r.shop, date: r.date, currency: cur, total_pence: total,
      discount_pence: r.discount ? cents(r.discount, cur) : 0, service_pence: r.service ? cents(r.service, cur) : 0, category: r.category,
      items: r.lines.map(([label, v]) => ({ label, pence: cents(v, cur) })),
    }, null, 1)}\n`);
  }
  await browser.close();
  console.log(`${String(RECEIPTS.length)} receipts in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
