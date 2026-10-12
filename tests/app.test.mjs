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
  const readout = t => t.match(/About (\$[\d,]+) of interest over the (\d+)-month build, on an average drawn balance of (\$[\d,]+)/);
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

describe("consumer summary", () => {
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
    assert.ok(grid.querySelector(".int-inputs").textContent.includes("Project Costs"));
    const results = grid.querySelector(".int-results");
    assert.ok(results.querySelector("#rentAmt"));
    assert.match(results.textContent, /Break-even rent.*Payback/);
    assert.ok(!grid.textContent.includes("Reading the results"), "legend sits below the grid");
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
    assert.match(p.text(), /Foundation\?\$43,500/);
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
  test("an exact quote can be typed, with $ , and k shorthand", async () => {
    const p = await load("?customRent=2600&siteMode=dollars");
    await typeInto(p, "Permits", "$11,240");
    assert.equal(p.saved().permits, 11240);
    await typeInto(p, "Foundation", "12.5k");
    assert.equal(p.saved().foundation, 12500);
    assert.match(p.text(), /Foundation\?\$12,500/);
  });
  test("typed values can exceed the slider's range, within the field's limits", async () => {
    const p = await load("?customRent=2600");
    await typeInto(p, "Water & sewer fees", "85000");
    assert.equal(p.saved().hookup, 85000, "slider stops at $60k");
    await typeInto(p, "Water & sewer fees", "9999999");
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
    assert.match(p.text(), /Permits, plan check & inspections\?\$45,000/);
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
