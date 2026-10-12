// End-to-end tests: load the built index.html in jsdom with a scenario in the URL and
// check what the page shows. Run with `npm test` (which rebuilds index.html first).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const SK = "adu-calc-v16";
const wait = ms => new Promise(r => setTimeout(r, ms));

// Every simulated window is closed after its test; left open they pile up (timers, React roots)
// until the run slows to a crawl.
const openDoms = [];
afterEach(() => { for (const d of openDoms.splice(0)) d.window.close(); });

async function load(qs = "", { stored, clipboard, execCommand } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("error", e => errors.push(String(e)));
  vc.on("jsdomError", e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    url: "https://example.test/adu/" + qs, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (stored) w.localStorage.setItem(SK, stored);
      if (clipboard) Object.defineProperty(w.navigator, "clipboard", { value: clipboard });
      if (execCommand) w.document.execCommand = execCommand;
    },
  });
  openDoms.push(dom);
  await wait(250);
  const w = dom.window, doc = w.document;
  return {
    w, doc, errors,
    // On-screen text only (the print report and the inline bundle are excluded).
    text: () => doc.querySelector("#root .screen-only").textContent,
    report: () => doc.querySelector("#root .print-report"),
    click: label => { const b = [...doc.querySelectorAll("button")].find(b => b.textContent.includes(label)); assert.ok(b, "button " + label); b.click(); return wait(60); },
    // Text of the value element that follows a card label.
    card: label => { const el = [...doc.querySelectorAll("#root .screen-only div")].find(e => e.textContent === label); return el?.nextElementSibling?.textContent ?? null; },
    saved: () => JSON.parse(w.localStorage.getItem(SK) || "null"),
    type: async (sel, value) => {
      const el = doc.querySelector(sel);
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
      await wait(60);
    },
  };
}
const money = s => { const m = String(s).match(/([−-])?\$([\d,]+)/); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, "")) : NaN; };

describe("rendering", () => {
  test("no garbage values across modes, financing, build time, tax and views", async () => {
    const bad = [];
    for (const mode of ["ltr", "hybrid", "str"]) for (const cd of [0, 20, 100]) for (const bm of [0, 6]) for (const tx of [0, 32])
      for (const con of ["paid", "cap", "none"]) for (const view of ["internal", "consumer"]) {
        if (con !== "paid" && (cd === 100 || bm === 0)) continue;
        const qs = `?customRent=2400&rentalMode=${mode}&cashDown=${cd}&buildMonths=${bm}&incomeTax=${tx}&conIntMode=${con}&view=${view}`;
        const p = await load(qs);
        const t = p.text();
        if (/NaN|Infinity|undefined|null|\$-/.test(t)) bad.push(qs + " → " + t.match(/.{25}(NaN|Infinity|undefined|null|\$-).{15}/)?.[0]);
        if (p.errors.length) bad.push(qs + " → " + p.errors[0]);
      }
    assert.deepEqual(bad, []);
  });
});

describe("bug fixes", () => {
  test("STR revenue is nightly rate × 30.4, not scaled by size", async () => {
    assert.match((await load("?rentalMode=str&sqft=1200&strADR=200")).text(), /\$6,080\/mo/);
  });
  test("STR revenue ignores a hidden long-term rent", async () => {
    assert.match((await load("?rentalMode=str&customRent=3000")).text(), /\$3,800\/mo/);
  });
  test("hybrid blends STR and LTR months", async () => {
    assert.match((await load("?rentalMode=hybrid&customRent=2000&strMonths=6&strADR=100")).text(), /\$2,520\/mo/);
  });
  test("CF+ is 'Now' / 'Day one' when positive from the first rent check", async () => {
    assert.match((await load("?customRent=6000&term=20&rate=3")).text(), /CF\+.{0,3}Now/);
    assert.equal((await load("?customRent=6000&term=20&rate=3&view=consumer")).card("Years to cash positive"), "Day one");
  });
  test("all-cash coverage shows 'No loan'", async () => {
    assert.match((await load("?customRent=2000&cashDown=100")).text(), /No loan/);
  });
  test("negative dollars render as −$", async () => {
    const t = (await load("?customRent=1500&view=consumer")).text();
    assert.doesNotMatch(t, /\$-/);
    assert.match(t, /−\$/);
  });
  test("bad URL values are clamped", async () => {
    const t = (await load("?term=0&rate=abc&customRent=2000&rentalMode=foo&sqft=99999&conIntMode=bogus")).text();
    assert.doesNotMatch(t, /NaN|Infinity/);
    assert.match(t, /1200 sq ft/);
    assert.match(t, /Long-term/);
  });
});

describe("saved model and share links", () => {
  const saved = JSON.stringify({ customRent: 2777, sqft: 800 });
  test("unrelated query params keep the saved model", async () => {
    const p = await load("?fbclid=abc", { stored: saved });
    assert.match(p.text(), /\$2,777/);
    assert.equal(p.saved().customRent, 2777);
  });
  test("a shared link doesn't overwrite the saved model until the visitor edits", async () => {
    const p = await load("?customRent=3333&view=consumer", { stored: saved });
    assert.equal(p.doc.querySelector("#cRent").value, "3333");
    assert.equal(p.saved().customRent, 2777);
    await p.click("Full model");
    assert.equal(p.saved().customRent, 2777, "switching tabs is not an edit");
    await p.type("#rentAmt", "3400");
    assert.equal(p.saved().customRent, 3400);
  });
  test("reset clears to defaults and resumes saving", async () => {
    const p = await load("?customRent=3333", { stored: saved });
    await p.click("Reset all");
    await p.click("Click again");
    assert.equal(p.saved().customRent, 0);
  });
  test("copy link only claims success when the copy worked", async () => {
    let prompted = null;
    const p = await load("?customRent=2000", { clipboard: { writeText: () => Promise.reject(new Error("blocked")) }, execCommand: () => false });
    p.w.prompt = (_, url) => { prompted = url; };
    await p.click("Copy model link");
    assert.doesNotMatch(p.text(), /Model link copied/);
    assert.match(prompted, /customRent=2000/);
    const ok = await load("?customRent=2000", { clipboard: { writeText: () => Promise.resolve() } });
    await ok.click("Copy model link");
    assert.match(ok.text(), /Model link copied/);
  });
});

describe("one simulation, consistent numbers", () => {
  test("payback card matches the chart marker and the internal view", async () => {
    const c = await load("?customRent=2600&cashDown=20&view=consumer");
    const pb = c.card("Payback period");
    assert.match(c.text(), new RegExp("Payback yr " + pb.replace(" yr", "").replace(".", "\\.")));
    const i = await load("?customRent=2600&cashDown=20");
    assert.equal(i.text().match(/Payback\?([\d.]+ yr|Never|Immediate)/)[1], pb);
  });
  test("year-1 card matches the monthly breakdown; post-loan card matches the full picture's ongoing income", async () => {
    const p = await load("?customRent=2600&cashDown=20&view=consumer");
    const t = p.text();
    assert.ok(p.card("Year-1 cash flow").startsWith(t.match(/([+−]?\$[\d,]+)\/moNet (income|subsidy) in rental year 1/)[1]));
    assert.ok(p.card("Income after the loan").startsWith(t.match(/Ongoing rental incomeAbout (−?\$[\d,]+)\/mo/)[1]));
  });
  test("internal Return matches the consumer total return", async () => {
    const cons = (await load("?customRent=2600&cashDown=20&view=consumer")).text().match(/Total return.{0,600}?([+−]\$[\d.]+[kM])/)[1];
    const intl = (await load("?customRent=2600&cashDown=20")).text().match(/Return\?([+-]\$[\d.]+k)/)[1];
    assert.equal(cons.replace("−", "-"), intl);
  });
  test("%/yr on the 20-year hero is a compound rate", async () => {
    const t = (await load("?customRent=3000&view=consumer")).text();
    const m = t.match(/20 years([+−])\$([\d.]+)k([+−]?[\d.]+)%\/yr/);
    const total = money(t.match(/(\$[\d,]+) project/)[1]);
    const gain = (m[1] === "−" ? -1 : 1) * parseFloat(m[2]) * 1000;
    assert.ok(Math.abs((Math.pow(1 + gain / total, 1 / 20) - 1) * 100 - parseFloat(m[3])) < 0.15);
  });
  test("build months shift results", async () => {
    const hero = async bm => (await load(`?customRent=2600&buildMonths=${bm}&conIntMode=none&view=consumer`)).text().match(/15 years([+−]\$[\d.]+k)/)[1];
    assert.notEqual(await hero(0), await hero(12));
  });
  test("operating-expense % uses the user's rent", async () => {
    const pct = async r => (await load(`?customRent=${r}`)).text().match(/(\d+)% of rent to expenses/)[1];
    assert.notEqual(await pct(1500), await pct(4000));
  });
});

describe("cost model", () => {
  test("furnishings are excluded from depreciation", async () => {
    const dep = async f => money((await load(`?customRent=2600&furnishing=${f}&conIntMode=none`)).text().match(/depreciation \((\$[\d,]+)\/yr/)[1]);
    assert.equal(await dep(0), await dep(10000));
  });
  test("the value multiplier sets the ADU's value everywhere", async () => {
    const c = await load("?customRent=2600&grm=200&view=consumer");
    assert.equal(c.card("Value when complete"), "$520,000", "200 × $2,600");
    assert.match(c.text(), /gross rent multiplier \(200× monthly long-term rent\)/);
    assert.match(c.report().textContent, /Value multiplier200× monthly long-term rent/);
    const i = await load("?customRent=2600&grm=200");
    assert.match(i.text(), /Equity\?\+\$520k/);
  });
  test("insurance is on the building's rebuild cost, not fees or site work", async () => {
    const ins = async qs => money((await load("?customRent=2600" + qs)).text().match(/Insurance \((\$[\d,]+)\/yr\)/)[1]);
    // (600 sq ft × $300 structure + $10,000 foundation) × 1.20 builder margin × 0.5%
    assert.equal(await ins(""), 1140);
    assert.equal(await ins("&permits=25000&hookup=30000&furnishing=10000"), 1140);
    assert.equal(await ins("&cpsf=350"), Math.round((600 * 350 + 10000) * 1.2 * 0.005));
  });
  test("contingency is its own line, not part of soft costs", async () => {
    const t = (await load("?customRent=2600")).text();
    // permits 10,000 + water/sewer 8,000 + design 8,000 + surveys 3,500 + furnishing 0
    assert.match(t, /Soft cost subtotal\$29,500/);
    assert.match(t, /Soft cost subtotal\$29,500Contingency/);
  });
});

describe("construction-period interest", () => {
  // [_, total interest, build months, average drawn balance] from the Financing section.
  const readout = t => {
    const i = t.match(/Construction interest: (\$[\d,]+)/), a = t.match(/an average of (\$[\d,]+) over the (\d+)-month build/);
    return i && a ? [null, i[1], a[2], a[1]] : null;
  };
  test("each option states what it means in dollars, and the totals reconcile", async () => {
    const t = (await load("?customRent=2600&cpsf=250")).text();
    const paid = t.match(/Paid monthlyYou pay about (\$[\d,]+) in interest-only bills during the build, then (\$[\d,]+)\/mo/);
    const cap = t.match(/Added to the loanNothing to pay during the build\. The loan grows by (\$[\d,]+), so the payment is (\$[\d,]+)\/mo — about (\$[\d,]+) more over the loan/);
    assert.ok(paid && cap, "both option cards show their numbers");
    // Over a 10-year loan: added-to-loan payments minus (paid-monthly payments + the interest paid during the build).
    const extra = money(cap[2]) * 120 - (money(paid[2]) * 120 + money(paid[1]));
    assert.ok(Math.abs(extra - money(cap[3])) <= 130, extra + " vs " + cap[3]);
    assert.ok(money(cap[3]) < money(paid[1]), "the extra is less than the interest itself, not more");
  });
  test("interest accrues on the S-curve draw balance", async () => {
    // $250/sq ft gives a $261,650 project, $0 down, 6 months, 7.5%. Soft costs ($35,400 with markup) are
    // drawn up front and hard costs follow the S-curve, so the average drawn balance is ~48% of the loan.
    const m = readout((await load("?customRent=2600&cpsf=250")).text());
    assert.ok(m, "readout shown");
    assert.ok(Math.abs(money(m[1]) - 4686) <= 2, m[1]);
    assert.ok(Math.abs(money(m[3]) - 124957) <= 5, m[3]);
  });
  test("cash down is spent before the loan is drawn", async () => {
    const at = async cd => money(readout((await load(`?customRent=2600&cashDown=${cd}`)).text())[1]);
    const none = await at(0), half = await at(50);
    // With 50% down, the first half of spending is equity, so far less is drawn while it's being built.
    assert.ok(half < none * 0.35, `${half} vs ${none}`);
  });
  test("a construction-rate premium raises interest", async () => {
    const at = async prem => money(readout((await load(`?customRent=2600&conPremium=${prem}`)).text())[1]);
    assert.ok(await at(1.5) > await at(0));
  });
  test("paid monthly delays payback; added to loan raises the payment", async () => {
    const pb = async mode => parseFloat((await load(`?customRent=2600&cashDown=20&conIntMode=${mode}&view=consumer`)).card("Payback period"));
    assert.ok(await pb("paid") > await pb("none"));
    const pmt = async mode => money((await load(`?customRent=2600&conIntMode=${mode}`)).text().match(/Monthly payment: (\$[\d,]+)/)[1]);
    assert.ok(await pmt("cap") > await pmt("none"));
    assert.equal(await pmt("paid"), await pmt("none"));
  });
  test("no construction-interest controls without a loan or without a build period", async () => {
    assert.doesNotMatch((await load("?customRent=2600&cashDown=100")).text(), /Interest during construction/);
    assert.doesNotMatch((await load("?customRent=2600&buildMonths=0")).text(), /Interest during construction/);
  });
  test("consumer view lists construction interest on its own line", async () => {
    const t = (await load("?customRent=2600&cashDown=20&view=consumer")).text();
    assert.match(t, /Construction-period interest/);
    assert.doesNotMatch((await load("?customRent=2600&cashDown=20&conIntMode=cap&view=consumer")).text(), /Construction-period interest/);
  });
});

describe("report details", () => {
  const qs = "?customRent=2600&clientName=Jane%20Smith&clientAddr=12%20Elm%20St%2C%20Austin&prepName=Sam%20Lee&prepCompany=Lee%20Builders&reportNotes=Excludes%20landscaping.%0ABids%20pending%20for%20the%20foundation.";
  test("appear on the printed report's header and notes", async () => {
    const t = (await load(qs)).report().textContent;
    assert.match(t, /Prepared for Jane Smith · 12 Elm St, Austin/);
    assert.match(t, /Prepared [A-Z][a-z]+ \d+, \d{4} by Sam Lee, Lee Builders/);
    assert.match(t, /Notes from Sam Lee, Lee Builders: Excludes landscaping\.\nBids pending for the foundation\./);
  });
  test("show on the Summary and in the Full model section header", async () => {
    assert.match((await load(qs + "&view=consumer")).text(), /Prepared for Jane Smith · 12 Elm St, Austin · Prepared by Sam Lee, Lee Builders/);
    assert.match((await load(qs)).text(), /Report detailsFor Jane Smith/);
  });
  test("leave no trace when empty, and long notes are capped", async () => {
    const empty = await load("?customRent=2600&view=consumer");
    assert.doesNotMatch(empty.text(), /Prepared for|Prepared by/);
    assert.doesNotMatch(empty.report().textContent, /Notes from|Prepared for/);
    const long = await load("?customRent=2600&reportNotes=" + "x".repeat(2000));
    assert.ok(long.report().textContent.includes("x".repeat(1200)) && !long.report().textContent.includes("x".repeat(1201)));
  });
});

describe("cost as a range", () => {
  // Same derivation as budget confidence: ±25% bands read as 90% ranges, combined; 80% range = ±1.2816σ.
  const lines = [180000, 10000, 8000, 8000, 3000, 2000, 10000, 8000, 8000, 3500];
  const base = lines.reduce((s, x) => s + x * 1.2, 0);
  const sigma = Math.sqrt(lines.reduce((s, x) => s + (x * 1.2 * 0.25 / 1.6449) ** 2, 0));
  const r1k = x => Math.round(x / 1000) * 1000;
  const lo = r1k(base - 1.2816 * sigma), hi = r1k(base + 1.2816 * sigma);
  const fmt = n => "$" + n.toLocaleString("en-US");
  test("the Summary, the breakdown and the report all show the same 80% range", async () => {
    const c = await load("?customRent=2600&view=consumer");
    assert.ok(c.text().includes("Project cost estimate $299,150 — likely " + fmt(lo) + "–" + fmt(hi) + " as built (80% range; rough estimate"), c.text().match(/Project cost estimate.{0,120}/)?.[0]);
    assert.ok(c.text().includes("Likely final cost: " + fmt(lo) + "–" + fmt(hi)));
    assert.match(c.report().textContent, new RegExp("Likely final cost \\" + fmt(lo).replace(",", ",") + "–"));
    assert.ok((await load("?customRent=2600")).text().includes("Likely final cost: " + fmt(lo) + "–" + fmt(hi)), "Full model too");
  });
  test("quotes narrow it; known prices collapse it; the loan fee shifts it", async () => {
    const width = t => { const m = t.match(/likely (\$[\d,]+)–(\$[\d,]+) as built/); return money(m[2]) - money(m[1]); };
    const est = width((await load("?customRent=2600&view=consumer")).text());
    const q = width((await load("?customRent=2600&firmOn=1&firm=qqqqqqqqqqq&view=consumer")).text());
    assert.ok(q < est / 2, q + " vs " + est);
    assert.equal(width((await load("?customRent=2600&firmOn=1&firm=kkkkkkkkkkk&view=consumer")).text()), 0);
    const fee = (await load("?customRent=2600&origFeeOn=1&origFee=5&view=consumer")).text().match(/likely (\$[\d,]+)–/)[1];
    assert.equal(money(fee), r1k(base - 1.2816 * sigma + 14958));
  });
});

describe("financing comparison", () => {
  const table = root => {
    const t = [...root.querySelectorAll("table")].find(t => /Monthly payment/.test(t.textContent) && /Net position at 15 years/.test(t.textContent));
    if (!t) return null;
    const heads = [...t.querySelectorAll("thead th")].slice(1).map(th => th.firstChild.textContent);
    const rows = Object.fromEntries([...t.querySelectorAll("tbody tr")].map(tr => [tr.children[0].textContent, [...tr.children].slice(1).map(td => td.textContent)]));
    return { heads, rows, t };
  };
  test("off by default; loan terms stop at 20 years (this isn't a mortgage)", async () => {
    const p = await load("?customRent=2600&term=30&view=consumer");
    assert.equal(table(p.doc.querySelector(".screen-only")), null);
    assert.match(p.text(), /Loan term20 years · 7\.5%/);
  });
  test("compares the current setup with each alternative, in all three places", async () => {
    const p = await load("?customRent=2600&cashDown=20&cmpOn=1");
    const f = table(p.doc.querySelector(".screen-only"));
    assert.deepEqual(f.heads, ["Your setup", "Home equity loan, 15 yr", "HELOC, 20 yr", "All cash"]);
    const pay = f.rows["Monthly payment"].map(v => money(v));
    assert.ok(pay[2] < pay[0], "the 20-year HELOC has a lower payment than the 10-year setup");
    assert.equal(f.rows["Monthly payment"][3], "No loan");
    assert.equal(f.t.querySelectorAll("td[style*='font-weight: 700']").length, 7, "one best value per row");
    const c = await load("?customRent=2600&cashDown=20&cmpOn=1&view=consumer");
    assert.ok(table(c.doc.querySelector(".screen-only")), "Summary card");
    assert.ok(table(c.report()), "printed report");
  });
  test("'Your setup' matches the rest of the page", async () => {
    const c = await load("?customRent=2600&cashDown=20&cmpOn=1&view=consumer");
    const f = table(c.doc.querySelector(".screen-only"));
    assert.equal(f.rows["Net position at 15 years"][0], c.text().match(/15 years([+−]\$[\d.]+k)/)[1]);
    assert.equal(f.rows["Payback"][0], c.card("Payback period"));
  });
  test("alternatives can be renamed, edited and switched off", async () => {
    const p = await load("?customRent=2600&cmpOn=1&cmpCOn=0&cmpBName=Credit%20union&cmpBRate=6.5");
    const f = table(p.doc.querySelector(".screen-only"));
    assert.deepEqual(f.heads, ["Your setup", "Credit union", "All cash"]);
    assert.match(f.t.textContent, /6\.5% · 15 yr/);
  });
});

describe("build period on the net-equity chart", () => {
  test("is shaded and explained when there's a build, and absent when there isn't", async () => {
    const p = await load("?customRent=2600&view=consumer");
    assert.match(p.text(), /During the 6-month build \(shaded\) the ADU's value stays at \$0 — a half-built ADU can't be rented or appraised the normal way/);
    assert.match(p.doc.querySelectorAll(".screen-only svg[role=img]")[1].textContent, /Building — not valued yet/);
    assert.match(p.report().textContent, /The ADU is valued at \$0 until it's finished \(shaded build period\)/);
    const none = await load("?customRent=2600&buildMonths=0&view=consumer");
    assert.doesNotMatch(none.text(), /shaded|Building — not valued yet/);
  });
});

describe("water & sewer ticks by city", () => {
  const row = t => t.match(/Water & sewer fees\?.*?Tick marks for/)[0];
  test("California by default; each city swaps in its official figures", async () => {
    assert.match(row((await load("?customRent=2600")).text()), /San Diego.*LA.*SF/);
    const austin = row((await load("?customRent=2600&hookupCity=austin")).text());
    assert.match(austin, /Central lot \(pre-2007\).*Lot platted after 2023/);
    assert.doesNotMatch(austin, /San Diego/);
    assert.match(row((await load("?customRent=2600&hookupCity=denver")).text()), /ADU water charge/);
    assert.match(row((await load("?customRent=2600&hookupCity=portland")).text()), /SDCs waived/);
  });
  test("the picker is saved, a bad city falls back, and the sources are listed", async () => {
    const p = await load("?customRent=2600");
    const sel = p.doc.querySelector("#hookupCity");
    sel.value = "denver"; sel.dispatchEvent(new p.w.Event("change", { bubbles: true })); await wait(60);
    assert.equal(p.saved().hookupCity, "denver");
    assert.match(row((await load("?customRent=2600&hookupCity=atlantis")).text()), /San Diego/);
    await p.click("Sources & data provenance");
    assert.match(p.text(), /2026 System Development Charges — Denver Water.*Rates and Fees \(Impact Fees\) — Austin Water.*ADU System Development Charge Waiver — City of Portland/);
  });
});

describe("streamlined layout", () => {
  test("Summary: no duplicate post-loan card, no empty tax bar, net equity starts as one line", async () => {
    const p = await load("?customRent=2600&cashDown=20&view=consumer");
    const t = p.text();
    assert.doesNotMatch(t, /Life after the loan/);
    assert.doesNotMatch(t, /Income tax \(not modeled/);
    const chart = () => p.doc.querySelectorAll(".screen-only svg[role=img]")[1].querySelectorAll("path[fill=none]").length;
    assert.equal(chart(), 1);
    await p.click("Show what makes it up");
    assert.equal(chart(), 4);
    assert.match((await load("?customRent=2600&incomeTax=24&view=consumer")).text(), /Income tax \(24% marginal rate\)/);
  });
  test("Full model: contingency and margin together, breakdown last, notes collapsed", async () => {
    const p = await load("?customRent=2600");
    const t = p.text();
    assert.match(t, /Contingency & builder margin.*Budget confidence.*Build time.*Where the money goes.*All-in build cost/);
    assert.match(t, /Monthly payment: \$[\d,]+\/moTotal repaid/);
    assert.match(t, /How the numbers work/);
    assert.doesNotMatch(t, /How rental income is taxed/);
    await p.click("How the numbers work");
    assert.match(p.text(), /How rental income is taxed/);
  });
});

describe("consumer summary", () => {
  test("leads with the verdict, then one compact scenario card", async () => {
    const p = await load("?customRent=2600&cashDown=20&view=consumer");
    const t = p.text();
    assert.match(t, /Your ADU Investment Summary.*The short answerAt \$2,600\/mo rent, this \$[\d,]+ project.*Your scenarioMonthly rent.*Down payment\$59,830 \(20%\).*Loan term10 years · 7\.5%.*Estimated total return/);
    assert.equal(p.doc.querySelectorAll(".screen-only input[type=range]").length >= 3, true);
  });
  test("asks for rent before showing a verdict", async () => {
    const t = (await load("?sqft=600&view=consumer")).text();
    assert.doesNotMatch(t, /The short answer/);
    assert.match(t, /Monthly rent — required.*Enter the rent you'd charge to see the analysis/);
  });
  test("one 'full picture' card covers value, cash flow and ongoing income", async () => {
    const t = (await load("?customRent=2600&cashDown=20&view=consumer")).text();
    assert.doesNotMatch(t, /What you have/);
    assert.match(t, /The full picture when the loan is paid off.*A fully paid-off ADU.*Total return.*Ongoing rental income.*Multigenerational flexibility/);
  });
});

describe("Full model layout", () => {
  test("inputs on the left, rent field and results on the right, reference below", async () => {
    const { doc } = await load("?customRent=2600");
    const grid = doc.querySelector(".int-grid");
    assert.ok(grid.querySelector(".int-inputs").textContent.includes("Construction cost"));
    const results = grid.querySelector(".int-results");
    assert.ok(results.querySelector("#rentAmt"));
    assert.match(results.textContent, /Break-even rent.*Payback/);
    assert.ok(!grid.textContent.includes("Reading the results"), "legend sits below the grid");
  });
  test("sections follow build → finance → revenue → taxes & insurance → value", async () => {
    const { doc } = await load("?customRent=2600");
    const sections = [...doc.querySelectorAll(".int-inputs [role=button][aria-expanded]")].map(b => b.firstElementChild.textContent);
    assert.deepEqual(sections, ["Construction cost", "Financing", "Revenue", "Taxes & insurance", "Value & selling", "Report details"]);
    const sectionText = name => [...doc.querySelectorAll(".int-inputs [role=button][aria-expanded]")].find(b => b.firstElementChild.textContent === name).parentElement.textContent;
    assert.match(sectionText("Construction cost"), /Build timeConstruction period/);
    assert.match(sectionText("Revenue"), /Annual rent growth.*Vacancy allowance.*Property management.*Maintenance reserve/);
    assert.match(sectionText("Taxes & insurance"), /Property tax.*Property tax growth.*Insurance.*Insurance growth.*Marginal income tax rate/);
    assert.match(sectionText("Value & selling"), /Value multiplier/);
  });
  test("narrow-screen bar shows rent vs. break-even and payback", async () => {
    const { doc } = await load("?customRent=2600");
    assert.match(doc.querySelector(".mini-bar").textContent, /Total.*Payment.*vs\. break-even.*Payback/);
  });
});

describe("project-type templates", () => {
  const pick = async (p, label) => {
    const b = [...p.doc.querySelectorAll("[role=radiogroup][aria-labelledby=ptype-label] button")].find(b => b.textContent.startsWith(label));
    b.click(); await wait(60);
  };
  test("the default scenario is the detached template, unmodified", async () => {
    const p = await load("?customRent=2600");
    assert.equal(p.doc.querySelector("[role=radio][aria-checked=true]").textContent.startsWith("Detached new build"), true);
    assert.doesNotMatch(p.text(), /Customized from/);
  });
  test("a garage conversion fills in consistent costs", async () => {
    const p = await load("?customRent=2000");
    await pick(p, "Garage conversion");
    const s = p.saved();
    assert.equal(s.projectType, "garage");
    assert.equal(s.sqft, 400);
    assert.equal(s.hookup, 0, "no utility connection fee for converted space");
    assert.equal(s.sitePrep, 1000);
    assert.match(p.text(), /Total est\.\$1\d\d,\d{3}/, "a garage conversion costs far less than the detached default");
    assert.doesNotMatch(p.text(), /Customized from/);
  });
  test("a junior ADU needs no foundation, grading or trenching", async () => {
    const p = await load("?customRent=1600");
    await pick(p, "Junior ADU");
    const t = p.text();
    assert.match(t, /FoundationInside the existing house — no foundation work\$0/);
    assert.match(t, /Grading, demo & accessNo site work\$0/);
    assert.match(t, /Utility trenchingUses the house's existing utilities\$0/);
  });
  test("editing a line marks the template customized, and reset restores it", async () => {
    const prefab = "?projectType=prefab&permits=9000&design=3000&markup=10&buildMonths=4&access=open&crane=1&customRent=2600";
    const p = await load(prefab + "&cpsf=220");
    assert.doesNotMatch(p.text(), /Customized from/);
    const p2 = await load(prefab + "&cpsf=260");
    assert.match(p2.text(), /Customized from the prefab \/ modular template/);
    await p2.click("Reset to template");
    assert.equal(p2.saved().cpsf, 220);
    assert.doesNotMatch(p2.text(), /Customized from/);
  });
  test("the type appears in the Summary header and the report", async () => {
    const p = await load("?customRent=2000&projectType=garage&sqft=400&view=consumer");
    assert.match(p.text(), /400 sq ft studio garage conversion/);
    assert.match(p.report().textContent, /400 sq ft studio garage conversion/);
  });
});

describe("site facts", () => {
  const breakdown = t => Object.fromEntries([...t.matchAll(/(Foundation|Grading, demo & access|Utility trenching|Electrical|Surveys & reports)(?: \(counted in soft costs\))?([^$]*?)(\$[\d,]+)/g)].map(m => [m[1], money(m[3])]));
  test("the default facts reproduce the default site-work dollars", async () => {
    const p = await load("?customRent=2600");
    const b = breakdown(p.text());
    assert.deepEqual(b, { "Foundation": 10000, "Grading, demo & access": 8000, "Utility trenching": 8000, "Electrical": 3000, "Surveys & reports": 3500 });
    assert.match(p.text(), /Site subtotal\$31,000/);
  });
  test("a steep lot on expansive clay costs what it should", async () => {
    const b = breakdown((await load("?customRent=2600&slope=steep&soil=clay")).text());
    assert.equal(b["Foundation"], 43500, "600 sq ft × $58 × 1.25");
    assert.equal(b["Grading, demo & access"], 16000, "side-yard access + steep grading");
    assert.equal(b["Surveys & reports"], 7000, "boundary survey + full geotechnical report");
  });
  test("a long run through rock with a sewer pump and gas line", async () => {
    const b = breakdown((await load("?customRent=2600&soil=rock&trenchFt=150&sewerPump=1&gasLine=1")).text());
    assert.equal(b["Utility trenching"], 150 * 100 * 1.6 + 8000 + 150 * 20);
  });
  test("a small panel with an all-electric unit needs a service upgrade", async () => {
    assert.equal(breakdown((await load("?customRent=2600&panel=small")).text())["Electrical"], 5000 + 1000 + 1500);
  });
  test("switching to dollar amounts keeps the numbers the facts produced", async () => {
    const p = await load("?customRent=2600&slope=steep&soil=clay");
    const before = p.text().match(/Total est\.(\$[\d,]+)/)[1];
    await p.click("Enter dollar amounts");
    assert.equal(p.saved().foundation, 43500);
    assert.equal(p.saved().siteMode, "dollars");
    assert.equal(p.text().match(/Total est\.(\$[\d,]+)/)[1], before);
    assert.equal(p.doc.querySelector("input[aria-label='Foundation in dollars']").value, "43,500");
  });
  test("each template's facts produce its site costs, and editing a fact marks it customized", async () => {
    const p = await load("?customRent=2000");
    const b = [...p.doc.querySelectorAll("[role=radiogroup][aria-labelledby=ptype-label] button")].find(b => b.textContent.startsWith("Garage conversion"));
    b.click(); await wait(60);
    assert.equal(breakdown(p.text())["Foundation"], 3000);
    assert.doesNotMatch(p.text(), /Customized from/);
    const slope = [...p.doc.querySelectorAll("[role=radiogroup][aria-label=Demolition] button")].find(b => b.textContent === "Shed or patio");
    slope.click(); await wait(60);
    assert.match(p.text(), /Customized from the garage conversion template/);
  });
  test("the report says how site work was estimated", async () => {
    assert.match((await load("?customRent=2600")).report().textContent, /Site work is estimated from site facts — foundation: 600 sq ft slab on flat ground.*electrical: subpanel off a 200A panel/);
  });
});

describe("what if you sold", () => {
  const ledger = t => {
    const part = t.match(/What if you sold\?(.*?)Stress tests/)[1];
    const get = re => { const m = part.match(re); return m ? money(m[1]) : 0; };
    return {
      value: get(/adds to the sale price.*?([+−]\$[\d,]+)/), costs: get(/Selling costs \(\d+(?:\.\d)?%\).*?([+−]\$[\d,]+)/),
      bal: get(/Pay off the remaining loan([+−]\$[\d,]+)/), recapture: get(/Depreciation recapture tax.*?([+−]\$[\d,]+)/),
      nol: get(/losses released.*?([+−]\$[\d,]+)/), proceeds: get(/Cash from the sale(\$[\d,]+|−\$[\d,]+)/),
      cash: get(/minus your down payment.*?([+−]\$[\d,]+)/), net: part.match(/What you'd walk away with.*?([+−]\$[\d.]+[kM]?)/)[1],
    };
  };
  test("the ledger adds up", async () => {
    const l = ledger((await load("?customRent=2600&cashDown=20&incomeTax=32&saleYear=8&view=consumer")).text());
    assert.ok(l.bal < 0 && l.recapture < 0 && l.costs < 0, JSON.stringify(l));
    assert.ok(Math.abs(l.value + l.costs + l.bal + l.recapture + l.nol - l.proceeds) <= 3, JSON.stringify(l));
  });
  test("selling at loan payoff with no costs or tax equals the full picture's total return", async () => {
    const t = (await load("?customRent=2600&cashDown=20&saleYear=10&sellCost=0&view=consumer")).text();
    const picture = t.match(/Total return[^+−]*([+−]\$[\d.]+k)✓/)[1];
    assert.equal(ledger(t).net, picture);
  });
  test("recapture only with income tax; selling costs and sale year are set in Value & selling", async () => {
    assert.doesNotMatch((await load("?customRent=2600&saleYear=8&view=consumer")).text(), /Depreciation recapture tax/);
    const f = (await load("?customRent=2600&sellCost=4")).text();
    assert.match(f, /Value & selling.*Selling costs.*4% of sale.*Sell after.*10 years of renting.*If sold then: about \$[\d,]+ from the sale/);
  });
  test("can be turned off: no card, no selling settings, no report note", async () => {
    const c = await load("?customRent=2600&saleOn=0&view=consumer");
    assert.doesNotMatch(c.text(), /What if you sold\?/);
    assert.doesNotMatch(c.report().textContent, /If sold after/);
    const f = (await load("?customRent=2600&saleOn=0")).text();
    assert.match(f, /Include a sale scenarioOff — for owners who plan to keep the ADU/);
    assert.doesNotMatch(f, /Selling costs|Sell after/);
    assert.match(f, /Value multiplier/, "the ADU's value still counts");
  });
  test("a homeowner can hide the card from the Summary", async () => {
    const p = await load("?customRent=2600&view=consumer");
    await p.click("Not planning to sell? Hide this");
    assert.doesNotMatch(p.text(), /What if you sold\?/);
    assert.equal(p.saved().saleOn, false);
  });
  test("a loan paid off by the sale year shows no payoff line", async () => {
    const t = (await load("?customRent=2600&cashDown=20&saleYear=10&view=consumer")).text();
    assert.doesNotMatch(t, /Pay off the remaining loan/);
    assert.match(t, /with the loan paid off/);
  });
  test("the report includes the sale scenario", async () => {
    assert.match((await load("?customRent=2600&saleYear=12")).report().textContent, /If sold after 12 years of renting: .* leaves \$[\d,]+ — a net gain of/);
  });
});

describe("tax loss carryover", () => {
  const taxTotal = r => {
    const table = [...r.querySelectorAll("table")].at(-1);
    const head = [...table.querySelectorAll("th")].map(th => th.textContent), i = head.indexOf("Income tax");
    const total = [...table.querySelectorAll("tbody tr")].at(-1).children[i].textContent;
    return Number(total.replace(/[(),]/g, "")) || 0;
  };
  test("only offered when income tax is modeled", async () => {
    assert.doesNotMatch((await load("?customRent=2600")).text(), /Carry rental losses forward/);
    assert.match((await load("?customRent=2600&incomeTax=32")).text(), /Carry rental losses forward/);
  });
  test("carrying losses forward lowers total tax and raises the return", async () => {
    const qs = "?customRent=2600&cashDown=20&incomeTax=32&view=consumer"; // early-year paper losses at this rent
    const on = await load(qs), off = await load(qs + "&lossCarry=0");
    assert.ok(taxTotal(on.report()) < taxTotal(off.report()), taxTotal(on.report()) + " vs " + taxTotal(off.report()));
    const ret = p => money(p.text().match(/Total return[^+−]*([+−]\$[\d.]+k)/)[1].replace("k", "")) ;
    assert.ok(ret(on) > ret(off));
    assert.match(on.report().textContent, /Early paper losses carry forward against later rental income/);
    assert.match(off.report().textContent, /Early paper losses are ignored/);
  });
});

describe("budget confidence", () => {
  const panel = t => {
    const m = t.match(/Quoted or known(\d+)%of the line-item budgetP50 \/ P80 build cost(\$[\d,]+) \/ (\$[\d,]+)50% \/ 80% chance it costs lessYour budget holds(?:≈ )?(\d+)%of the time, with (\d+)% contingencyContingency for P80(\d+)%of hard costs/);
    return m && { firmed: +m[1], p50: money(m[2]), p80: money(m[3]), holds: +m[4], have: +m[5], suggested: +m[6] };
  };
  // Independent re-derivation: each status is a 90% band; lines combine as independent normals.
  const Z90 = 1.6449, Z80 = 0.8416, hard = 180000 + 10000 + 8000 + 8000 + 3000 + 2000;
  const lines = [180000, 10000, 8000, 8000, 3000, 2000, 10000, 8000, 8000, 3500];
  const expect = range => {
    const base = lines.reduce((s, x) => s + x * 1.2, 0);
    const sigma = Math.sqrt(lines.reduce((s, x, i) => s + (x * 1.2 * range[i] / Z90) ** 2, 0));
    const phi = z => 0.5 * (1 + Math.sign(z) * Math.sqrt(1 - Math.exp(-2 * z * z / Math.PI)));   // close approximation
    return { p50: base, p80: base + Z80 * sigma, suggested: Math.ceil(Z80 * sigma / hard * 100 - 1e-9), holds: sigma ? phi(10550 / sigma) * 100 : 100 };
  };
  test("is off by default", async () => {
    const t = (await load("?customRent=2600")).text();
    assert.match(t, /Track how firm each cost is/);
    assert.equal(panel(t), null);
  });
  test("all estimates: P50/P80, coverage and the P80 contingency follow from ±25% bands", async () => {
    const b = panel((await load("?customRent=2600&firmOn=1")).text());
    const e = expect(lines.map(() => 0.25));
    assert.equal(b.firmed, 0);
    assert.equal(b.p50, 288600);
    assert.ok(Math.abs(b.p80 - e.p80) <= 1, b.p80 + " vs " + e.p80);
    assert.equal(b.suggested, e.suggested);
    assert.ok(b.suggested >= 12 && b.suggested <= 15, "close to the 15% rule of thumb: " + b.suggested);
    assert.ok(Math.abs(b.holds - e.holds) <= 1.5, b.holds + " vs " + e.holds);
    assert.equal(b.have, 5);
  });
  test("quotes and known prices firm up the budget and lower the P80 contingency", async () => {
    const q = panel((await load("?customRent=2600&firmOn=1&firm=qqqqqqqqqqq")).text());
    assert.equal(q.firmed, 100);
    assert.equal(q.suggested, expect(lines.map(() => 0.10)).suggested);
    assert.ok(q.suggested >= 4 && q.suggested <= 6, "close to the 5% rule of thumb: " + q.suggested);
    assert.ok(q.holds >= 75, "5% contingency covers a fully quoted budget about 80% of the time: " + q.holds);
    const k = panel((await load("?customRent=2600&firmOn=1&firm=kkkkkkkkkkk")).text());
    assert.equal(k.suggested, 0);
    assert.equal(k.p80, k.p50);
    assert.equal(k.holds, 100);
  });
  test("ranks what drives the uncertainty", async () => {
    const t = (await load("?customRent=2600&firmOn=1")).text();
    const m = t.match(/What drives the uncertainty — firm these up first(.*?)Each status is read/)[1];
    assert.match(m, /^Structure \(estimate\)\d+%/, "structure dominates when everything is estimated");
    const q = (await load("?customRent=2600&firmOn=1&firm=qeeeeeeeeee")).text().match(/What drives the uncertainty — firm these up first(.*?)Each status is read/)[1];
    assert.match(q, /^Structure \(quote\)/, "still the biggest single line once quoted");
  });
  test("marking a line and applying the suggestion", async () => {
    const p = await load("?customRent=2600&firmOn=1&contingency=1");
    const group = p.doc.querySelector("[role=radiogroup][aria-label='Structure firmness']");
    [...group.querySelectorAll("button")].find(b => b.textContent === "Quote").click(); await wait(60);
    assert.equal(p.saved().firm, "qeeeeeeeeee");
    const b = panel(p.text());
    assert.ok(b.suggested < 13 && b.suggested >= 4, "quoting the structure cuts the contingency needed: " + b.suggested);
    await p.click("Use " + b.suggested + "% contingency");
    assert.equal(p.saved().contingency, b.suggested);
    assert.ok(panel(p.text()).holds >= 80 && panel(p.text()).holds <= 85, "P80 contingency → holds at least 80% of the time: " + panel(p.text()).holds);
  });
  test("bad firmness strings in a link are ignored; the report notes it when on", async () => {
    assert.equal((await load("?customRent=2600&firmOn=1&firm=zz")).saved()?.firm ?? "eeeeeeeeeee", "eeeeeeeeeee");
    assert.match((await load("?customRent=2600&firmOn=1")).report().textContent, /Budget confidence: 0% of line-item costs are quoted or known\. P50 build cost \$288,600, P80 \$[\d,]+; the budget, with 5% contingency, covers the build about \d+% of the time \(P80 needs \d+%\)\./);
  });
});

// Dollar input boxes, found by their accessible label ("<line> in dollars").
const box = (p, label) => [...p.doc.querySelectorAll("input[aria-label]")].find(i => i.getAttribute("aria-label") === label + " in dollars") ?? null;
async function enter(p, label, text, key) {
  const el = box(p, label);
  el.focus(); el.dispatchEvent(new p.w.FocusEvent("focusin", { bubbles: true })); await wait(20);
  Object.getOwnPropertyDescriptor(p.w.HTMLInputElement.prototype, "value").set.call(el, text);
  el.dispatchEvent(new p.w.Event("input", { bubbles: true }));
  if (key) el.dispatchEvent(new p.w.KeyboardEvent("keydown", { key, bubbles: true }));
  el.blur(); el.dispatchEvent(new p.w.FocusEvent("focusout", { bubbles: true }));
  await wait(60);
}

describe("where the money goes", () => {
  const steps = el => [...el.querySelectorAll("div[style*='grid-template-columns']")].map(r => [r.children[0]?.textContent, money(r.children[2]?.textContent)]).filter(([l, v]) => l && !Number.isNaN(v));
  test("the steps add up to the total, in both views", async () => {
    for (const view of ["internal", "consumer"]) {
      const p = await load("?customRent=2600&origFeeOn=1&furnishing=5000&view=" + view);
      const h = [...p.doc.querySelectorAll(".screen-only div")].find(d => /^Where the money goes$/i.test(d.textContent));
      const card = view === "internal" ? h.nextElementSibling : h.parentElement;
      const r = steps(card), total = r.find(([l]) => l === "Total project cost")[1];
      assert.equal(r.filter(([l]) => l !== "Total project cost").reduce((s, [, v]) => s + v, 0), total, view);
      assert.ok(r.some(([l]) => l === "Loan origination fee"), view + " shows the loan fee step");
    }
  });
  test("checks all-in $/sq ft against the typical range for the type", async () => {
    assert.match((await load("?customRent=2600")).text(), /All-in build cost: \$499\/sq ft — within the typical \$350–\$600\/sq ft for a detached ADU/);
    assert.match((await load("?customRent=2600&cpsf=600")).text(), /above the typical \$350–\$600\/sq ft for a detached ADU\. Check the \$\/sq ft/);
    assert.match((await load("?customRent=2600&cpsf=100&siteMode=dollars&foundation=0&sitePrep=0&utilTrench=0&electrical=0&hardscape=0")).text(), /below the typical .*Make sure nothing is missing/);
  });
});

describe("loan origination fee in the Summary", () => {
  test("shows build cost + fee = project cost when the fee is on", async () => {
    const t = (await load("?customRent=2600&origFeeOn=1&origFee=5&view=consumer")).text();
    assert.match(t, /\$299,150 to build \+ \$14,958 loan fee = \$314,108 project/);
    assert.match(t, /Loan origination fee: \$14,958 \(5% of the \$299,150 build cost\), added to the project price and financed\./);
  });
  test("is absent when there's no fee", async () => {
    assert.doesNotMatch((await load("?customRent=2600&view=consumer")).text(), /loan fee|origination fee/i);
  });
});

describe("total return headline", () => {
  test("the first card is the same figure as the full picture and the verdict", async () => {
    const p = await load("?customRent=2600&cashDown=20&view=consumer");
    const t = p.text();
    const hero = t.match(/At loan payoff · Year 10\.5([+−]\$[\d.]+k)/)[1];
    const picture = t.match(/Total return[^+−]*([+−]\$[\d.]+k)✓/)[1];
    assert.equal(hero, picture);
    assert.match(t, new RegExp("builds an estimated \\" + hero.replace("+", "").replace(".", "\\.") + " of net equity by loan payoff"));
    assert.match(t, /At loan payoff · Year 10\.5.*15 years.*20 years/);
  });
  test("all-cash projects headline the chosen horizon", async () => {
    assert.match((await load("?customRent=2600&cashDown=100&horizon=15&view=consumer")).text(), /Estimated total returnYear 15[+−]\$[\d.]+k.*20 years.*25 years/);
  });
});

describe("dollar amounts mode", () => {
  test("every site line has a visible dollar box", async () => {
    const p = await load("?customRent=2600&siteMode=dollars");
    for (const l of ["Foundation", "Grading, demo & access", "Utility trenching", "Electrical panel upgrade", "Hardscape & path", "Surveys & reports"])
      assert.ok(box(p, l), l);
    assert.equal(box(p, "Foundation").value, "10,000");
    assert.equal(box(await load("?customRent=2600"), "Foundation"), null, "facts mode has no foundation box");
  });
  test("typing a quote into a box sets it, with $ , and k shorthand", async () => {
    const p = await load("?customRent=2600&siteMode=dollars");
    await enter(p, "Foundation", "$11,240");
    assert.equal(p.saved().foundation, 11240);
    assert.equal(box(p, "Foundation").value, "11,240");
    await enter(p, "Utility trenching", "14.5k");
    assert.equal(p.saved().utilTrench, 14500);
    await enter(p, "Grading, demo & access", "75000");
    assert.equal(p.saved().sitePrep, 75000, "boxes go past the slider's range");
  });
  test("Escape and nonsense leave the value alone", async () => {
    const p = await load("?customRent=2600&siteMode=dollars");
    await enter(p, "Foundation", "99999", "Escape");
    await enter(p, "Electrical panel upgrade", "lots");
    assert.equal(box(p, "Foundation").value, "10,000");
    assert.equal(box(p, "Electrical panel upgrade").value, "3,000");
  });
});

describe("typed values", () => {
  const editor = (p, label) => {
    const lab = [...p.doc.querySelectorAll(".screen-only span[id]")].find(s => s.textContent.startsWith(label));
    return lab.closest("div[style*='column']").querySelector("button[title^='Click to type']");
  };
  const typeInto = async (p, label, text, key = "Enter") => {
    editor(p, label).click(); await wait(40);
    const input = p.doc.querySelector("input[aria-label='Type a value']");
    Object.getOwnPropertyDescriptor(p.w.HTMLInputElement.prototype, "value").set.call(input, text);
    input.dispatchEvent(new p.w.Event("input", { bubbles: true }));
    input.dispatchEvent(new p.w.KeyboardEvent("keydown", { key, bubbles: true }));
    input.blur?.(); input.dispatchEvent(new p.w.FocusEvent("focusout", { bubbles: true }));
    await wait(60);
  };
  test("every cost line has a dollar box; quotes can be typed with $ , and k", async () => {
    const p = await load("?customRent=2600");
    for (const l of ["Structure cost per sq ft", "Permits, plan check & inspections", "Water & sewer fees", "Design & engineering", "Furnishing"]) assert.ok(box(p, l), l);
    await enter(p, "Permits, plan check & inspections", "$11,240");
    assert.equal(p.saved().permits, 11240);
    await enter(p, "Design & engineering", "12.5k");
    assert.equal(p.saved().design, 12500);
    assert.equal(box(p, "Design & engineering").value, "12,500");
    await enter(p, "Structure cost per sq ft", "287");
    assert.equal(p.saved().cpsf, 287);
  });
  test("typed values can exceed the slider's range, within the field's limits", async () => {
    const p = await load("?customRent=2600");
    await enter(p, "Water & sewer fees", "85000");
    assert.equal(p.saved().hookup, 85000, "slider stops at $60k");
    await enter(p, "Water & sewer fees", "9999999");
    assert.equal(p.saved().hookup, 300000, "clamped to the field limit");
  });
  test("decimals are kept where the slider allows them; garbage and Escape change nothing", async () => {
    const p = await load("?customRent=2600");
    await typeInto(p, "Interest rate", "7.25%");
    assert.equal(p.saved().rate, 7.25);
    await typeInto(p, "Interest rate", "abc");
    assert.equal(p.saved().rate, 7.25);
  });
  test("a typed value beyond the slider survives a share link", async () => {
    const p = await load("?customRent=2600&permits=45000");
    assert.equal(box(p, "Permits, plan check & inspections").value, "45,000");
  });
});

describe("header actions", () => {
  test("Copy model link is the rightmost header button in both views", async () => {
    for (const view of ["internal", "consumer"]) {
      const { doc } = await load("?customRent=2600&view=" + view);
      const h1 = doc.querySelector(".screen-only h1");
      const buttons = [...h1.parentElement.parentElement.querySelectorAll("button")].map(b => b.textContent);
      assert.equal(buttons.at(-1), "Copy model link", view);
      assert.equal(buttons.at(-2), "Print / Save as PDF", view);
    }
  });
});

describe("printed report", () => {
  const rows = (table) => [...table.querySelectorAll("tbody tr")].map(tr => [...tr.children].map(td => td.textContent));
  const acct = v => v === "—" ? 0 : (v.startsWith("(") ? -1 : 1) * Number(v.replace(/[(),]/g, ""));
  test("is separate from the screen UI and identical from either view", async () => {
    const a = (await load("?customRent=2600&cashDown=20&customName=Smith%20ADU")).report();
    const b = (await load("?customRent=2600&cashDown=20&customName=Smith%20ADU&view=consumer")).report();
    assert.ok(a && !a.closest(".screen-only"));
    assert.equal(a.textContent.replace(/Prepared [^E]+/, ""), b.textContent.replace(/Prepared [^E]+/, ""));
    assert.match(a.textContent, /ADU Investment Analysis.*Smith ADU.*Prepared/);
  });
  test("leads with a verdict and key figures that match the screen", async () => {
    const p = await load("?customRent=2600&cashDown=20&view=consumer");
    const t = p.report().textContent;
    assert.match(t, /At \$2,600\/mo rent, this \$[\d,]+ project needs about \$\d[\d,]*\/mo of support in its first rental year, turns cash-flow positive in year [\d.]+(?: \(once the loan is paid off\))?, pays back everything invested by year [\d.]+, and builds an estimated/);
    assert.ok(t.includes(p.card("Payback period")), "payback matches");
  });
  test("cost table adds up to the total", async () => {
    const r = (await load("?customRent=2600&furnishing=5000&origFeeOn=1")).report();
    const cost = rows(r.querySelector("table"));
    const items = cost.slice(0, -1).reduce((s, [, v]) => s + money(v), 0);
    assert.equal(cost.at(-1)[0], "Total project cost");
    assert.equal(items, money(cost.at(-1)[1]));
  });
  test("annual projection reconciles: net flows sum to final cumulative cash", async () => {
    const r = (await load("?customRent=2600&cashDown=20&incomeTax=24")).report();
    const table = [...r.querySelectorAll("table")].at(-1);
    const head = [...table.querySelectorAll("th")].map(th => th.textContent);
    const body = rows(table), data = body.slice(0, -1), total = body.at(-1);
    const iNet = head.indexOf("Net cash flow"), iCum = head.indexOf("Cumulative cash");
    assert.ok(head.includes("Income tax"));
    const sum = data.reduce((s, row) => s + acct(row[iNet]), 0);
    assert.ok(Math.abs(sum - acct(data.at(-1)[iCum])) <= data.length, sum + " vs " + data.at(-1)[iCum]);
    assert.ok(Math.abs(acct(total[iNet]) - sum) <= data.length);
    assert.doesNotMatch(table.textContent, /-0\b|NaN|undefined/);
  });
  test("charts scale to the page instead of clipping", async () => {
    const r = (await load("?customRent=2600")).report();
    const svgs = r.querySelectorAll("svg[role=img]");
    assert.equal(svgs.length, 2);
    for (const svg of svgs) { assert.ok(svg.getAttribute("viewBox")); assert.equal(svg.style.width, "100%"); }
  });
  test("asks for a rent when there isn't one", async () => {
    assert.match((await load("?sqft=600")).report().textContent, /Enter the rent/);
  });
});

describe("stress tests", () => {
  const rows = p => [...p.doc.querySelectorAll(".screen-only table tbody tr")].map(tr => {
    const td = [...tr.querySelectorAll("td")];
    return { label: td[0].textContent, payback: parseFloat(td[2].textContent), ret: money(td[3].firstChild.textContent) * (/k$/.test(td[3].firstChild.textContent) ? 1000 : 1) };
  });
  test("cover rate, lease-up, rent and cost shocks, each worse than the base case", async () => {
    const r = rows(await load("?customRent=2600&cashDown=20&view=consumer"));
    assert.deepEqual(r.map(x => x.label), ["Base case", "Rent 10% below estimate", "Rent 20% below estimate", "First 3 months vacant", "Loan rate 1% higher", "Construction 15% over budget", "Construction 25% over budget"]);
    for (const x of r.slice(1)) assert.ok(x.ret < r[0].ret, x.label + " lowers the return");
    assert.ok(r[4].payback > r[0].payback, "higher rate delays payback");
  });
  test("all-cash projects skip the loan-rate test", async () => {
    const r = rows(await load("?customRent=2600&cashDown=100&view=consumer"));
    assert.ok(!r.some(x => /Loan rate/.test(x.label)));
    assert.equal(r.length, 6);
  });
});

describe("all-cash consumer view", () => {
  test("hides loan-only cards and offers a horizon instead", async () => {
    const t = (await load("?customRent=2600&cashDown=100&view=consumer")).text();
    assert.doesNotMatch(t, /Loan term|Loan paid off|Life after the loan/);
    assert.match(t, /Years to evaluate10 years/);
    assert.match(t, /paid in cash/);
  });
  test("the horizon sets how far out the summary looks", async () => {
    const t = (await load("?customRent=2600&cashDown=100&horizon=20&view=consumer")).text();
    assert.match(t, /The full picture after 20 years/);
    assert.match(t, /Income in year 20/);
  });
});

describe("charts", () => {
  test("completion shows as a step with its own hover point", async () => {
    const p = await load("?customRent=2600&cashDown=20&view=consumer");
    const svgs = p.doc.querySelectorAll(".screen-only svg[role=img]");
    assert.equal(svgs.length, 2);
    // Hover each target on the net-equity chart until the completion point's tooltip appears.
    const targets = [...svgs[1].querySelectorAll("rect[fill=transparent]")];
    let found = false;
    for (const r of targets) {
      r.dispatchEvent(new p.w.MouseEvent("mouseover", { bubbles: true }));
      await wait(10);
      if (/Build complete \(month 6\)/.test(p.text())) { found = true; break; }
    }
    assert.ok(found, "tooltip for the completion point");
  });
});

describe("accessibility", () => {
  test("controls are labelled buttons and sliders", async () => {
    const { doc } = await load("?customRent=3000");
    const ranges = [...doc.querySelectorAll("input[type=range]")];
    assert.ok(ranges.length > 20);
    for (const r of ranges) assert.ok(doc.getElementById(r.getAttribute("aria-labelledby")), "slider label");
    assert.ok(doc.querySelector("button[role=switch]"));
    assert.equal(doc.querySelectorAll("[role=radiogroup][aria-label='Rental strategy'] button[role=radio]").length, 3);
  });
});
