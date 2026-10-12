import React, { StrictMode, useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, useId } from "react";
import { createRoot } from "react-dom/client";

// localStorage can throw (private mode, blocked site data) — never let that break the page.
const store={
  get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},
  set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},
  del:k=>{try{localStorage.removeItem(k)}catch(e){}},
};

// 1BR (600 sq ft) rent range across major metros, 2025–2026 — the low/high anchors shown beside the rent field.
const RENT_1BR_LO=1200,RENT_1BR_HI=3500,RENT_1BR_US=1900;
const rs=s=>Math.pow(s/600,0.55),ut=s=>s<450?"Studio":s<700?"1 Bed":s<950?"1–2 Bed":"2 Bed";
const cMP=(p,r,y)=>{if(p<=0)return 0;const mr=r/12,n=y*12;if(mr===0)return p/n;return p*(mr*Math.pow(1+mr,n))/(Math.pow(1+mr,n)-1)};

// The one monthly simulation every number on the page reads from.
// Time counts in months from project start. The first buildMo months are construction;
// rent and amortizing loan payments both start at month buildMo.
//
// Construction draws follow standard construction-lending practice:
//  - soft costs (design, permits, utility fees, surveys, loan fee) are paid at the start,
//  - the owner's cash goes in first (lenders require equity before they fund),
//  - hard costs are funded monthly in arrears as work is inspected, along an S-curve
//    (slow mobilization, fast framing/rough-in, slow finish work),
//  - 5% retention is held back until completion (California caps private-works
//    retention at 5%), and furnishings are bought at completion.
// Interest accrues only on what has been drawn. It's either paid monthly (HELOCs and
// most construction-to-permanent loans), capitalized into the loan at conversion, or
// not charged. Either way it's a cost of producing the building, so for tax purposes it
// is capitalized into the depreciation basis (IRC §263A) rather than deducted.
const SIM_YEARS=50,DEP_MONTHS=330; // 27.5-year residential depreciation
const RETENTION=0.05;
function runModel(p){
  const{loanAmt,cashDown,annRate,termYr,buildMo,grossY1,collectPct,opPct,mPTY1,mInsY1,rentGrowth,taxGrowthA,insGrowthA,taxMarg,depBasis,valueY1,valueGrowth,
    conMode="none",conRate=annRate,spendUp=0,spendEnd=0,leaseUp=0,lossCarry=false}=p;
  const bm=buildMo||0,n=termYr*12,mr=annRate/12;
  const mg=x=>x>0?Math.pow(1+x,1/12)-1:0;
  const mrG=mg(rentGrowth),mtG=mg(taxGrowthA),miG=mg(insGrowthA),mvG=mg(valueGrowth);
  const valueAt=k=>k<bm?0:valueY1*Math.pow(1+mvG,k-bm);

  // Cumulative project spend after k months of construction.
  const total=loanAmt+cashDown,hard=Math.max(0,total-spendUp-spendEnd);
  const spentAt=k=>{if(k>=bm)return total;const f=k/bm;return spendUp+hard*(1-RETENTION)*f*f*(3-2*f)};
  const conMr=loanAmt>0&&conMode!=="none"?conRate/12:0;
  let equity=0,drawn=0,capInt=0,conPaid=0,conBalSum=0,depTaken=0,basisTotal=depBasis;
  const spend=S=>{const e=Math.min(S,cashDown),d=Math.max(0,S-cashDown);const de=e-equity;equity=e;drawn=d;return de};

  // nol: rental tax losses carried forward (passive losses most owners can't use against other income).
  let cash=-spend(spentAt(0)),bal=drawn,pmt=0,dep=0,cfm=-1,subsidies=0,nol=0;
  const months=[]; // one entry per rented month; months[0] is the first rent check
  const snap=[{k:0,cash,bal,value:valueAt(0),tot:valueAt(0)-bal+cash,nol:0,depTaken:0}]; // position after k months
  let payK=cash>=0?0:-1;
  for(let k=0;k<bm+SIM_YEARS*12;k++){
    const m=k-bm;
    if(m<0){
      // Construction month: interest-only on the balance drawn so far, then this month's draw.
      const b=drawn+capInt,intr=b*conMr;
      conBalSum+=drawn;
      if(conMode==="cap")capInt+=intr;else{conPaid+=intr;cash-=intr}
      cash-=spend(spentAt(k+1));
      bal=drawn+capInt;
    }else{
      if(m===0){
        // Conversion: the permanent loan is everything drawn plus any capitalized interest.
        bal=drawn+capInt;pmt=cMP(bal,annRate,termYr);
        basisTotal=depBasis+capInt+conPaid;dep=basisTotal/27.5/12;
      }
      const rent=grossY1*Math.pow(1+mrG,m),coll=m<leaseUp?0:rent*collectPct,opex=coll*opPct;
      const pt=mPTY1*Math.pow(1+mtG,m),ins=mInsY1*Math.pow(1+miG,m);
      const noi=coll-opex-pt-ins;
      const inLoan=m<n&&bal>0.005;
      const interest=inLoan?bal*mr:0;
      const pay=inLoan?Math.min(pmt,bal+interest):0;
      const principal=pay-interest;
      bal=Math.max(0,bal-principal);
      const depM=m<DEP_MONTHS?dep:0;depTaken+=depM;
      let taxable=noi-interest-depM;
      if(lossCarry){if(taxable<0){nol-=taxable;taxable=0}else{const use=Math.min(nol,taxable);nol-=use;taxable-=use}}
      const tax=taxMarg>0&&taxable>0?taxable*taxMarg:0;
      const flow=noi-tax-pay;
      cash+=flow;
      if(m<n&&flow<0)subsidies-=flow;
      if(cfm<0&&flow>=0)cfm=m;
      months.push({rent,vacOpex:rent-coll+opex,pt,ins,tax,pay,interest,principal,noi,flow});
    }
    const kk=k+1,value=valueAt(kk);
    snap.push({k:kk,cash,bal,value,tot:value-bal+cash,nol,depTaken});
    // Payback is the LAST time cash turns non-negative, so a later dip un-does it.
    if(cash>=0){if(payK<0)payK=kk}else payK=-1;
  }
  const at=k=>snap[Math.min(Math.max(0,Math.round(k)),snap.length-1)];
  // Rental-year averages (y = 1 is the first 12 rent checks).
  const year=y=>{const sl=months.slice((y-1)*12,y*12);const a=key=>sl.reduce((s,x)=>s+x[key],0)/sl.length;
    return{year:y,rent:a("rent"),opEx:a("vacOpex"),propTax:a("pt"),ins:a("ins"),incomeTax:a("tax"),pmt:a("pay"),interest:a("interest"),principal:a("principal"),net:a("flow")}};
  return{
    pmt,months,snap,at,year,subsidies,loanEnd:bm+n,basisTotal,
    // Construction-period interest: total, the part paid out of pocket, the part added to the loan,
    // and the average drawn balance it accrued on.
    conInterest:conPaid+capInt,conPaid,conCap:capInt,conAvgDrawn:bm>0?conBalSum/bm:0,
    // CF+: years from project start until monthly after-tax cash flow is >= 0. 0 = from the first rent check.
    cfPlus:cfm<0?Infinity:cfm===0?0:(bm+cfm)/12,
    cfAtTerm:loanAmt>0&&cfm>=n,
    // Payback: years from project start until every dollar you put in (down payment, shortfalls,
    // construction interest) is back.
    po:payK<0?Infinity:payK/12,
  };
}
// Compound annual rate that turns `base` into `base + gain` over `years`.
const annualized=(gain,base,years)=>{if(!(base>0)||!(years>0))return null;const x=1+gain/base;return x<=0?-100:(Math.pow(x,1/years)-1)*100};
const fYr=v=>v===Infinity?"Never":v>50?"50+ yr":v.toFixed(1)+" yr";
const fD=n=>{const r=Math.round(n);return(r<0?"−$":"$")+Math.abs(r).toLocaleString()};
const fK=n=>{const a=Math.abs(n),s=n<0?"-":"+";return a>=1000?s+"$"+Math.round(a/1000)+"k":s+"$"+Math.round(a)};

const CI={"Rent":"Year-1 monthly rent at the current ADU size, as entered.\n\nIf STR mode is on, revenue is the nightly rate × 30.4 nights (before unbooked nights).","Net":"First-month rent minus operating expenses (pre-tax).\n\nProperty tax, insurance, maintenance, vacancy, management.","Cov.":"First-month pre-tax net rent ÷ loan payment.\n\nIgnores equity, rent growth, and income tax.\n100% = breakeven monthly.","+/−":"First-month pre-tax net rent minus loan payment.\n\nDoes NOT reflect rent growth or taxes.\n\nGreen = passive income.\nRed = monthly subsidy.","CF+":"Years from project start until monthly cash flow turns positive: rent after expenses and income tax, minus the loan payment.\n\n'Now' = positive from the first rent check.\n* = only turned positive because the loan ended.\n\nAccounts for rent growth AND income tax (interest + depreciation deductions shrink over time).","Payback":"Years from project start until the ADU has paid back every dollar you put in: your down payment plus any months where you covered a shortfall.\n\nUses after-tax cash flow after loan payments, so financing costs count. 'Immediate' = $0 down and never out of pocket.\n\nGreen ≤ term. Yellow ≤ 1.5×.\nRed = longer.","Equity":"Rough estimate of value added on day one: the value multiplier (a gross rent multiplier, set under Value & selling) × monthly long-term rent.\n\nSimplified heuristic — real appraisers use sales comparables first, income approach as a cross-check. The right multiplier varies sharply: coastal CA and Seattle have GRMs of 200–300×, so this likely understates value there. Midwest markets are closer to 80–120×.\n\nAlways uses LTR rent, not STR income.\n\nGreen = gross estimate exceeds ADU cost.","Return":"Your net position when the loan is paid off: the ADU's estimated value at that point, plus cumulative after-tax cash flow, minus your down payment.\n\nThe first % is the compound annual return on TOTAL PROJECT COST from project start to loan payoff (construction included) — the denominator is the full cost whether you financed it or not.\n\nThe second is the same on the cash you actually put in. It is undefined at 0% down, where you invested nothing."};

// Site work worked out from facts about the lot instead of raw dollar amounts. Typical
// 2025–2026 unit costs, set so the default detached scenario matches the earlier dollar defaults:
//  - Foundation, per sq ft of footprint by slope: slab on flat ground ~$16.70, stepped slab $20,
//    raised/crawl-space $30, engineered hillside $58. ×1.25 for expansive clay (post-tensioned
//    slab), ×1.15 for rock (excavation). An existing slab needs footing and moisture work, ~$7.50/sq ft.
//  - Grading & access: base by how equipment reaches the site, plus slope grading, a crane set
//    for prefab/modular units, and demolition.
//  - Trenching: ~$100/ft for one shared water/sewer/electric trench, ×1.6 in rock, +$8k for a
//    sewer ejector pump when the ADU sits below the main, +$20/ft for a gas line.
//  - Electrical: by headroom in the existing panel, plus capacity for an all-electric unit.
//  - Surveys: a boundary survey unless one is on file; a soil report for new foundations unless
//    the soil is known, upgraded to a full geotechnical report on steep lots.
const SITE={
  fdnRate:{flat:16.7,gentle:20,moderate:30,steep:58},soilMult:{known:1,unknown:1,clay:1.25,rock:1.15},existingSlab:7.5,
  access:{open:3000,side:8000,tight:15000},slopeGrade:{flat:0,gentle:1500,moderate:4000,steep:8000},crane:6000,
  demo:{none:0,small:3000,structure:10000},prepExisting:1000,
  trenchPerFt:100,rockTrench:1.6,pump:8000,gasPerFt:20,
  panel:{room:2000,full:4000,small:5000},allElectric:1000,smallAllElectric:1500,
  boundary:1500,soilReport:2000,geotech:5500,
};
const FACT_KEYS=["fdn","slope","soil","access","crane","demo","trenchFt","sewerPump","gasLine","panel","allElectric","boundary"];
const SITE_KEYS=["foundation","sitePrep","utilTrench","electrical","surveys"];
const r100=x=>Math.round(x/100)*100;
function siteFromFacts(f,sqft){
  const isNew=f.fdn==="new",inside=f.fdn==="none",rock=f.soil==="rock";
  const foundation=inside?0:f.fdn==="existing"?r100(sqft*SITE.existingSlab):r100(sqft*SITE.fdnRate[f.slope]*SITE.soilMult[f.soil]);
  const sitePrep=SITE.demo[f.demo]+(inside?0:f.fdn==="existing"?SITE.prepExisting:SITE.access[f.access]+SITE.slopeGrade[f.slope]+(f.crane?SITE.crane:0));
  const utilTrench=inside?0:r100(f.trenchFt*SITE.trenchPerFt*(rock?SITE.rockTrench:1)+(f.sewerPump?SITE.pump:0)+(f.gasLine?f.trenchFt*SITE.gasPerFt:0));
  const electrical=SITE.panel[f.panel]+(f.allElectric?SITE.allElectric:0)+(f.panel==="small"&&f.allElectric?SITE.smallAllElectric:0);
  const soilNeeded=isNew&&(f.soil!=="known"||f.slope==="moderate"||f.slope==="steep");
  const surveys=(f.boundary==="needed"?SITE.boundary:0)+(soilNeeded?(f.slope==="steep"?SITE.geotech:SITE.soilReport):0);
  const parts=a=>a.filter(Boolean).join(", ");
  const why={
    foundation:inside?"Inside the existing house — no foundation work":f.fdn==="existing"?"Existing slab: new footings and moisture work":
      sqft+" sq ft "+{flat:"slab on flat ground",gentle:"slab with stepped footings",moderate:"raised foundation for the slope",steep:"engineered hillside foundation"}[f.slope]+(f.soil==="clay"?", post-tensioned for expansive clay":rock?", with rock excavation":""),
    sitePrep:parts([inside?"":f.fdn==="existing"?"Clean-out and prep of the existing structure":{open:"Open equipment access",side:"Side-yard access",tight:"Tight, hand-carry access"}[f.access],
      isNew&&f.slope!=="flat"&&f.slope+" slope grading",isNew&&f.crane&&"crane set",{none:"",small:"shed or patio removal",structure:"demolishing an existing building"}[f.demo]])||"No site work",
    utilTrench:inside?"Uses the house's existing utilities":parts([f.trenchFt+" ft shared trench for water, sewer and electric"+(rock?" through rock":""),f.sewerPump&&"sewer ejector pump",f.gasLine&&"gas line"]),
    electrical:{room:"Subpanel off a 200A panel with space",full:"200A panel is full — load management or rebalancing",small:"100–150A service upgraded to 200A"}[f.panel]+(f.allElectric?", sized for all-electric":""),
    surveys:parts([f.boundary==="needed"&&"Boundary survey",soilNeeded&&(f.slope==="steep"?"full geotechnical report":"soil report")])||"No survey or soil report needed",
  };
  return{foundation,sitePrep,utilTrench,electrical,surveys,why};
}
const siteDollars=x=>Object.fromEntries(SITE_KEYS.map(k=>[k,x[k]]));

// Project-type templates: typical 2025–2026 values for each kind of ADU. Choosing one fills in
// size, $/sq ft, fees, GC margin, build time and site facts; site-work dollars follow from the facts.
//  - Detached: stick-built, so $/sq ft sits on the "Stick-built" tick.
//  - Prefab: factory pricing per sq ft, open access plus a crane set, pre-approved plans, the
//    manufacturer's smaller margin, ~4 months on site.
//  - Garage conversion: existing slab/walls/roof, short utility runs, and no separate utility
//    connection fee (California bars them for conversions of existing space); hidden conditions
//    in older garages justify a higher contingency.
//  - Attached: structural tie-in and matching roof/siding raise $/sq ft and design; shorter
//    utility runs and some demolition where it joins the house.
//  - Junior ADU: interior remodel within the house (California caps JADUs at 500 sq ft), no
//    site work, no utility connection fee.
const F0={fdn:"new",slope:"flat",soil:"unknown",access:"side",crane:false,demo:"none",trenchFt:80,sewerPump:false,gasLine:false,panel:"room",allElectric:true,boundary:"needed"};
const mkType=(label,noun,desc,f,v)=>({label,noun,desc,f,v:{...v,...siteDollars(siteFromFacts(f,v.sqft))}});
const PTYPES={
  detached:mkType("Detached new build","detached ADU","Stick-built backyard unit",F0,{sqft:600,cpsf:300,hardscape:2000,permits:10000,hookup:8000,design:8000,contingency:5,markup:20,buildMonths:6}),
  prefab:mkType("Prefab / modular","prefab ADU","Factory-built, crane-set on site",{...F0,access:"open",crane:true},{sqft:600,cpsf:220,hardscape:2000,permits:9000,hookup:8000,design:3000,contingency:5,markup:10,buildMonths:4}),
  garage:mkType("Garage conversion","garage conversion","Existing slab, walls and roof",{...F0,fdn:"existing",soil:"known",access:"open",trenchFt:30,allElectric:false,boundary:"have"},{sqft:400,cpsf:175,hardscape:1000,permits:6000,hookup:0,design:5000,contingency:10,markup:20,buildMonths:4}),
  attached:mkType("Attached addition","attached ADU","New unit joined to the house",{...F0,access:"open",demo:"small",trenchFt:40},{sqft:600,cpsf:275,hardscape:1000,permits:10000,hookup:6000,design:9000,contingency:8,markup:20,buildMonths:7}),
  jadu:mkType("Junior ADU","junior ADU","Within the house, up to 500 sq ft",{...F0,fdn:"none",soil:"known",trenchFt:0,allElectric:false,boundary:"have"},{sqft:400,cpsf:125,hardscape:0,permits:4000,hookup:0,design:3000,contingency:10,markup:20,buildMonths:3}),
};
const DEF={projectType:"detached",...PTYPES.detached.v,siteMode:"facts",...PTYPES.detached.f,rentalMode:"ltr",strADR:125,strGrowth:2,strCosts:20,strVacancy:15,strMonths:4,furnishing:0,cashDown:0,origFeeOn:false,origFee:5,rate:7.5,term:10,conIntMode:"paid",conPremium:0,horizon:10,taxRate:1.1,taxGrowth:2,insurance:0.5,insGrowth:5,maint:8,vacancy:5,mgmt:0,growth:3,grm:110,clientName:"",clientAddr:"",prepName:"",prepCompany:"",reportNotes:"",cmpOn:false,
  cmpBOn:true,cmpBName:"Home equity loan, 15 yr",cmpBRate:8,cmpBTerm:15,cmpBDown:0,cmpBFee:2,
  cmpCOn:true,cmpCName:"HELOC, 20 yr",cmpCRate:8.5,cmpCTerm:20,cmpCDown:0,cmpCFee:0,
  cmpDOn:true,cmpDName:"All cash",cmpDRate:0,cmpDTerm:10,cmpDDown:100,cmpDFee:0,hookupCity:"ca",saleOn:true,saleYear:10,sellCost:6,incomeTax:0,lossCarry:true,firmOn:false,firm:"eeeeeeeeeee",customRent:0,customName:"",view:"internal"};
const SK="adu-calc-v16";
// Fields that make up a shareable scenario link — everything except UI-only state.
const SHARE_KEYS=Object.keys(DEF).filter(k=>k!=="view");
function shareUrlFor(state){
  const p=new URLSearchParams();
  SHARE_KEYS.forEach(k=>{const v=state[k],d=DEF[k];if(v===d)return;p.set(k,typeof v==="boolean"?(v?"1":"0"):String(v))});
  // Shared links open straight into the consumer-facing summary — that's who they're for.
  p.set("view","consumer");
  const q=p.toString();
  return window.location.origin+window.location.pathname+(q?"?"+q:"");
}
// Valid ranges for numeric fields. Anything loaded from a URL or storage — or typed into a
// value — is clamped to these. Cost lines go well past their sliders so a real quote always fits.
const LIM={sqft:[300,1200],cpsf:[50,1500],permits:[0,300000],hookup:[0,300000],foundation:[0,500000],sitePrep:[0,500000],utilTrench:[0,500000],electrical:[0,100000],hardscape:[0,200000],design:[0,300000],surveys:[0,100000],contingency:[0,20],markup:[0,40],strADR:[25,3000],strGrowth:[0,6],strCosts:[3,40],strVacancy:[5,40],strMonths:[1,6],furnishing:[0,200000],trenchFt:[0,1000],cashDown:[0,100],origFee:[1,40],rate:[0,25],term:[5,20],buildMonths:[0,18],conPremium:[0,3],horizon:[5,30],taxRate:[0.5,3],taxGrowth:[0,6],insurance:[0.2,3.5],insGrowth:[0,15],maint:[3,15],vacancy:[0,12],mgmt:[0,12],growth:[0,6],grm:[50,400],cmpBRate:[0,25],cmpCRate:[0,25],cmpDRate:[0,25],cmpBTerm:[5,20],cmpCTerm:[5,20],cmpDTerm:[5,20],cmpBDown:[0,100],cmpCDown:[0,100],cmpDDown:[0,100],cmpBFee:[0,40],cmpCFee:[0,40],cmpDFee:[0,40],saleYear:[1,30],sellCost:[0,12],incomeTax:[0,50],customRent:[0,100000]};
const INT_KEYS=new Set(["cmpBTerm","cmpCTerm","cmpDTerm","saleYear","trenchFt","term","strMonths","buildMonths","horizon"]);
const ENUMS={hookupCity:["ca","austin","denver","portland"],projectType:Object.keys(PTYPES),siteMode:["facts","dollars"],fdn:["new","existing","none"],slope:["flat","gentle","moderate","steep"],soil:["known","unknown","clay","rock"],access:["open","side","tight"],demo:["none","small","structure"],panel:["room","full","small"],boundary:["needed","have"],rentalMode:["ltr","hybrid","str"],conIntMode:["paid","cap","none"]};
function cleanField(k,raw){
  const d=DEF[k];
  if(typeof d==="boolean")return raw===true||raw==="1"||raw==="true";
  if(typeof d==="number"){
    let n=typeof raw==="number"?raw:parseFloat(raw);
    if(!Number.isFinite(n))return undefined;
    if(INT_KEYS.has(k))n=Math.round(n);
    const l=LIM[k];
    return l?Math.min(l[1],Math.max(l[0],n)):n;
  }
  if(ENUMS[k])return ENUMS[k].includes(raw)?raw:undefined;
  if(k==="firm")return typeof raw==="string"&&/^[eqk]{11}$/.test(raw)?raw:undefined;
  return typeof raw==="string"?raw.slice(0,k==="reportNotes"?1200:200):undefined;
}
function cleanState(src){
  const out={};
  SHARE_KEYS.forEach(k=>{if(src[k]===undefined)return;const v=cleanField(k,src[k]);if(v!==undefined)out[k]=v});
  return out;
}
function shareParamsFromLocation(){
  const p=new URLSearchParams(window.location.search);
  // Only a link carrying model fields counts as a shared scenario — unrelated params
  // like ?fbclid= or ?utm_source= must not reset the visitor's saved model.
  if(!SHARE_KEYS.some(k=>p.has(k)))return null;
  const raw={};
  SHARE_KEYS.forEach(k=>{if(p.has(k))raw[k]=p.get(k)});
  const out=cleanState(raw);
  out.view=p.get("view")==="consumer"?"consumer":"internal";
  return out;
}
const tk="#6e7681",tb="#58a6ff",gn="#3fb950",yl="#d29922",rd="#f85149";
const card={background:"#161b22",border:"1px solid #21262d",borderRadius:10};

function IT({text,align}){const[o,sO]=useState(false);const[pin,sP]=useState(false);const[shiftX,setShiftX]=useState(0);const r=useRef(null);const popRef=useRef(null);useEffect(()=>{if(!o)return;const h=e=>{if(r.current&&!r.current.contains(e.target)){sO(false);sP(false)}};document.addEventListener("mousedown",h);document.addEventListener("touchstart",h);return()=>{document.removeEventListener("mousedown",h);document.removeEventListener("touchstart",h)}},[o]);useLayoutEffect(()=>{if(!o){setShiftX(0);return}const el=popRef.current;if(!el)return;const rect=el.getBoundingClientRect(),m=8;let dx=0;if(rect.right>window.innerWidth-m)dx=window.innerWidth-m-rect.right;else if(rect.left<m)dx=m-rect.left;setShiftX(dx)},[o]);const ls=text.split("\n");const pos=align==="left"?{left:-4}:align==="right"?{right:-4}:{left:"50%"};const centerT=align==="left"||align==="right"?"":"translateX(-50%) ";const shiftT=shiftX?"translateX("+shiftX+"px)":"";const popTransform=(centerT+shiftT).trim()||undefined;const arr=align==="left"?{left:12}:align==="right"?{right:12}:{left:"50%",marginLeft:-4};return(<span ref={r} style={{position:"relative",display:"inline-block",marginLeft:3,verticalAlign:"middle"}}><span role="button" tabIndex={0} aria-label="More information" onClick={e=>{e.stopPropagation();sP(v=>{const n=!v;sO(n);return n})}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();sP(v=>{const n=!v;sO(n);return n})}if(e.key==="Escape"){sP(false);sO(false)}}} onMouseEnter={()=>sO(true)} onMouseLeave={()=>{if(!pin)sO(false)}} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:16,height:16,borderRadius:"50%",border:"1px solid "+(o?tb:"#3d444d"),color:o?tb:tk,fontSize:10,fontWeight:700,cursor:"pointer",transition:"all 0.15s",fontFamily:"'DM Sans',sans-serif",letterSpacing:0,textTransform:"none",lineHeight:1,userSelect:"none"}}>?</span>{o&&(<div ref={popRef} style={{position:"absolute",bottom:"calc(100% + 8px)",...pos,transform:popTransform,width:200,padding:"8px 10px",background:"#1c2129",border:"1px solid #30363d",borderRadius:8,fontSize:10.5,fontWeight:400,fontFamily:"'DM Sans',sans-serif",color:"#c9d1d9",lineHeight:1.5,textTransform:"none",letterSpacing:"normal",textAlign:"left",zIndex:100,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",wordWrap:"break-word",whiteSpace:"normal"}}>{ls.map((l,i)=>l===""?<div key={i} style={{height:4}}/>:<div key={i}>{l}</div>)}<div style={{position:"absolute",bottom:-5,...arr,width:8,height:8,background:"#1c2129",borderRight:"1px solid #30363d",borderBottom:"1px solid #30363d",transform:"translateX("+(-shiftX)+"px) rotate(45deg)"}}/></div>)}</span>)}

// A slider's value that turns into a text box when clicked, so an exact figure (a $11,240 quote)
// can be typed. Accepts "$11,240", "11240", "12.5k" or "7.25%"; clamps to [lo, hi].
function EditVal({value,format,onChange,lo,hi,integer,style}){
  const[edit,setEdit]=useState(false);const[txt,setTxt]=useState("");
  const commit=()=>{
    const raw=txt.trim().toLowerCase().replace(/[$,%\s]/g,""),k=raw.endsWith("k");
    const n=parseFloat(k?raw.slice(0,-1):raw)*(k?1000:1);
    if(Number.isFinite(n)){let v=Math.min(hi,Math.max(lo,n));if(integer)v=Math.round(v);if(v!==value)onChange(v)}
    setEdit(false);
  };
  if(edit)return(<input autoFocus type="text" inputMode="decimal" aria-label="Type a value" value={txt} onChange={e=>setTxt(e.target.value)} onFocus={e=>e.target.select()}
    onBlur={commit} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.target.blur()}if(e.key==="Escape"){setTxt(String(value));setEdit(false)}}}
    style={{...style,width:120,textAlign:"right",background:"#0d1117",border:"1px solid "+tb,borderRadius:4,padding:"0 6px",outline:"none"}}/>);
  return(<button type="button" title="Click to type an exact value" onClick={()=>{setTxt(String(value));setEdit(true)}}
    style={{...style,background:"none",border:"none",borderBottom:"1px dashed #3d444d",padding:0,cursor:"text",lineHeight:1.2}}>{format(value)}</button>);
}

// An always-visible dollar box for lines where the user has chosen to enter amounts. Shows the
// value with commas; while focused it holds the raw text, and commits on Enter or blur.
function MoneyInput({value,onChange,lo,hi,label}){
  // editing: true from focus until the edit is committed or cancelled, so a stray second blur can't re-commit.
  const[txt,setTxt]=useState(null);const editing=useRef(false);
  const commit=()=>{
    if(editing.current&&txt!==null){
      const raw=txt.trim().toLowerCase().replace(/[$,\s]/g,""),k=raw.endsWith("k");
      const n=parseFloat(k?raw.slice(0,-1):raw)*(k?1000:1);
      if(Number.isFinite(n)){const v=Math.round(Math.min(hi,Math.max(lo,n)));if(v!==value)onChange(v)}
    }
    editing.current=false;setTxt(null);
  };
  return(<span style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
    <span style={{position:"absolute",left:9,color:"#8b949e",fontFamily:"'Fraunces',serif",fontSize:14,pointerEvents:"none"}}>$</span>
    <input type="text" inputMode="numeric" className="fld" aria-label={label+" in dollars"} value={txt??Math.round(value).toLocaleString()}
      onFocus={e=>{editing.current=true;setTxt(String(Math.round(value)));const el=e.target;setTimeout(()=>el.select(),0)}} onChange={e=>setTxt(e.target.value)} onBlur={commit}
      onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){editing.current=false;setTxt(null);e.target.blur()}}}
      style={{width:124,padding:"5px 9px 5px 22px",textAlign:"right",background:"#0d1117",border:"1px solid #30363d",borderRadius:6,color:"#e6edf3",fontSize:15,fontFamily:"'Fraunces',serif",fontWeight:600,outline:"none",boxSizing:"border-box"}}/>
  </span>);
}

function Sl({label,value,onChange,min,max,step,format,typeMin,typeMax}){const id=useId();return(<div style={{display:"flex",flexDirection:"column",gap:3}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><span id={id} style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>{label}</span><EditVal value={value} format={format} onChange={onChange} lo={typeMin??min} hi={typeMax??max} integer={Number.isInteger(step)} style={{fontSize:17,fontFamily:"'Fraunces',serif",fontWeight:600,color:"#e6edf3"}}/></div><input type="range" aria-labelledby={id} aria-valuetext={format(value)} min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} style={{width:"100%",accentColor:tb,height:5,cursor:"pointer"}}/></div>)}

function TS({label,value,onChange,min,max,step,format,ticks,badge,typeMin,typeMax,box}){const id=useId();const pct=v=>((v-min)/(max-min))*100;return(<div style={{display:"flex",flexDirection:"column"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:box?"center":"baseline",marginBottom:box?6:3,gap:8}}><span style={{fontSize:12,color:"#8b949e"}}><span id={id}>{label}</span>{badge&&<span style={{marginLeft:6,fontSize:11,color:tb,background:"rgba(88,166,255,0.1)",padding:"1px 6px",borderRadius:4,fontWeight:600}}>{badge}</span>}</span>{box?<MoneyInput value={value} onChange={onChange} lo={typeMin??min} hi={typeMax??max} label={box}/>:<EditVal value={value} format={format} onChange={onChange} lo={typeMin??min} hi={typeMax??max} integer={Number.isInteger(step)} style={{fontSize:15,fontFamily:"'Fraunces',serif",fontWeight:600,color:"#e6edf3"}}/>}</div><input type="range" aria-labelledby={id} aria-valuetext={String(format(value))} min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} style={{width:"100%",accentColor:tb,height:5,cursor:"pointer",margin:0}}/>{ticks&&ticks.length>0&&(<div style={{position:"relative",height:30,marginTop:2}}>{(()=>{
  // Which tick is the handle sitting closest to? Only that label gets full contrast.
  let near=-1,best=Infinity;ticks.forEach((t,i)=>{const d=Math.abs(pct(t.value)-pct(value));if(d<best){best=d;near=i}});
  return ticks.map((t,i)=>{const left=pct(t.value);if(left<0||left>100)return null;const stagger=i%2===1;
  // Clamp at the rails so edge labels stay inside the card instead of bleeding out.
  const edge=left<8?"translateX(0)":left>92?"translateX(-100%)":"translateX(-50%)";
  const align=left<8?"flex-start":left>92?"flex-end":"center";
  const on=i===near&&best<6;
  return(<div key={i} style={{position:"absolute",left:`${left}%`,transform:edge,display:"flex",flexDirection:"column",alignItems:align,pointerEvents:"none"}}><div style={{width:1,height:stagger?16:5,background:t.color||"#3d444d",alignSelf:align==="center"?"center":align,opacity:on?1:0.65}}/><span style={{fontSize:9.5,color:on?"#e6edf3":tk,whiteSpace:"nowrap",marginTop:1,fontWeight:on?600:500,transition:"color 0.15s"}}>{t.label}</span></div>)})})()}</div>)}</div>)}

// Chooses HOW a section is estimated. Styled as option cards with a radio dot so it reads as a
// choice of approach that governs the controls nested beneath it, not as one more answer.
function MethodSwitch({label,value,onChange,options}){
  return(<div role="radiogroup" aria-label={label} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:8}}>
    {options.map(o=>{const on=value===o.value;return(
      <button key={o.value} type="button" role="radio" aria-checked={on} onClick={()=>onChange(o.value)} style={{display:"flex",gap:10,alignItems:"flex-start",textAlign:"left",padding:"10px 12px",borderRadius:10,cursor:"pointer",fontFamily:"inherit",background:on?"rgba(88,166,255,0.10)":"transparent",border:(on?"1.5px solid "+tb:"1px dashed #3d444d"),transition:"border-color 0.15s, background 0.15s"}}>
        <span aria-hidden="true" style={{flexShrink:0,width:16,height:16,marginTop:1,borderRadius:"50%",border:"2px solid "+(on?tb:"#6e7681"),display:"inline-flex",alignItems:"center",justifyContent:"center"}}>{on&&<span style={{width:8,height:8,borderRadius:"50%",background:tb}}/>}</span>
        <span><span style={{display:"block",fontSize:13,fontWeight:600,color:on?"#e6edf3":"#c9d1d9"}}>{o.label}</span><span style={{display:"block",fontSize:11,color:"#8b949e",marginTop:2,lineHeight:1.35}}>{o.desc}</span></span>
      </button>)})}
  </div>);
}
// The controls governed by a MethodSwitch: indented under a rule in the accent colour.
const nested={marginTop:10,paddingLeft:14,borderLeft:"2px solid rgba(88,166,255,0.35)"};

// Budget confidence (optional): mark each cost line as an estimate, a quote, or a known price.
// Each status implies a typical accuracy band, read as a 90% range: a rough estimate lands within
// about ±25%, a contractor or city quote within about ±10% (change orders, allowances), a fixed fee
// or signed fixed price doesn't move. Treating lines as independent and roughly normal, they combine
// into a standard deviation for the whole build, which gives P50/P80 costs, how often the current
// budget covers the build, and the contingency needed to reach P80. Real overruns skew upward, so
// these are best read as floors.
const FIRM={e:{label:"Estimate",range:0.25},q:{label:"Quote",range:0.10},k:{label:"Known",range:0}};
const FIRM_LINES=[["structure","Structure",true],["foundation","Foundation",true],["sitePrep","Grading, demo & access",true],["utilTrench","Utility trenching",true],["electrical","Electrical",true],["hardscape","Hardscape & path",true],
  ["permits","Permits & inspections",false],["hookup","Water & sewer fees",false],["design","Design & engineering",false],["surveys","Surveys & reports",false],["furnishing","Furnishing",false]];
const FIRM_DEFAULT="e".repeat(FIRM_LINES.length);
const Z90=1.6449,Z80=0.8416;
// Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf).
function normCdf(z){const t=1/(1+0.3275911*Math.abs(z)/Math.SQRT2),y=1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-z*z/2);return z>=0?(1+y)/2:(1-y)/2}
// amounts: {key: dollars before markup}; firm: one letter per FIRM_LINES entry; markup: % on every line;
// contingencyAmt: the budget's current contingency in dollars.
function budgetConfidence(amounts,firm,markup,contingencyAmt){
  const m=1+markup/100;let base=0,firmed=0,varSum=0,hard=0;
  const lines=FIRM_LINES.map(([k,label,isHard],i)=>{
    const st=FIRM[firm[i]]?firm[i]:"e",amt=amounts[k]||0,withM=amt*m,sd=withM*FIRM[st].range/Z90;
    base+=withM;if(st!=="e")firmed+=withM;varSum+=sd*sd;if(isHard)hard+=amt;
    return{k,label,i,st,amt,v:sd*sd};
  });
  const sigma=Math.sqrt(varSum),need80=Z80*sigma;
  return{
    lines,sigma,base,firmedPct:base>0?firmed/base*100:0,
    p50:base,p80:base+need80,
    // 80% range of the build cost (10% chance below p10, 10% above p90).
    p10:Math.max(0,base-1.2816*sigma),p90:base+1.2816*sigma,
    // Chance the budget (line items + contingency) covers the build.
    coverage:sigma>0?normCdf(contingencyAmt/sigma)*100:100,
    // Rounded up, so applying it always reaches at least P80.
    suggested:hard>0?Math.ceil(need80/hard*100-1e-9):0,
    drivers:lines.filter(l=>l.v>0).map(l=>({...l,share:l.v/varSum*100})).sort((a,b)=>b.share-a.share),
  };
}
function BudgetConfidence({on,onToggle,firm,setFirm,bc,contingency,setContingency}){
  const setLine=(i,st)=>setFirm(firm.slice(0,i)+st+firm.slice(i+1));
  const tile=(k,v,s)=>(<div key={k} style={{...card,background:"#0d1117",padding:"10px 12px"}}>
    <div style={{fontSize:10.5,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600}}>{k}</div>
    <div style={{fontFamily:"'Fraunces',serif",fontSize:19,fontWeight:600,color:"#e6edf3",marginTop:2}}>{v}</div>
    <div style={{fontSize:11,color:"#6e7681",lineHeight:1.35}}>{s}</div>
  </div>);
  const cov=Math.round(bc.coverage);
  return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
    <Tog on={on} onToggle={onToggle} label="Track how firm each cost is" sub="Mark each line as an estimate, a quote or a known price to see how likely the budget is to hold and what contingency it needs"/>
    {on&&(<div style={nested}>
      <div role="table" aria-label="Budget confidence by line" style={{display:"flex",flexDirection:"column"}}>
        {bc.lines.filter(l=>l.amt>0).map(l=>(
          <div role="row" key={l.k} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid #21262d",flexWrap:"wrap"}}>
            <span role="cell" style={{flex:"1 1 150px",fontSize:12.5,color:"#c9d1d9"}}>{l.label}</span>
            <span role="cell" style={{fontFamily:"'Fraunces',serif",fontSize:14,fontWeight:600,color:"#e6edf3",minWidth:80,textAlign:"right"}}>{fD(l.amt)}</span>
            <span role="cell"><span role="radiogroup" aria-label={l.label+" firmness"} style={{display:"inline-flex",border:"1px solid #30363d",borderRadius:6,overflow:"hidden"}}>
              {Object.entries(FIRM).map(([st,f])=>{const sel=l.st===st;return(
                <button key={st} type="button" role="radio" aria-checked={sel} onClick={()=>setLine(l.i,st)} style={{padding:"4px 9px",fontSize:11,fontFamily:"inherit",cursor:"pointer",border:"none",borderRight:st!=="k"?"1px solid #30363d":"none",background:sel?(st==="e"?"rgba(210,153,34,0.18)":st==="q"?"rgba(88,166,255,0.18)":"rgba(63,185,80,0.18)"):"transparent",color:sel?(st==="e"?yl:st==="q"?tb:gn):"#8b949e",fontWeight:sel?600:400}}>{f.label}</button>)})}
            </span></span>
          </div>))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))",gap:10,marginTop:12}}>
        {tile("Quoted or known",Math.round(bc.firmedPct)+"%","of the line-item budget")}
        {tile("P50 / P80 build cost",fD(bc.p50)+" / "+fD(bc.p80),"50% / 80% chance it costs less")}
        {tile("Your budget holds",bc.sigma>0?"≈ "+cov+"%":"100%","of the time, with "+contingency+"% contingency")}
        {tile("Contingency for P80",bc.suggested+"%","of hard costs · you have "+contingency+"%")}
      </div>
      {bc.suggested!==contingency&&<button type="button" onClick={()=>setContingency(bc.suggested)} style={{marginTop:10,padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:"transparent",border:"1px solid "+tb,color:tb}}>Use {bc.suggested}% contingency</button>}

      {bc.drivers.length>0&&(<div style={{marginTop:14}}>
        <div style={{fontSize:12,color:"#8b949e",marginBottom:6}}>What drives the uncertainty — firm these up first</div>
        {bc.drivers.filter(d=>d.share>=1).slice(0,5).map(d=>(
          <div key={d.k} style={{display:"grid",gridTemplateColumns:"minmax(120px,170px) 1fr 44px",alignItems:"center",gap:10,padding:"3px 0"}}>
            <span style={{fontSize:12,color:"#c9d1d9"}}>{d.label} <span style={{color:d.st==="e"?yl:tb,fontSize:11}}>({FIRM[d.st].label.toLowerCase()})</span></span>
            <span style={{height:10,background:"#0d1117",borderRadius:3,position:"relative"}}><span style={{position:"absolute",left:0,top:0,bottom:0,width:Math.max(d.share,1)+"%",background:d.st==="e"?yl:tb,borderRadius:3,opacity:0.8}}/></span>
            <span style={{fontSize:12,color:"#e6edf3",textAlign:"right"}}>{Math.round(d.share)}%</span>
          </div>))}
      </div>)}

      <div style={{fontSize:11,color:"#6e7681",marginTop:10,lineHeight:1.45}}>Each status is read as a 90% range — estimates ±25%, quotes ±10%, known prices fixed — and lines are combined as independent risks. P80 means an 80% chance the build costs less. Real overruns tend to skew upward, so treat these as floors. Build costs exclude any loan fee.</div>
    </div>)}
  </div>);
}


// One site fact: a label (with optional help) above a row of choices.
function Fact({label,help,children}){
  return(<div><div style={{fontSize:12,color:"#8b949e",marginBottom:5,display:"flex",alignItems:"center"}}>{label}{help&&<IT align="left" text={help}/>}</div>{children}</div>);
}
const opts=pairs=>pairs.map(([value,label])=>({value,label}));
// The site-facts questionnaire and the dollar amounts it produces, each with the reason.
function SiteFacts({s,set,sf}){
  const isNew=s.fdn==="new",inside=s.fdn==="none";const wide={gridColumn:"1 / -1"};
  return(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))",gap:"14px 20px",alignItems:"start"}}>
    <Fact label="Foundation"><ModePills label="Foundation" value={s.fdn} onChange={set("fdn")} options={opts([["new","New"],["existing","Existing slab"],["none","None (inside house)"]])}/></Fact>
    {isNew&&<Fact label="Lot slope" help={"Gentle: under about 5%. Moderate: 5–15% — usually a raised foundation. Steep: over 15% — an engineered hillside foundation and a full geotechnical report."}>
      <ModePills label="Lot slope" value={s.slope} onChange={set("slope")} options={opts([["flat","Flat"],["gentle","Gentle"],["moderate","Moderate"],["steep","Steep"]])}/></Fact>}
    {isNew&&<Fact label="Soil" help={"Known stable: a recent soil report or well-documented neighborhood — no new report needed. Unknown: budget a soil report. Expansive clay swells when wet and needs a post-tensioned slab. Rock slows excavation and trenching."}>
      <ModePills label="Soil" value={s.soil} onChange={set("soil")} options={opts([["known","Known stable"],["unknown","Unknown"],["clay","Expansive clay"],["rock","Rock"]])}/></Fact>}
    {isNew&&<Fact label="Equipment access" help={"Open: a driveway or alley a small excavator and concrete truck can use. Side yard: a narrow path, smaller equipment and pumped concrete. Tight: materials carried in by hand."}>
      <ModePills label="Equipment access" value={s.access} onChange={set("access")} options={opts([["open","Open"],["side","Side yard"],["tight","Tight"]])}/></Fact>}
    {isNew&&<Tog on={s.crane} onToggle={()=>set("crane")(!s.crane)} label="Crane set" sub="Prefab and modular units are lifted into place — about $6,000"/>}
    {!inside&&<Fact label="Demolition"><ModePills label="Demolition" value={s.demo} onChange={set("demo")} options={opts([["none","None"],["small","Shed or patio"],["structure","Existing building"]])}/></Fact>}
    {!inside&&<div style={wide}><TS label={<>Distance to utility connections<IT align="left" text={"How far the trench runs from the house's water, sewer and electrical connections to the ADU. One shared trench is typical, at roughly $100 per foot."}/></>} value={s.trenchFt} onChange={set("trenchFt")} typeMin={0} typeMax={1000} min={0} max={300} step={10} format={v=>v+" ft"} ticks={[{value:30,label:"Close",color:gn},{value:80,label:"Typical",color:tb},{value:150,label:"Far",color:yl},{value:250,label:"Very far",color:rd}]}/></div>}
    {!inside&&<Fact label="Sewer" help={"If the ADU sits lower than the sewer connection, waste has to be pumped up with an ejector pump — about $8,000 installed."}>
      <ModePills label="Sewer" value={s.sewerPump?"pump":"gravity"} onChange={v=>set("sewerPump")(v==="pump")} options={opts([["gravity","Flows by gravity"],["pump","Needs a pump"]])}/></Fact>}
    {!inside&&<Tog on={s.gasLine} onToggle={()=>set("gasLine")(!s.gasLine)} label="Gas line to the ADU" sub="Adds about $20 per foot to the trench"/>}
    <Fact label="Existing electrical panel" help={"The house's main panel. With spare capacity the ADU gets a subpanel; a full 200A panel needs load management; 100–150A service usually has to be upgraded to 200A."}>
      <ModePills label="Existing electrical panel" value={s.panel} onChange={set("panel")} options={opts([["room","200A, has space"],["full","200A, full"],["small","100–150A"]])}/></Fact>
    <Tog on={s.allElectric} onToggle={()=>set("allElectric")(!s.allElectric)} label="All-electric ADU" sub="Heat pump and induction cooking need more panel capacity"/>
    <Fact label="Boundary survey"><ModePills label="Boundary survey" value={s.boundary} onChange={set("boundary")} options={opts([["needed","Needed"],["have","Have a recent one"]])}/></Fact>
    <div style={{...wide,border:"1px solid #21262d",borderRadius:8,padding:"6px 12px",background:"#0d1117"}}>
      {[["Foundation","foundation"],["Grading, demo & access","sitePrep"],["Utility trenching","utilTrench"],["Electrical","electrical"],["Surveys & reports","surveys"]].map(([l,k],i)=>(
        <div key={k} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"7px 0",borderTop:i?"1px solid #21262d":"none"}}>
          <div style={{minWidth:0}}><div style={{fontSize:12.5,color:"#c9d1d9"}}>{l}{k==="surveys"&&<span style={{fontSize:11,color:"#6e7681"}}> (counted in soft costs)</span>}</div><div style={{fontSize:11,color:"#8b949e",lineHeight:1.4}}>{sf.why[k]}</div></div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:15,fontWeight:600,color:"#e6edf3",whiteSpace:"nowrap"}}>{sf[k]===0?"$0":fD(sf[k])}</div>
        </div>))}
    </div>
  </div>);
}

// "What are you building?" — applies a PTYPES template. Shows when the lines have been edited
// away from the template, with a link to restore it.
function TypePicker({value,onPick,custom}){
  return(<div>
    <div id="ptype-label" style={{fontSize:12,color:"#8b949e",marginBottom:6}}>What are you building?</div>
    <div role="radiogroup" aria-labelledby="ptype-label" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(128px,1fr))",gap:6}}>
      {Object.entries(PTYPES).map(([k,t])=>{const on=value===k;return(
        <button key={k} type="button" role="radio" aria-checked={on} onClick={()=>onPick(k)} style={{textAlign:"left",padding:"8px 10px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",background:on?"rgba(88,166,255,0.12)":"transparent",border:"1px solid "+(on?tb:"#30363d"),transition:"border-color 0.15s, background 0.15s"}}>
          <div style={{fontSize:12.5,fontWeight:600,color:on?"#e6edf3":"#c9d1d9"}}>{t.label}</div>
          <div style={{fontSize:11,color:"#8b949e",marginTop:2,lineHeight:1.3}}>{t.desc}</div>
        </button>)})}
    </div>
    <div style={{fontSize:11,color:custom?yl:"#8b949e",marginTop:7,lineHeight:1.45}}>{custom
      ?<>Customized from the {PTYPES[value].label.toLowerCase()} template · <button type="button" onClick={()=>onPick(value)} style={{background:"none",border:"none",padding:0,color:tb,fontSize:11,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>Reset to template</button></>
      :"Typical 2025–2026 costs for this type. Adjust any line below, or click a value to type in a quote."}</div>
  </div>);
}

function Sub({label,value}){return(<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0 1px",borderTop:"1px solid #21262d",marginTop:4}}><span style={{fontSize:11.5,color:"#6e7681"}}>{label}</span><span style={{fontSize:13,fontFamily:"'Fraunces',serif",fontWeight:600,color:"#8b949e"}}>{fD(value)}</span></div>)}
function SL({children}){return <div style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:600,marginTop:22,marginBottom:10,paddingTop:12,borderTop:"1px solid #21262d"}}>{children}</div>}
function Tog({on,onToggle,label,sub}){return(<button type="button" role="switch" aria-checked={on} onClick={onToggle} style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none",background:"none",border:"none",padding:0,textAlign:"left",fontFamily:"inherit",width:"100%"}}><div style={{width:40,height:22,borderRadius:11,padding:2,background:on?tb:"#30363d",transition:"background 0.2s",flexShrink:0}}><div style={{width:18,height:18,borderRadius:9,background:"#e6edf3",transform:on?"translateX(18px)":"translateX(0)",transition:"transform 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/></div><div><div style={{fontSize:13,fontWeight:500,color:"#e6edf3"}}>{label}</div>{sub&&<div style={{fontSize:11,color:"#8b949e",lineHeight:1.4,marginTop:1}}>{sub}</div>}</div></button>)}
function ModePills({value,onChange,options,label}){return(<div role="radiogroup" aria-label={label} style={{display:"flex",gap:0,borderRadius:8,overflow:"hidden",border:"1px solid #30363d"}}>{options.map(o=>(<button type="button" role="radio" aria-checked={value===o.value} key={o.value} onClick={()=>onChange(o.value)} style={{padding:"8px 14px",cursor:"pointer",fontSize:12,fontFamily:"inherit",border:"none",fontWeight:value===o.value?600:400,color:value===o.value?"#e6edf3":"#8b949e",background:value===o.value?"#30363d":"transparent",transition:"all 0.15s",userSelect:"none",borderRight:"1px solid #30363d",flex:1,textAlign:"center"}}>{o.label}</button>))}</div>)}
function Section({title,summary,open,onToggle,children}){const[hov,setHov]=useState(false);return(<div style={{...card,padding:open?"18px 22px 14px":"14px 22px",marginBottom:12}}><div onClick={onToggle} role="button" tabIndex={0} aria-expanded={open} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onToggle()}}} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none",marginBottom:open?16:0,gap:8}}><span style={{fontSize:11,color:hov?"#e6edf3":"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500,flexShrink:0,transition:"color 0.15s"}}>{title}</span><div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}><div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{summary}</div><span style={{fontSize:13,color:hov?tb:tk,transform:open?"rotate(180deg)":"none",transition:"transform 0.15s, color 0.15s",display:"inline-flex",flexShrink:0,lineHeight:1}}>▾</span></div></div>{open&&children}</div>)}

// Pick a round axis step (1/2/2.5/5 × 10^n) that gives roughly `target` ticks.
function niceStep(range,target){const raw=range/Math.max(1,target),p=Math.pow(10,Math.floor(Math.log10(raw||1))),f=raw/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
const fAx=v=>{const a=Math.abs(v),s=v>0?"+":v<0?"−":"";return s+(a>=1e6?"$"+(a/1e6).toFixed(1).replace(/\.0$/,"")+"M":a>=1000?"$"+Math.round(a/1000)+"k":"$"+Math.round(a))};
// Width of an element in CSS px, tracked across resizes — charts draw at their real
// width so text stays a readable size on phones instead of shrinking with a viewBox.
function useWidth(ref,fallback){
  const[w,setW]=useState(fallback);
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const upd=()=>{const cw=el.clientWidth;if(cw>0)setW(cw)};upd();
    if(typeof ResizeObserver==="undefined")return;
    const ro=new ResizeObserver(upd);ro.observe(el);return()=>ro.disconnect();
  },[ref]);
  return w;
}

// Year-based line chart used by both consumer charts. pts: [{year,...values,label?,hidden?}] —
// years may be fractional; hidden points shape the line but get no dot or hover target.
// series: [{key,color,width,dash,opacity}]; the first series is the interactive one.
// band: {to, label} shades years 0 → to (the construction period) and labels it.
function TimeChart({pts,series,area,pointColor,vlines=[],marker,tooltip,height=230,ariaLabel,band}){
  const wrapRef=useRef(null);const W=useWidth(wrapRef,820);const uid=useId().replace(/:/g,"");
  const[hov,setHov]=useState(null);const[pin,setPin]=useState(false);
  const narrow=W<520,FS=narrow?11:12;
  const H=narrow?Math.round(height*0.85):height,PL=narrow?44:58,PR=narrow?10:20,PT=22,PB=28;
  const cW=Math.max(10,W-PL-PR),cH=H-PT-PB;
  const xMax=pts[pts.length-1].year||1;
  const vals=[0];series.forEach(s=>pts.forEach(p=>vals.push(p[s.key])));
  let lo=Math.min(...vals),hi=Math.max(...vals);
  const step=niceStep(hi-lo||1,narrow?4:6);
  lo=Math.floor(lo/step)*step;hi=Math.ceil(hi/step)*step;if(hi===lo)hi=lo+step;
  const xC=x=>PL+(x/xMax)*cW,yC=v=>PT+cH-((v-lo)/(hi-lo))*cH,zeroY=yC(0);
  const path=key=>pts.map((p,i)=>(i?"L":"M")+xC(p.year).toFixed(1)+","+yC(p[key]).toFixed(1)).join(" ");
  const main=series[0].key,mainD=path(main);
  const areaD=mainD+" L"+xC(xMax).toFixed(1)+","+zeroY.toFixed(1)+" L"+xC(pts[0].year).toFixed(1)+","+zeroY.toFixed(1)+" Z";
  const yTicks=[];for(let v=lo;v<=hi+step/2;v+=step)yTicks.push(v);
  const xEvery=Math.max(1,Math.ceil(xMax/Math.max(2,Math.floor(cW/46))));
  // Hover targets span halfway to each visible neighbour, so uneven spacing still works.
  const vis=pts.map((p,i)=>i).filter(i=>!pts[i].hidden);
  const edges=vis.map((i,j)=>{const x=xC(pts[i].year),l=j>0?(x+xC(pts[vis[j-1]].year))/2:x-12,r=j<vis.length-1?(x+xC(pts[vis[j+1]].year))/2:x+12;return{i,l,r}});
  const hp=hov!==null?pts[hov]:null;
  const tipLeft=hp?Math.min(Math.max(xC(hp.year),80),W-80):0;
  return(<div ref={wrapRef} style={{position:"relative"}}>
    <svg viewBox={"0 0 "+W+" "+H} role="img" aria-label={ariaLabel} style={{display:"block",width:"100%",height:"auto",fontFamily:"'DM Sans',sans-serif"}} onClick={()=>{setPin(false);setHov(null)}}>
      <defs>
        <linearGradient id={uid+"p"} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={area.pos} stopOpacity="0.25"/><stop offset="100%" stopColor={area.pos} stopOpacity="0.02"/></linearGradient>
        <linearGradient id={uid+"n"} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={area.neg} stopOpacity="0.02"/><stop offset="100%" stopColor={area.neg} stopOpacity="0.22"/></linearGradient>
        <clipPath id={uid+"a"}><rect x={PL} y={PT} width={cW} height={Math.max(0,zeroY-PT)}/></clipPath>
        <clipPath id={uid+"b"}><rect x={PL} y={zeroY} width={cW} height={Math.max(0,PT+cH-zeroY)}/></clipPath>
      </defs>
      {yTicks.map((v,i)=>{const yy=yC(v);return(<g key={i}><line x1={PL} y1={yy} x2={W-PR} y2={yy} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={v===0?"":"3,3"}/><text x={PL-6} y={yy+4} textAnchor="end" fontSize={FS} fill="#64748b">{fAx(v)}</text></g>)})}
      <line x1={PL} y1={zeroY} x2={W-PR} y2={zeroY} stroke="#64748b" strokeWidth="1"/>
      <path d={areaD} fill={"url(#"+uid+"p)"} clipPath={"url(#"+uid+"a)"}/>
      <path d={areaD} fill={"url(#"+uid+"n)"} clipPath={"url(#"+uid+"b)"}/>
      {band&&band.to>0&&<g><rect x={xC(0)} y={PT} width={Math.max(2,xC(band.to)-xC(0))} height={cH} fill="#94a3b8" opacity="0.16"/><text x={xC(0)+4} y={PT+cH-6} fontSize={FS} fill="#64748b" stroke="#fff" strokeWidth="3" paintOrder="stroke">{band.label}</text></g>}
      {series.slice(1).map(s=><path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={s.width||1.5} strokeDasharray={s.dash||""} opacity={s.opacity||1}/>)}
      <path d={mainD} fill="none" stroke={series[0].color} strokeWidth={series[0].width||2.5} strokeLinejoin="round"/>
      {vlines.map((v,i)=>v.x>0&&v.x<=xMax&&<g key={i}><line x1={xC(v.x)} y1={PT} x2={xC(v.x)} y2={PT+cH} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4,3"/><text x={xC(v.x)} y={PT-7} textAnchor="middle" fontSize={FS} fill="#64748b">{v.label}</text></g>)}
      {marker&&marker.x>=0&&marker.x<=xMax&&(()=>{
        // The line rises through the marker, so put the label on the side it's coming from (left, above zero).
        const mx=xC(marker.x),left=mx-PL>90;
        return(<><circle cx={mx} cy={zeroY} r="5" fill={marker.color} stroke="#fff" strokeWidth="2"/><text x={left?mx-9:mx+9} y={zeroY-9} textAnchor={left?"end":"start"} fontSize={FS} fill={marker.color} fontWeight="600" stroke="#fff" strokeWidth="3" paintOrder="stroke">{marker.label}</text></>)})()}
      {pts.filter(p=>!p.hidden&&Number.isInteger(p.year)&&p.year%xEvery===0).map(p=><text key={p.year} x={xC(p.year)} y={H-PB+16} textAnchor="middle" fontSize={FS} fill="#64748b">{"Yr "+p.year}</text>)}
      {pts.map((p,i)=>!p.hidden&&<circle key={i} cx={xC(p.year)} cy={yC(p[main])} r={hov===i?6:narrow?2.5:3.5} fill={pointColor?pointColor(p):series[0].color} stroke="#fff" strokeWidth={hov===i?2.5:1.2} style={{pointerEvents:"none"}}/>)}
      {edges.map(({i,l,r})=><rect key={"h"+i} x={l} y={PT} width={Math.max(1,r-l)} height={cH} fill="transparent" style={{cursor:"pointer"}} onMouseEnter={()=>{if(!pin)setHov(i)}} onMouseLeave={()=>{if(!pin)setHov(null)}} onClick={e=>{e.stopPropagation();setPin(true);setHov(i)}}/>)}
    </svg>
    {hp&&<div style={{position:"absolute",left:tipLeft,top:yC(hp[main]),transform:"translate(-50%, calc(-100% - 12px))",background:"#0f172a",color:"#fff",padding:"7px 11px",borderRadius:8,fontSize:12,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",pointerEvents:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.15)",zIndex:10}}>{tooltip(hp)}</div>}
  </div>);
}

const SRC=[
{cat:"Academic & Government Data",links:[
{t:"Statewide ADU Owner Survey — Terner Center, UC Berkeley (2024)",u:"https://ternercenter.berkeley.edu/blog/cci-adu-survey/",n:"Median CA ADU rent of $2,000/mo; 71% of ADUs cost <$200K to build; 8% are STR. Used to sanity-check rent and cost defaults."},
{t:"Reaching California's ADU Potential & Need for ADU Finance — Terner Center",u:"https://ternercenter.berkeley.edu/research-and-policy/adu-finance/",n:"Permit volume trends (5,911→15,571 from 2018–2019); the financing-gap argument that motivates this tool's loan modeling."},
{t:"It All Adds Up: Cost of Housing Development Fees — Terner Center",u:"https://ternercenter.berkeley.edu/wp-content/uploads/pdfs/Development_Fees_Report_Final_2.pdf",n:"Per-unit fee variance across CA cities ($12K LA → $75K Fremont). Source for the wide range on the permits and impact-fee slider."},
{t:"California Construction Cost Index (CCCI) — CA DGS",u:"https://www.dgs.ca.gov/RESD/Resources/Page-Content/Real-Estate-Services-Division-Resources-List-Folder/DGS-California-Construction-Cost-Index-CCCI",n:"Official CA construction cost tracking. Source for the 44% inflation figure (Jan 2021–Dec 2025) used to validate cost defaults."},
{t:"IRS Pub. 925 — Passive Activity & At-Risk Rules",u:"https://www.irs.gov/publications/p925",n:"Authoritative rules for the $25K passive loss allowance, MAGI phase-out (>$100K), and suspended-loss carryforward. Informs the tax explainer."},
{t:"IRS Pub. 946 — How to Depreciate Property",u:"https://www.irs.gov/publications/p946",n:"27.5-year straight-line depreciation rule used directly in the after-tax cash flow simulation."},
{t:"Form 8582 Instructions — IRS",u:"https://www.irs.gov/instructions/i8582",n:"Technical reference for the passive activity loss limit calculation that the income tax slider approximates."},
{t:"BLS Consumer Price Index — Rent of Primary Residence",u:"https://www.bls.gov/cpi/factsheets/owners-equivalent-rent-and-rent.htm",n:"Historical rent growth data (2.5–4% annualized over rolling 10-year periods). Calibrates the 3%/yr default and 'Hot' (5%) tick on the rent-growth slider."},
{t:"Zillow Observed Rent Index (ZORI)",u:"https://www.zillow.com/research/data/",n:"Per-metro rent levels and year-over-year growth used to cross-check the metro base rents in the model."},
{t:"HUD User Fair Market Rents (FMR)",u:"https://www.huduser.gov/portal/datasets/fmr.html",n:"Federal government 50th-percentile rent benchmark by metro and bedroom count. Used as the lower-bound check on metro rent defaults."},
]},
{cat:"Rent Data by Metro",links:[
{t:"Bay Area ADU Rental Income 2026 — Custom Home",u:"https://www.customhome.us/blog/adu-rental-income-guide-bay-area/",n:"Source for SF Peninsula ($3,250) and San Jose ($2,750) base rents."},
{t:"LA ADU Investment Guide 2026 — CalBuild Remodel",u:"https://www.calbuildremodel.com/post/los-angeles-adu-investment-guide-2026-costs-roi-60-day-permits-rental-income-by-neighborhood",n:"LA Westside ($3,500) and LA SFV ($2,600) base rents."},
{t:"Seattle ADU Guide 2026 — Nine8 Redevelopment",u:"https://www.nine8redev.com/posts/seattle-adu-guide-2026-costs-permits-roi-what-homeowners-need-to-know",n:"Seattle prime ($2,800) and Seattle avg ($2,200) rent benchmarks."},
{t:"Colorado ADU ROI & Rental Income — Olerra",u:"https://www.olerra.com/blog/colorado-adu-roi-rental-income/",n:"Denver ($1,650) base rent and Front Range cap rate context."},
{t:"ADU Rules in Austin TX 2026 — Neuhaus Realty",u:"https://neuhausre.com/adu-accessory-dwelling-unit-rules-austin-tx-2026/",n:"Austin ($2,000) base rent and TX regulatory framing."},
{t:"ADU Rental Income San Mateo County — Genuine Kitchen & Bath",u:"https://genuinekitchenbath.com/adu-rental-income-san-mateo-county/",n:"San Mateo ($3,100) rent and the widely-cited 100–120× GRM heuristic."},
{t:"How Much Can I Rent My ADU For? — Maxable",u:"https://maxablespace.com/how-much-can-i-rent-my-adu-for/",n:"Cross-metro rent reference and size-to-rent scaling relationship."},
]},
{cat:"Construction & Site Costs",links:[
{t:"ADU Construction Cost California 2026 — Verified ADU",u:"https://verifiedadu.com/adu-construction-cost-california/",n:"Mid-market stick-built $/sqft ($275–300) tick mark calibration."},
{t:"Cost to Build an ADU in San Diego (2026) — SnapADU",u:"https://snapadu.com/adu-costs/",n:"$375–$600+/sqft turnkey for SD; the 80–85% vertical-build share insight used to separate structure from site work."},
{t:"ADU Cost Los Angeles 2026 — CALI ADU",u:"https://www.cali-adu.com/blog/cost-to-build-adu/",n:"Real $471/sqft LA project example; supports the $300–400/sqft default ranges."},
{t:"ADU Cost LA in 2026 — GatherADU",u:"https://www.gatheradu.com/blog/how-much-does-an-adu-permit-cost-in-california",n:"$240K for 600 sqft 1-BR baseline — the figure the calculator's default total is calibrated against."},
{t:"Prefab ADU Comparison — SnapADU",u:"https://snapadu.com/blog/studio-shed-vs-abodu-vs-villa-homes-comparing-popular-prefab-adu-options/",n:"Prefab tick ($220/sqft) and the prefab-vs-stick total-cost convergence (within 10–15%)."},
{t:"Abodu Prefab ADU Pricing — Abodu",u:"https://www.abodu.com/locations/prefab-adu-california",n:"Manufacturer-direct prefab pricing for one slider extreme."},
{t:"ADU Sitework & Utility Costs — SnapADU",u:"https://snapadu.com/blog/cost-drivers-adu-sitework/",n:"Site-work line items: foundation, grading, utility trenching defaults."},
{t:"Cost to Build ADU San Jose 2026 — Imkat Homes",u:"https://imkatconstruction.com/cost-to-build-an-adu-in-san-jose-2026-pricing-guide/",n:"Bay Area pricing extremes for the $400/sqft tick mark."},
]},
{cat:"Permits, Impact Fees & Soft Costs",links:[
{t:"ADU Permit Costs San Diego 2026 — Better Place",u:"https://betterplacedesignbuild.com/blog/adu-permit-cost-in-san-diego/",n:"SD permit fee defaults ($3K–$8K) and inspection cost line items."},
{t:"ADU Permit Fees & Waivers (SB 13) — SnapADU",u:"https://snapadu.com/blog/adu-permit-fees-waivers/",n:"SB 13 fee waiver thresholds (under 750 sqft) — informs the 'waived/incl.' tick on hookup fees."},
{t:"ADU Impact Fees in California — How To ADU",u:"https://www.how-to-adu.com/adu-articles-blog/accessory-dwelling-unit-impact-fees",n:"Impact-fee variance by jurisdiction; informs the $0–$20K permits range."},
{t:"San Diego ADU Fee Waiver — Better Place",u:"https://betterplacedesignbuild.com/blog/san-diego-adu-fee-waiver/",n:"Specific waiver mechanics for SD baseline."},
]},
{cat:"Water, Sewer & Electrical",links:[
{t:"2026 System Development Charges — Denver Water",u:"https://www.denverwater.org/contractors/construction-information/system-development-charges/2026",n:"Official ADU water charge inside Denver ($2,055 Jan–Jun 2026, $2,170 from July 1, 2026) — the Denver tick on the water & sewer slider."},
{t:"Rates and Fees (Impact Fees) — Austin Water",u:"https://www.austintexas.gov/water/rates-and-fees",n:"Official water and wastewater impact fees per service unit by plat date — the Austin ticks on the water & sewer slider."},
{t:"ADU System Development Charge Waiver — City of Portland",u:"https://www.portland.gov/zh-hans/ppd/residential-permitting/adu-sdc-huomian",n:"Portland's waiver of system development charges for qualifying ADUs — the Portland tick on the water & sewer slider."},
{t:"ADU Water, Sewer & Gas Connections — SnapADU",u:"https://snapadu.com/blog/guide-water-sewer-gas-connections-upgrades-for-adu/",n:"Hookup fee ranges by city; calibrates the $0–$30K water/sewer slider."},
{t:"ADU Plumbing Cost Guide — Better Place",u:"https://betterplacedesignbuild.com/blog/adu-plumbing-cost/",n:"Plumbing trench/run lengths used for the +sewer-pump high-end tick."},
{t:"Sewer Line Installation Cost 2026 — Angi",u:"https://www.angi.com/articles/how-much-does-installing-sewer-line-cost.htm",n:"National sewer-lateral cost benchmarks for non-CA metros."},
{t:"ADU Electrical Panel Requirements — SnapADU",u:"https://snapadu.com/blog/electric-panels-upgrades-power-sources-adu/",n:"When panel upgrade is needed vs. subpanel only — the four tick categories."},
{t:"ADU Electrical Panel & Service Upgrade — Better Place",u:"https://betterplacedesignbuild.com/blog/what-are-the-electrical-panel-requirements-for-an-adu-in-california/",n:"200A upgrade cost at $5K used as a tick mark."},
{t:"Electrical Panel Upgrade Cost 2026 — Caudill's",u:"https://caudills.com/electrical-panel-upgrade-cost-guide/",n:"National panel upgrade pricing for non-CA jurisdictions."},
]},
{cat:"Surveys, Soil Reports & Design",links:[
{t:"Soil Report Costs for ADUs — Better Place",u:"https://betterplacedesignbuild.com/blog/soil-report-costs-a-comprehensive-guide/",n:"Soil report pricing range for the surveys slider."},
{t:"ADU Soils Reports: When Needed? — SnapADU",u:"https://snapadu.com/blog/adu-grading-plan-soils-report-do-you-need-one/",n:"Decision logic on when geotech is required — informs the 'not required' tick."},
{t:"Geotechnical Report Cost 2026 — HomeGuide",u:"https://homeguide.com/costs/geotechnical-report-cost",n:"National geotech pricing for the full-geotech high-end tick."},
{t:"Land Survey Cost 2026 — Angi",u:"https://www.angi.com/articles/how-much-does-land-survey-cost.htm",n:"Survey-only baseline pricing."},
]},
{cat:"Operating Expenses, Property Tax & Insurance",links:[
{t:"ADU ROI Colorado: Cash-Flow Model — Olerra",u:"https://www.olerra.com/blog/adu-investment-roi-colorado/",n:"Operating expense ratios (~28–35% of rent) that calibrate the slider defaults."},
{t:"True Costs of an Accessory Dwelling — New Avenue",u:"https://www.newavenuehomes.com/blog/what-are-the-true-costs-of-an-accessory-dwelling",n:"Maintenance reserve and vacancy assumptions used in defaults."},
{t:"How ADUs Affect Property Taxes (CA) — SnapADU",u:"https://snapadu.com/blog/california-san-diego-adu-effect-on-property-taxes/",n:"CA Prop 13 treatment of ADUs — explains the 1.1% default and 2% escalator."},
{t:"ADUs and Taxes — Beach Front PM",u:"https://bfpminc.com/understanding-adus-and-taxes-impact-on-property-taxes-and-tax-deductions-in-california/",n:"Reassessment mechanics for ADUs in non-Prop-13 states."},
{t:"ADU Rental Income & Depreciation — Daniels",u:"https://www.danielsremodeling.com/blog/adu-rental-income-taxes/",n:"Schedule E treatment basics; informs the tax explainer prose."},
{t:"Home Insurance Rates by State 2025 — Bankrate/NerdWallet aggregations",u:"https://www.bankrate.com/insurance/homeowners-insurance/states/",n:"Per-state premium rates as % of dwelling coverage; calibrates jurisdiction tick marks on the insurance slider."},
{t:"Standard & Poor's GRMs by U.S. Metro — Multiple Industry Reports",u:"https://www.spglobal.com/spdji/en/indices/equity/sp-corelogic-case-shiller-us-national-home-price-nsa-index/",n:"Case-Shiller-derived gross rent multiplier ranges by metro tier (low-cost 80–120×, high-cost coastal 200–300×). Used to disclose conservatism of the 110× heuristic in coastal markets."},
{t:"California FAIR Plan Rate Filings — CA Dept. of Insurance",u:"https://www.insurance.ca.gov/0250-insurers/0300-insurers/0200-fair-plan/",n:"CA insurer-of-last-resort rates and underwriting rules. Source for the 1.5–2.5% insurance rate noted for high-wildfire-risk areas where standard carriers have withdrawn."},
]},
{cat:"Property Value & Financing",links:[
{t:"ADU Appraisal: 100–120× Rule — Genuine Kitchen & Bath",u:"https://genuinekitchenbath.com/adu-rental-income-san-mateo-county/",n:"The GRM heuristic widely cited by lenders/builders. The 110× midpoint is this tool's default value multiplier."},
{t:"6 ADU Loan Options — RenoFi",u:"https://www.renofi.com/adus/adu/financing/",n:"Loan product menu: HELOC, cash-out refi, renovation loans, construction-to-perm. Informs the rate/term defaults."},
{t:"ADU Financing Options — JVM Lending",u:"https://www.jvmlending.com/blog/how-much-does-an-adu-cost-adu-financing-options/",n:"Typical rate ranges (6–9%) for ADU loans in 2026 — calibrates the 7.5% default."},
{t:"Best ADU Loan Programs CA — Better Place",u:"https://betterplacedesignbuild.com/blog/adu-loan-programs/",n:"CalHFA grant info and program-specific structures."},
{t:"ADU HELOC 125% CLTV — Patelco",u:"https://www.patelco.org/credit-cards-and-loans/home-equity/adu-line-of-credit",n:"Future-value-based HELOC products — the 125% CLTV is unusual in the broader market."},
{t:"Freddie Mac Primary Mortgage Market Survey",u:"https://www.freddiemac.com/pmms",n:"Weekly 30-year fixed mortgage rate benchmark used for the broader rate context (HELOCs and renovation loans typically run +100–200 bps above PMMS)."},
{t:"CalHFA ADU Grant Program — California Housing Finance Agency",u:"https://www.calhfa.ca.gov/adu/",n:"Up to $40,000 in pre-development cost grants for income-qualified homeowners. The model does NOT include this — output is conservative for CA homeowners eligible for the program."},
{t:"Fannie Mae Selling Guide on ADU Income — B3-3.1-08",u:"https://selling-guide.fanniemae.com/sel/b3-3.1-08/rental-income",n:"Federal underwriting guidance on counting ADU rental income in DTI calculations. Informs the financing-feasibility framing in the Summary view."},
]},
{cat:"Short-Term Rental & Hybrid Strategy",links:[
{t:"ADU Airbnb Income by City — Maxable",u:"https://maxablespace.com/adu-airbnb/",n:"STR nightly rate benchmarks by metro — informs the ADR tick marks ($75–$300/night)."},
{t:"Airbnb Host Fee Structure 2026 — Airbnb",u:"https://www.airbnb.com/help/article/1857",n:"Host-only 15% vs split-fee 3% model — used for the hosting/management cost slider."},
{t:"STR vs LTR for ADUs — Autonomous",u:"https://www.autonomous.ai/ourblog/adu-short-term-rental",n:"Comparative net-income analysis between strategies — informs the hybrid mode blending logic."},
{t:"Furnished Finder — Medium-Term Rental Platform",u:"https://www.furnishedfinder.com/",n:"Traveling-nurse and 30+ day rentals — reference for the medium-term alternative to STR/LTR."},
{t:"AirDNA Market Reports — Short-Term Rental Analytics",u:"https://www.airdna.co/",n:"Per-market STR occupancy, ADR, and revenue trends. Referenced for the warning that STR supply has grown faster than demand in many markets since 2022."},
{t:"AirDNA 2026 US Short-Term Rental Outlook Report",u:"https://www.airdna.co/outlook-report",n:"Forward ADR growth forecast: 1.5% base case (conservative), 2–3% mid-range with mix shift toward premium listings, up to 4.5% in strong event markets. Source for the nightly rate growth slider tick marks."},
{t:"AirDNA: 2026 Will Be the Best Year to Invest in STRs Since 2021 — PR Newswire",u:"https://www.prnewswire.com/news-releases/2026-will-be-the-best-year-to-invest-in-short-term-rentals-since-2021-new-airdna-report-finds-302643393.html",n:"Confirms post-pandemic ADR normalization (2022–2023 flat to 1%) and modest 2024–2025 recovery (2.1–3%). Basis for 'Flat' and 'Conservative' tick marks on the STR nightly rate growth slider."},
{t:"Local STR Ordinance Tracker — Granicus / Host Compliance",u:"https://hostcompliance.com/blog/",n:"Catalog of city-level STR restrictions (LA, NYC, SF, Boston, etc.). Informs the STR regulatory-risk caveat."},
]},
{cat:"Construction Timelines",links:[
{t:"How Long Does It Take to Build an ADU? — Maxable",u:"https://maxablespace.com/how-long-does-it-take-to-build-an-adu/",n:"6–9 month typical timelines; supports the 6-month default."},
{t:"ADU Permit Timeline California 2026 — Verified ADU",u:"https://verifiedadu.com/adu-permit-timeline-california/",n:"Permit-to-completion timing including the SB 9 60-day streamlining."},
{t:"Prefab ADU Timeline: Abodu vs. Stick-Built — Abodu",u:"https://www.abodu.com/blog/how-long-does-it-take-to-build-an-adu",n:"Prefab can compress to 3–4 months; informs the 'Prefab' tick at 4mo."},
]},
{cat:"Solar Loan Comparison (Origination Fee Model)",links:[
{t:"Solar Dealer Fee Explained — EnergySage",u:"https://www.energysage.com/solar/financing/dealer-fees/",n:"10–30% dealer-fee model — the analog for the optional origination-fee toggle in the financing card."},
{t:"How Solar Loans Work — SEIA",u:"https://www.seia.org/initiatives/solar-financing",n:"Structural overview of how solar lenders bake origination fees into project price — directly mirrored in the optional fee toggle."},
{t:"Solar ABS Market Overview — KBRA",u:"https://www.kbra.com/topics/solar-abs",n:"Securitization context for why solar lenders front-load fees — informs the framing of the fee model."},
]},
];

// Light theme palette for consumer view
const LT={bg:"#f8fafc",card:"#ffffff",border:"#e2e8f0",borderLight:"#f1f5f9",text:"#0f172a",body:"#475569",muted:"#64748b",mutedLight:"#94a3b8",pos:"#16a34a",posBg:"#dcfce7",info:"#2563eb",infoBg:"#dbeafe",warn:"#d97706",warnBg:"#fef3c7",neg:"#dc2626",negBg:"#fee2e2"};
const ltCard={background:LT.card,border:"1px solid "+LT.border,borderRadius:12,boxShadow:"0 1px 3px rgba(15,23,42,0.04)"};

// Shared page header for both views, so the actions sit in the same place: an optional
// Reset, then Print, then Copy model link as the rightmost (primary) button.
function PageHeader({dark,title,subtitle,copied,onCopy,onReset,confirmReset}){
  const btn={borderRadius:8,fontSize:13,fontWeight:600,padding:"10px 18px",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit",transition:"background 0.15s, border-color 0.15s"};
  const sec=dark?{...btn,background:"transparent",border:"1px solid #30363d",color:"#c9d1d9"}:{...btn,background:LT.card,border:"1px solid "+LT.border,color:LT.body};
  const pri=dark
    ?{...btn,background:copied?"rgba(63,185,80,0.15)":tb,border:"1px solid "+(copied?gn:tb),color:copied?gn:"#0d1117"}
    :{...btn,background:copied?LT.posBg:LT.info,border:"1px solid "+(copied?LT.pos:LT.info),color:copied?LT.pos:"#fff"};
  const warn=dark?{...sec,background:"rgba(248,81,73,0.15)",border:"1px solid "+rd,color:rd}:{...sec,background:LT.negBg,border:"1px solid "+LT.neg,color:LT.neg};
  return(<div style={{marginBottom:26,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
    <div style={{flex:"1 1 320px",minWidth:0}}>
      <h1 style={{fontFamily:"'Fraunces',serif",fontSize:30,fontWeight:700,margin:"0 0 6px",letterSpacing:"-0.02em",color:dark?"#e6edf3":LT.text}}>{title}</h1>
      <p style={{color:dark?"#8b949e":LT.body,fontSize:14,margin:0,lineHeight:1.5}}>{subtitle}</p>
    </div>
    <div className="no-print" style={{display:"flex",gap:8,flexShrink:0,flexWrap:"wrap",marginLeft:"auto"}}>
      {onReset&&<button type="button" onClick={onReset} style={confirmReset?warn:sec}>{confirmReset?"Click again to confirm":"Reset all"}</button>}
      <button type="button" onClick={()=>window.print()} style={sec}>Print / Save as PDF</button>
      <button type="button" onClick={onCopy} style={pri}>{copied?"Model link copied ✓":"Copy model link"}</button>
    </div>
  </div>);
}

// Print-only report: a formal, letter-size readout of the scenario. Screens never see it;
// printing from either view produces it instead of the interactive page.
const fShort=n=>{const a=Math.abs(n),s=n<0?"−":"";return a>=1e6?s+"$"+(a/1e6).toFixed(2)+"M":a>=1000?s+"$"+(a/1000).toFixed(a>=100000?0:1)+"k":s+"$"+Math.round(a)};
// Accounting style for tables: negatives in parentheses, zero as a dash, no dollar signs (stated in the caption).
const fAcct=n=>{const r=Math.round(n)||0;return r===0?"—":r<0?"("+Math.abs(r).toLocaleString()+")":r.toLocaleString()};
const RP={ink:"#0f172a",body:"#334155",muted:"#64748b",rule:"#cbd5e1",faint:"#e2e8f0",band:"#f1f5f9",accent:"#1e3a5f",pos:"#15803d",neg:"#b91c1c"};
function PrintReport({rep}){
  if(!rep)return(<div className="print-report" style={{fontFamily:"'DM Sans',sans-serif",color:RP.ink,padding:40}}>Enter the rent you'd charge to generate the report.</div>);
  const{cm}=rep;
  const H2=({children,first})=>(<h2 style={{fontFamily:"'Fraunces',serif",fontSize:15,fontWeight:600,color:RP.accent,margin:first?"0 0 8px":"20px 0 8px",paddingBottom:4,borderBottom:"1.5px solid "+RP.accent,breakAfter:"avoid"}}>{children}</h2>);
  const KV=({rows})=>(<table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5}}><tbody>
    {rows.map(([k,v,strong],i)=>(<tr key={i} style={{borderBottom:"1px solid "+(strong?RP.rule:RP.faint)}}>
      <td style={{padding:"4px 0",color:strong?RP.ink:RP.body,fontWeight:strong?700:400}}>{k}</td>
      <td style={{padding:"4px 0",textAlign:"right",color:RP.ink,fontWeight:strong?700:500,whiteSpace:"nowrap"}}>{v}</td>
    </tr>))}
  </tbody></table>);
  const kpis=[
    ["Total project cost",fD(rep.total),"Likely "+fShort(rep.costRange.lo)+"–"+fShort(rep.costRange.hi)+" as built"],
    ["Monthly loan payment",rep.loanAmt>0?fD(rep.loanPmt):"None",rep.loanAmt>0?rep.rate.toFixed(2).replace(/0$/,"")+"% · "+rep.term+" years":"No loan"],
    ["Year-1 cash flow",(cm.bars[0].net>=0?"+":"")+fD(cm.bars[0].net)+"/mo","Average month"+(rep.loanAmt>0&&rep.incomeTax>0?", after loan and tax":rep.loanAmt>0?", after loan payment":rep.incomeTax>0?", after tax":", after expenses")],
    ["Cash-flow positive",cm.cfPlus<=0?"Day one":fYr(cm.cfPlus)+(cm.cfAtTerm?"*":""),"From project start"],
    ["Payback",cm.po===0?"Immediate":fYr(cm.po),"All cash invested returned"],
    [rep.loanAmt>0?"Net equity at payoff":"Net equity, year "+rep.evalYrs,(cm.ret>=0?"+":"")+fShort(cm.ret),cm.roi===null?"":(cm.roi>=0?"+":"")+cm.roi.toFixed(1)+"%/yr compound on cost"],
  ];
  const ledger=[
    ["Cash invested"+(rep.cashDownAmt>0?" ("+rep.cashDown+"% down)":""),-rep.cashDownAmt],
    ...(cm.conPaid>0?[["Construction-period interest",-cm.conPaid]]:[]),
    ["Cumulative net cash flow",cm.cashCollected],
    [rep.loanAmt>0?"ADU value (loan paid off)":"ADU value",cm.valueEnd],
  ];
  const showTax=rep.incomeTax>0;
  const cols=["Year","Gross rent","Operating costs","Loan payments",...(showTax?["Income tax"]:[]),"Net cash flow","Cumulative cash","Loan balance","ADU value","Net equity"];
  const th={padding:"5px 4px",fontSize:8.5,fontWeight:700,color:RP.muted,textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"right",borderBottom:"1.5px solid "+RP.ink,verticalAlign:"bottom"};
  const td={padding:"3.5px 4px",fontSize:9.5,textAlign:"right",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"};
  const tot=cm.annual.filter(a=>a.year>0).reduce((s,a)=>({rent:s.rent+a.rent,ops:s.ops+a.ops,pay:s.pay+a.pay,tax:s.tax+a.tax,net:s.net+a.net}),{rent:0,ops:0,pay:0,tax:0,net:0});
  return(<div className="print-report" style={{fontFamily:"'DM Sans',sans-serif",color:RP.ink,background:"#fff",fontSize:10.5,lineHeight:1.45}}>
    <style>{"@page{@top-left{content:"+JSON.stringify("ADU Investment Analysis — "+rep.title)+";font:9px 'DM Sans',sans-serif;color:#64748b}}"}</style>

    {/* PAGE 1 — summary */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:16,paddingBottom:10,borderBottom:"3px solid "+RP.accent}}>
      <div>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:RP.accent}}>ADU Investment Analysis</div>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:24,fontWeight:700,lineHeight:1.15,marginTop:2}}>{rep.title}</div>
        <div style={{fontSize:10.5,color:RP.body,marginTop:3}}>{rep.subtitle}</div>
        {rep.preparedFor&&<div style={{fontSize:10.5,color:RP.ink,marginTop:3}}>Prepared for <strong>{rep.preparedFor}</strong></div>}
      </div>
      <div style={{textAlign:"right",fontSize:9.5,color:RP.muted,lineHeight:1.5}}>
        <div>Prepared {rep.date}{rep.preparedBy?" by "+rep.preparedBy:""}</div>
        <div>Estimate — not an appraisal or offer of credit</div>
      </div>
    </div>

    <p style={{fontSize:11.5,lineHeight:1.55,margin:"12px 0 14px",color:RP.ink}}>{rep.verdict}</p>
    {rep.clientNotes&&<div style={{margin:"0 0 14px",padding:"8px 12px",borderLeft:"3px solid "+RP.accent,background:RP.band,fontSize:10,lineHeight:1.5,color:RP.body,whiteSpace:"pre-wrap"}}><strong style={{color:RP.ink}}>Notes{rep.preparedBy?" from "+rep.preparedBy:""}: </strong>{rep.clientNotes}</div>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",border:"1px solid "+RP.rule,borderRadius:4}}>
      {kpis.map(([k,v,s],i)=>(<div key={k} style={{padding:"9px 12px",borderRight:i%3<2?"1px solid "+RP.rule:"none",borderBottom:i<3?"1px solid "+RP.rule:"none"}}>
        <div style={{fontSize:8.5,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:RP.muted}}>{k}</div>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:19,fontWeight:700,lineHeight:1.2,marginTop:2}}>{v}</div>
        <div style={{fontSize:9,color:RP.muted}}>{s}</div>
      </div>))}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
      <div>
        <H2>Project Cost</H2>
        <KV rows={[...rep.costRows.map(([k,v])=>[k,fD(v)]),["Total project cost",fD(rep.total),true]]}/>
        <div style={{fontSize:9,color:RP.muted,marginTop:4}}>Likely final cost {fD(rep.costRange.lo)}–{fD(rep.costRange.hi)} (80% range; {rep.costRange.note}). {rep.loanAmt>0?fD(rep.cashDownAmt)+" down, "+fD(rep.loanAmt)+" financed.":"Paid in cash."}</div>
        <H2>Return Summary{rep.loanAmt>0?" at Loan Payoff":" After "+rep.evalYrs+" Years"}</H2>
        <KV rows={[...ledger.map(([k,v])=>[k,(Math.round(v)>0?"+":"")+fD(v)]),["Total return",(cm.ret>=0?"+":"")+fD(cm.ret),true]]}/>
        <div style={{fontSize:9,color:RP.muted,marginTop:4}}>{cm.roi===null?"":cm.roi.toFixed(1)+"%/yr compound on the "+fD(rep.total)+" project cost"}{cm.roiCash!==null&&rep.loanAmt>0?"; "+cm.roiCash.toFixed(1)+"%/yr on the "+fD(rep.cashDownAmt)+" invested":""}. Afterward the ADU nets about {fD(cm.postLoan.net)}/mo, growing with rent.</div>
      </div>
      <div>
        <H2>Financing</H2>
        <KV rows={rep.finRows}/>
        <H2>Operating Assumptions</H2>
        <KV rows={rep.opRows}/>
      </div>
    </div>

    {/* PAGE 2 — over time */}
    <div style={{breakBefore:"page"}}>
      <H2 first>Cash Position Over Time</H2>
      <div style={{fontSize:9.5,color:RP.body,marginBottom:4}}>Cumulative money in and out of pocket: down payment, then each month's rent after expenses, loan payments{rep.incomeTax>0?" and income tax":""}. Payback is where the line crosses zero.</div>
      <TimeChart pts={cm.pts} height={210} ariaLabel="Cumulative cash position by year"
        series={[{key:"cash",color:"#15803d",width:2}]} area={{pos:"#15803d",neg:"#b45309"}}
        pointColor={p=>p.cash>=0?"#15803d":"#b45309"}
        vlines={rep.loanAmt>0?[{x:cm.loanEndYr,label:"Loan paid off"}]:[]}
        marker={cm.po>0&&cm.po!==Infinity?{x:cm.po,label:"Payback yr "+cm.po.toFixed(1),color:"#15803d"}:null}
        tooltip={()=>null}/>
      <H2>Net Equity Over Time</H2>
      <div style={{fontSize:9.5,color:RP.body,marginBottom:4}}>Estimated ADU value, minus loan balance, plus cash position.{rep.buildMonths>0?" The ADU is valued at $0 until it's finished (shaded build period), since a half-built ADU can't be rented or appraised the normal way.":""}</div>
      <TimeChart pts={cm.pts} height={210} band={rep.buildMonths>0?{to:rep.buildMonths/12,label:"Building — not valued yet"}:null} ariaLabel="Net equity by year"
        series={[{key:"tot",color:RP.accent,width:2.5},{key:"value",color:"#b45309",dash:"2,4",opacity:0.8},{key:"loanNeg",color:"#b91c1c",dash:"4,3",opacity:0.7},{key:"cash",color:"#15803d",dash:"4,3",opacity:0.8}]}
        area={{pos:RP.accent,neg:RP.accent}} vlines={rep.loanAmt>0?[{x:cm.loanEndYr,label:"Loan paid off"}]:[]} tooltip={()=>null}/>
      <div style={{display:"flex",gap:16,fontSize:9,color:RP.muted,marginTop:2}}>
        {[["Net equity",RP.accent,"solid"],["ADU value","#b45309","dotted"],["Loan balance","#b91c1c","dashed"],["Cash position","#15803d","dashed"]].map(([l,c,s])=><span key={l}><span style={{display:"inline-block",width:16,borderTop:"2px "+s+" "+c,verticalAlign:"middle",marginRight:4}}/>{l}</span>)}
      </div>

      <H2>Stress Tests</H2>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Scenario","Cash-flow positive","Payback","Total return","vs. base"].map((h,i)=><th key={h} style={{...th,textAlign:i?"right":"left"}}>{h}</th>)}</tr></thead>
        <tbody>{cm.stress.map((t,i)=>(<tr key={t.label} style={{borderBottom:"1px solid "+RP.faint,fontWeight:i===0?700:400}}>
          <td style={{...td,textAlign:"left"}}>{t.label}</td>
          <td style={td}>{t.cfPlus<=0?"Day one":fYr(t.cfPlus)+(t.cfAtTerm?"*":"")}</td>
          <td style={td}>{t.po===0?"Immediate":fYr(t.po)}</td>
          <td style={td}>{(t.ret>=0?"+":"")+fShort(t.ret)}</td>
          <td style={{...td,color:i===0?RP.muted:RP.neg}}>{i===0?"—":fShort(t.ret-cm.stress[0].ret)}</td>
        </tr>))}</tbody>
      </table>
      {rep.cmp&&<div style={{breakInside:"avoid"}}><H2>Financing Options Compared</H2><FinCompareTable cols={rep.cmp} theme="print"/><div style={{fontSize:9,color:RP.muted,marginTop:4}}>Same project, different financing; best figure per row highlighted. Rates are estimates — confirm with lenders.</div></div>}
      <div style={{fontSize:9,color:RP.muted,marginTop:4}}>Each test changes one assumption and holds the rest.{cm.stress.some(t=>t.cfAtTerm)?" * Positive only once the loan is paid off.":""}</div>
    </div>

    {/* PAGE 3 — annual projection and notes */}
    <div style={{breakBefore:"page"}}>
      <H2 first>Annual Projection</H2>
      <div style={{fontSize:9.5,color:RP.body,marginBottom:6}}>US dollars; negatives in parentheses. Flows are annual totals by rental year; balances and values are at year end. Year 0 is {rep.buildMonths>0?"the "+rep.buildMonths+"-month construction period":"the start, when the down payment is made"}{cm.conPaid>0?"; its loan payments are interest on construction draws":""}.</div>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{cols.map((h,i)=><th key={h} style={{...th,textAlign:i?"right":"left"}}>{h}</th>)}</tr></thead>
        <tbody>
          {cm.annual.map(a=>(<tr key={a.year} style={{borderBottom:"1px solid "+RP.faint,background:rep.loanAmt>0&&a.year===rep.term?RP.band:"transparent"}}>
            <td style={{...td,textAlign:"left",fontWeight:600}}>{a.year===0?(rep.buildMonths>0?"0 (build)":"0 (start)"):a.year}</td>
            <td style={td}>{a.year===0?"—":fAcct(a.rent)}</td>
            <td style={td}>{a.year===0?"—":fAcct(-a.ops)}</td>
            <td style={td}>{fAcct(-a.pay)}</td>
            {showTax&&<td style={td}>{fAcct(-a.tax)}</td>}
            <td style={{...td,fontWeight:600,color:a.net<0?RP.neg:RP.ink}}>{fAcct(a.net)}</td>
            <td style={{...td,color:a.cum<0?RP.neg:RP.ink}}>{fAcct(a.cum)}</td>
            <td style={td}>{fAcct(a.bal)}</td>
            <td style={td}>{fAcct(a.value)}</td>
            <td style={{...td,fontWeight:600}}>{fAcct(a.tot)}</td>
          </tr>))}
          <tr style={{borderTop:"1.5px solid "+RP.ink}}>
            <td style={{...td,textAlign:"left",fontWeight:700}}>Total</td>
            <td style={{...td,fontWeight:700}}>{fAcct(tot.rent)}</td>
            <td style={{...td,fontWeight:700}}>{fAcct(-tot.ops)}</td>
            <td style={{...td,fontWeight:700}}>{fAcct(-(tot.pay+cm.annual[0].pay))}</td>
            {showTax&&<td style={{...td,fontWeight:700}}>{fAcct(-tot.tax)}</td>}
            <td style={{...td,fontWeight:700}}>{fAcct(tot.net+cm.annual[0].net)}</td>
            <td colSpan={4}/>
          </tr>
        </tbody>
      </table>
      {rep.loanAmt>0&&<div style={{fontSize:9,color:RP.muted,marginTop:4}}>Shaded row: final year of the {rep.term}-year loan.</div>}

      <H2>Notes and Method</H2>
      <ul style={{margin:"4px 0 0",paddingLeft:16,fontSize:9.5,color:RP.body,lineHeight:1.55}}>
        {rep.notes.map((n,i)=><li key={i} style={{marginBottom:3}}>{n}</li>)}
      </ul>
      <div style={{marginTop:14,padding:"8px 10px",border:"1px solid "+RP.rule,borderRadius:4,fontSize:8.5,color:RP.muted,lineHeight:1.5}}>
        This analysis is an estimate for planning purposes only. It is not an appraisal, tax advice, or an offer or commitment to lend. Actual costs, rents, financing terms, taxes and property values will differ. Consult a licensed contractor, lender, appraiser and tax professional before committing funds.
      </div>
    </div>
  </div>);
}

// Typical all-in build cost per sq ft (structure, site work, fees, contingency and builder margin;
// before any loan fee) by project type — rough 2025–2026 ranges, mostly from California builder
// pricing in the sources. Used only as a sanity check, never in the math.
// Tick marks for the water & sewer fee slider, by city. California is the original set; the other
// cities are included only where the utility publishes the fee itself (sources in SRC).
//  - Austin Water impact fees per service unit (water + wastewater), by plat date: about $800–1,100
//    for central lots platted before 2007, $7,200 for 2018–2023 plats, $7,700 after Oct 1, 2023.
//  - Denver Water's ADU system development charge (water only): $2,170 from July 1, 2026.
//  - Portland waives system development charges for qualifying ADUs.
const HOOKUP_TICKS={
  ca:{label:"California",ticks:[{value:0,label:"Waived / incl.",color:gn},{value:4000,label:"San Diego",color:tk},{value:12000,label:"LA",color:tk},{value:20000,label:"SF",color:yl},{value:30000,label:"+lateral",color:rd}],
    note:"California examples. ADUs under 750 sq ft are exempt from impact fees under state law; connection and capacity charges vary by utility."},
  austin:{label:"Austin",ticks:[{value:1000,label:"Central lot (pre-2007)",color:gn},{value:7700,label:"Lot platted after 2023",color:yl}],
    note:"Austin Water impact fees per service unit, water + wastewater, by when the lot was platted: about $800–$1,100 for central lots platted before 2007, $7,200 for 2018–2023, $7,700 after October 2023. Meter and inspection fees are extra, and Austin Water sets how many service units an ADU is assessed — confirm with them."},
  denver:{label:"Denver",ticks:[{value:2170,label:"ADU water charge",color:tb}],
    note:"Denver Water's system development charge for an ADU inside Denver: $2,170 from July 1, 2026 ($2,055 before). It covers water only; sewer connection charges are separate."},
  portland:{label:"Portland",ticks:[{value:0,label:"SDCs waived",color:gn}],
    note:"Portland waives system development charges for qualifying ADUs. Conditions apply — confirm eligibility with Portland Permitting & Development."},
};
const PSF_RANGE={detached:[350,600],prefab:[300,550],garage:[150,300],attached:[300,550],jadu:[100,250]};
const WF_COLORS={dark:["#58a6ff","#3fb950","#a371f7","#d29922","#f0883e","#f85149"],light:["#2563eb","#16a34a","#7c3aed","#d97706","#ea580c","#dc2626"]};
// "Where the money goes": each cost step as a bar starting where the previous one ended, then the
// total — plus an all-in $/sq ft check against the typical range for the project type.
function CostWaterfall({steps,total,buildTotal,sqft,ptypeKey,typeNoun,dark,range}){
  const c=dark?{text:"#c9d1d9",muted:"#8b949e",track:"#0d1117",rule:"#21262d",strong:"#e6edf3",ok:gn,warn:yl}:{text:LT.body,muted:LT.muted,track:LT.borderLight,rule:LT.borderLight,strong:LT.text,ok:LT.pos,warn:LT.warn};
  const pal=WF_COLORS[dark?"dark":"light"];
  const shown=steps.filter(s=>s.amt>0);
  let cum=0;
  const psf=sqft>0?buildTotal/sqft:0,[lo,hi]=PSF_RANGE[ptypeKey]||PSF_RANGE.detached;
  const verdict=psf<lo?"below":psf>hi?"above":"within";
  const row=(label,left,width,color,amt,bold,key)=>(
    <div key={key} style={{display:"grid",gridTemplateColumns:"minmax(110px,170px) 1fr 84px",alignItems:"center",gap:10,padding:"4px 0"}}>
      <span style={{fontSize:12,color:bold?c.strong:c.text,fontWeight:bold?600:400}}>{label}</span>
      <span style={{position:"relative",height:16,background:c.track,borderRadius:3}}>
        <span style={{position:"absolute",left:left+"%",width:Math.max(width,0.6)+"%",top:0,bottom:0,background:color,borderRadius:3,opacity:bold?1:0.85}}/>
      </span>
      <span style={{fontFamily:"'Fraunces',serif",fontSize:13.5,fontWeight:bold?700:600,color:c.strong,textAlign:"right"}}>{fD(amt)}</span>
    </div>);
  return(<div>
    {shown.map((s,i)=>{const r=row(s.label,cum/total*100,s.amt/total*100,pal[steps.indexOf(s)%pal.length],s.amt,false,s.label);cum+=s.amt;return r})}
    <div style={{borderTop:"1px solid "+c.rule,marginTop:4}}>{row("Total project cost",0,100,dark?"#6e7681":"#475569",total,true,"total")}</div>
    {range&&<div style={{fontSize:12,color:c.text,marginTop:6,lineHeight:1.5}}>Likely final cost: <strong style={{color:c.strong}}>{fD(range.lo)}–{fD(range.hi)}</strong> <span style={{color:c.muted}}>(80% range; {range.note})</span></div>}
    <div style={{fontSize:12,color:c.text,marginTop:10,lineHeight:1.5}}>
      All-in build cost: <strong style={{color:c.strong}}>{fD(psf)}/sq ft</strong>{" — "}
      <span style={{color:verdict==="within"?c.ok:c.warn}}>{verdict==="within"?"within":verdict==="above"?"above":"below"} the typical {fD(lo)}–{fD(hi)}/sq ft for a {typeNoun}</span>
      {verdict==="above"?". Check the $/sq ft and site costs — or local pricing may simply run higher.":verdict==="below"?". Make sure nothing is missing.":"."}
      <IT align="left" text={"Build cost (structure, site work, fees, contingency and builder margin, before any loan fee) divided by the ADU's size. The typical range is a rough 2025–2026 figure for this project type, mostly from California builder pricing — a sanity check only; it isn't used in any calculation."}/>
    </div>
  </div>);
}

// Financing options compared: each column is the same project run through the model with different
// financing. Rows are compared at fixed horizons because "at payoff" is a different year per loan.
const CMP_ALTS=["B","C","D"];
const CMP_ROWS=[
  {k:"pmt",label:"Monthly payment",better:"low",fmt:v=>v>0?fD(v)+"/mo":"No loan"},
  {k:"y1",label:"Year-1 cash flow",better:"high",fmt:v=>(v>=0?"+":"")+fD(v)+"/mo"},
  {k:"cfPlus",label:"Cash-flow positive",better:"low",fmt:v=>v<=0?"Day one":fYr(v)},
  {k:"po",label:"Payback",better:"low",fmt:v=>v===0?"Immediate":fYr(v)},
  {k:"interest",label:"Interest paid",better:"low",fmt:v=>fD(v)},
  {k:"net15",label:"Net position at 15 years",better:"high",fmt:v=>(v>=0?"+":"")+fShort(v)},
  {k:"net30",label:"Net position at 30 years",better:"high",fmt:v=>(v>=0?"+":"")+fShort(v)},
];
function bestIdx(cols,row){
  const vals=cols.map(c=>c[row.k]);if(vals.every(v=>v===vals[0]))return-1;
  const target=row.better==="low"?Math.min(...vals):Math.max(...vals);return vals.indexOf(target);
}
// theme: "dark" (Full model), "light" (Summary), "print" (report).
function FinCompareTable({cols,theme}){
  const T=theme==="dark"?{text:"#c9d1d9",muted:"#8b949e",strong:"#e6edf3",rule:"#21262d",best:"rgba(63,185,80,0.14)",bestText:gn,font:12}
    :theme==="light"?{text:LT.body,muted:LT.muted,strong:LT.text,rule:LT.borderLight,best:LT.posBg,bestText:LT.pos,font:12.5}
    :{text:RP.body,muted:RP.muted,strong:RP.ink,rule:RP.faint,best:"#e8f5ec",bestText:RP.pos,font:9.5};
  const th={textAlign:"right",padding:"6px 8px",fontSize:T.font-1,color:T.strong,fontWeight:700,verticalAlign:"bottom",borderBottom:"1.5px solid "+(theme==="print"?RP.ink:T.rule)};
  const td={textAlign:"right",padding:"6px 8px",fontSize:T.font,color:T.text,borderBottom:"1px solid "+T.rule,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"};
  return(<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:cols.length*96+130}}>
    <thead><tr><th style={{...th,textAlign:"left"}}/>{cols.map(c=><th key={c.key} style={th}>{c.name}<div style={{fontWeight:400,color:T.muted,fontSize:T.font-2}}>{c.down>=100?"All cash":c.rate+"% · "+c.term+" yr"+(c.down>0?" · "+c.down+"% down":"")}{c.fee>0?" · "+c.fee+"% fee":""}</div></th>)}</tr></thead>
    <tbody>{CMP_ROWS.map(row=>{const b=bestIdx(cols,row);return(<tr key={row.k}>
      <td style={{...td,textAlign:"left",color:T.muted}}>{row.label}</td>
      {cols.map((c,i)=><td key={c.key} style={{...td,background:i===b?T.best:"transparent",color:i===b?T.bestText:T.text,fontWeight:i===b?700:400}}>{row.fmt(c[row.k])}</td>)}
    </tr>)})}</tbody>
  </table></div>);
}
// Editable inputs for one alternative column (Full model).
function CmpNum({value,onChange,lo,hi,step,label,suffix}){
  return(<label style={{display:"flex",flexDirection:"column",gap:3,fontSize:10.5,color:"#8b949e"}}>{suffix}
    <input type="number" aria-label={label} value={value} min={lo} max={hi} step={step} onChange={e=>{const n=parseFloat(e.target.value);if(Number.isFinite(n))onChange(Math.min(hi,Math.max(lo,n)))}}
      style={{width:"100%",boxSizing:"border-box",padding:"4px 6px",background:"#0d1117",border:"1px solid #30363d",borderRadius:5,color:"#e6edf3",fontSize:12,textAlign:"right",fontFamily:"inherit"}}/>
  </label>);
}
function FinCompare({state,set,cols}){
  return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
    <Tog on={state.cmpOn} onToggle={()=>set("cmpOn")(!state.cmpOn)} label="Compare financing options" sub="Run the same project with other loans side by side — in the Summary and the printed report too"/>
    {state.cmpOn&&(<div style={nested}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,190px),1fr))",gap:10}}>
        {CMP_ALTS.map(a=>{const on=state["cmp"+a+"On"];return(
          <div key={a} style={{...card,background:"#0d1117",padding:"10px 12px",opacity:on?1:0.55}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#8b949e",marginBottom:6}}><input type="checkbox" checked={on} onChange={()=>set("cmp"+a+"On")(!on)}/>Option {a}</label>
            <input type="text" aria-label={"Option "+a+" name"} value={state["cmp"+a+"Name"]} onChange={e=>set("cmp"+a+"Name")(e.target.value.slice(0,40))} disabled={!on}
              style={{width:"100%",boxSizing:"border-box",padding:"5px 8px",background:"#161b22",border:"1px solid #30363d",borderRadius:5,color:"#e6edf3",fontSize:12.5,fontWeight:600,fontFamily:"inherit",marginBottom:8}}/>
            {on&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              <CmpNum label={"Option "+a+" rate"} value={state["cmp"+a+"Rate"]} onChange={set("cmp"+a+"Rate")} lo={0} hi={25} step={0.125} suffix="Rate %"/>
              <CmpNum label={"Option "+a+" term"} value={state["cmp"+a+"Term"]} onChange={v=>set("cmp"+a+"Term")(Math.round(v))} lo={5} hi={20} step={1} suffix="Term (years)"/>
              <CmpNum label={"Option "+a+" down payment"} value={state["cmp"+a+"Down"]} onChange={set("cmp"+a+"Down")} lo={0} hi={100} step={5} suffix="Down %"/>
              <CmpNum label={"Option "+a+" fee"} value={state["cmp"+a+"Fee"]} onChange={set("cmp"+a+"Fee")} lo={0} hi={40} step={0.5} suffix="Fees %"/>
            </div>}
          </div>)})}
      </div>
      <div style={{fontSize:11,color:yl,margin:"8px 0 10px",lineHeight:1.45}}>Example rates — replace them with real quotes. "Fees" are closing costs or a loan fee as a share of the build cost, added to the amount financed. Construction interest uses the setting above for every option.</div>
      <FinCompareTable cols={cols} theme="dark"/>
    </div>)}
  </div>);
}

// Quick-pick buttons under a Summary slider.
function Presets({value,onPick,options}){
  return(<div className="no-print" style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
    {options.map(([v,l])=>(<button key={v} type="button" onClick={()=>onPick(v)} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:value===v?600:500,cursor:"pointer",userSelect:"none",border:"1px solid "+(value===v?LT.info:LT.border),background:value===v?LT.info:LT.card,color:value===v?LT.card:LT.body,transition:"all 0.15s",fontFamily:"inherit"}}>{l}</button>))}
  </div>);
}
const fieldLabel={fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600,marginBottom:5};
const fieldValue={fontFamily:"'Fraunces',serif",fontSize:17,fontWeight:600,color:LT.text,whiteSpace:"nowrap"};
const fieldNote={fontSize:11.5,color:LT.muted,marginTop:8,lineHeight:1.5};

function ConsumerView({cm,costRange,preparedFor,preparedBy,cmpCols,verdict,saleOn,setSaleOn,saleYear,setSaleYear,rentY1,unitNoun,grm,assetCost,origFeeAmt,origFee,costSteps,ptypeKey,total,loanPmt,loanAmt,cashDownAmt,rate,term,setTerm,horizon,setHorizon,growth,buildMonths,sqft,utype,isSTR,hasCustom,customName,cashDown,setCashDown,incomeTax,customRent,setCustomRent,setCustomName,sizeAnchor,rentLo,rentHi,copied,copyShare}){
  const[barYear,setBarYear]=useState(1);const[showParts,setShowParts]=useState(false);
  const[showMethod,setShowMethod]=useState(false);
  const fK2=n=>{const a=Math.abs(n),s=n<0?"−":"";return a>=1000000?s+"$"+(a/1000000).toFixed(1)+"M":a>=1000?s+"$"+Math.round(a/1000)+"k":s+"$"+Math.round(a)};

  return(<>
    <PageHeader title="Your ADU Investment Summary" copied={copied} onCopy={copyShare}
      subtitle={sqft+" sq ft "+utype.toLowerCase()+" "+unitNoun+" · "+(origFeeAmt>0?fD(assetCost)+" to build + "+fD(origFeeAmt)+" loan fee = "+fD(total)+" project":fD(total)+" project")+" · "+(loanAmt>0?rate.toFixed(1)+"% / "+term+"-year financing"+(cashDownAmt>0?" · "+fD(cashDownAmt)+" down":""):"paid in cash")}/>
    {(preparedFor||preparedBy)&&<div style={{fontSize:12.5,color:LT.muted,marginTop:-16,marginBottom:20}}>{preparedFor&&<>Prepared for <strong style={{color:LT.body}}>{preparedFor}</strong></>}{preparedFor&&preparedBy?" · ":""}{preparedBy&&<>Prepared by <strong style={{color:LT.body}}>{preparedBy}</strong></>}</div>}
    {/* THE SHORT ANSWER — the verdict first, before any inputs */}
    {verdict&&(
      <div style={{...ltCard,padding:"20px 24px",marginBottom:16,borderLeft:"4px solid "+(cm.ret>=0?LT.pos:LT.neg)}}>
        <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:8}}>The short answer</div>
        <p style={{margin:0,fontFamily:"'Fraunces',serif",fontSize:19,fontWeight:500,lineHeight:1.45,color:LT.text}}>{verdict}</p>
        <div style={{fontSize:12.5,color:LT.muted,marginTop:8}}>Project cost estimate {fD(total)} — likely {fD(costRange.lo)}–{fD(costRange.hi)} as built (80% range; {costRange.note}).</div>
      </div>
    )}

    {/* YOUR SCENARIO — the few inputs a homeowner adjusts, in one card */}
    <div style={{...ltCard,padding:"18px 22px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:14}}>Your scenario</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:"20px 28px"}}>
        {/* Rent */}
        <div>
          {isSTR?(<>
            <div style={fieldLabel}>Monthly revenue</div>
            <div style={fieldValue}>{fD(rentY1)}/mo</div>
            <div style={fieldNote}>Short-term rental — set by the nightly rate in the Full model.</div>
          </>):(<>
            <label htmlFor="cRent" style={{...fieldLabel,display:"block"}}>Monthly rent{!hasCustom&&<span style={{color:LT.warn,textTransform:"none",letterSpacing:0,fontWeight:500}}> — required</span>}</label>
            <div style={{position:"relative",maxWidth:220}}>
              <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:15,color:LT.muted,pointerEvents:"none",fontFamily:"'Fraunces',serif"}}>$</span>
              <input id="cRent" className="fld" type="number" inputMode="numeric" min={0} step={25} value={customRent||""} onChange={e=>setCustomRent(parseInt(e.target.value)||0)} placeholder="e.g. 2000" style={{width:"100%",background:LT.card,border:"1px solid "+(hasCustom?LT.border:LT.warn+"80"),borderRadius:6,padding:"8px 44px 8px 26px",color:LT.text,fontSize:16,fontFamily:"'Fraunces',serif",outline:"none",boxSizing:"border-box"}}/>
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:LT.muted,pointerEvents:"none"}}>/mo</span>
            </div>
            <div style={fieldNote}>What you'd list this {sqft} sq ft {utype.toLowerCase()} for. Check local listings — this size runs about {fD(sizeAnchor)}/mo at the U.S. average and {fD(rentLo)}–{fD(rentHi)}/mo across major metros.</div>
            <label htmlFor="cLoc" style={{...fieldLabel,display:"block",marginTop:10}}>Label <span style={{textTransform:"none",letterSpacing:0,fontWeight:400}}>(optional)</span></label>
            <input id="cLoc" className="fld" type="text" value={customName} onChange={e=>setCustomName(e.target.value)} placeholder="e.g. Portland — Alberta" style={{width:"100%",maxWidth:260,background:LT.card,border:"1px solid "+LT.border,borderRadius:6,padding:"7px 10px",color:LT.text,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
          </>)}
        </div>

        {/* Down payment */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
            <span style={fieldLabel}>Down payment</span>
            <span style={fieldValue}>{cashDown===0?"$0":cashDown===100?"All cash":fD(cashDownAmt)+" ("+cashDown+"%)"}</span>
          </div>
          <input type="range" aria-label="Down payment percent" min={0} max={100} step={5} value={cashDown} onChange={e=>setCashDown(parseFloat(e.target.value))} style={{width:"100%",accentColor:LT.info,height:6,cursor:"pointer",margin:"6px 0 0"}}/>
          <Presets value={cashDown} onPick={setCashDown} options={[[0,"$0"],[20,"20%"],[50,"50%"],[100,"All cash"]]}/>
          <div style={fieldNote}>
            {cashDown===100?"No loan — you own it outright from day one.":(cashDown===0?"100% financed":fD(loanAmt)+" financed")+" · "+fD(loanPmt)+"/mo payment."}
            {cm.conPaid>0?" Plus about "+fD(cm.conPaid)+" of interest during the "+buildMonths+"-month build.":cm.conCap>0?" Includes about "+fD(cm.conCap)+" of build-period interest added to the loan.":""}
          </div>
        </div>

        {/* Loan term (or how far to look when paying cash) */}
        <div>
          {loanAmt>0?(<>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
              <span style={fieldLabel}>Loan term</span>
              <span style={fieldValue}>{term} years · {rate.toFixed(1)}%</span>
            </div>
            <input type="range" aria-label="Loan term in years" min={5} max={20} step={1} value={term} onChange={e=>setTerm(parseInt(e.target.value))} style={{width:"100%",accentColor:LT.info,height:6,cursor:"pointer",margin:"6px 0 0"}}/>
            <Presets value={term} onPick={setTerm} options={[[5,"5 yr"],[10,"10 yr"],[15,"15 yr"],[20,"20 yr"]]}/>
            <div style={fieldNote}>{term<=10?"Shorter loans cost more per month but less in total interest.":"Longer loans lower the payment but cost more interest over time."} The rate is set in the Full model.</div>
          </>):(<>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
              <span style={fieldLabel}>Years to evaluate</span>
              <span style={fieldValue}>{horizon} years</span>
            </div>
            <input type="range" aria-label="Years to evaluate" min={5} max={30} step={1} value={horizon} onChange={e=>setHorizon(parseInt(e.target.value))} style={{width:"100%",accentColor:LT.info,height:6,cursor:"pointer",margin:"6px 0 0"}}/>
            <Presets value={horizon} onPick={setHorizon} options={[[5,"5 yr"],[10,"10 yr"],[20,"20 yr"],[30,"30 yr"]]}/>
            <div style={fieldNote}>With no loan, this sets how far out the returns and the full picture are measured.</div>
          </>)}
        </div>
      </div>
      {origFeeAmt>0&&(
        <div style={{marginTop:16,padding:"10px 14px",borderRadius:8,background:LT.warnBg,fontSize:12.5,color:LT.text,lineHeight:1.5,display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <span><strong>Loan origination fee:</strong> {fD(origFeeAmt)} ({origFee}% of the {fD(assetCost)} build cost), added to the project price and financed.</span>
          <span style={{fontFamily:"'Fraunces',serif",fontWeight:600,whiteSpace:"nowrap"}}>{fD(assetCost)} + {fD(origFeeAmt)} = {fD(total)}</span>
        </div>
      )}
    </div>

    {!hasCustom&&!isSTR&&(
      <div style={{...ltCard,padding:"40px 30px",textAlign:"center",marginBottom:20,background:LT.borderLight}}>
        <div style={{fontSize:17,fontWeight:600,color:LT.text,marginBottom:8}}>Enter the rent you'd charge to see the analysis</div>
        <div style={{fontSize:13,color:LT.body,lineHeight:1.6,maxWidth:440,margin:"0 auto"}}>The verdict, monthly cash flow, equity buildup, payback period and stress tests appear once you give a rent estimate. Even a rough number works; you can refine it later.</div>
      </div>
    )}

    {(hasCustom||isSTR)&&(()=>{
    const y1=cm.bars[0],post=cm.postLoan;
    const y1Pos=y1.net>=0;
    const taxNote=incomeTax>0?" and income tax":"";
    const timeNote="Years count from project start"+(buildMonths>0?", including the "+buildMonths+"-month build (no rent or loan payments yet)":"")+".";
    const secH={fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600};
    return(<>
    {/* HERO outcome card */}
    <div style={{...ltCard,padding:"28px 30px",marginBottom:20}}>
      <div style={{...secH,marginBottom:14}}>Estimated total return</div>
      <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        {cm.hero.map(h=>{const up=h.ret>=0;return(
          <div key={h.key} style={{flex:"1 1 0",minWidth:90,textAlign:"center",padding:"16px 10px",borderRadius:10,background:up?LT.posBg:LT.negBg,border:(h.key==="end"?"2px solid ":"1px solid ")+(up?"rgba(34,197,94,"+(h.key==="end"?"0.5":"0.2")+")":"rgba(220,38,38,"+(h.key==="end"?"0.5":"0.2")+")")}}>
            <div style={{fontSize:11,color:LT.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600}}>{h.label}{h.sub&&<span style={{textTransform:"none",letterSpacing:0,fontWeight:500}}> · {h.sub}</span>}</div>
            <div style={{fontFamily:"'Fraunces',serif",fontSize:26,fontWeight:700,color:up?LT.pos:LT.neg,lineHeight:1,marginBottom:4}}>{up?"+":""}{fK2(h.ret)}</div>
            <div style={{fontSize:11,color:LT.body}}>{h.roi===null?"":(h.roi>=0?"+":"")+h.roi.toFixed(1)+"%/yr"}</div>
          </div>)})}
      </div>
      <div style={{fontSize:13,color:LT.body,lineHeight:1.6,textAlign:"center"}}>
        What you'd be ahead by at each point: the ADU's value, minus any loan left, plus the after-tax cash it has made, minus your down payment. %/yr is compound on the {fD(total)} project cost{buildMonths>0?"; years count from the start of the "+buildMonths+"-month build":""}.
      </div>
    </div>

    {/* MONTHLY BREAKDOWN — rental-year slider */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6,gap:8,flexWrap:"wrap"}}>
        <div style={secH}>Monthly breakdown</div>
        <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:LT.text}}>Rental year {Math.min(barYear,cm.bars.length)}{loanAmt>0&&barYear>term?" (post-loan)":""}</span>
      </div>
      <div className="no-print" style={{marginBottom:14}}>
        <input type="range" aria-label="Rental year" min={1} max={cm.bars.length} step={1} value={Math.min(barYear,cm.bars.length)} onChange={e=>setBarYear(parseInt(e.target.value))} style={{width:"100%",accentColor:LT.info,height:5,cursor:"pointer",margin:0}}/>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:LT.muted,marginTop:4}}>
          <span>Year 1</span>
          {loanAmt>0&&<span>Year {term} (loan ends)</span>}
          <span>Year {cm.bars.length}</span>
        </div>
      </div>
      {(()=>{
        const b=cm.bars[Math.min(barYear-1,cm.bars.length-1)];
        const totalExp=b.opEx+b.propTax+b.ins;
        const maxBar=Math.max(b.rent,b.pmt,totalExp,1);
        const netMo=b.net;
        const netPos=netMo>=0;
        const taxActive=incomeTax>0;
        const rowL={display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4,gap:8};
        const track={width:"100%",height:26,background:LT.borderLight,borderRadius:6,overflow:"hidden"};
        return(<>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <div style={rowL}>
              <span style={{fontSize:12.5,color:LT.body}}>{isSTR?"Expected revenue":"Expected rent"}</span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:LT.pos}}>{fD(b.rent)}/mo</span>
            </div>
            <div style={track}><div style={{height:"100%",background:LT.pos,borderRadius:6,width:`${(b.rent/maxBar)*100}%`,transition:"width 0.3s"}}/></div>
          </div>
          {loanAmt>0&&<div style={{opacity:b.pmt>0?1:0.35}}>
            <div style={rowL}>
              <span style={{fontSize:12.5,color:b.pmt>0?LT.body:LT.muted}}>{b.pmt>0?"Loan payment":"Loan payment (paid off)"}</span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:b.pmt>0?LT.text:LT.pos}}>{b.pmt>0?"−"+fD(b.pmt)+"/mo":"$0 — paid off!"}</span>
            </div>
            {b.pmt>0?(<>
              <div style={track}>
                <div style={{height:"100%",width:`${(b.pmt/maxBar)*100}%`,display:"flex"}}>
                  <div title={"Interest: "+fD(b.interest)+"/mo"} style={{height:"100%",background:LT.neg,width:`${(b.interest/b.pmt)*100}%`,transition:"width 0.3s",opacity:0.75}}/>
                  <div title={"Principal: "+fD(b.principal)+"/mo"} style={{height:"100%",background:"#cbd5e1",width:`${(b.principal/b.pmt)*100}%`,transition:"width 0.3s"}}/>
                </div>
              </div>
              <div style={{display:"flex",gap:14,marginTop:5,fontSize:11.5,color:LT.muted,flexWrap:"wrap"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:5,flexWrap:"wrap"}}><span style={{display:"inline-block",width:10,height:10,background:LT.neg,opacity:0.75,borderRadius:2,flexShrink:0}}/>Interest <strong style={{color:LT.neg,fontFamily:"'Fraunces',serif"}}>{fD(b.interest)}</strong> <span style={{color:LT.muted}}>— cost of borrowing</span></span>
                <span style={{display:"inline-flex",alignItems:"center",gap:5,flexWrap:"wrap"}}><span style={{display:"inline-block",width:10,height:10,background:"#cbd5e1",borderRadius:2,flexShrink:0}}/>Principal <strong style={{color:LT.text,fontFamily:"'Fraunces',serif"}}>{fD(b.principal)}</strong> <span style={{color:LT.muted}}>— builds equity</span></span>
              </div>
            </>):(<div style={track}/>)}
          </div>}
          <div>
            <div style={rowL}>
              <span style={{fontSize:12.5,color:LT.body}}>Operating expenses <span style={{fontSize:11,color:LT.muted}}>(property tax, insurance, vacancy, maintenance)</span></span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:LT.warn,whiteSpace:"nowrap"}}>{"−"+fD(totalExp)}/mo</span>
            </div>
            <div style={track}><div style={{height:"100%",background:LT.warn,borderRadius:6,width:`${(totalExp/maxBar)*100}%`,transition:"width 0.3s",opacity:0.8}}/></div>
          </div>
          {taxActive&&<div>
            <div style={rowL}>
              <span style={{fontSize:12.5,color:taxActive?LT.body:LT.muted}}>Income tax <span style={{fontSize:11,color:LT.muted}}>{taxActive?"("+incomeTax+"% marginal rate)":"(not modeled — set a rate in the Full model)"}</span></span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:taxActive?LT.neg:LT.muted,whiteSpace:"nowrap"}}>{taxActive?"−"+fD(b.incomeTax)+"/mo":"$0"}</span>
            </div>
            <div style={track}><div style={{height:"100%",background:taxActive?"#ef4444":"#cbd5e1",borderRadius:6,width:taxActive?`${(b.incomeTax/maxBar)*100}%`:"0%",transition:"width 0.3s",opacity:0.7}}/></div>
          </div>}
        </div>
        <div style={{marginTop:12,padding:"10px 14px",borderRadius:8,background:netPos?LT.posBg:LT.warnBg,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div>
            <span style={{fontFamily:"'Fraunces',serif",fontSize:20,fontWeight:700,color:netPos?LT.pos:LT.warn}}>{netPos?"+":""}{fD(netMo)}/mo</span>
            <span style={{fontSize:13,color:LT.body,marginLeft:10}}>{netPos?"Net income":"Net subsidy"} in rental year {Math.min(barYear,cm.bars.length)}</span>
          </div>
          <div style={{fontSize:11.5,color:LT.muted,lineHeight:1.4,maxWidth:260}}>{loanAmt===0?"No loan — all net rent is yours from day one.":barYear>term?"Loan paid off — all net rent is yours.":!netPos&&growth>0?"Rent grows "+growth+"%/yr while the payment stays fixed.":netPos?"The ADU is cash-flow positive.":""}</div>
        </div>
        <div style={{fontSize:11,color:LT.muted,marginTop:8}}>Monthly averages over the year.</div>
        </>);
      })()}
    </div>

    {/* 4-column summary */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:20}}>
      {[
        {k:"Year-1 cash flow",v:<>{y1Pos?"+":""}{fD(y1.net)}<span style={{fontSize:12,color:LT.muted,fontWeight:400}}>/mo</span></>,c:y1Pos?LT.pos:LT.warn,s:"Average month: rent − expenses"+taxNote+(loanAmt>0?" − "+fD(loanPmt)+" loan":"")},
        {k:"Years to cash positive",v:cm.cfPlus<=0?"Day one":fYr(cm.cfPlus),c:cm.cfPlus<=0?LT.pos:cm.cfAtTerm||cm.cfPlus===Infinity?LT.warn:LT.pos,s:cm.cfPlus<=0?"Positive from the first rent check":cm.cfPlus===Infinity?"Expenses outpace rent":cm.cfAtTerm?"Only once the loan is paid off":"When growing rent overtakes the loan payment"},
        {k:"Payback period",v:cm.po===0?"Immediate":fYr(cm.po),c:cm.po<=cm.evalYrs?LT.pos:cm.po<=cm.evalYrs*1.5?LT.warn:LT.neg,s:cm.po===0?"You're never out of pocket":"Until every dollar you put in is back"},
        {k:loanAmt>0?"Income after the loan":"Income in year "+cm.evalYrs,v:<>{fD(post.net)}<span style={{fontSize:12,color:LT.muted,fontWeight:400}}>/mo</span></>,c:post.net>=0?LT.pos:LT.neg,s:"Rental year "+(loanAmt>0?term+1:cm.evalYrs)+", after expenses"+taxNote+"; rent grown to "+fD(post.rent)+"/mo"},
      ].map(t=>(
        <div key={t.k} style={{...ltCard,padding:"16px 16px"}}>
          <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:8,lineHeight:1.3}}>{t.k}</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:23,fontWeight:700,color:t.c,lineHeight:1,marginBottom:6}}>{t.v}</div>
          <div style={{fontSize:12,color:LT.body,lineHeight:1.45}}>{t.s}</div>
        </div>
      ))}
    </div>

    {/* FINANCING OPTIONS COMPARED (when turned on in the Full model) */}
    {cmpCols&&<div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{...secH,marginBottom:6}}>Financing options compared</div>
      <div style={{fontSize:12.5,color:LT.body,marginBottom:12,lineHeight:1.5}}>The same project with different loans. The best figure in each row is highlighted. Rates are estimates — confirm with lenders.</div>
      <FinCompareTable cols={cmpCols} theme="light"/>
    </div>}

    {/* WHERE THE MONEY GOES */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{...secH,marginBottom:12}}>Where the money goes</div>
      <CostWaterfall steps={costSteps} total={total} buildTotal={assetCost} sqft={sqft} ptypeKey={ptypeKey} typeNoun={unitNoun} range={costRange}/>
    </div>

    {/* PROPERTY VALUE */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{...secH,marginBottom:14}}>Impact on your property value</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:16,marginBottom:16}}>
        <div style={{textAlign:"center",padding:"14px 10px",borderRadius:10,background:LT.borderLight}}>
          <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:500,marginBottom:6}}>You invest</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,color:LT.text}}>{fD(total)}</div>
        </div>
        <div style={{textAlign:"center",padding:"14px 10px",borderRadius:10,background:LT.borderLight}}>
          <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:500,marginBottom:6}}>Value when complete</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,color:cm.valueY1>=total?LT.pos:LT.warn}}>{fD(cm.valueY1)}</div>
          <div style={{fontSize:12,color:cm.valueY1>=total?LT.pos:LT.warn,fontWeight:600,marginTop:2}}>{(cm.valueY1/total).toFixed(1)}× your cost</div>
        </div>
        <div style={{textAlign:"center",padding:"14px 10px",borderRadius:10,background:cm.valueEnd>=total?LT.posBg:LT.warnBg}}>
          <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:500,marginBottom:6}}>{loanAmt>0?"Value at loan payoff":"Value in year "+cm.evalYrs}</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,color:cm.valueEnd>=total?LT.pos:LT.warn}}>{fK2(cm.valueEnd)}</div>
          <div style={{fontSize:12,color:cm.valueEnd>=total?LT.pos:LT.warn,fontWeight:600,marginTop:2}}>{(cm.valueEnd/total).toFixed(1)}× your cost</div>
        </div>
      </div>
      <div style={{fontSize:12.5,color:LT.body,lineHeight:1.6}}>
        {cm.valueY1>=total?"You create immediate equity: once built, the ADU adds an estimated "+fD(cm.valueY1)+" to your property value — "+fD(cm.valueY1-total)+" more than what you paid.":"The ADU initially appraises "+fD(total-cm.valueY1)+" below its cost — common with high site work or premium finishes."}
        {growth>0?" As rents grow "+growth+"%/yr, that value climbs to an estimated "+fK2(cm.valueEnd)+" by "+(loanAmt>0?"loan payoff":"year "+cm.evalYrs)+".":""}
      </div>
      <div style={{fontSize:11,color:LT.muted,marginTop:8}}>Value estimates use a gross rent multiplier ({grm}× monthly long-term rent). Actual appraisals use comparable sales and may differ.{grm<200?" Coastal markets often see higher multipliers (200–300×), so this may be conservative there.":""}</div>
    </div>

    {/* CASH POSITION TIMELINE */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{...secH,marginBottom:4}}>Your cash position over time</div>
      <div style={{fontSize:12.5,color:LT.body,marginBottom:14,lineHeight:1.5}}>Every dollar in and out of your pocket: {cashDownAmt>0?"the "+fD(cashDownAmt)+" down payment, then ":""}each month's rent after expenses, minus loan payments{taxNote}. Payback is where the line crosses zero.</div>
      <TimeChart pts={cm.pts} ariaLabel="Cumulative cash position by year"
        series={[{key:"cash",color:"#16a34a",width:2.5}]}
        area={{pos:"#16a34a",neg:"#d97706"}}
        pointColor={p=>p.cash>=0?"#16a34a":"#d97706"}
        vlines={loanAmt>0?[{x:cm.loanEndYr,label:"Loan paid off"}]:[]}
        marker={cm.po>0&&cm.po!==Infinity?{x:cm.po,label:"Payback yr "+cm.po.toFixed(1),color:"#16a34a"}:null}
        tooltip={p=>(<>
          <div style={{fontSize:11,color:"#94a3b8",fontWeight:500}}>{p.label||"Year "+p.year}</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:15,fontWeight:600,color:p.cash>=0?"#4ade80":"#fbbf24"}}>{p.cash>=0?"+":""}{fD(p.cash)}</div>
        </>)}/>
      <div style={{fontSize:12,color:LT.body,lineHeight:1.5,marginTop:8}}>
        {cm.po===Infinity?"Within 50 years the ADU doesn't pay back what you put in.":cm.po===0?"With nothing down and positive cash flow from the start, you're never out of pocket.":"Amber is money you're out of pocket; green is money the ADU has paid back beyond everything you put in."} {timeNote}
      </div>
    </div>

    {/* NET EQUITY POSITION */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{...secH,marginBottom:4}}>Net equity position over time</div>
      <div style={{fontSize:12.5,color:LT.body,marginBottom:14,lineHeight:1.5}}>Total wealth created by the ADU at any point — asset value <strong style={{color:LT.info}}>minus</strong> remaining loan balance <strong style={{color:LT.info}}>plus</strong> your cash position. After the loan is paid off, the payment becomes income and growth accelerates.{buildMonths>0?" During the "+buildMonths+"-month build (shaded) the ADU's value stays at $0 — a half-built ADU can't be rented or appraised the normal way — so net equity dips while money goes out, then jumps when it's finished.":""}</div>
      <TimeChart pts={cm.pts} height={250} band={buildMonths>0?{to:buildMonths/12,label:"Building — not valued yet"}:null} ariaLabel="Net equity, ADU value, loan balance and cash position by year"
        series={[{key:"tot",color:"#2563eb",width:3},...(showParts?[{key:"value",color:"#d97706",dash:"2,4",opacity:0.6},{key:"loanNeg",color:"#ef4444",dash:"4,3",opacity:0.5},{key:"cash",color:"#16a34a",dash:"4,3",opacity:0.55}]:[])]}
        area={{pos:"#2563eb",neg:"#2563eb"}}
        vlines={loanAmt>0?[{x:cm.loanEndYr,label:"Loan paid off"}]:[]}
        tooltip={p=>{const row=(l,v,c)=>(<div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}><span style={{color:"#94a3b8",fontSize:12}}>{l}</span><span style={{fontFamily:"'Fraunces',serif",fontSize:13,fontWeight:600,color:c}}>{v}</span></div>);return(<>
          <div style={{fontSize:11,color:"#94a3b8",fontWeight:500,marginBottom:4}}>{p.label||"Year "+p.year}</div>
          {row("ADU value",fD(p.value),"#fbbf24")}
          {row("Loan balance",p.bal>0?"−"+fD(p.bal):"$0",p.bal>0?"#f87171":"#4ade80")}
          {row("Cash position",(p.cash>=0?"+":"")+fD(p.cash),p.cash>=0?"#4ade80":"#fbbf24")}
          <div style={{borderTop:"1px solid #334155",paddingTop:3,marginTop:2,display:"flex",justifyContent:"space-between",gap:12}}>
            <span style={{color:"#e2e8f0",fontSize:12,fontWeight:600}}>Net equity</span>
            <span style={{fontFamily:"'Fraunces',serif",fontSize:14,fontWeight:700,color:"#60a5fa"}}>{p.tot>=0?"+":""}{fD(p.tot)}</span>
          </div>
        </>)}}/>
      <div style={{display:"flex",gap:16,marginTop:10,fontSize:12,color:LT.muted,flexWrap:"wrap",alignItems:"center"}}>
        <span><span style={{display:"inline-block",width:20,height:3,background:"#2563eb",borderRadius:2,verticalAlign:"middle",marginRight:5}}/>Net equity</span>
        {showParts&&<><span><span style={{display:"inline-block",width:20,height:0,borderTop:"2px dotted #d97706",verticalAlign:"middle",marginRight:5}}/>ADU value</span>
        <span><span style={{display:"inline-block",width:20,height:0,borderTop:"2px dashed #ef4444",verticalAlign:"middle",marginRight:5}}/>Loan balance</span>
        <span><span style={{display:"inline-block",width:20,height:0,borderTop:"2px dashed #16a34a",verticalAlign:"middle",marginRight:5}}/>Cash position</span></>}
        <button type="button" className="no-print" onClick={()=>setShowParts(v=>!v)} style={{marginLeft:"auto",background:"none",border:"none",padding:0,color:LT.info,fontSize:12,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>{showParts?"Hide the parts":"Show what makes it up"}</button>
      </div>
    </div>

    {/* THE FULL PICTURE — what you put in, what you got, what you keep */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{...secH,marginBottom:14}}>{loanAmt>0?"The full picture when the loan is paid off":"The full picture after "+cm.evalYrs+" years"}</div>
      <div style={{display:"flex",flexDirection:"column",gap:0}}>
        {[
          {label:"Cash you invested"+(cashDownAmt>0?" ("+cashDown+"% down)":""),value:-cashDownAmt,sub:cashDownAmt===0?"100% financed — no cash out of pocket":loanAmt>0?"The rest is financed at "+rate.toFixed(1)+"%":"Paid in full, no loan",color:LT.text,icon:"↓"},
          ...(cm.conPaid>0?[{label:"Construction-period interest",value:-cm.conPaid,sub:"Interest-only payments on the funds drawn during the "+buildMonths+"-month build",color:LT.warn,icon:"−"}]:[]),
          {label:"Cumulative net cash flow",value:cm.cashCollected,sub:cm.cashCollected>=0?"Rent after expenses"+taxNote+(loanAmt>0?" exceeded your loan payments":""):(cm.subsidies>0?"You covered "+fD(cm.subsidies)+" of monthly shortfalls along the way":"Monthly shortfalls before rent caught up"),color:cm.cashCollected>=0?LT.pos:LT.warn,icon:cm.cashCollected>=0?"+":"−"},
          {label:loanAmt>0?"A fully paid-off ADU":"The ADU's value",value:cm.valueEnd,sub:"Estimated contribution to your home's value ("+fD(cm.valueY1)+" when complete, growing with rent) — rent-multiplier method",color:LT.pos,icon:"+"},
          {label:"Total return",value:cm.ret,sub:(cm.roi===null?"":cm.roi.toFixed(1)+"%/yr compound on the "+fD(total)+" project cost")+(cm.roiCash!==null?" ("+cm.roiCash.toFixed(1)+"%/yr on the "+fD(cashDownAmt)+" you put in)":", with no cash out of pocket"),color:cm.ret>=0?LT.pos:LT.neg,icon:"=",bold:true},
        ].map((item,i)=>(<div key={i} style={{display:"flex",alignItems:"flex-start",padding:item.bold?"14px 16px":"11px 16px",borderBottom:!item.bold?"1px solid "+LT.borderLight:"none",background:item.bold?(cm.ret>=0?LT.posBg:LT.negBg):"transparent",borderRadius:item.bold?8:0}}>
          <span style={{fontSize:item.bold?16:14,color:LT.muted,width:22,textAlign:"center",fontWeight:600,marginTop:2}}>{item.icon}</span>
          <div style={{flex:1,marginLeft:8}}>
            <div style={{fontSize:item.bold?15:13,color:item.bold?LT.text:LT.body,fontWeight:item.bold?600:500}}>{item.label}</div>
            <div style={{fontSize:12,color:LT.muted,marginTop:2,lineHeight:1.4}}>{item.sub}</div>
          </div>
          <span style={{fontFamily:"'Fraunces',serif",fontSize:item.bold?24:17,fontWeight:700,color:item.color,marginLeft:12,whiteSpace:"nowrap"}}>{Math.round(item.value)===0?"$0":(item.value>=0?"+":"")+fK2(item.value)}</span>
        </div>))}
      </div>
      {/* What you keep going forward — not part of the total above */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16,marginTop:16,paddingTop:14,borderTop:"1px solid "+LT.border}}>
        {[
          ["Ongoing rental income",<>About <strong style={{color:post.net>=0?LT.pos:LT.warn}}>{fD(post.net)}/mo</strong> net{loanAmt>0?" with no loan payment":""}, growing with rent</>],
          ["Multigenerational flexibility","House family, age in place, or change how you use it without selling"],
        ].map(([h,s])=>(
          <div key={h} style={{display:"flex",alignItems:"baseline",gap:8}}>
            <div style={{fontSize:12,color:LT.pos,minWidth:14}}>✓</div>
            <div><div style={{fontSize:13.5,fontWeight:600,color:LT.text}}>{h}</div><div style={{fontSize:12.5,color:LT.body,lineHeight:1.5}}>{s}</div></div>
          </div>
        ))}
      </div>
    </div>

    {/* WHAT IF YOU SOLD? — optional; owners who plan to keep it can turn it off */}
    {saleOn&&<div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:12,flexWrap:"wrap",marginBottom:4}}>
        <div style={secH}>What if you sold?</div>
        <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:LT.text}}>After {saleYear} year{saleYear===1?"":"s"} of renting</span>
      </div>
      <button type="button" className="no-print" onClick={()=>setSaleOn(false)} style={{background:"none",border:"none",padding:0,color:LT.info,fontSize:11.5,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>Not planning to sell? Hide this</button>
      <input type="range" aria-label="Years of renting before selling" min={1} max={30} step={1} value={saleYear} onChange={e=>setSaleYear(parseInt(e.target.value))} style={{width:"100%",accentColor:LT.info,height:6,cursor:"pointer",margin:"8px 0 0"}}/>
      <Presets value={saleYear} onPick={setSaleYear} options={[[5,"5 yr"],[10,"10 yr"],[15,"15 yr"],[20,"20 yr"],[30,"30 yr"]]}/>
      {(()=>{const sl=cm.sale;const rows=[
        ["What the ADU adds to the sale price",sl.value,"Estimated value at "+grm+"× rent"],
        ["Selling costs ("+sl.costPct+"%)",-sl.costs,"Agent commission and closing costs"],
        ...(sl.bal>0?[["Pay off the remaining loan",-sl.bal,""]]:[]),
        ...(sl.recapture>0?[["Depreciation recapture tax",-sl.recapture,"Tax on "+fD(sl.recaptured)+" of depreciation deducted while renting"]]:[]),
        ...(sl.nolBenefit>0?[["Carried-forward losses released",sl.nolBenefit,"Unused rental losses become deductible when you sell"]]:[]),
      ];return(<>
        <div style={{display:"flex",flexDirection:"column",marginTop:14}}>
          {rows.map(([l,v,sub],i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,padding:"9px 4px",borderBottom:"1px solid "+LT.borderLight}}>
            <div><div style={{fontSize:13,color:LT.body}}>{l}</div>{sub&&<div style={{fontSize:11.5,color:LT.muted,marginTop:1}}>{sub}</div>}</div>
            <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:v<0?LT.warn:LT.text,whiteSpace:"nowrap"}}>{(v>0?"+":"")+fD(v)}</span>
          </div>))}
          <div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"10px 4px",borderBottom:"1px solid "+LT.border}}>
            <span style={{fontSize:13.5,fontWeight:600,color:LT.text}}>Cash from the sale</span>
            <span style={{fontFamily:"'Fraunces',serif",fontSize:17,fontWeight:700,color:LT.text,whiteSpace:"nowrap"}}>{fD(sl.proceeds)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,padding:"9px 4px"}}>
            <div><div style={{fontSize:13,color:LT.body}}>Cash flow while you owned it</div><div style={{fontSize:11.5,color:LT.muted,marginTop:1}}>Rent after all costs, minus your down payment{cm.conPaid>0?" and construction interest":""}</div></div>
            <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:sl.cash<0?LT.warn:LT.text,whiteSpace:"nowrap"}}>{(sl.cash>0?"+":"")+fD(sl.cash)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"14px 16px",borderRadius:8,background:sl.net>=0?LT.posBg:LT.negBg,marginTop:4}}>
            <div><div style={{fontSize:15,fontWeight:600,color:LT.text}}>What you'd walk away with</div><div style={{fontSize:12,color:LT.muted,marginTop:2}}>{sl.roi===null?"":(sl.roi>=0?"+":"")+sl.roi.toFixed(1)+"%/yr compound on the "+fD(total)+" project cost, over "+sl.years.toFixed(1).replace(/\.0$/,"")+" years"}</div></div>
            <span style={{fontFamily:"'Fraunces',serif",fontSize:24,fontWeight:700,color:sl.net>=0?LT.pos:LT.neg,whiteSpace:"nowrap"}}>{(sl.net>=0?"+":"")+fK2(sl.net)}</span>
          </div>
        </div>
        <div style={{fontSize:12.5,color:LT.body,marginTop:12,lineHeight:1.55}}>
          {sl.keepNet>=0?<>Or keep it: the ADU would be netting about <strong style={{color:LT.text}}>{fD(sl.keepNet)}/mo</strong> the year after{sl.bal>0?", with "+fD(sl.bal)+" still owed on the loan":", with the loan paid off"}.</>:<>Keeping it means covering about <strong style={{color:LT.text}}>{fD(-sl.keepNet)}/mo</strong> the year after.</>}
        </div>
        <div style={{fontSize:11,color:LT.muted,marginTop:8,lineHeight:1.5}}>Simplified: the ADU is valued at its rent multiplier as its share of the home's sale price. Capital gains tax and the home-sale exclusion depend on how the sale is structured with the main house and aren't modeled{incomeTax>0?"":"; with income tax off, depreciation recapture isn't either"}. Talk to a tax professional before selling.</div>
      </>)})()}
    </div>}

    {/* STRESS TESTS */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{...secH,marginBottom:6}}>Stress tests</div>
      <div style={{fontSize:12.5,color:LT.body,marginBottom:14}}>How one thing going wrong would change your timeline and your return:</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead>
          <tr style={{borderBottom:"1px solid "+LT.border}}>
            {["Scenario","Cash positive","Payback",loanAmt>0?"Return at payoff":"Return, yr "+cm.evalYrs].map((h,i)=><th key={h} style={{textAlign:i?"right":"left",padding:"8px 4px",verticalAlign:"bottom",fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {cm.stress.map((t,i)=>{const H=cm.evalYrs,cfCol=t.cfPlus<=3?LT.pos:t.cfPlus<=H&&!t.cfAtTerm?LT.warn:LT.neg;const poCol=t.po<=H?LT.pos:t.po<=H*1.5?LT.warn:LT.neg;const isBase=i===0;return(<tr key={i} style={{borderBottom:i<cm.stress.length-1?"1px solid "+LT.borderLight:"none",background:isBase?LT.borderLight:"transparent"}}>
            <td style={{padding:"10px 4px",color:LT.text,fontWeight:isBase?600:500}}>{t.label}</td>
            <td style={{padding:"10px 4px",textAlign:"right",fontFamily:"'Fraunces',serif",fontWeight:600,color:cfCol}}>{t.cfPlus<=0?"Day one":fYr(t.cfPlus)+(t.cfAtTerm?"*":"")}</td>
            <td style={{padding:"10px 4px",textAlign:"right",fontFamily:"'Fraunces',serif",fontWeight:600,color:poCol}}>{t.po===0?"Immediate":fYr(t.po)}</td>
            <td style={{padding:"10px 4px",textAlign:"right",fontFamily:"'Fraunces',serif",fontWeight:600,color:t.ret>=0?LT.pos:LT.neg,whiteSpace:"nowrap"}}>{(t.ret>=0?"+":"")+fK2(t.ret)}{!isBase&&<div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:500,color:LT.muted}}>{(t.ret-cm.stress[0].ret>=0?"+":"−")+fK2(Math.abs(t.ret-cm.stress[0].ret))}</div>}</td>
          </tr>)})}
        </tbody>
      </table>
      <div style={{fontSize:12,color:LT.muted,marginTop:14,lineHeight:1.5}}>"Cash positive" is when monthly cash flow after the loan payment{taxNote} turns positive{cm.stress.some(t=>t.cfAtTerm)?" (* = only once the loan is paid off)":""}. "Payback" is when you've gotten back everything you put in. The small figure under each return is the change from the base case. Each test changes one assumption and holds the rest; rent shortfalls and cost overruns of 15–25% are the most common surprises in published ADU projects{loanAmt>0?", and HELOC rates are variable":""}.</div>
    </div>
    </>);})()}

{/* FOOTER */}
    <div style={{marginTop:24,padding:"14px 18px",borderRadius:8,background:LT.borderLight,fontSize:11,color:LT.muted,lineHeight:1.6}}>
      Estimates are for illustration only. Actual costs, rents, and returns will vary based on site conditions, local market dynamics, financing terms, and many other factors. Property value estimates use a simplified gross rent multiplier and are not a formal appraisal. Investment decisions should be made in consultation with qualified professionals.
      <div style={{marginTop:8}} className="no-print">
        <button onClick={()=>setShowMethod(!showMethod)} style={{background:"transparent",border:"none",padding:0,color:LT.info,fontSize:11,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>{showMethod?"Hide methodology ▴":"How these numbers are calculated ▾"}</button>
      </div>
      {showMethod&&<div style={{marginTop:14,padding:"14px 16px",background:LT.card,border:"1px solid "+LT.border,borderRadius:8,fontSize:11,color:LT.body,lineHeight:1.65}}>
        <div style={{fontSize:11,color:LT.text,fontWeight:600,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>Methodology</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Rent estimates</strong> are whatever you enter as the rent you would charge; the reference range shown beside that field uses 2025–2026 mid-range rents for a 1-bedroom ADU, scaled sub-linearly by unit size (a 2-bedroom rents for less than 2× a 1-bedroom). Custom entries use your own input. Short-term rental income is the nightly rate you set × ~30.4 nights, less unbooked nights and hosting costs.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Construction costs</strong> are built up from line-item components (structure, foundation, site work, permits, fees, design, surveys) at 2026 mid-range defaults, plus a builder/GC margin. Garage conversions, prefab units, and high-cost markets are reflected via slider tick marks. Costs vary substantially by region and site conditions — adjust the sliders to match local builder quotes.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Property value</strong> uses a gross rent multiplier of {grm}× monthly long-term rent — a heuristic widely cited by lenders and builders. Real appraisals use comparable sales as the primary method, and multipliers can vary substantially by market: low-cost regions trend toward 80–120×, while expensive coastal markets often run 200–300×. The default of 110× is conservative for high-rent metros.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Operating expenses</strong> include property tax (with annual escalator), insurance (a rate on the building's replacement cost — structure and foundation, not fees or site work — with annual escalator), vacancy, maintenance reserve, and property management. Escalator defaults reflect recent 2020–2025 trends and vary by jurisdiction.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Income tax</strong> is modeled on US Schedule E: rental income minus loan interest, depreciation (27.5-year straight-line on the ADU cost basis, excluding furnishings), and operating expenses. Paper losses aren't deducted against other income (the passive-loss rules); with "Carry rental losses forward" on, they offset later rental income instead. Default rate is 0% (not modeled); the Full model's marginal-tax slider applies your combined federal + state rate.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Cash flow simulation</strong> runs month by month from project start: the construction period, then rent and loan payments together, with rent growth, expense escalation, and tax effects compounded monthly. Every figure on this page comes from that one simulation. Loan amortization uses the standard mortgage formula. Payback is when your cumulative cash position — down payment plus every month's net cash flow after loan payments and tax — returns to zero. Annual returns are compound rates.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Construction financing</strong> follows standard draw practice: design, permits, fees and surveys are paid up front; your cash goes in before the lender funds anything; the lender then funds hard costs in monthly draws along an S-curve as work is inspected, holding back 5% retention until completion; furnishings are bought at the end. Interest accrues only on what's been drawn and is either paid monthly, added to the loan, or not charged, as set in the Full model. Construction interest is capitalized into the depreciation basis for taxes.</div>
        <div><strong style={{color:LT.text}}>Limitations.</strong> The model does not capture construction cost overruns, regulatory changes, mortgage refinancing, depreciation recapture at sale, transaction costs at exit, jurisdiction-specific fees or incentives, short-term rental restrictions, or interactions with existing zoning. Always consult a tax professional and your local building department before committing capital.</div>
      </div>}
    </div>
  </>);
}

function App(){
  // Initial state is read synchronously (localStorage is synchronous) so there's no loading flash.
  // A shared link wins over the saved model; otherwise the saved model loads into the Full model.
  const[init]=useState(()=>{
    const shared=shareParamsFromLocation();
    if(shared)return{state:{...DEF,...shared},shared:true};
    try{const raw=store.get(SK);if(raw)return{state:{...DEF,...cleanState(JSON.parse(raw)),view:"internal"},shared:false}}catch(e){}
    return{state:DEF,shared:false};
  });
  const[state,setState]=useState(init.state);const[showSources,setShowSources]=useState(false);const[showHow,setShowHow]=useState(false);const[copied,setCopied]=useState(false);const[confirmReset,setConfirmReset]=useState(false);
  const[openSec,setOpenSec]=useState({costs:true,financing:true,revenue:true,taxes:true,value:true,details:false});
  const toggleSec=k=>setOpenSec(s=>({...s,[k]:!s[k]}));
  const resetTimerRef=useRef(null);
  // True while viewing a shared link that the visitor hasn't edited. Saving is held
  // off until they change a model field, so opening someone else's link doesn't
  // overwrite the visitor's own saved model.
  const fromShareRef=useRef(init.shared);
  useEffect(()=>{if(init.shared)window.history.replaceState(null,"",window.location.pathname)},[init]);
  useEffect(()=>{if(!fromShareRef.current)store.set(SK,JSON.stringify({...state,view:"internal"}))},[state]);
  const copyShare=useCallback(async()=>{
    const url=shareUrlFor(state);
    let ok=false;
    try{await navigator.clipboard.writeText(url);ok=true}catch(e){
      try{
        const ta=document.createElement("textarea");
        ta.value=url;ta.style.position="fixed";ta.style.opacity="0";
        document.body.appendChild(ta);ta.focus();ta.select();
        ok=document.execCommand("copy");
        document.body.removeChild(ta);
      }catch(e2){}
    }
    // Only claim success when a copy actually happened; otherwise hand the link over to copy by hand.
    if(ok){setCopied(true);setTimeout(()=>setCopied(false),1800)}
    else window.prompt("Copy this link:",url);
  },[state]);
  const set=useCallback(k=>v=>{if(k!=="view")fromShareRef.current=false;setState(s=>({...s,[k]:v}))},[]);
  const pickType=useCallback(t=>{fromShareRef.current=false;setState(s=>({...s,...PTYPES[t].v,...PTYPES[t].f,projectType:t}))},[]);
  // Switching to dollar amounts starts the sliders at what the site facts produced, so nothing jumps.
  const setSiteMode=useCallback(m=>{fromShareRef.current=false;setState(s=>m==="dollars"&&s.siteMode!=="dollars"?{...s,siteMode:m,...siteDollars(siteFromFacts(s,s.sqft))}:{...s,siteMode:m})},[]);
  const{projectType,siteMode,sqft,cpsf,permits,hookup,hardscape,design,contingency,markup,rentalMode,strADR,strGrowth,strCosts,strVacancy,strMonths,furnishing,cashDown,origFeeOn,origFee,rate,term,buildMonths,conIntMode,conPremium,horizon,taxRate,taxGrowth,insurance,insGrowth,maint,vacancy,mgmt,growth,grm,clientName,clientAddr,prepName,prepCompany,reportNotes,hookupCity,saleOn,saleYear,sellCost,incomeTax,lossCarry,firmOn,firm,customRent,customName,view}=state;
  const isSTR=rentalMode==="str",isHybrid=rentalMode==="hybrid",isLTR=rentalMode==="ltr";
  const ptype=PTYPES[projectType]||PTYPES.detached;
  // Site work: from the site facts, or the dollar sliders when the user prefers to enter amounts.
  const facts=siteMode!=="dollars";
  const sf=siteFromFacts(state,sqft);
  const{foundation,sitePrep,utilTrench,electrical,surveys}=facts?sf:state;
  const typeCustom=Object.entries(ptype.v).some(([k,v])=>!(facts&&SITE_KEYS.includes(k))&&state[k]!==v)||(facts&&FACT_KEYS.some(k=>state[k]!==ptype.f[k]));
  const hasSTR=isSTR||isHybrid;
  const buildCost=sqft*cpsf,siteCost=foundation+sitePrep+utilTrench+electrical+hardscape;
  const contingencyAmt=Math.round((buildCost+siteCost)*(contingency/100));
  const softCostBase=permits+hookup+design+surveys+furnishing;
  const markupBase=buildCost+siteCost+softCostBase;
  // Insurance covers rebuilding the dwelling: the structure and its foundation, plus the builder's
  // margin on them. Permits, fees, design, site work and furniture aren't part of dwelling coverage.
  const insBase=Math.round((buildCost+foundation)*(1+markup/100));
  const bc=budgetConfidence({structure:buildCost,foundation,sitePrep,utilTrench,electrical,hardscape,permits,hookup,design,surveys,furnishing},firm,markup,contingencyAmt);
  const subtotal=buildCost+siteCost+softCostBase+contingencyAmt,markupAmt=Math.round(markupBase*(markup/100));
  const assetCost=subtotal+markupAmt;
  const origFeeAmt=origFeeOn?Math.round(assetCost*(origFee/100)):0;
  // The estimate as a range: P10–P90 of the build cost (line items), plus any loan fee. With budget
  // tracking off, every line is treated as a rough estimate.
  const r1k=x=>Math.round(x/1000)*1000;
  const costRange={lo:r1k(bc.p10+origFeeAmt),hi:r1k(bc.p90+origFeeAmt),
    note:firmOn?Math.round(bc.firmedPct)+"% of line items quoted or known":"rough estimate — each line taken as ±25% until quotes come in"};
  const total=assetCost+origFeeAmt;
  const cashDownAmt=Math.round(total*(cashDown/100)),loanAmt=total-cashDownAmt;
  // Cost steps for the "Where the money goes" breakdown (they sum to the project total).
  const costSteps=[{label:"Structure",amt:buildCost},{label:"Site work",amt:siteCost},{label:"Fees, design & other",amt:softCostBase},{label:"Contingency",amt:contingencyAmt},{label:"Builder margin",amt:markupAmt},{label:"Loan origination fee",amt:origFeeAmt}];
  const isCash=loanAmt<=0;
  const scale=rs(sqft),utype=ut(sqft);
  // Furnishings (with the GC markup on them) are personal property, not part of the
  // building — they're excluded from the 27.5-year depreciation basis.
  const furnBasis=Math.round(furnishing*(1+markup/100));
  const depBasis=Math.max(0,assetCost-furnBasis);
  // Paid at the start of construction: design, permits, utility fees, surveys (with markup) and any loan fee.
  const spendUp=Math.round((permits+hookup+design+surveys)*(1+markup/100))+origFeeAmt;

  // What the US-average 1-bed base scales to at this size — the fallback rent and
  // the sanity anchor shown in the rent field's help text.
  const sizeAnchor=Math.round(RENT_1BR_US*scale);
  const rentLo=Math.round(RENT_1BR_LO*scale),rentHi=Math.round(RENT_1BR_HI*scale);
  const hasCustom=customRent>0;
  const ltrRent=hasCustom?customRent:sizeAnchor;

  // Gross monthly revenue for a given LTR rent. STR months earn the nightly rate × 30.4
  // nights as entered — the ADR is already for this unit, so it is not scaled again
  // by size or by the LTR rent. Hybrid blends STR and LTR months.
  const strGross=strADR*30.4;
  const grossFor=ltr=>isSTR?strGross:isHybrid?(strMonths*strGross+(12-strMonths)*ltr)/12:ltr;
  const grossY1=Math.round(grossFor(ltrRent));
  const strMult=ltrRent>0?grossY1/ltrRent:1;
  // Blended STR/LTR rates: STR months use the STR costs/vacancy, LTR months use management/vacancy.
  const stF=isSTR?1:isHybrid?strMonths/12:0;
  const vacPct=(vacancy*(1-stF)+strVacancy*stF)/100;
  const opPct=(maint+mgmt*(1-stF)+strCosts*stF)/100;
  const effG=(growth*(1-stF)+strGrowth*stF)/100;
  const mPT=(assetCost*(taxRate/100))/12,mIns=(insBase*(insurance/100))/12;

  // Every result on the page comes from runModel. Stress tests rerun it with one assumption shocked.
  const mdl=useMemo(()=>{
    const mk=({rentMult=1,costMult=1,rateAdd=0,leaseUp=0,conMode=conIntMode,rateAbs=rate,termYr=term,downPct=cashDown,feePct=origFeeOn?origFee:0}={})=>{
      const aC=assetCost*costMult,tot=aC+Math.round(aC*(feePct/100)),down=Math.round(tot*(downPct/100));
      return runModel({loanAmt:tot-down,cashDown:down,annRate:(rateAbs+rateAdd)/100,termYr,leaseUp,buildMo:buildMonths,grossY1:grossY1*rentMult,collectPct:1-vacPct,opPct,
        mPTY1:(aC*(taxRate/100))/12,mInsY1:(insBase*costMult*(insurance/100))/12,rentGrowth:effG,taxGrowthA:taxGrowth/100,insGrowthA:insGrowth/100,taxMarg:incomeTax/100,lossCarry,
        depBasis:Math.max(0,aC-furnBasis*costMult),valueY1:ltrRent*grm,valueGrowth:growth/100,
        conMode,conRate:(rateAbs+rateAdd+conPremium)/100,spendUp:spendUp*costMult,spendEnd:furnBasis*costMult});
    };
    const base=mk();
    const evalAt=buildMonths+(loanAmt>0?term:horizon)*12;
    const stress=[
      {label:"Base case"},
      {label:"Rent 10% below estimate",rentMult:0.9},
      {label:"Rent 20% below estimate",rentMult:0.8},
      {label:"First 3 months vacant",leaseUp:3},
      ...(loanAmt>0?[{label:"Loan rate 1% higher",rateAdd:1}]:[]),
      {label:"Construction 15% over budget",costMult:1.15},
      {label:"Construction 25% over budget",costMult:1.25},
    ].map((sc,i)=>{const r=i===0?base:mk(sc);return{label:sc.label,cfPlus:r.cfPlus,cfAtTerm:r.cfAtTerm,po:r.po,ret:r.at(evalAt).tot}});
    // Each construction-interest option, so the choice can show what it means in dollars.
    const conAlt=loanAmt>0&&buildMonths>0?Object.fromEntries(["paid","cap","none"].map(m=>[m,m===conIntMode?base:mk({conMode:m})])):null;
    // Financing comparison: the current setup plus each enabled alternative, at fixed horizons.
    const summarize=(r,c)=>({...c,pmt:r.pmt,y1:r.year(1).net,cfPlus:r.cfPlus,po:r.po,interest:r.months.reduce((t,m)=>t+m.interest,0)+r.conInterest,net15:r.at(180).tot,net30:r.at(360).tot});
    const cmp=state.cmpOn?[summarize(base,{key:"cur",name:"Your setup",rate,term,down:cashDown,fee:origFeeOn?origFee:0}),
      ...CMP_ALTS.filter(a=>state["cmp"+a+"On"]).map(a=>{const c={key:a,name:state["cmp"+a+"Name"]||"Option "+a,rate:state["cmp"+a+"Rate"],term:state["cmp"+a+"Term"],down:state["cmp"+a+"Down"],fee:state["cmp"+a+"Fee"]};
        return summarize(mk({rateAbs:c.rate,termYr:c.term,downPct:c.down,feePct:c.fee}),c)})]:null;
    return{base,stress,conAlt,cmp};
  },[state,lossCarry,loanAmt,horizon,assetCost,origFeeOn,origFee,cashDown,rate,term,buildMonths,conIntMode,conPremium,spendUp,grossY1,vacPct,opPct,taxRate,insurance,insBase,effG,taxGrowth,insGrowth,incomeTax,furnBasis,ltrRent,grm,growth]);
  const M0=mdl.base;
  // The permanent-loan payment, including any construction interest added to the loan.
  const loanPmt=M0.pmt;
  const first=M0.months[0];
  // Results are evaluated at loan payoff, or after the chosen horizon for an all-cash project.
  const evalYrs=isCash?horizon:term;
  const evalK=buildMonths+evalYrs*12,horizonYrs=evalK/12;
  const end=M0.at(evalK);
  const ret=end.tot;
  const roi=annualized(ret,total,horizonYrs);
  const roiCash=cashDownAmt>0?annualized(ret,cashDownAmt,horizonYrs):null;

  // First-month (year-1) snapshot for the Full model's metric cards.
  const r={rent:grossY1,net:first.noi,sur:first.noi-loanPmt,cov:loanPmt>0?(first.noi/loanPmt)*100:null,cfPlus:M0.cfPlus,cfAtTerm:M0.cfAtTerm,po:M0.po,eq:ltrRent*grm,ret,roi};
  // Share of gross rent that goes to vacancy, opex, property tax and insurance — for the user's rent.
  const expPct=grossY1>0?Math.round(((grossY1-first.noi)/grossY1)*100):0;
  // Break-even gross rent: year 1, pre-tax.
  const beRent=(loanPmt+mPT+mIns)/((1-vacPct)*(1-opPct));

  // Consumer-view metrics — all read from the same simulation.
  const cm=useMemo(()=>{
    const ptsYears=Math.max(Math.ceil(evalK/12)+(isCash?0:3),M0.po!==Infinity&&M0.po<=30?Math.ceil(M0.po)+1:0);
    const pt=(s,year,extra)=>({year,cash:s.cash,value:s.value,bal:s.bal,loanNeg:-s.bal,tot:s.tot,...extra});
    let pts=[];for(let y=0;y<=ptsYears;y++)pts.push(pt(M0.at(y*12),y));
    if(buildMonths>0){
      // Mark completion: just before (everything spent, nothing appraised yet) and just after
      // (the ADU's value lands), so the jump shows as a step instead of a slope across year 1.
      const s=M0.at(buildMonths),x=buildMonths/12;
      pts=pts.filter(p=>p.year!==x);
      pts.push(pt({...s,value:0,tot:s.tot-s.value},x,{hidden:true}),pt(s,x,{label:"Build complete (month "+buildMonths+")"}));
      pts.sort((a,b)=>a.year-b.year||(a.hidden?-1:1));
    }
    const bars=[];for(let y=1;y<=evalYrs+(isCash?0:3);y++)bars.push(M0.year(y));
    // Annual projection: year 0 is the build (down payment, construction interest); then rental years.
    const s0=M0.at(buildMonths);
    const annual=[{year:0,rent:0,ops:0,pay:M0.conPaid,tax:0,net:s0.cash,cum:s0.cash,bal:s0.bal,value:s0.value,tot:s0.tot}];
    bars.forEach((b,i)=>{const s=M0.at(buildMonths+12*(i+1));annual.push({year:i+1,rent:b.rent*12,ops:(b.opEx+b.propTax+b.ins)*12,pay:b.pmt*12,tax:b.incomeTax*12,net:b.net*12,cum:s.cash,bal:s.bal,value:s.value,tot:s.tot})});
    return{
      pts,bars,annual,isCash,evalYrs,postLoan:M0.year(isCash?evalYrs:term+1),loanEndYr:M0.loanEnd/12,
      // The first card is the same moment as "The full picture" and the verdict (loan payoff, or the
      // chosen horizon when paying cash); the others look further out.
      hero:[{key:"end",label:isCash?"Year "+evalYrs:"At loan payoff",sub:isCash?"":"Year "+(evalK/12).toFixed(1).replace(/\.0$/,""),ret:end.tot,roi:annualized(end.tot,total,evalK/12)},
        ...[10,15,20,25,30,35,40].filter(Y=>Y>=evalK/12+3).slice(0,2).map(Y=>{const s=M0.at(Y*12);return{key:Y,label:Y+" years",sub:"",ret:s.tot,roi:annualized(s.tot,total,Y)}})],
      cfPlus:M0.cfPlus,cfAtTerm:M0.cfAtTerm,po:M0.po,
      valueY1:ltrRent*grm,valueEnd:end.value,subsidies:M0.subsidies,
      // Operating cash flow only — construction interest paid out of pocket is shown on its own line.
      cashCollected:end.cash+cashDownAmt+M0.conPaid,conPaid:M0.conPaid,conCap:M0.conCap,
      ret,roi,roiCash,stress:mdl.stress,
      // Selling after saleYear years of renting: the ADU's value, less selling costs, the remaining
      // loan and depreciation recapture (unrecaptured §1250 gain, taxed at the marginal rate up to
      // 25%, and only up to the actual gain), plus the tax value of any carried-forward losses,
      // which become deductible on a sale. Added to the cash position for the net gain.
      sale:(()=>{
        const k=buildMonths+saleYear*12,sn0=M0.at(k),sn={...sn0,bal:sn0.bal<1?0:sn0.bal},tx=incomeTax/100; // a sub-dollar balance is paid off
        const costs=sn.value*sellCost/100,netPrice=sn.value-costs;
        const gain=Math.max(0,netPrice-(M0.basisTotal-sn.depTaken));
        const recaptured=tx>0?Math.min(sn.depTaken,gain):0,recapture=recaptured*Math.min(tx,0.25);
        const nolBenefit=tx>0&&lossCarry?sn.nol*tx:0;
        const proceeds=netPrice-sn.bal-recapture+nolBenefit,net=proceeds+sn.cash;
        return{value:sn.value,costs,costPct:sellCost,bal:sn.bal,recaptured,recapture,nolBenefit,proceeds,cash:sn.cash,net,years:k/12,roi:annualized(net,total,k/12),keepNet:M0.year(saleYear+1).net};
      })(),
    };
  },[mdl,term,total,cashDownAmt,ltrRent,grm,saleYear,sellCost,incomeTax,lossCarry,evalK,evalYrs,isCash,buildMonths]);

  const handleReset=()=>{fromShareRef.current=false;setState(DEF);store.del(SK)};
  const onResetClick=()=>{
    if(confirmReset){
      if(resetTimerRef.current)clearTimeout(resetTimerRef.current);
      setConfirmReset(false);
      handleReset();
    }else{
      setConfirmReset(true);
      resetTimerRef.current=setTimeout(()=>setConfirmReset(false),3000);
    }
  };
  const dark=view!=="consumer";
  const preparedFor=[clientName.trim(),clientAddr.trim()].filter(Boolean).join(" · ");
  const preparedBy=[prepName.trim(),prepCompany.trim()].filter(Boolean).join(", ");

  // Data for the printed report (both views print the same report).
  const pct=v=>(Math.round(v*10)/10).toString();
  const y1=cm.bars[0];
  const rep=(hasCustom||isSTR)?(()=>{
    const unit=sqft+" sq ft "+utype.toLowerCase()+" "+ptype.noun;
    const strategy=isSTR?"short-term rental at $"+strADR+"/night":isHybrid?"seasonal hybrid ("+strMonths+" months short-term at $"+strADR+"/night)":"long-term lease";
    const horizonTxt=loanAmt>0?"by loan payoff":"by year "+evalYrs;
    const parts=[
      y1.net>=0?"nets about "+fD(y1.net)+"/mo in its first rental year":"needs about "+fD(-y1.net)+"/mo of support in its first rental year",
      ...(M0.cfPlus>0&&M0.cfPlus!==Infinity?["turns cash-flow positive in year "+M0.cfPlus.toFixed(1)+(M0.cfAtTerm?" (once the loan is paid off)":"")]:M0.cfPlus===Infinity?["does not become cash-flow positive"]:[]),
      M0.po===0?"never leaves you out of pocket":M0.po===Infinity?"does not pay back what was invested within 50 years":"pays back everything invested by year "+M0.po.toFixed(1),
      "builds an estimated "+fShort(ret)+" of net equity "+horizonTxt+(roi===null?"":" ("+roi.toFixed(1)+"%/yr compound on cost)"),
    ];
    const verdict="At "+fD(grossY1)+"/mo "+(isSTR?"in projected revenue":"rent")+", this "+fD(total)+" project "+parts.slice(0,-1).join(", ")+", and "+parts[parts.length-1]+".";
    return{
      cm,title:customName||unit,
      subtitle:(customName?unit+" · ":"")+strategy[0].toUpperCase()+strategy.slice(1)+" · "+fD(grossY1)+"/mo "+(isSTR?"projected revenue":"rent")+" in year 1",
      date:new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}),
      total,loanAmt,cashDownAmt,cashDown,loanPmt,rate,term,evalYrs,incomeTax,buildMonths,verdict,cmp:mdl.cmp,costRange,preparedFor,preparedBy,clientNotes:reportNotes.trim(),
      costRows:[
        ["Structure ("+sqft+" sq ft × $"+cpsf+")",buildCost],
        ["Site work",siteCost],
        ["Permits, utility fees, design & surveys",permits+hookup+design+surveys],
        ...(furnishing>0?[["Furnishing",furnishing]]:[]),
        ["Contingency ("+contingency+"% of hard costs)",contingencyAmt],
        ["Builder / GC margin ("+markup+"%)",markupAmt],
        ...(origFeeAmt>0?[["Loan origination fee ("+origFee+"%)",origFeeAmt]]:[]),
      ],
      finRows:[
        ["Down payment",cashDown===100?"All cash":fD(cashDownAmt)+" ("+cashDown+"%)"],
        ...(loanAmt>0?[["Loan amount",fD(loanAmt)],["Rate and term",pct(rate)+"% fixed · "+term+" years"],["Monthly payment",fD(loanPmt)]]:[["Evaluation horizon",horizon+" years"]]),
        ["Construction period",buildMonths>0?buildMonths+" months":"None (already built)"],
        ...(loanAmt>0&&buildMonths>0?[["Construction interest",conIntMode==="none"?"Not charged":fD(M0.conInterest)+(conIntMode==="paid"?", paid monthly":", added to loan")+(conPremium>0?" (+"+conPremium+"% rate)":"")]]:[]),
      ],
      opRows:[
        ["Rental strategy",isSTR?"Short-term":isHybrid?"Hybrid · "+strMonths+" mo STR":"Long-term"],
        ["Rent growth",pct(effG*100)+"%/yr"],
        ["Vacancy",pct(vacPct*100)+"% of gross"],
        ["Maintenance & management"+(hasSTR?" & hosting":""),pct(opPct*100)+"% of collected"],
        ["Property tax",pct(taxRate)+"% of cost · +"+pct(taxGrowth)+"%/yr"],
        ["Insurance",pct(insurance)+"% of "+fD(insBase)+" rebuild cost · +"+pct(insGrowth)+"%/yr"],
        ["Income tax",incomeTax>0?incomeTax+"% marginal rate":"Not modeled"],
        ["Value multiplier",grm+"× monthly long-term rent"],
      ],
      notes:[
        ...(saleOn?["If sold after "+saleYear+" years of renting: the ADU's estimated "+fD(cm.sale.value)+" share of the sale price, less "+sellCost+"% selling costs"+(cm.sale.bal>0?", the "+fD(cm.sale.bal)+" loan balance":"")+(cm.sale.recapture>0?" and "+fD(cm.sale.recapture)+" depreciation recapture":"")+(cm.sale.nolBenefit>0?", plus "+fD(cm.sale.nolBenefit)+" from released losses":"")+", leaves "+fD(cm.sale.proceeds)+" — a net gain of "+fD(cm.sale.net)+" including cash flow while owned. Capital gains tax isn't modeled."]:[]),
        ...(firmOn?["Budget confidence: "+Math.round(bc.firmedPct)+"% of line-item costs are quoted or known. P50 build cost "+fD(bc.p50)+", P80 "+fD(bc.p80)+"; the budget, with "+contingency+"% contingency, covers the build about "+Math.round(bc.coverage)+"% of the time"+(bc.suggested!==contingency?" (P80 needs "+bc.suggested+"%)":"")+"."]:[]),
        ...(facts?(()=>{const lc=t=>t[0].toLowerCase()+t.slice(1);return["Site work is estimated from site facts — foundation: "+lc(sf.why.foundation)+"; grading and access: "+lc(sf.why.sitePrep)+"; utilities: "+lc(sf.why.utilTrench)+"; electrical: "+lc(sf.why.electrical)+"; surveys: "+lc(sf.why.surveys)+"."]})():[]),
        "Rent is the figure entered. The ADU's value is estimated at "+grm+"× monthly long-term rent (a gross rent multiplier); appraisals rely on comparable sales and may differ, and coastal markets often run 200–300×.",
        "The model runs month by month from project start."+(buildMonths>0?" During the "+buildMonths+"-month build there is no rent; funds are drawn on a standard construction schedule (soft costs up front, owner cash first, hard costs on an S-curve with 5% retention)"+(loanAmt>0?(conIntMode==="none"?". Construction interest is not charged in this scenario.":", with interest on the drawn balance."):"."):""),
        "Operating costs are vacancy, maintenance, management"+(hasSTR?", hosting":"")+", property tax and insurance, each escalating at the rates shown.",
        incomeTax>0?"Income tax is applied at "+incomeTax+"% to rental income after "+(loanAmt>0?"loan interest and ":"")+"27.5-year depreciation of "+fD(depBasis)+" (furnishings excluded; construction interest capitalized)."+(lossCarry?" Early paper losses carry forward against later rental income.":" Early paper losses are ignored rather than carried forward.")+" Losses aren't deducted against other income.":"Income tax is not modeled; figures are pre-tax.",
        "Payback is when cumulative cash — down payment, construction interest and monthly cash flow — returns to zero. Annual returns are compound rates on the total project cost.",
        "Not included: solar (required on new California homes), landscaping restoration, HOA fees, refinancing, or the costs of selling.",
      ],
    };
  })():null;

  return(<>
    <div className="screen-only" style={{fontFamily:"'DM Sans',sans-serif",background:view==="consumer"?"#f8fafc":"#0d1117",color:view==="consumer"?"#0f172a":"#e6edf3",minHeight:"100vh",padding:"28px 16px",transition:"background 0.2s"}}>
      <div style={{maxWidth:1120,margin:"0 auto"}}>
        {/* VIEW SWITCHER — always visible; the primary choice on this page */}
        <div className="no-print" role="tablist" aria-label="View mode" style={{display:"flex",gap:6,marginBottom:22,padding:5,borderRadius:14,border:"1px solid "+(dark?"#30363d":"#cbd5e1"),background:dark?"#0d1117":"#eef2f7"}}>
          <button type="button" role="tab" aria-selected={view==="internal"} onClick={()=>set("view")("internal")} style={{flex:1,padding:"12px 8px",borderRadius:10,cursor:"pointer",userSelect:"none",border:"none",fontFamily:"inherit",transition:"background 0.15s",background:view==="internal"?tb:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:14,fontWeight:700,color:view==="internal"?"#0d1117":(dark?"#8b949e":"#64748b")}}>Full model</span>
            <span style={{fontSize:11,fontWeight:500,color:view==="internal"?"rgba(13,17,23,0.7)":(dark?"#6e7681":"#94a3b8")}}>Every assumption, adjustable</span>
          </button>
          <button type="button" role="tab" aria-selected={view==="consumer"} onClick={()=>set("view")("consumer")} style={{flex:1,padding:"12px 8px",borderRadius:10,cursor:"pointer",userSelect:"none",border:"none",fontFamily:"inherit",transition:"background 0.15s",background:view==="consumer"?LT.info:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:14,fontWeight:700,color:view==="consumer"?"#fff":(dark?"#8b949e":"#64748b")}}>Summary</span>
            <span style={{fontSize:11,fontWeight:500,color:view==="consumer"?"rgba(255,255,255,0.8)":(dark?"#6e7681":"#94a3b8")}}>Clean results to share</span>
          </button>
        </div>

      {view==="internal"&&(<>
        <PageHeader dark title="Can ADU Rent Cover the Loan?" subtitle="Build up costs from real components, set expenses and rent growth, and see whether the rent covers the loan." copied={copied} onCopy={copyShare} onReset={onResetClick} confirmReset={confirmReset}/>

        {/* STICKY MINI SUMMARY — narrow screens only; wide screens have the sticky results column */}
        <div className="no-print mini-bar" style={{position:"sticky",top:0,zIndex:45,background:"#0d1117",border:"1px solid #21262d",borderRadius:8,padding:"10px 16px",marginBottom:16,display:"flex",gap:20,flexWrap:"wrap",alignItems:"baseline",boxShadow:"0 6px 16px rgba(0,0,0,0.35)"}}>
          <div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:10.5,color:"#6e7681",textTransform:"uppercase",letterSpacing:"0.06em"}}>Total</span><span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:700,color:tb}}>{fD(total)}</span></div>
          <div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:10.5,color:"#6e7681",textTransform:"uppercase",letterSpacing:"0.06em"}}>Payment</span><span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:700,color:"#e6edf3"}}>{loanAmt>0?fD(loanPmt)+"/mo":"$0"}</span></div>
          {(hasCustom||isSTR)&&<div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:10.5,color:"#6e7681",textTransform:"uppercase",letterSpacing:"0.06em"}}>vs. break-even</span><span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:700,color:r.rent>=beRent?gn:rd}}>{(r.rent>=beRent?"+":"")+fD(r.rent-beRent)}</span></div>}
          {(hasCustom||isSTR)&&<div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:10.5,color:"#6e7681",textTransform:"uppercase",letterSpacing:"0.06em"}}>Payback</span><span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:700,color:r.po<=term?gn:r.po<=term*1.5?yl:rd}}>{r.po===0?"Immediate":fYr(r.po)}</span></div>}
        </div>

        <div className="int-grid">
        <div className="int-inputs">
        {/* 1. CONSTRUCTION COST */}
        <Section title="Construction cost" open={openSec.costs} onToggle={()=>toggleSec("costs")} summary={<><span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em"}}>Total est.</span><span style={{fontSize:openSec.costs?24:16,fontFamily:"'Fraunces',serif",fontWeight:700,color:tb,marginLeft:8}}>{fD(total)}</span></>}>
          <TypePicker value={projectType} onPick={pickType} custom={typeCustom}/>

          <SL>Unit structure</SL>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label="ADU size" badge={utype} value={sqft} onChange={set("sqft")} typeMin={LIM.sqft[0]} typeMax={LIM.sqft[1]} min={300} max={1200} step={50} format={v=>v+" sq ft"} ticks={[{value:400,label:"Studio",color:tk},{value:600,label:"1-bed",color:tb},{value:800,label:"1–2 bed",color:tk},{value:1000,label:"Common cap",color:tk}]}/>
            <TS label={<>Structure $/sq ft (unit only)<IT align="left" text={"Includes: framing, roofing, siding, insulation, drywall, interior finishes, flooring, cabinets, countertops, windows, doors, interior plumbing fixtures, interior electrical (wiring, outlets, lighting), HVAC, and kitchen appliances (range, dishwasher, and hood are built-in; a standard refrigerator is assumed included too, though it's technically free-standing).\n\nDoes NOT include: foundation, panel upgrades, trenching, hardscape, or furnishing — those are separate below.\n\nPublished \"all-in $/sqft\" figures often bundle site work — use a lower number here."}/></>} value={cpsf} onChange={set("cpsf")} box="Structure cost per sq ft" typeMin={LIM.cpsf[0]} typeMax={LIM.cpsf[1]} min={100} max={500} step={10} format={v=>"$"+v+"/ft²"} ticks={[{value:175,label:"Garage conv.",color:tk},{value:220,label:"Prefab",color:tb},{value:300,label:"Stick-built",color:tk},{value:400,label:"Bay Area",color:tk}]}/>
            <Sub label="Structure subtotal" value={buildCost}/>
          </div>

          <SL>Site work</SL>
          <div style={{fontSize:12,color:"#8b949e",marginBottom:6}}>How should site work be estimated?</div>
          <MethodSwitch label="Site work method" value={siteMode} onChange={setSiteMode} options={[
            {value:"facts",label:"Estimate from site facts",desc:"Answer a few questions about the lot; each cost is calculated with its reason"},
            {value:"dollars",label:"Enter dollar amounts",desc:"Type each amount — a contractor quote or your own figure — or use the sliders"}]}/>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {facts?<div style={nested}><SiteFacts s={state} set={set} sf={sf}/></div>:(<div style={{...nested,display:"flex",flexDirection:"column",gap:6}}>
              <TS label={<>Foundation<IT align="left" text="What the structure sits on. Cheapest to priciest: pier/post (posts driven into the ground — common for smaller or elevated units), slab (a poured concrete pad — the typical default), crawl space (a raised foundation with access underneath, needed on uneven lots), and hillside engineering (retaining walls and extra structural work for a sloped site)."/></>} value={foundation} onChange={set("foundation")} box="Foundation" typeMin={LIM.foundation[0]} typeMax={LIM.foundation[1]} min={0} max={50000} step={1000} format={v=>v===0?"Existing":fD(v)} ticks={[{value:0,label:"Existing",color:gn},{value:5000,label:"Pier / post",color:gn},{value:10000,label:"Slab",color:tb},{value:18000,label:"Crawl space",color:tk},{value:35000,label:"Hillside eng.",color:rd}]}/>
              <TS label="Grading, demo & access" value={sitePrep} onChange={set("sitePrep")} box="Grading, demo & access" typeMin={LIM.sitePrep[0]} typeMax={LIM.sitePrep[1]} min={0} max={30000} step={500} format={v=>v===0?"None":fD(v)} ticks={[{value:3000,label:"Flat / clear",color:gn},{value:8000,label:"Average",color:tk},{value:15000,label:"Tight access",color:yl},{value:25000,label:"Complex",color:rd}]}/>
              <TS label="Utility trenching" value={utilTrench} onChange={set("utilTrench")} box="Utility trenching" typeMin={LIM.utilTrench[0]} typeMax={LIM.utilTrench[1]} min={0} max={30000} step={500} format={v=>v===0?"None (existing)":fD(v)} ticks={[{value:3000,label:"Short run",color:gn},{value:8000,label:"Average",color:tk},{value:15000,label:"Long / rocky",color:yl},{value:22000,label:"+sewer pump",color:rd}]}/>
              <TS label="Electrical panel upgrade" value={electrical} onChange={set("electrical")} box="Electrical panel upgrade" typeMin={LIM.electrical[0]} typeMax={LIM.electrical[1]} min={0} max={8000} step={500} format={v=>v===0?"Not needed":fD(v)} ticks={[{value:0,label:"Not needed",color:gn},{value:2000,label:"Subpanel",color:tb},{value:5000,label:"200A upgrade",color:tk},{value:7000,label:"Complex",color:yl}]}/>
            </div>)}
            <TS label="Hardscape & path" value={hardscape} onChange={set("hardscape")} box={facts?undefined:"Hardscape & path"} typeMin={LIM.hardscape[0]} typeMax={LIM.hardscape[1]} min={0} max={10000} step={500} format={v=>v===0?"None":fD(v)} ticks={[{value:0,label:"None",color:gn},{value:1500,label:"Short path",color:tk},{value:4000,label:"Path + patio",color:tb},{value:8000,label:"Full hardscape",color:yl}]}/>
            <Sub label="Site subtotal" value={siteCost}/>
          </div>

          <SL>Fees & soft costs</SL>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label={<>Permits, plan check & inspections<IT align="left" text={"Includes plan review and all construction inspections (foundation, framing, rough MEP, insulation, final/CO).\n\nRe-inspection fees if something fails are typically $100–$500 and come out of the builder's margin."}/></>} value={permits} onChange={set("permits")} box="Permits, plan check & inspections" typeMin={LIM.permits[0]} typeMax={LIM.permits[1]} min={0} max={30000} step={500} format={fD} ticks={[{value:3000,label:"Small / waived",color:gn},{value:7000,label:"Sacramento",color:tk},{value:12000,label:"LA",color:tk},{value:20000,label:"SF",color:rd}]}/>
            <TS label={<>Water & sewer fees<IT align="left" text={HOOKUP_TICKS[hookupCity].note}/></>} value={hookup} onChange={set("hookup")} box="Water & sewer fees" typeMin={LIM.hookup[0]} typeMax={LIM.hookup[1]} min={0} max={60000} step={500} format={fD} ticks={HOOKUP_TICKS[hookupCity].ticks}/>
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#8b949e",marginTop:-2}}>
              <label htmlFor="hookupCity">Tick marks for</label>
              <select id="hookupCity" value={hookupCity} onChange={e=>set("hookupCity")(e.target.value)} style={{background:"#0d1117",color:"#c9d1d9",border:"1px solid #30363d",borderRadius:6,padding:"3px 6px",fontSize:11,fontFamily:"inherit"}}>
                {Object.entries(HOOKUP_TICKS).map(([k,c])=><option key={k} value={k}>{c.label}</option>)}
              </select>
              <span style={{color:"#6e7681"}}>· from each utility's published fees</span>
            </div>
            <TS label="Design & engineering" value={design} onChange={set("design")} box="Design & engineering" typeMin={LIM.design[0]} typeMax={LIM.design[1]} min={0} max={25000} step={500} format={fD} ticks={[{value:3000,label:"Pre-approved",color:gn},{value:10000,label:"Custom arch.",color:tk},{value:18000,label:"Bay Area",color:tk}]}/>
            {facts?(<div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline"}}><div><div style={{fontSize:12,color:"#8b949e"}}>Surveys & reports</div><div style={{fontSize:11,color:"#6e7681"}}>From site facts: {sf.why.surveys}</div></div><span style={{fontSize:15,fontFamily:"'Fraunces',serif",fontWeight:600,color:"#e6edf3"}}>{surveys===0?"Not required":fD(surveys)}</span></div>):<TS label={<>Surveys & reports<IT align="left" text="A land survey confirms your property lines and where the ADU can legally sit. A soil report (geotechnical study) tells the engineer what kind of foundation the ground actually needs — required on many hillside or unstable-soil lots, skippable on a flat, already-documented one."/></>} value={surveys} onChange={set("surveys")} box="Surveys & reports" typeMin={LIM.surveys[0]} typeMax={LIM.surveys[1]} min={0} max={12000} step={500} format={v=>v===0?"Not required":fD(v)} ticks={[{value:0,label:"Not req'd",color:gn},{value:1500,label:"Survey only",color:tk},{value:3500,label:"Survey + soil",color:tb},{value:7000,label:"Full geotech",color:yl}]}/>}
            <TS label={<>Furnishing<IT align="left" text={(hasSTR?"Furniture, linens, kitchenware, decor — everything a guest needs. The range, dishwasher, and refrigerator are already in structure $/sqft.":"Washer/dryer, furniture, or other extras beyond what the builder installs. The range, dishwasher, and refrigerator are already in structure $/sqft. Set to $0 if tenant-supplied.")+"\n\nFurnishings are not depreciated with the building in this model. Expect to replace them every 5–7 years ("+(hasSTR?"sooner with heavy guest turnover":"sooner with hard use")+") — budget for that from the maintenance reserve."}/></>} value={furnishing} onChange={set("furnishing")} box="Furnishing" typeMin={LIM.furnishing[0]} typeMax={LIM.furnishing[1]} min={0} max={25000} step={1000} format={v=>v===0?"Unfurnished":fD(v)} ticks={hasSTR?[{value:0,label:"Unfurnished",color:gn},{value:5000,label:"Basic",color:tk},{value:10000,label:"Standard",color:tb},{value:18000,label:"Design-forward",color:yl}]:[{value:0,label:"Unfurnished",color:gn},{value:1500,label:"Washer/dryer",color:tk},{value:5000,label:"Partial",color:tb},{value:12000,label:"Fully furnished",color:yl}]}/>
            <Sub label="Soft cost subtotal" value={softCostBase}/>
          </div>

          <SL>Contingency & builder margin</SL>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label={<>Contingency<IT align="left" text={"Percentage of hard costs (structure + site work) set aside for unforeseen items — buried utilities, soil surprises, permit re-inspections, landscaping restoration.\n\n5% is standard for straightforward builds; 10–15% for complex sites or older neighborhoods with unknown infrastructure.\n\nTurn on Budget confidence below to get a contingency suggested from how firm each cost is."}/></>} value={contingency} onChange={set("contingency")} typeMin={LIM.contingency[0]} typeMax={LIM.contingency[1]} min={0} max={20} step={1} format={v=>v===0?"None":v+"% ("+fD(contingencyAmt)+")"} ticks={[{value:0,label:"None",color:gn},{value:5,label:"Typical",color:tb},{value:10,label:"Complex",color:tk},{value:15,label:"High risk",color:yl}]}/>
            <TS label={<>Markup on project<IT align="left" text="The general contractor's profit and overhead on top of raw materials and labor — it's how a builder stays in business, covers insurance, permits paperwork, and project management, and absorbs the risk of things going wrong. 0% (owner-builder) means you're acting as your own GC and only paying subcontractors directly."/></>} value={markup} onChange={set("markup")} typeMin={LIM.markup[0]} typeMax={LIM.markup[1]} min={0} max={40} step={1} format={v=>v===0?"Owner-builder":v+"% ("+fD(markupAmt)+")"} ticks={[{value:0,label:"Owner-builder",color:gn},{value:10,label:"Prefab co.",color:tb},{value:20,label:"Typical GC",color:tk},{value:25,label:"Design-build",color:yl},{value:35,label:"Premium",color:rd}]}/>
            {origFeeOn&&origFeeAmt>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 1px",borderTop:"1px solid #21262d",marginTop:6}}><span style={{fontSize:11.5,color:yl}}>+ Dealer fee ({origFee}%)</span><span style={{fontSize:13,fontFamily:"'Fraunces',serif",fontWeight:600,color:yl}}>{fD(origFeeAmt)}</span></div>}
          </div>

          <SL>Budget confidence</SL>
          <BudgetConfidence on={firmOn} onToggle={()=>set("firmOn")(!firmOn)} firm={firm} setFirm={set("firm")} bc={bc} contingency={contingency} setContingency={set("contingency")}/>

          <SL>Build time</SL>
          <TS label={<>Construction period<IT align="left" text={"Months from permit approval to first rent check. Regular loan payments start when the ADU is finished; until then there's no rent, and interest on the funds drawn so far is set below.\n\nAll results are measured from project start, so a longer build pushes every result "+buildMonths+" months later."}/></>} value={buildMonths} onChange={set("buildMonths")} typeMin={LIM.buildMonths[0]} typeMax={LIM.buildMonths[1]} min={0} max={18} step={1} format={v=>v===0?"None (already built)":v+" months"} ticks={[{value:0,label:"Already built",color:gn},{value:4,label:"Prefab",color:tb},{value:6,label:"Typical",color:tk},{value:10,label:"Stick-built",color:yl},{value:15,label:"+permit delays",color:rd}]}/>

          <SL>Where the money goes</SL>
          <CostWaterfall dark range={costRange} steps={costSteps} total={total} buildTotal={assetCost} sqft={sqft} ptypeKey={projectType} typeNoun={ptype.noun}/>
        </Section>

        {/* 2. FINANCING */}
        <Section title="Financing" open={openSec.financing} onToggle={()=>toggleSec("financing")} summary={loanAmt>0?<><span style={{fontSize:11,color:"#8b949e"}}>Loan amount</span><span style={{fontSize:openSec.financing?18:15,fontFamily:"'Fraunces',serif",fontWeight:700,color:tb,marginLeft:8}}>{fD(loanAmt)}</span></>:<span style={{fontSize:12,color:"#8b949e"}}>All cash</span>}>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <TS label="Cash / equity down" value={cashDown} onChange={set("cashDown")} typeMin={LIM.cashDown[0]} typeMax={LIM.cashDown[1]} min={0} max={100} step={5} format={v=>v===0?"100% financed":v+"% ("+fD(cashDownAmt)+")"} ticks={[{value:0,label:"All loan",color:tb},{value:20,label:"20%",color:tk},{value:50,label:"50/50",color:tk},{value:100,label:"All cash",color:gn}]}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
              <Sl label="Interest rate" value={rate} onChange={set("rate")} typeMin={LIM.rate[0]} typeMax={LIM.rate[1]} min={3} max={14} step={0.5} format={v=>v.toFixed(1)+"%"}/>
              {isCash?<Sl label="Years to evaluate" value={horizon} onChange={set("horizon")} typeMin={LIM.horizon[0]} typeMax={LIM.horizon[1]} min={5} max={30} step={1} format={v=>v+" yr"}/>:<Sl label="Loan term" value={term} onChange={set("term")} typeMin={LIM.term[0]} typeMax={LIM.term[1]} min={5} max={20} step={1} format={v=>v+" yr"}/>}
            </div>
            <div style={{marginTop:2}}>
              <Tog on={origFeeOn} onToggle={()=>set("origFeeOn")(!origFeeOn)} label="Loan origination / dealer fee" sub={origFeeOn?"Baked into the project price — like solar, the fee is invisible to the borrower":"Off — no origination fee (e.g. HELOC, credit union loan)"}/>
              {origFeeOn&&(
                <div style={{marginTop:8}}>
                  <TS label={<>Origination fee<IT align="left" text={"Works like a solar dealer fee: the lender adds "+origFee+"% to the project price. The homeowner's \"cost\" is "+fD(total)+", not "+fD(assetCost)+" — the "+fD(origFeeAmt)+" fee is embedded in the price and the loan.\n\nSolar lenders charge 10–30%; an ADU fintech might charge 5–15%. The fee lets lenders offer lower rates and front-load their return for securitization.\n\nProperty tax and depreciation are based on the actual asset cost ("+fD(assetCost)+"), not the inflated price."}/></>} value={origFee} onChange={set("origFee")} typeMin={LIM.origFee[0]} typeMax={LIM.origFee[1]} min={1} max={40} step={1} format={v=>v+"% ("+fD(origFeeAmt)+")"} ticks={[{value:2,label:"Mortgage",color:gn},{value:5,label:"Personal loan",color:tb},{value:15,label:"Solar-style",color:tk},{value:25,label:"High dealer fee",color:yl},{value:35,label:"Subprime",color:rd}]}/>
                </div>
              )}
            </div>
            <div style={{borderTop:"1px solid #21262d",marginTop:10,paddingTop:8}}>
              {loanAmt>0&&buildMonths>0&&(<div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
                <div style={{fontSize:12,color:"#8b949e"}}>Interest during construction<IT align="left" text={"How construction financing works in this model:\n\nDesign, permits, utility fees and surveys are paid at the start. Your cash goes in first — lenders require it before they fund anything. The lender then funds the rest in monthly draws as work is completed and inspected, following the typical S-curve (slow start, fast framing and rough-in, slow finish work). 5% retention is held back until completion, and furnishings are bought at the end.\n\nYou pay interest only on what's been drawn, so the average balance during the build is typically 40–55% of the loan.\n\nHELOCs and most construction-to-permanent loans bill that interest monthly. Some lenders add it to the loan instead, which raises the permanent payment.\n\nFor taxes, construction interest is capitalized into the building's depreciation basis rather than deducted."}/></div>
                {(()=>{const A=mdl.conAlt,P=A.paid,C=A.cap,extra=C.pmt*term*12-(P.pmt*term*12+P.conPaid);return(
                <MethodSwitch label="Interest during construction" value={conIntMode} onChange={set("conIntMode")} options={[
                  {value:"paid",label:"Paid monthly",desc:"You pay about "+fD(P.conPaid)+" in interest-only bills during the build, then "+fD(P.pmt)+"/mo. Usual for HELOCs and construction-to-permanent loans."},
                  {value:"cap",label:"Added to the loan",desc:"Nothing to pay during the build. The loan grows by "+fD(C.conCap)+", so the payment is "+fD(C.pmt)+"/mo — about "+fD(extra)+" more over the loan, as you pay interest on that interest."},
                  {value:"none",label:"Not charged",desc:"Only realistic if the builder or a grant carries the financing until the ADU is finished."}]}/>)})()}
                {conIntMode!=="none"&&<TS label={<>Construction-phase rate<IT align="left" text={"Extra interest charged during the build, on top of the "+rate.toFixed(1)+"% loan rate.\n\nHELOCs keep the same rate. Construction-to-permanent loans often price the build phase 0.5–1% higher; standalone bank construction loans 1–2% higher; private/hard-money lenders more."}/></>} value={conPremium} onChange={set("conPremium")} typeMin={LIM.conPremium[0]} typeMax={LIM.conPremium[1]} min={0} max={3} step={0.25} format={v=>v===0?"Same as loan ("+rate.toFixed(1)+"%)":"+"+v+"% ("+(rate+v).toFixed(2)+"%)"} ticks={[{value:0,label:"HELOC",color:gn},{value:0.75,label:"Constr.-to-perm",color:tb},{value:1.5,label:"Bank constr.",color:tk},{value:3,label:"Private lender",color:rd}]}/>}
                <div style={{fontSize:11,color:"#8b949e",lineHeight:1.45}}>Interest is charged only on what's been drawn — an average of {fD(M0.conAvgDrawn)} over the {buildMonths}-month build. Which option applies is usually set by the lender.</div>
              </div>)}
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:10,fontSize:12,color:"#8b949e",marginTop:14,paddingTop:10,borderTop:"1px solid #21262d"}}>
          <span>Monthly payment: <strong style={{color:"#e6edf3"}}>{loanAmt>0?fD(loanPmt)+"/mo":"$0 (all cash)"}</strong></span>
          <span>{loanAmt>0?"Total repaid: ":"Cash invested: "}<strong style={{color:"#e6edf3"}}>{loanAmt>0?fD(loanPmt*term*12):fD(total)}</strong>{cashDown>0&&loanAmt>0&&<span> + {fD(cashDownAmt)} cash</span>}</span>
          {M0.conInterest>0&&<span>Construction interest: <strong style={{color:"#e6edf3"}}>{fD(M0.conInterest)}</strong> {conIntMode==="paid"?"(paid during build)":"(in the loan)"}</span>}
          </div>
          <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid #21262d"}}><FinCompare state={state} set={set} cols={mdl.cmp||[]}/></div>
        </Section>

        {/* 3. REVENUE — what the unit brings in, and what comes off the top of the rent */}
        <Section title="Revenue" open={openSec.revenue} onToggle={()=>toggleSec("revenue")} summary={<><span style={{fontSize:12,color:"#8b949e"}}>{isLTR?"Long-term":isHybrid?"Seasonal hybrid":"Short-term · $"+strADR+"/night"} · </span><span style={{fontSize:openSec.revenue?18:15,fontFamily:"'Fraunces',serif",fontWeight:700,color:expPct>35?rd:expPct>28?yl:gn,marginLeft:4}}>{expPct}%</span><span style={{fontSize:12,color:"#8b949e"}}> of rent to expenses</span></>}>
          <ModePills label="Rental strategy" value={rentalMode} onChange={set("rentalMode")} options={[{value:"ltr",label:"Long-term"},{value:"hybrid",label:"Seasonal hybrid"},{value:"str",label:"Short-term"}]}/>
          <div style={{fontSize:11,color:"#8b949e",lineHeight:1.4,marginTop:6}}>{isLTR?"Traditional 12-month lease to a single tenant.":isHybrid?"Short-term rental during peak season, long-term tenant the rest of the year. Rents and costs are blended across "+strMonths+" STR months and "+(12-strMonths)+" LTR months.":"Year-round Airbnb / VRBO. Higher rents, higher expenses, regulatory risk."}</div>
          {!isSTR&&<div style={{fontSize:11,color:tb,lineHeight:1.4,marginTop:6}}>The monthly rent itself is entered at the top of the results{" "}column.</div>}
          {hasSTR&&(
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:12,paddingTop:10,borderTop:"1px solid #21262d"}}>
              {isHybrid&&<TS label="Peak STR months per year" value={strMonths} onChange={set("strMonths")} typeMin={LIM.strMonths[0]} typeMax={LIM.strMonths[1]} min={1} max={6} step={1} format={v=>v+" mo STR / "+(12-v)+" mo LTR"} ticks={[{value:2,label:"Ski / holiday",color:tk},{value:3,label:"Short summer",color:tb},{value:4,label:"Full summer",color:gn},{value:6,label:"Half year",color:yl}]}/>}
              <TS label={"Average nightly rate"+(isHybrid?" (peak)":"")} value={strADR} onChange={set("strADR")} typeMin={LIM.strADR[0]} typeMax={LIM.strADR[1]} min={50} max={400} step={5} format={v=>"$"+v+"/night"} ticks={[{value:Math.round(75*scale),label:"Budget",color:tk},{value:Math.round(125*scale),label:utype+" avg",color:tb},{value:Math.round(200*scale),label:"Strong metro",color:gn},{value:Math.round(300*scale),label:"Prime / resort",color:yl}]}/>
              {isHybrid&&<div style={{fontSize:11,color:tb,lineHeight:1.4}}>Peak months: ${strADR}/night = ~{fD(Math.round(strADR*30.4))}/mo gross (before vacancy). Off-peak months use LTR rent. Blended {strMonths}mo STR + {12-strMonths}mo LTR = effective {strMult.toFixed(2)}× LTR year-round.</div>}
              <TS label={<>Nightly rate growth{isHybrid?" (STR months)":""}<IT align="left" text={"Annual growth in the STR average daily rate. Post-pandemic normalization has settled ADR growth at 1.5–2.5%/yr for most markets; above 3.5% is strong."+(isHybrid?" LTR months use the annual rent growth slider below.":"")+" Property value is always projected using LTR rent growth."}/></>} value={strGrowth} onChange={set("strGrowth")} typeMin={LIM.strGrowth[0]} typeMax={LIM.strGrowth[1]} min={0} max={6} step={0.5} format={v=>v===0?"Flat":"+"+v+"%/yr"} ticks={[{value:0,label:"Flat",color:rd},{value:1.5,label:"Conservative",color:tk},{value:2.5,label:"Base case",color:tb},{value:3.5,label:"Strong",color:gn},{value:5,label:"Exceptional",color:yl}]}/>
              <TS label={<>Hosting, cleaning & management<IT align="left" text={"Platform fees + cleaning + management for STR "+(isHybrid?"months only. LTR months use the property management rate below.":"year-round. Replaces property management.")}/></>} value={strCosts} onChange={set("strCosts")} typeMin={LIM.strCosts[0]} typeMax={LIM.strCosts[1]} min={3} max={40} step={1} format={v=>v+"% of STR gross"} ticks={[{value:3,label:"Airbnb 3%",color:gn},{value:5,label:"VRBO 5%",color:tk},{value:15,label:"+cleaning",color:tb},{value:22,label:"+co-host",color:tk},{value:30,label:"Full-svc mgr",color:yl}]}/>
              <TS label={<>Unbooked nights / vacancy<IT align="left" text={isHybrid?"Unbooked nights during STR months. LTR months use the vacancy allowance below.":"Percentage of nights unbooked year-round. LTR vacancy is much lower at 3–8%."}/></>} value={strVacancy} onChange={set("strVacancy")} typeMin={LIM.strVacancy[0]} typeMax={LIM.strVacancy[1]} min={5} max={40} step={1} format={v=>v+"% of nights"} ticks={[{value:8,label:"Hot market",color:gn},{value:15,label:"Typical",color:tb},{value:25,label:"Seasonal",color:yl},{value:35,label:"Soft / new",color:rd}]}/>
              <div style={{fontSize:11,color:yl,lineHeight:1.4,marginTop:2}}>STR income is less predictable and subject to local regulations. Many cities require permits, cap rental days, or ban STRs outright.</div>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:12}}>
            <TS label="Annual rent growth" value={growth} onChange={set("growth")} typeMin={LIM.growth[0]} typeMax={LIM.growth[1]} min={0} max={6} step={0.5} format={v=>v===0?"Flat":"+"+v+"%/yr"} ticks={[{value:0,label:"Flat",color:rd},{value:2,label:"Low",color:tk},{value:3,label:"Avg",color:tb},{value:5,label:"Hot",color:gn}]}/>
            {!isSTR&&<TS label={<>Vacancy allowance<IT align="left" text={"The share of rent you'd lose to the unit sitting empty — between tenants, during a re-lease, or from a late payment.\n\nIt's not a one-time cost; it's baked into every month's expected income as a haircut on the rent, since even a well-run rental rarely stays 100% occupied."}/></>} value={vacancy} onChange={set("vacancy")} typeMin={LIM.vacancy[0]} typeMax={LIM.vacancy[1]} min={0} max={12} step={1} format={v=>v+"%"} ticks={[{value:3,label:"Tight",color:gn},{value:5,label:"Average",color:tk},{value:8,label:"Soft",color:yl}]}/>}
            {!isSTR&&<TS label={<>Property management<IT align="left" text={"What you'd pay a property manager to handle tenant screening, rent collection, and maintenance calls — as a percentage of rent.\n\n0% (Self) means you do it yourself. \"Hybrid\" is a lighter-touch service (leasing only, or occasional help); \"Full svc\" is a manager handling everything day-to-day."}/></>} value={mgmt} onChange={set("mgmt")} typeMin={LIM.mgmt[0]} typeMax={LIM.mgmt[1]} min={0} max={12} step={1} format={v=>v===0?"Self-managed":v+"% of rent"} ticks={[{value:0,label:"Self",color:gn},{value:5,label:"Hybrid",color:tk},{value:10,label:"Full svc",color:yl}]}/>}
            <TS label={<>Maintenance reserve<IT align="left" text={"Not a specific repair bill — a percentage of rent set aside every year as a running fund for the wear and tear that comes with owning a rental: a broken water heater, a roof patch, repainting between tenants.\n\nNewer construction needs less reserve early on; older or heavily-used units need more."}/></>} value={maint} onChange={set("maint")} typeMin={LIM.maint[0]} typeMax={LIM.maint[1]} min={3} max={15} step={1} format={v=>v+"% of rent"} ticks={[{value:5,label:"New build",color:gn},{value:8,label:"Standard",color:tk},{value:12,label:"Aging",color:yl}]}/>
            {isHybrid&&<div style={{fontSize:11,color:tb,lineHeight:1.4}}>These rates apply to the {12-strMonths} LTR months. STR months use the hosting/management rate above. Costs are blended automatically.</div>}
          </div>
        </Section>

        {/* 4. TAXES & INSURANCE — the fixed costs of owning */}
        <Section title="Taxes & insurance" open={openSec.taxes} onToggle={()=>toggleSec("taxes")} summary={<><span style={{fontSize:openSec.taxes?18:15,fontFamily:"'Fraunces',serif",fontWeight:700,color:"#e6edf3"}}>{fD((mPT+mIns)*12)}</span><span style={{fontSize:12,color:"#8b949e"}}>/yr property tax + insurance · {incomeTax===0?"income tax not modeled":incomeTax+"% income tax"}</span></>}>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label={<>Property tax<IT align="left" text={"Annual property tax as a percentage of the ADU's assessed cost — not the whole property's value, and not the price you'd pay for rent.\n\nIn California, Prop 13 caps annual reassessment growth at 2%, which is why the default escalator below is set to match. Other states reassess closer to market value each year."}/></>} value={taxRate} onChange={set("taxRate")} typeMin={LIM.taxRate[0]} typeMax={LIM.taxRate[1]} min={0.5} max={3.0} step={0.1} format={v=>v.toFixed(1)+"% of ADU cost"} ticks={[{value:1.0,label:"CA",color:tb},{value:1.2,label:"Natl avg",color:tk},{value:2.2,label:"Texas",color:yl},{value:2.5,label:"NJ",color:rd}]}/>
            <TS label="Property tax growth" value={taxGrowth} onChange={set("taxGrowth")} typeMin={LIM.taxGrowth[0]} typeMax={LIM.taxGrowth[1]} min={0} max={6} step={0.5} format={v=>v===0?"Flat":"+"+v+"%/yr"} ticks={[{value:0,label:"Flat",color:gn},{value:2,label:"CA Prop 13 cap",color:tb},{value:3,label:"Avg reassess",color:tk},{value:5,label:"Hot market",color:yl}]}/>
            <TS label={<>Insurance ({fD(Math.round(insBase*insurance/100))}/yr)<IT align="left" text={"A rate on the building's replacement cost — the structure and foundation plus the builder's margin on them ("+fD(insBase)+"). Permits, fees, design, site work and furniture aren't part of dwelling coverage. Rate as a percentage of replacement cost is how insurers actually quote.\n\nLandlord policies (DP-3) run 15–25% above owner-occupied rates. Short-term rentals are excluded from standard and landlord policies — STR-specific coverage (Proper, Steadily, commercial) runs 2–3× landlord rates. Airbnb host protection is a supplement, not a replacement.\n\nCA wildfire-zone properties on the FAIR Plan can hit 1.5–2.5%."}/></>} value={insurance} onChange={set("insurance")} typeMin={LIM.insurance[0]} typeMax={LIM.insurance[1]} min={0.2} max={3.5} step={0.1} format={v=>v.toFixed(1)+"% of cost"} ticks={[{value:0.3,label:"HI / VT",color:gn},{value:0.45,label:"CA / PNW",color:tb},{value:0.65,label:"Natl avg",color:tk},{value:1.2,label:"TX / CO",color:yl},{value:1.8,label:"OK / KS / NE",color:yl},{value:2.8,label:"FL coastal",color:rd}]}/>
            <TS label="Insurance growth" value={insGrowth} onChange={set("insGrowth")} typeMin={LIM.insGrowth[0]} typeMax={LIM.insGrowth[1]} min={0} max={15} step={0.5} format={v=>v===0?"Flat":"+"+v+"%/yr"} ticks={[{value:0,label:"Flat",color:gn},{value:3,label:"Inflation",color:tk},{value:6,label:"Natl recent",color:tb},{value:10,label:"CA / FL",color:yl},{value:14,label:"Crisis",color:rd}]}/>
            <TS label={<>Marginal income tax rate<IT align="left" text={"Combined federal + state rate. Applied to taxable rental income after deducting loan interest and depreciation ("+fD(Math.round(depBasis/27.5))+"/yr).\n\nIn early years, deductions often exceed income — no tax owed. Tax grows as the loan amortizes and interest shrinks. Cov. and +/− are always pre-tax year-1."}/></>} value={incomeTax} onChange={set("incomeTax")} typeMin={LIM.incomeTax[0]} typeMax={LIM.incomeTax[1]} min={0} max={50} step={1} format={v=>v===0?"Not modeled":v+"%"} ticks={[{value:0,label:"Not modeled",color:gn},{value:22,label:"22% fed",color:tk},{value:32,label:"32% fed",color:tb},{value:37,label:"Top fed",color:yl},{value:46,label:"+CA state",color:rd}]}/>
            {incomeTax>0&&<Tog on={lossCarry} onToggle={()=>set("lossCarry")(!lossCarry)} label={<>Carry rental losses forward<IT align="left" text={"In the early years, loan interest and depreciation usually make the ADU show a loss on paper even when cash comes in. Most owners can't deduct that loss against their salary (the passive-loss rules phase that out above $100K–$150K of income), but the loss isn't lost: it carries forward and offsets the ADU's rental income in later years, and anything left is deductible when you sell.\n\nTurn this off to see the more conservative case where early losses are simply ignored."}/></>} sub={lossCarry?"Early paper losses offset later rental income, lowering tax in later years":"Off — early paper losses are ignored (more conservative)"}/>}
            <div style={{fontSize:11,color:"#6e7681",lineHeight:1.45}}>For income tax, the building is written off as depreciation ({fD(Math.round(depBasis/27.5))}/yr over 27.5 years, furnishings excluded).</div>
          </div>
        </Section>

        {/* 5. VALUE & SELLING — what the ADU is worth */}
        <Section title="Value & selling" open={openSec.value} onToggle={()=>toggleSec("value")} summary={<><span style={{fontSize:openSec.value?18:15,fontFamily:"'Fraunces',serif",fontWeight:700,color:tb}}>{fD(ltrRent*grm)}</span><span style={{fontSize:12,color:"#8b949e"}}> when complete · {grm}× rent{saleOn?" · sale after "+saleYear+" yr":""}</span></>}>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label={<>Value multiplier<IT align="left" text={"Estimates what the ADU adds to your property's value: this multiple × the monthly long-term rent (a gross rent multiplier, or GRM).\n\nAppraisers rely mainly on comparable sales and use the GRM as a cross-check. Low-cost markets run about 80–120×; expensive coastal markets 200–300×.\n\nValue drives Equity, Return and the net-equity chart, so set this for your market."}/></>} value={grm} onChange={set("grm")} typeMin={LIM.grm[0]} typeMax={LIM.grm[1]} min={50} max={400} step={5} format={v=>v+"× rent"} ticks={[{value:80,label:"Low-cost",color:tk},{value:110,label:"Typical",color:tb},{value:200,label:"Coastal",color:tk},{value:300,label:"Prime coastal",color:yl}]}/>
            <Tog on={saleOn} onToggle={()=>set("saleOn")(!saleOn)} label="Include a sale scenario" sub={saleOn?"Shows what you'd walk away with if you sold — in the Summary and the printed report":"Off — for owners who plan to keep the ADU"}/>
            {saleOn&&<div style={{...nested,display:"flex",flexDirection:"column",gap:6}}>
              <TS label={<>Selling costs<IT align="left" text={"Agent commission plus closing costs, as a share of what the ADU adds to the sale price. Typical: 5–6% with traditional agents, less with a discount brokerage or a for-sale-by-owner sale."}/></>} value={sellCost} onChange={set("sellCost")} typeMin={LIM.sellCost[0]} typeMax={LIM.sellCost[1]} min={0} max={10} step={0.5} format={v=>v+"% of sale"} ticks={[{value:1,label:"By owner",color:gn},{value:3.5,label:"Discount agent",color:tk},{value:6,label:"Typical",color:tb},{value:8,label:"+ concessions",color:yl}]}/>
              <TS label={<>Sell after<IT align="left" text={"Years of renting before a hypothetical sale, used for the 'What if you sold?' card in the Summary and the printed report."}/></>} value={saleYear} onChange={set("saleYear")} typeMin={LIM.saleYear[0]} typeMax={LIM.saleYear[1]} min={1} max={30} step={1} format={v=>v+" years of renting"} ticks={[{value:5,label:"5 yr",color:tk},{value:10,label:"10 yr",color:tb},{value:20,label:"20 yr",color:tk},{value:30,label:"30 yr",color:tk}]}/>
              <div style={{fontSize:11,color:tb,lineHeight:1.45}}>If sold then: about {fD(cm.sale.proceeds)} from the sale and {(cm.sale.net>=0?"+":"")+fD(cm.sale.net)} overall after everything put in and taken out.</div>
            </div>}
          </div>
        </Section>

        {/* 6. REPORT DETAILS — who it's for and who prepared it, for the printed report */}
        <Section title="Report details" open={openSec.details} onToggle={()=>toggleSec("details")} summary={<span style={{fontSize:12,color:"#8b949e"}}>{clientName.trim()?"For "+clientName.trim():"Not filled in"}</span>}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,240px),1fr))",gap:12}}>
            <label htmlFor="clientName" style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>Prepared for<input id="clientName" className="fld" type="text" value={clientName} onChange={e=>set("clientName")(e.target.value)} placeholder="Client name" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"7px 10px",color:"#e6edf3",fontSize:13,fontFamily:"inherit",textTransform:"none",letterSpacing:0,outline:"none"}}/></label>
            <label htmlFor="clientAddr" style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>Property address<input id="clientAddr" className="fld" type="text" value={clientAddr} onChange={e=>set("clientAddr")(e.target.value)} placeholder="Street, city" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"7px 10px",color:"#e6edf3",fontSize:13,fontFamily:"inherit",textTransform:"none",letterSpacing:0,outline:"none"}}/></label>
            <label htmlFor="prepName" style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>Prepared by<input id="prepName" className="fld" type="text" value={prepName} onChange={e=>set("prepName")(e.target.value)} placeholder="Your name" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"7px 10px",color:"#e6edf3",fontSize:13,fontFamily:"inherit",textTransform:"none",letterSpacing:0,outline:"none"}}/></label>
            <label htmlFor="prepCompany" style={{display:"flex",flexDirection:"column",gap:4,fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>Company<input id="prepCompany" className="fld" type="text" value={prepCompany} onChange={e=>set("prepCompany")(e.target.value)} placeholder="Company (optional)" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"7px 10px",color:"#e6edf3",fontSize:13,fontFamily:"inherit",textTransform:"none",letterSpacing:0,outline:"none"}}/></label>
          </div>
          <label htmlFor="reportNotes" style={{display:"flex",flexDirection:"column",gap:4,marginTop:12,fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>Notes for the client<textarea id="reportNotes" className="fld" rows={4} value={reportNotes} onChange={e=>set("reportNotes")(e.target.value.slice(0,1200))} placeholder="Site-specific caveats, what's included or excluded, next steps…" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"8px 10px",color:"#e6edf3",fontSize:13,fontFamily:"inherit",textTransform:"none",letterSpacing:0,lineHeight:1.5,resize:"vertical",outline:"none"}}/></label>
          <div style={{fontSize:11,color:"#6e7681",marginTop:8,lineHeight:1.45}}>Shown on the printed report and the Summary. These details are saved in this browser and included in model links — leave them out of links you post publicly.</div>
        </Section>
        </div>

        <div className="int-results">
        {/* RENT YOU'D CHARGE */}
        <div style={{...card,padding:"16px 18px",marginBottom:12,opacity:isSTR?0.45:1,pointerEvents:isSTR?"none":"auto"}}>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:2}}>
            <h3 style={{margin:0,fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,fontFamily:"inherit"}}>What would you charge for rent?</h3>
            {!isSTR&&!hasCustom&&<span style={{fontSize:11,color:yl,fontWeight:500}}>Required</span>}
          </div>
          {isSTR?(<div style={{fontSize:11,color:yl}}>Not used in STR mode — rent is set by the nightly rate above.</div>):(<>
          <p style={{margin:"0 0 12px",fontSize:11,color:"#6e7681",lineHeight:1.5,maxWidth:640}}>
            Enter the monthly rent you expect to collect for this {sqft} sq ft {utype.toLowerCase()} — the figure you'd list it at, not a per-square-foot base. It is used exactly as typed. For scale, a {sqft} sq ft unit runs about {fD(sizeAnchor)}/mo at the U.S. average, and roughly {fD(rentLo)}–{fD(rentHi)}/mo across major metros.
          </p>
          <div style={{display:"flex",alignItems:"flex-end",gap:16,flexWrap:"wrap"}}>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <label htmlFor="rentAmt" style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>Monthly rent</label>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:14,color:"#8b949e",fontFamily:"'Fraunces',serif"}}>$</span>
                <input id="rentAmt" className="fld" type="number" inputMode="numeric" min={0} step={25} value={customRent||""} onChange={e=>set("customRent")(parseInt(e.target.value)||0)} placeholder="e.g. 2000" style={{background:"#0d1117",border:"1px solid "+(hasCustom?"#30363d":yl+"80"),borderRadius:6,padding:"7px 10px",color:"#e6edf3",fontSize:15,fontFamily:"'Fraunces',serif",width:120,outline:"none"}}/>
                <span style={{fontSize:11,color:"#8b949e"}}>/mo</span>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <label htmlFor="rentLoc" style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>Label <span style={{textTransform:"none",letterSpacing:0,color:"#6e7681"}}>(optional)</span></label>
              <input id="rentLoc" className="fld" type="text" value={customName} onChange={e=>set("customName")(e.target.value)} placeholder="e.g. Portland — Alberta" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"7px 10px",color:"#e6edf3",fontSize:13,fontFamily:"'DM Sans',sans-serif",width:210,outline:"none"}}/>
            </div>
            <button type="button" onClick={()=>set("view")("consumer")} disabled={!hasCustom} style={{padding:"14px 26px",borderRadius:8,fontSize:15,fontWeight:600,letterSpacing:"0.01em",cursor:hasCustom?"pointer":"not-allowed",border:"1px solid "+(hasCustom?tb:"#30363d"),background:hasCustom?tb:"transparent",color:hasCustom?"#0d1117":"#6e7681",fontFamily:"inherit",transition:"background 0.15s, box-shadow 0.15s",boxShadow:hasCustom?"0 1px 10px rgba(88,166,255,0.28)":"none",whiteSpace:"nowrap",flexShrink:0}} onMouseEnter={e=>{if(hasCustom)e.currentTarget.style.background="#79b8ff"}} onMouseLeave={e=>{if(hasCustom)e.currentTarget.style.background=tb}}>Open summary →</button>
          </div>
          </>)}
        </div>

        {(hasCustom||isSTR)?(()=>{
        const eqR=total>0?r.eq/total:0, eqC=eqR>=1?gn:eqR>=0.7?yl:rd;
        const covN=r.cov, covC=covN===null||covN>=100?gn:covN>=85?yl:rd;
        const be=Math.round(beRent), gap=r.rent-be;
        const mos=r.rent>0?(gap/r.rent)*100:0;
        const pctTxt=v=>v===null?"n/a":(v>=0?"":"−")+Math.abs(v).toFixed(1)+"%/yr";
        return(<>
        {/* HEADLINE — break-even, the only benchmark a single site has */}
        <div style={{...card,padding:"18px 22px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:16}}>
            <div>
              <div style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:600,marginBottom:4}}>Break-even rent<IT text={"Gross monthly rent that exactly covers loan payment, property tax, and insurance after vacancy and operating costs.\n\nYear 1, pre-tax. Rent growth and tax deductions are not counted here — they are what CF+ and Payback add."} align="left"/></div>
              <div style={{fontFamily:"'Fraunces',serif",fontSize:30,fontWeight:700,color:"#e6edf3",lineHeight:1.1}}>{fD(be)}<span style={{fontSize:15,color:"#8b949e",fontWeight:400}}>/mo</span></div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:600,marginBottom:4}}>Your rent vs. break-even</div>
              <div style={{fontFamily:"'Fraunces',serif",fontSize:23,fontWeight:700,color:gap>=0?gn:rd,lineHeight:1.2}}>{gap>=0?"+"+fD(gap):"\u2212"+fD(Math.abs(gap))}<span style={{fontSize:13,fontWeight:400,color:"#8b949e"}}>/mo</span></div>
              <div style={{fontSize:11,color:"#8b949e",marginTop:2}}>{gap>=0?`${Math.round(mos)}% margin of safety`:`rent must rise ${Math.round((be/Math.max(r.rent,1)-1)*100)}% to break even`}</div>
            </div>
          </div>
          <div style={{marginTop:14,height:6,borderRadius:3,background:"#0d1117",overflow:"hidden",position:"relative"}}>
            <div style={{height:"100%",width:`${Math.min(100,(r.rent/Math.max(be,1))*100)}%`,background:gap>=0?gn:rd,borderRadius:3,transition:"width 0.2s"}}/>
          </div>
          <div style={{fontSize:10.5,color:"#8b949e",lineHeight:1.55,marginTop:8}}>{sqft} sq ft {utype.toLowerCase()}, {isSTR?<span style={{color:yl}}>${strADR}/night STR</span>:isHybrid?<span style={{color:tb}}>{strMonths}mo @ ${strADR}/night + {12-strMonths}mo LTR</span>:"long-term lease"}{growth>0&&<span style={{color:tb}}> · +{growth}%/yr rent growth</span>}{incomeTax>0&&<span style={{color:yl}}> · {incomeTax}% marginal tax</span>}{buildMonths>0&&<span style={{color:yl}}> · {buildMonths}mo build</span>}</div>
        </div>

        {/* METRICS */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:12}}>
          {[
            {k:"Rent",v:fD(r.rent)+"/mo",c:"#e6edf3",s:"Year 1, as entered"},
            {k:"Net",v:fD(r.net)+"/mo",c:"#e6edf3",s:"After property tax, insurance, opex"},
            {k:"Cov.",v:covN===null?"No loan":covN.toFixed(0)+"%",c:covC,s:covN===null?"All cash \u2014 no payment to cover":"Net rent \u00f7 loan payment"},
            {k:"+/\u2212",v:(r.sur>=0?"+":"")+fD(r.sur)+"/mo",c:r.sur>=0?gn:rd,s:r.sur>=0?"Passive income":"Monthly subsidy"},
            {k:"CF+",v:r.cfPlus<=0?"Now":fYr(r.cfPlus)+(r.cfAtTerm?"*":""),c:r.cfPlus<=3?gn:r.cfPlus<=term&&!r.cfAtTerm?yl:rd,s:r.cfPlus===Infinity?"Expenses outpace rent":r.cfAtTerm?"Only once the loan ends":"From project start"},
            {k:"Payback",v:r.po===0?"Immediate":fYr(r.po),c:r.po<=term?gn:r.po<=term*1.5?yl:rd,s:r.po===0?"Never out of pocket":"Until all cash put in is back"},
            {k:"Equity",v:fK(r.eq),c:eqC,s:`${Math.round(eqR*100)}% of project cost`},
            {k:"Return",v:fK(r.ret),c:r.ret>0?gn:rd,s:`${pctTxt(r.roi)} on project cost · `+(roiCash!==null?`${pctTxt(roiCash)} on cash invested`:"no cash invested")},
          ].map(m=>(
            <div key={m.k} style={{...card,padding:"12px 14px"}}>
              <div style={{fontSize:10.5,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:5,display:"flex",alignItems:"center"}}>{m.k}<IT text={CI[m.k]} align="left"/></div>
              <div style={{fontFamily:"'Fraunces',serif",fontSize:19,fontWeight:600,color:m.c,lineHeight:1.15}}>{m.v}</div>
              <div style={{fontSize:10.5,color:"#6e7681",marginTop:4,lineHeight:1.4}}>{m.s}</div>
            </div>
          ))}
        </div>
        {r.cfAtTerm&&<div style={{fontSize:10.5,color:yl,marginBottom:12,lineHeight:1.5}}>* Cash flow only turns positive once the {term}-year loan is paid off — rent growth alone never overtakes the payment.</div>}
        </>);})():(<div style={{...card,padding:"32px 24px",textAlign:"center"}}><p style={{color:"#8b949e",fontSize:13,margin:0,lineHeight:1.6}}>Enter the monthly rent you'd charge above to see the results for this site. Break-even for the project as configured is <strong style={{color:"#e6edf3"}}>{fD(Math.round(beRent))}/mo</strong>.</p></div>)}
        </div>
        </div>

        {(hasCustom||isSTR)&&(<>
        {/* HOW THE NUMBERS WORK — reference notes, collapsed by default */}
        <div style={{marginTop:16,...card}}>
          <button type="button" aria-expanded={showHow} onClick={()=>setShowHow(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 22px",cursor:"pointer",width:"100%",background:"transparent",border:"none",borderRadius:10,fontFamily:"inherit"}}>
            <span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>How the numbers work</span>
            <span style={{fontSize:13,color:"#8b949e"}}>{showHow?"▴":"▾"}</span>
          </button>
          {showHow&&(<div style={{padding:"0 22px 18px",fontSize:11.5,lineHeight:1.7,color:"#8b949e",display:"flex",flexDirection:"column",gap:10,maxWidth:820}}>
            <div><strong style={{color:"#e6edf3"}}>Reading the results.</strong> Cov. and +/− are first-month, pre-tax cash flow. CF+, Payback and Return include rent growth{incomeTax>0?" and income tax at "+incomeTax+"%":""}. Equity is the value multiplier ({grm}× long-term rent) — a heuristic; appraisals use comparable sales.</div>
            <div><strong style={{color:"#e6edf3"}}>What's in the cost.</strong> Structure $/sq ft covers the shell, finishes, systems and built-in appliances; foundation, site work and furnishing are separate lines. The builder margin ({markup}%, {fD(markupAmt)}) is included. Not included: solar panels (required on new California homes, about $5–10K), landscaping restoration, or HOA fees.</div>
            <div><strong style={{color:"#e6edf3"}}>How rental income is taxed.</strong> It goes on Schedule E — no LLC needed. You deduct expenses, loan interest and depreciation. Early on, deductions usually exceed income, so no tax is owed; as interest shrinks, taxable income grows. The passive-loss rules limit using those early losses against other income (the $25K allowance phases out between $100K and $150K of income), but they carry forward — set under Taxes & insurance. The income tax rate applies to CF+, Payback and Return; leave it at 0% for a pre-tax view.</div>
            <div style={{color:tb}}>Settings are saved automatically in this browser.</div>
          </div>)}
        </div>

        {/* SOURCES */}
        <div style={{marginTop:24,...card}}>
          <button type="button" aria-expanded={showSources} onClick={()=>setShowSources(s=>!s)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 22px",cursor:"pointer",userSelect:"none",width:"100%",background:"transparent",border:"none",borderRadius:10,fontFamily:"inherit"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>Sources & data provenance</span>
            <span style={{fontSize:13,color:"#8b949e"}}>{showSources?"▴":"▾"}</span>
          </button>
          {showSources&&(<div style={{padding:"0 22px 18px"}}>
            <div style={{fontSize:11,color:"#8b949e",lineHeight:1.6,marginBottom:16,maxWidth:760}}>Each source below is annotated with what it contributed to the model. Defaults and tick marks reflect cross-referenced 2025–2026 data, primarily from Terner Center academic research, IRS publications, builder cost reporting, and aggregated insurance-rate data. Where sources conflict, the model uses the median or the more conservative value.</div>
            <div style={{display:"flex",flexDirection:"column",gap:18}}>
              {SRC.map(s=>(
                <div key={s.cat}>
                  <div style={{fontSize:12,fontWeight:600,color:"#e6edf3",marginBottom:8,paddingBottom:4,borderBottom:"1px solid #21262d"}}>{s.cat}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {s.links.map((l,i)=>(
                      <div key={i} style={{paddingLeft:8,borderLeft:"2px solid #21262d"}}>
                        <a href={l.u} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:tb,textDecoration:"none",lineHeight:1.5,fontWeight:500,display:"inline-block"}} onMouseEnter={e=>e.target.style.textDecoration="underline"} onMouseLeave={e=>e.target.style.textDecoration="none"}>{l.t} ↗</a>
                        {l.n&&<div style={{fontSize:10.5,color:"#8b949e",lineHeight:1.6,marginTop:3}}>{l.n}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>)}
        </div>
        </>)}
      </>)}

      {view==="consumer"&&cm&&(<ConsumerView cm={cm} costRange={costRange} preparedFor={preparedFor} preparedBy={preparedBy} cmpCols={mdl.cmp} verdict={rep?rep.verdict:null} saleOn={saleOn} setSaleOn={set("saleOn")} saleYear={saleYear} setSaleYear={set("saleYear")} rentY1={grossY1} assetCost={assetCost} origFeeAmt={origFeeAmt} origFee={origFee} costSteps={costSteps} ptypeKey={projectType} unitNoun={ptype.noun} grm={grm} total={total} loanPmt={loanPmt} loanAmt={loanAmt} cashDownAmt={cashDownAmt} rate={rate} term={term} setTerm={set("term")} horizon={horizon} setHorizon={set("horizon")} growth={growth} buildMonths={buildMonths} sqft={sqft} utype={utype} isSTR={isSTR} hasCustom={hasCustom} sizeAnchor={sizeAnchor} rentLo={rentLo} rentHi={rentHi} customName={customName} cashDown={cashDown} setCashDown={set("cashDown")} incomeTax={incomeTax} customRent={customRent} setCustomRent={set("customRent")} setCustomName={set("customName")} copied={copied} copyShare={copyShare} />)}

      </div>
    </div>
    <PrintReport rep={rep}/>
  </>);
}


createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
