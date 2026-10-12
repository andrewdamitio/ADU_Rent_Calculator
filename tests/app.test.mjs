// End-to-end tests: load the built index.html in jsdom with a scenario in the URL and
// check what the page shows. Run with `npm test` (which rebuilds index.html first).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const SK = "adu-calc-v16";
const wait = ms => new Promise(r => setTimeout(r, ms));

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
  await wait(250);
  const w = dom.window, doc = w.document;
  return {
    w, doc, errors,
    // Visible text only (the inline bundle lives outside #root).
    text: () => doc.getElementById("root").textContent,
    click: label => { const b = [...doc.querySelectorAll("button")].find(b => b.textContent.includes(label)); assert.ok(b, "button " + label); b.click(); return wait(60); },
    // Text of the value element that follows a card label.
    card: label => { const el = [...doc.querySelectorAll("div")].find(e => e.textContent === label); return el?.nextElementSibling?.textContent ?? null; },
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
  test("year-1 card matches the monthly breakdown; post-loan card matches 'Life after the loan'", async () => {
    const p = await load("?customRent=2600&cashDown=20&view=consumer");
    const t = p.text();
    assert.ok(p.card("Year-1 cash flow").startsWith(t.match(/([+−]?\$[\d,]+)\/moNet (income|subsidy) in rental year 1/)[1]));
    assert.ok(p.card("Income after the loan").startsWith(t.match(/onward(−?\$[\d,]+)\/mo/)[1]));
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
    const hero = async bm => (await load(`?customRent=2600&buildMonths=${bm}&conIntMode=none&view=consumer`)).text().match(/10 years([+−]\$[\d.]+k)/)[1];
    assert.notEqual(await hero(0), await hero(12));
  });
  test("operating-expense % uses the user's rent", async () => {
    const pct = async r => (await load(`?customRent=${r}`)).text().match(/Eff\. rate(\d+)%/)[1];
    assert.notEqual(await pct(1500), await pct(4000));
  });
});

describe("cost model", () => {
  test("furnishings are excluded from depreciation", async () => {
    const dep = async f => money((await load(`?customRent=2600&furnishing=${f}&conIntMode=none`)).text().match(/depreciation \((\$[\d,]+)\/yr/)[1]);
    assert.equal(await dep(0), await dep(10000));
  });
  test("contingency is its own line, not part of soft costs", async () => {
    const t = (await load("?customRent=2600")).text();
    // permits 10,000 + water/sewer 8,000 + design 8,000 + surveys 3,500 + furnishing 0
    assert.match(t, /Soft cost subtotal\$29,500/);
    assert.match(t, /Soft cost subtotal\$29,500Contingency/);
  });
});

describe("construction-period interest", () => {
  const readout = t => t.match(/About (\$[\d,]+) of interest over the (\d+)-month build, on an average drawn balance of (\$[\d,]+)/);
  test("interest accrues on the S-curve draw balance", async () => {
    // Defaults: $261,650 project, $0 down, 6 months, 7.5%. Soft costs ($35,400 with markup) are drawn
    // up front and hard costs follow the S-curve, so the average drawn balance is ~48% of the loan.
    const m = readout((await load("?customRent=2600")).text());
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

describe("consumer summary", () => {
  test("one 'full picture' card covers value, cash flow and ongoing income", async () => {
    const t = (await load("?customRent=2600&cashDown=20&view=consumer")).text();
    assert.doesNotMatch(t, /What you have/);
    assert.match(t, /The full picture when the loan is paid off.*A fully paid-off ADU.*Total return.*Ongoing rental income.*Multigenerational flexibility/);
  });
});

describe("all-cash consumer view", () => {
  test("hides loan-only cards and offers a horizon instead", async () => {
    const t = (await load("?customRent=2600&cashDown=100&view=consumer")).text();
    assert.doesNotMatch(t, /Interest rate on your loan|How long is your loan|Loan paid off|Life after the loan/);
    assert.match(t, /How many years should we look at\?/);
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
    const svgs = p.doc.querySelectorAll("svg[role=img]");
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
