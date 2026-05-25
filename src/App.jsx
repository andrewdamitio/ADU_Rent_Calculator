import { useState, useMemo, useRef, useEffect, useCallback } from "react";

const storage = storage ?? {
  get: (k) => Promise.resolve({ value: localStorage.getItem(k) }),
  set: (k, v) => Promise.resolve(localStorage.setItem(k, v)),
  delete: (k) => Promise.resolve(localStorage.removeItem(k)),
};

const M=[{metro:"LA Westside",br:3500},{metro:"SF Peninsula",br:3250},{metro:"San Mateo Co.",br:3100},{metro:"Seattle (prime)",br:2800},{metro:"San Jose",br:2750},{metro:"LA — SFV",br:2600},{metro:"San Diego",br:2300},{metro:"Seattle (avg)",br:2200},{metro:"Austin",br:2000},{metro:"U.S. average",br:1900},{metro:"Portland",br:1700},{metro:"Denver",br:1650},{metro:"Midwest / SE",br:1200}];
const rs=s=>Math.pow(s/600,0.55),ut=s=>s<450?"Studio":s<700?"1 Bed":s<950?"1–2 Bed":"2 Bed";
const cMP=(p,r,y)=>{if(p<=0)return 0;const mr=r/12,n=y*12;if(mr===0)return p/n;return p*(mr*Math.pow(1+mr,n))/(Math.pow(1+mr,n)-1)};
function sim(p){
  const{loanAmt,annRate,termYr,rentNetOpY1,mPTY1,mInsY1,rentGrowth,taxGrowthA,insGrowthA,taxMarg,depBasis,buildMo}=p;
  const bm=buildMo||0;
  const dep=(depBasis||loanAmt)/27.5/12;
  const mrG=rentGrowth>0?Math.pow(1+rentGrowth,1/12)-1:0;
  const mtG=taxGrowthA>0?Math.pow(1+taxGrowthA,1/12)-1:0;
  const miG=insGrowthA>0?Math.pow(1+insGrowthA,1/12)-1:0;
  if(loanAmt<=0){
    let cum=0;
    for(let m=0;m<termYr*12;m++){
      const rNet=rentNetOpY1*Math.pow(1+mrG,m),pt=mPTY1*Math.pow(1+mtG,m),ins=mInsY1*Math.pow(1+miG,m);
      const net=rNet-pt-ins,taxable=net-dep,tax=taxMarg>0&&taxable>0?taxable*taxMarg:0;
      cum+=net-tax;
    }
    return{cfPlus:bm/12,cfAtTerm:false,po:0,cum};
  }
  const mr=annRate/12,pmt=cMP(loanAmt,annRate,termYr),n=termYr*12;
  const netY1=rentNetOpY1-mPTY1-mInsY1;
  if(netY1<=0)return{cfPlus:bm/12+termYr,cfAtTerm:true,po:Infinity,cum:-pmt*n};
  let aBal=loanAmt,lBal=loanAmt,cum=0,cfm=-1,pom=-1;
  for(let m=0;m<600;m++){
    const rNet=rentNetOpY1*Math.pow(1+mrG,m),pt=mPTY1*Math.pow(1+mtG,m),ins=mInsY1*Math.pow(1+miG,m);
    const net=rNet-pt-ins,inT=m<n;
    const intM=inT&&aBal>0?aBal*mr:0;
    if(inT&&aBal>0)aBal=Math.max(0,aBal-(pmt-intM));
    const taxable=net-intM-dep;
    const tax=taxMarg>0&&taxable>0?taxable*taxMarg:0;
    const atNet=net-tax;
    if(cfm<0){const cp=m<n?pmt:0;if(atNet>=cp)cfm=m}
    if(m<n)cum+=atNet-pmt;
    if(pom<0&&lBal>0){lBal=lBal+lBal*mr-atNet;if(lBal<=0)pom=m}
  }
  const totalTerm=bm/12+termYr;
  const cfRaw=cfm<0?totalTerm:(cfm+1)/12+bm/12;
  return{cfPlus:Math.min(cfRaw,totalTerm),cfAtTerm:cfm<0||cfRaw>totalTerm-0.01,po:pom<0?Infinity:(pom+1)/12+bm/12,cum};
}
const fD=n=>"$"+Math.round(n).toLocaleString();
const fK=n=>{const a=Math.abs(n),s=n<0?"-":"+";return a>=1000?s+"$"+Math.round(a/1000)+"k":s+"$"+Math.round(a)};

const CI={"Metro":"City or metro area.\n\nBase rents are midpoints for a 1BR (600 sq ft) ADU, 2025–2026 market data.","Rent":"Year-1 monthly rent at the current ADU size.\n\nScaled from 1BR base: studios ≈ 75%, 2-beds ≈ 130%.\n\nIf STR mode is on, rent is computed from the nightly rate × 30.4 nights, scaled by metro vs. US average.","Net":"Year-1 rent minus operating expenses (pre-tax).\n\nProperty tax, insurance, maintenance, vacancy, management.","Cov.":"Year-1 pre-tax net rent ÷ loan payment.\n\nIgnores equity, rent growth, and income tax.\n100% = breakeven monthly.","+/−":"Year-1 pre-tax net rent minus loan payment.\n\nDoes NOT reflect rent growth or taxes.\n\nGreen = passive income.\nRed = monthly subsidy.","CF+":"Years until after-tax growing rent exceeds the fixed loan payment.\n\n'Now' = already positive in year 1.\n* = rent never caught up, but loan ended.\n\nAccounts for rent growth AND income tax (interest + depreciation deductions shrink over time).","Payback":"Years until cumulative after-tax net rent equals total project cost.\n\nSimple payback period — not loan payoff. Does not model extra principal payments; asks: how long until rent has returned the full investment?\n\nAccounts for rent growth and income tax.\n\nGreen ≤ term. Yellow ≤ 1.5×.\nRed = longer.","Equity":"Rough estimate of value added, using a GRM of 110× monthly rent.\n\nSimplified heuristic — real appraisers use sales comparables first, income approach as a cross-check. The right multiplier varies sharply: coastal CA and Seattle have GRMs of 200–300×, so this column likely understates value there. Midwest markets are closer to 80–120×.\n\nAlways uses LTR rent, not STR income.\n\nGreen = gross estimate exceeds ADU cost.","Return":"Total gain over loan term: cumulative after-tax cash flow + equity.\n\nAccounts for rent growth and income tax.\nThe % is annualized ROI."};

const DEF={sqft:600,cpsf:250,permits:10000,hookup:8000,foundation:10000,sitePrep:8000,utilTrench:8000,electrical:3000,hardscape:2000,design:8000,surveys:3500,markup:20,rentalMode:"ltr",strADR:125,strCosts:20,strVacancy:15,strMonths:4,furnishing:0,cashDown:0,origFeeOn:false,origFee:5,rate:7.5,term:10,buildMonths:6,taxRate:1.1,taxGrowth:2,insurance:0.5,insGrowth:5,maint:8,vacancy:5,mgmt:0,growth:3,incomeTax:0,customRent:0,customName:"",view:"internal",featuredIdx:0};
const SK="adu-calc-v16";
const tk="#6e7681",tb="#58a6ff",gn="#3fb950",yl="#d29922",rd="#f85149";
const card={background:"#161b22",border:"1px solid #21262d",borderRadius:10};

function IT({text,align}){const[o,sO]=useState(false);const r=useRef(null);useEffect(()=>{if(!o)return;const h=e=>{if(r.current&&!r.current.contains(e.target))sO(false)};document.addEventListener("mousedown",h);document.addEventListener("touchstart",h);return()=>{document.removeEventListener("mousedown",h);document.removeEventListener("touchstart",h)}},[o]);const ls=text.split("\n");const pos=align==="left"?{left:-4}:align==="right"?{right:-4}:{left:"50%",transform:"translateX(-50%)"};const arr=align==="left"?{left:12}:align==="right"?{right:12}:{left:"50%",marginLeft:-4};return(<span ref={r} style={{position:"relative",display:"inline-block",marginLeft:3,verticalAlign:"middle"}}><span onClick={e=>{e.stopPropagation();sO(!o)}} onMouseEnter={()=>sO(true)} onMouseLeave={()=>sO(false)} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:12,height:12,borderRadius:"50%",border:"1px solid "+(o?tb:"#3d444d"),color:o?tb:tk,fontSize:7.5,fontWeight:700,cursor:"pointer",transition:"all 0.15s",fontFamily:"'DM Sans',sans-serif",letterSpacing:0,textTransform:"none",lineHeight:1,userSelect:"none"}}>?</span>{o&&(<div style={{position:"absolute",bottom:"calc(100% + 8px)",...pos,width:200,padding:"8px 10px",background:"#1c2129",border:"1px solid #30363d",borderRadius:8,fontSize:10.5,fontWeight:400,fontFamily:"'DM Sans',sans-serif",color:"#c9d1d9",lineHeight:1.5,textTransform:"none",letterSpacing:"normal",textAlign:"left",zIndex:100,boxShadow:"0 8px 24px rgba(0,0,0,0.5)",wordWrap:"break-word",whiteSpace:"normal"}}>{ls.map((l,i)=>l===""?<div key={i} style={{height:4}}/>:<div key={i}>{l}</div>)}<div style={{position:"absolute",bottom:-5,...arr,width:8,height:8,background:"#1c2129",borderRight:"1px solid #30363d",borderBottom:"1px solid #30363d",transform:"rotate(45deg)"}}/></div>)}</span>)}

function Sl({label,value,onChange,min,max,step,format}){return(<div style={{display:"flex",flexDirection:"column",gap:3}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:500}}>{label}</span><span style={{fontSize:17,fontFamily:"'Fraunces',serif",fontWeight:600,color:"#e6edf3"}}>{format(value)}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} style={{width:"100%",accentColor:tb,height:5,cursor:"pointer"}}/></div>)}

function TS({label,value,onChange,min,max,step,format,ticks,badge}){const pct=v=>((v-min)/(max-min))*100;return(<div style={{display:"flex",flexDirection:"column"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}><span style={{fontSize:12,color:"#8b949e"}}>{label}{badge&&<span style={{marginLeft:6,fontSize:10,color:tb,background:"rgba(88,166,255,0.1)",padding:"1px 6px",borderRadius:4,fontWeight:600}}>{badge}</span>}</span><span style={{fontSize:15,fontFamily:"'Fraunces',serif",fontWeight:600,color:"#e6edf3"}}>{format(value)}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} style={{width:"100%",accentColor:tb,height:5,cursor:"pointer",margin:0}}/>{ticks&&ticks.length>0&&(<div style={{position:"relative",height:18,marginTop:2}}>{ticks.map((t,i)=>{const left=pct(t.value);if(left<0||left>100)return null;return(<div key={i} style={{position:"absolute",left:`${left}%`,transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center",pointerEvents:"none"}}><div style={{width:1,height:5,background:t.color||"#3d444d"}}/><span style={{fontSize:8.5,color:t.color||tk,whiteSpace:"nowrap",marginTop:1,fontWeight:500}}>{t.label}</span></div>)})}</div>)}</div>)}

function Sub({label,value}){return(<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0 1px",borderTop:"1px solid #21262d",marginTop:4}}><span style={{fontSize:11.5,color:"#6e7681"}}>{label}</span><span style={{fontSize:13,fontFamily:"'Fraunces',serif",fontWeight:600,color:"#8b949e"}}>{fD(value)}</span></div>)}
function SL({children}){return <div style={{fontSize:10,color:"#6e7681",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:500,marginTop:12,marginBottom:6}}>{children}</div>}
function Tog({on,onToggle,label,sub}){return(<div onClick={onToggle} style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none"}}><div style={{width:40,height:22,borderRadius:11,padding:2,background:on?tb:"#30363d",transition:"background 0.2s",flexShrink:0}}><div style={{width:18,height:18,borderRadius:9,background:"#e6edf3",transform:on?"translateX(18px)":"translateX(0)",transition:"transform 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/></div><div><div style={{fontSize:13,fontWeight:500,color:"#e6edf3"}}>{label}</div>{sub&&<div style={{fontSize:11,color:"#8b949e",lineHeight:1.4,marginTop:1}}>{sub}</div>}</div></div>)}
function ModePills({value,onChange,options}){return(<div style={{display:"flex",gap:0,borderRadius:8,overflow:"hidden",border:"1px solid #30363d"}}>{options.map(o=>(<div key={o.value} onClick={()=>onChange(o.value)} style={{padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:value===o.value?600:400,color:value===o.value?"#e6edf3":"#8b949e",background:value===o.value?"#30363d":"transparent",transition:"all 0.15s",userSelect:"none",borderRight:"1px solid #30363d",flex:1,textAlign:"center"}}>{o.label}</div>))}</div>)}

const HA=["left","center","center","center","center","center","center","right","right"];

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
{t:"ADU Appraisal: 100–120× Rule — Genuine Kitchen & Bath",u:"https://genuinekitchenbath.com/adu-rental-income-san-mateo-county/",n:"The GRM heuristic widely cited by lenders/builders. The 110× midpoint is what this tool's Equity column uses."},
{t:"6 ADU Loan Options — RenoFi",u:"https://www.renofi.com/adus/adu/financing/",n:"Loan product menu: HELOC, cash-out refi, renovation loans, construction-to-perm. Informs the rate/term defaults."},
{t:"ADU Financing Options — JVM Lending",u:"https://www.jvmlending.com/blog/how-much-does-an-adu-cost-adu-financing-options/",n:"Typical rate ranges (6–9%) for ADU loans in 2026 — calibrates the 7.5% default."},
{t:"Best ADU Loan Programs CA — Better Place",u:"https://betterplacedesignbuild.com/blog/adu-loan-programs/",n:"CalHFA grant info and program-specific structures."},
{t:"ADU HELOC 125% CLTV — Patelco",u:"https://www.patelco.org/credit-cards-and-loans/home-equity/adu-line-of-credit",n:"Future-value-based HELOC products — the 125% CLTV is unusual in the broader market."},
{t:"Freddie Mac Primary Mortgage Market Survey",u:"https://www.freddiemac.com/pmms",n:"Weekly 30-year fixed mortgage rate benchmark used for the broader rate context (HELOCs and renovation loans typically run +100–200 bps above PMMS)."},
{t:"CalHFA ADU Grant Program — California Housing Finance Agency",u:"https://www.calhfa.ca.gov/adu/",n:"Up to $40,000 in pre-development cost grants for income-qualified homeowners. The model does NOT include this — output is conservative for CA homeowners eligible for the program."},
{t:"Fannie Mae Selling Guide on ADU Income — B3-3.1-08",u:"https://selling-guide.fanniemae.com/sel/b3-3.1-08/rental-income",n:"Federal underwriting guidance on counting ADU rental income in DTI calculations. Informs the financing-feasibility framing in the consumer view."},
]},
{cat:"Short-Term Rental & Hybrid Strategy",links:[
{t:"ADU Airbnb Income by City — Maxable",u:"https://maxablespace.com/adu-airbnb/",n:"STR nightly rate benchmarks by metro — informs the ADR tick marks ($75–$300/night)."},
{t:"Airbnb Host Fee Structure 2026 — Airbnb",u:"https://www.airbnb.com/help/article/1857",n:"Host-only 15% vs split-fee 3% model — used for the hosting/management cost slider."},
{t:"STR vs LTR for ADUs — Autonomous",u:"https://www.autonomous.ai/ourblog/adu-short-term-rental",n:"Comparative net-income analysis between strategies — informs the hybrid mode blending logic."},
{t:"Furnished Finder — Medium-Term Rental Platform",u:"https://www.furnishedfinder.com/",n:"Traveling-nurse and 30+ day rentals — reference for the medium-term alternative to STR/LTR."},
{t:"AirDNA Market Reports — Short-Term Rental Analytics",u:"https://www.airdna.co/",n:"Per-market STR occupancy, ADR, and revenue trends. Referenced for the warning that STR supply has grown faster than demand in many markets since 2022."},
{t:"Local STR Ordinance Tracker — Granicus / Host Compliance",u:"https://hostcompliance.com/blog/",n:"Catalog of city-level STR restrictions (LA, NYC, SF, Boston, etc.). Informs the STR regulatory-risk caveat."},
]},
{cat:"Construction Timelines",links:[
{t:"How Long Does It Take to Build an ADU? — Maxable",u:"https://maxablespace.com/how-long-does-it-take-to-build-an-adu/",n:"6–9 month typical timelines; supports the 6-month default."},
{t:"ADU Permit Timeline California 2026 — Verified ADU",u:"https://verifiedadu.com/adu-permit-timeline-california/",n:"Permit-to-completion timing including the SB 9 60-day streamlining."},
{t:"Prefab ADU Timeline: Abodu vs. Stick-Built — Abodu",u:"https://www.abodu.com/blog/how-long-does-it-take-to-build-an-adu",n:"Prefab can compress to 3–4 months; informs the 'fast-track' tick at 4mo."},
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

function ConsumerView({featured,cm,sens,rows,featuredIdx,setFeaturedIdx,total,loanPmt,loanAmt,cashDownAmt,rate,term,setTerm,growth,buildMonths,sqft,utype,rentalMode,strADR,isSTR,isHybrid,strMonths,hasCustom,customName,cashDown,setCashDown,incomeTax,customRent,setCustomRent,setCustomName}){
  const[hovPt,setHovPt]=useState(null);
  const[barYear,setBarYear]=useState(1);
  const[hovPt2,setHovPt2]=useState(null);
  const[showMethod,setShowMethod]=useState(false);
  const chartRef=useRef(null);
  if(!featured)return null;
  const cf=featured.sur,pos=cf>=0;
  const cfPlusYears=featured.cfPlus;
  const isCashPositive=cfPlusYears<=0;
  const fK2=n=>{const a=Math.abs(n),s=n<0?"-":"";return a>=1000000?s+"$"+(a/1000000).toFixed(1)+"M":a>=1000?s+"$"+Math.round(a/1000)+"k":s+"$"+Math.round(a)};

  return(<>
    {/* Header */}
    <div style={{marginBottom:28}}>
      <h1 style={{fontFamily:"'Fraunces',serif",fontSize:32,fontWeight:700,letterSpacing:"-0.02em",color:LT.text,margin:"0 0 6px"}}>Your ADU Investment Summary</h1>
      <p style={{fontSize:14,color:LT.body,margin:0,lineHeight:1.5}}>{sqft} sq ft {utype.toLowerCase()} · {fD(total)} project · {rate.toFixed(1)}% / {term}-year financing{cashDownAmt>0?" · "+fD(cashDownAmt)+" down":""}</p>
    </div>

    {/* YOUR MARKET — editable inline */}
    <div style={{...ltCard,padding:"18px 22px",marginBottom:20,borderLeft:"3px solid "+LT.info}}>
      <div style={{marginBottom:10}}>
        <span style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Your market</span>
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{flex:"1 1 220px",minWidth:200}}>
          <input type="text" value={customName} onChange={e=>setCustomName(e.target.value)} placeholder="Location" style={{width:"100%",background:LT.card,border:"1px solid "+LT.border,borderRadius:6,padding:"8px 12px",color:LT.text,fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor=LT.info} onBlur={e=>e.target.style.borderColor=LT.border}/>
        </div>
        <div style={{flex:"1 1 200px",minWidth:180}}>
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:LT.muted,pointerEvents:"none"}}>$</span>
            <input type="text" value={customRent||""} onChange={e=>setCustomRent(parseInt(e.target.value)||0)} placeholder="Rent estimate" style={{width:"100%",background:LT.card,border:"1px solid "+(hasCustom?LT.border:LT.warn+"80"),borderRadius:6,padding:"8px 12px 8px 24px",color:LT.text,fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor=LT.info} onBlur={e=>e.target.style.borderColor=hasCustom?LT.border:LT.warn+"80"}/>
            <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:LT.muted,pointerEvents:"none"}}>/mo</span>
          </div>
        </div>
      </div>
      <div style={{fontSize:11,color:LT.muted,marginTop:10,lineHeight:1.5,fontStyle:"italic"}}>Rents vary considerably even within the same city. Check Zillow, Apartments.com, or local listings for a {sqft} sq/ft unit comparable to what you're building. Your input scales automatically based on the ADU size set in the Internal view.</div>
    </div>

    {/* DOWN PAYMENT SLIDER — consumer-facing, syncs with internal */}
    <div style={{...ltCard,padding:"18px 22px",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
        <span style={{fontSize:12,color:LT.body}}>How much do you want to put down?</span>
        <span style={{fontFamily:"'Fraunces',serif",fontSize:18,fontWeight:600,color:LT.text}}>{cashDown===0?"$0 down":cashDown===100?"All cash ("+fD(total)+")":fD(cashDownAmt)+" ("+cashDown+"%)"}</span>
      </div>
      <input type="range" min={0} max={100} step={5} value={cashDown} onChange={e=>setCashDown(parseFloat(e.target.value))} style={{width:"100%",accentColor:LT.info,height:6,cursor:"pointer",margin:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
        <span style={{fontSize:10,color:LT.muted}}>$0 down</span>
        <span style={{fontSize:10,color:LT.muted}}>All cash</span>
      </div>
      <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}} className="no-print">
        {[{v:0,l:"$0 down"},{v:20,l:"20%"},{v:50,l:"50%"},{v:100,l:"All cash"}].map(p=>(
          <button key={p.v} onClick={()=>setCashDown(p.v)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,fontWeight:cashDown===p.v?600:500,cursor:"pointer",userSelect:"none",border:"1px solid "+(cashDown===p.v?LT.info:LT.border),background:cashDown===p.v?LT.info:LT.card,color:cashDown===p.v?LT.card:LT.body,transition:"all 0.15s",fontFamily:"inherit"}}>{p.l}</button>
        ))}
      </div>
      <div style={{fontSize:11,color:LT.muted,marginTop:10,lineHeight:1.5}}>
        {cashDown===0?"100% financed at "+rate.toFixed(1)+"%. Monthly payment: "+fD(loanPmt)+". No cash out of pocket.":cashDown===100?"No loan needed — you own the ADU outright from day one. All returns are pure cash flow.":fD(cashDownAmt)+" cash + "+fD(loanAmt)+" financed at "+rate.toFixed(1)+"%. Monthly payment: "+fD(loanPmt)+"."}
      </div>
    </div>

    {/* LOAN TERM SLIDER — consumer-facing, syncs with internal */}
    <div style={{...ltCard,padding:"18px 22px",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
        <span style={{fontSize:12,color:LT.body}}>How long is your loan?</span>
        <span style={{fontFamily:"'Fraunces',serif",fontSize:18,fontWeight:600,color:LT.text}}>{term}-year loan</span>
      </div>
      <input type="range" min={5} max={20} step={1} value={term} onChange={e=>setTerm(parseInt(e.target.value))} style={{width:"100%",accentColor:LT.info,height:6,cursor:"pointer",margin:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
        <span style={{fontSize:10,color:LT.muted}}>5 years</span>
        <span style={{fontSize:10,color:LT.muted}}>20 years</span>
      </div>
      <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}} className="no-print">
        {[{v:5,l:"5 yr"},{v:10,l:"10 yr"},{v:15,l:"15 yr"},{v:20,l:"20 yr"}].map(p=>(
          <button key={p.v} onClick={()=>setTerm(p.v)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,fontWeight:term===p.v?600:500,cursor:"pointer",userSelect:"none",border:"1px solid "+(term===p.v?LT.info:LT.border),background:term===p.v?LT.info:LT.card,color:term===p.v?LT.card:LT.body,transition:"all 0.15s",fontFamily:"inherit"}}>{p.l}</button>
        ))}
      </div>
      <div style={{fontSize:11,color:LT.muted,marginTop:10,lineHeight:1.5}}>
        {term<=10?"Shorter loan = higher monthly payments but less interest paid overall. Monthly payment: "+fD(loanPmt)+".":"Longer loan = lower monthly payments ("+fD(loanPmt)+") but more interest paid over time."}
      </div>
    </div>

    {!hasCustom&&(
      <div style={{...ltCard,padding:"48px 30px",textAlign:"center",marginBottom:20,background:LT.borderLight}}>
        <div style={{fontSize:36,marginBottom:12}}>↑</div>
        <div style={{fontSize:17,fontWeight:600,color:LT.text,marginBottom:8}}>Enter your local rent above to see the analysis</div>
        <div style={{fontSize:13,color:LT.body,lineHeight:1.6,maxWidth:420,margin:"0 auto"}}>The full breakdown — monthly cash flow, equity buildup, payback period, and stress tests — appears once you provide a rent estimate for your specific area. Even a rough number works; you can refine it later.</div>
      </div>
    )}

    {hasCustom&&(<>
    {/* HERO outcome card */}
    <div style={{...ltCard,padding:"28px 30px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:14}}>Estimated total return in {featured.metro}</div>
      <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        {[{yrs:10,ret:cm.ret10,roi:cm.roi10},{yrs:15,ret:cm.ret15,roi:cm.roi15},{yrs:20,ret:cm.ret20,roi:cm.roi20}].map(h=>(
          <div key={h.yrs} style={{flex:"1 1 0",minWidth:90,textAlign:"center",padding:"16px 10px",borderRadius:10,background:h.ret>=0?LT.posBg:LT.warnBg,border:"1px solid "+(h.ret>=0?"rgba(34,197,94,0.2)":"rgba(251,191,36,0.2)")}}>
            <div style={{fontSize:10,color:LT.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600}}>{h.yrs} years</div>
            <div style={{fontFamily:"'Fraunces',serif",fontSize:26,fontWeight:700,color:h.ret>=0?LT.pos:LT.neg,lineHeight:1,marginBottom:4}}>{h.ret>=0?"+":""}{fK2(h.ret)}</div>
            <div style={{fontSize:11,color:LT.body}}>{h.roi>=0?"+":""}{h.roi.toFixed(1)}%/yr</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:13,color:LT.body,lineHeight:1.6,textAlign:"center"}}>
        Cumulative after-tax cash flow plus estimated ADU value{growth>0?", with "+growth+"%/yr rent growth":""}.{loanAmt>0?" Loan term: "+term+" years.":""}
      </div>
    </div>

    {/* MONTHLY BREAKDOWN — year-by-year slider */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
        <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>Monthly breakdown</div>
        <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:LT.text}}>Year {barYear}{barYear>term?" (post-loan)":""}</span>
      </div>
      <div style={{marginBottom:14}}>
        <input type="range" min={1} max={term+3} step={1} value={barYear} onChange={e=>setBarYear(parseInt(e.target.value))} style={{width:"100%",accentColor:LT.info,height:5,cursor:"pointer",margin:0}}/>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:LT.muted,marginTop:4}}>
          <span>Year 1</span>
          <span>Year {term} (loan ends)</span>
          <span>Year {term+3}</span>
        </div>
      </div>
      {(()=>{
        const b=cm.yearlyBars[Math.min(barYear-1,cm.yearlyBars.length-1)];
        if(!b)return null;
        const totalExp=b.opEx+b.propTax+b.ins;
        const maxBar=Math.max(b.rent, b.pmt, totalExp, 1);
        const netMo=b.rent-totalExp-b.incomeTax-b.pmt;
        const netPos=netMo>=0;
        const taxActive=incomeTax>0;
        return(<>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
              <span style={{fontSize:12,color:LT.body}}>Expected rent</span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:LT.pos}}>{fD(b.rent)}/mo</span>
            </div>
            <div style={{width:"100%",height:26,background:LT.borderLight,borderRadius:6,overflow:"hidden"}}>
              <div style={{height:"100%",background:LT.pos,borderRadius:6,width:`${(b.rent/maxBar)*100}%`,transition:"width 0.3s"}}/>
            </div>
          </div>
          {loanAmt>0&&<div style={{opacity:b.pmt>0?1:0.35}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
              <span style={{fontSize:12,color:b.pmt>0?LT.body:LT.muted}}>{b.pmt>0?"Loan payment ":"Loan payment (paid off)"}{b.pmt>0&&<span style={{fontSize:10,color:LT.muted}}>(interest vs. principal split)</span>}</span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:b.pmt>0?LT.text:LT.pos}}>{b.pmt>0?"−"+fD(b.pmt)+"/mo":"$0 — paid off!"}</span>
            </div>
            {b.pmt>0?(<>
              <div style={{width:"100%",height:26,background:LT.borderLight,borderRadius:6,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${(b.pmt/maxBar)*100}%`,display:"flex"}}>
                  <div title={"Interest: "+fD(b.interest)+"/mo"} style={{height:"100%",background:LT.neg,width:`${(b.interest/b.pmt)*100}%`,transition:"width 0.3s",opacity:0.75}}/>
                  <div title={"Principal: "+fD(b.principal)+"/mo"} style={{height:"100%",background:"#cbd5e1",width:`${(b.principal/b.pmt)*100}%`,transition:"width 0.3s"}}/>
                </div>
              </div>
              <div style={{display:"flex",gap:14,marginTop:5,fontSize:10.5,color:LT.muted}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{display:"inline-block",width:10,height:10,background:LT.neg,opacity:0.75,borderRadius:2}}/>Interest <strong style={{color:LT.neg,fontFamily:"'Fraunces',serif"}}>{fD(b.interest)}</strong> <span style={{color:LT.mutedLight,fontStyle:"italic"}}>— cost of borrowing</span></span>
                <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{display:"inline-block",width:10,height:10,background:"#cbd5e1",borderRadius:2}}/>Principal <strong style={{color:LT.text,fontFamily:"'Fraunces',serif"}}>{fD(b.principal)}</strong> <span style={{color:LT.mutedLight,fontStyle:"italic"}}>— builds equity</span></span>
              </div>
            </>):(
              <div style={{width:"100%",height:26,background:LT.borderLight,borderRadius:6,overflow:"hidden"}}>
                <div style={{height:"100%",background:LT.pos,borderRadius:6,width:"0%",transition:"width 0.3s"}}/>
              </div>
            )}
          </div>}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
              <span style={{fontSize:12,color:LT.body}}>Operating expenses <span style={{fontSize:10,color:LT.muted}}>(property tax, insurance, vacancy, maintenance)</span></span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:LT.warn}}>−{fD(totalExp)}/mo</span>
            </div>
            <div style={{width:"100%",height:26,background:LT.borderLight,borderRadius:6,overflow:"hidden"}}>
              <div style={{height:"100%",background:LT.warn,borderRadius:6,width:`${(totalExp/maxBar)*100}%`,transition:"width 0.3s",opacity:0.8}}/>
            </div>
          </div>
          <div style={{opacity:taxActive?1:0.35}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
              <span style={{fontSize:12,color:taxActive?LT.body:LT.muted}}>Income tax <span style={{fontSize:10,color:LT.muted}}>{taxActive?"("+incomeTax+"% marginal rate)":"(not modeled — set rate in Internal view)"}</span></span>
              <span style={{fontFamily:"'Fraunces',serif",fontSize:16,fontWeight:600,color:taxActive?LT.neg:LT.muted}}>{taxActive?"−"+fD(b.incomeTax)+"/mo":"$0"}</span>
            </div>
            <div style={{width:"100%",height:26,background:LT.borderLight,borderRadius:6,overflow:"hidden"}}>
              <div style={{height:"100%",background:taxActive?"#ef4444":"#cbd5e1",borderRadius:6,width:taxActive?`${(b.incomeTax/maxBar)*100}%`:"0%",transition:"width 0.3s",opacity:0.7}}/>
            </div>
          </div>
        </div>
        <div style={{marginTop:12,padding:"10px 14px",borderRadius:8,background:netPos?LT.posBg:LT.warnBg,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <span style={{fontFamily:"'Fraunces',serif",fontSize:20,fontWeight:700,color:netPos?LT.pos:LT.warn}}>{netPos?"+":""}{fD(netMo)}/mo</span>
            <span style={{fontSize:13,color:LT.body,marginLeft:10}}>{netPos?"Net income":"Net subsidy"} in year {barYear}</span>
          </div>
          <div style={{fontSize:11,color:LT.muted,textAlign:"right",lineHeight:1.4,maxWidth:260}}>{loanAmt===0?"No loan — all net rent is yours from day one.":barYear>term?"Loan paid off — all net rent is yours.":!netPos&&growth>0?"Rent grows "+growth+"%/yr while the payment stays fixed.":netPos?"The ADU is cash-flow positive.":""}</div>
        </div>
        </>);
      })()}
    </div>

        {/* 4-column summary */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:20}}>
      <div style={{...ltCard,padding:"16px 16px"}}>
        <div style={{fontSize:9.5,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:8,lineHeight:1.3}}>Year-1 Cash Flow</div>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:23,fontWeight:700,color:pos?LT.pos:LT.warn,lineHeight:1,marginBottom:6}}>{cf>=0?"+":""}{fD(cf)}<span style={{fontSize:11,color:LT.muted,fontWeight:400}}>/mo</span></div>
        <div style={{fontSize:11,color:LT.body,lineHeight:1.45}}>{fD(featured.rent)} rent − expenses − {fD(loanPmt)} loan</div>
      </div>
      <div style={{...ltCard,padding:"16px 16px"}}>
        <div style={{fontSize:9.5,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:8,lineHeight:1.3}}>Years to Cash Positive</div>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:23,fontWeight:700,color:featured.cfAtTerm?LT.warn:LT.pos,lineHeight:1,marginBottom:6}}>{isCashPositive?"Day one":featured.cfAtTerm?term+"+":cfPlusYears.toFixed(1)+" yr"}</div>
        <div style={{fontSize:11,color:LT.body,lineHeight:1.45}}>{isCashPositive?"Rent covers loan from month 1":featured.cfAtTerm?"Loan paid off at year "+term:"When growing rent overtakes loan payment"}</div>
      </div>
      <div style={{...ltCard,padding:"16px 16px"}}>
        <div style={{fontSize:9.5,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:8,lineHeight:1.3}}>Payback Period</div>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:23,fontWeight:700,color:featured.po<=term?LT.pos:featured.po<=term*1.5?LT.warn:LT.neg,lineHeight:1,marginBottom:6}}>{featured.po===Infinity?"Never":featured.po>50?"50+ yr":featured.po.toFixed(1)+" yr"}</div>
        <div style={{fontSize:11,color:LT.body,lineHeight:1.45}}>Years until cumulative net rent equals project cost</div>
      </div>
      <div style={{...ltCard,padding:"16px 16px"}}>
        <div style={{fontSize:9.5,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginBottom:8,lineHeight:1.3}}>Year-{term} Income</div>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:23,fontWeight:700,color:LT.pos,lineHeight:1,marginBottom:6}}>{fD(cm.yr10Net)}<span style={{fontSize:11,color:LT.muted,fontWeight:400}}>/mo</span></div>
        <div style={{fontSize:11,color:LT.body,lineHeight:1.45}}>Net rent with loan paid, rent grown to {fD(cm.yr10Rent)}/mo</div>
      </div>
    </div>

    {/* PROPERTY VALUE — instant equity */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:14}}>Impact on your property value</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:16}}>
        <div style={{textAlign:"center",padding:"14px 10px",borderRadius:10,background:LT.borderLight}}>
          <div style={{fontSize:10,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:500,marginBottom:6}}>You invest</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,color:LT.text}}>{fD(total)}</div>
        </div>
        <div style={{textAlign:"center",padding:"14px 10px",borderRadius:10,background:LT.borderLight}}>
          <div style={{fontSize:10,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:500,marginBottom:6}}>Day-1 value added</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,color:cm.instantEquity>=0?LT.pos:LT.warn}}>{fD(cm.yr1Value)}</div>
          <div style={{fontSize:11,color:cm.instantEquity>=0?LT.pos:LT.warn,fontWeight:600,marginTop:2}}>{cm.valueRatio>=1?(cm.valueRatio.toFixed(1)+"× your cost"):fD(cm.instantEquity)}</div>
        </div>
        <div style={{textAlign:"center",padding:"14px 10px",borderRadius:10,background:cm.yr10Asset>total?LT.posBg:LT.warnBg}}>
          <div style={{fontSize:10,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.05em",fontWeight:500,marginBottom:6}}>Year-{term} value</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,color:LT.pos}}>{fK2(cm.yr10Asset)}</div>
          <div style={{fontSize:11,color:LT.pos,fontWeight:600,marginTop:2}}>{(cm.yr10Asset/total).toFixed(1)}× your cost</div>
        </div>
      </div>
      <div style={{fontSize:12,color:LT.body,lineHeight:1.6}}>
        {cm.instantEquity>=0?"You create immediate equity: the ADU adds an estimated "+fD(cm.yr1Value)+" to your property value on day one — "+fD(cm.instantEquity)+" more than what you paid.":"The ADU initially appraises below its cost — common with high site work or premium finishes. "}
        {growth>0?" As rents grow "+growth+"%/yr, that value climbs to an estimated "+fK2(cm.yr10Asset)+" by year "+term+".":""}
      </div>
      <div style={{fontSize:10,color:LT.muted,marginTop:8,fontStyle:"italic"}}>Value estimates use a gross rent multiplier (110× monthly LTR rent). Actual appraisals use comparable sales and may differ. Coastal markets often see higher multipliers (200–300×), meaning these estimates may be conservative.</div>
    </div>

    {/* CASH FLOW TIMELINE — SVG area chart */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:14}}>Cumulative cash flow over time</div>
      {(()=>{
        const pts=cm.cfTimeline;
        const W=820,H=220,PL=60,PR=20,PT=20,PB=36;
        const cW=W-PL-PR,cH=H-PT-PB;
        const minY=Math.min(0,...pts.map(p=>p.cum)),maxY=Math.max(0,...pts.map(p=>p.cum));
        const rangeY=maxY-minY||1;
        const xC=p=>PL+(p.year/pts[pts.length-1].year)*cW;
        const yC=p=>PT+cH-(((p.cum-minY)/rangeY)*cH);
        const zeroY=PT+cH-((0-minY)/rangeY)*cH;
        const pathD=pts.map((p,i)=>(i===0?"M":"L")+xC(p).toFixed(1)+","+yC(p).toFixed(1)).join(" ");
        const areaD=pathD+" L"+xC(pts[pts.length-1]).toFixed(1)+","+zeroY.toFixed(1)+" L"+xC(pts[0]).toFixed(1)+","+zeroY.toFixed(1)+" Z";
        let cross=null;
        for(let i=1;i<pts.length;i++){if(pts[i-1].cum<0&&pts[i].cum>=0){const r=-pts[i-1].cum/(pts[i].cum-pts[i-1].cum);cross={year:pts[i-1].year+r*(pts[i].year-pts[i-1].year),x:0,y:zeroY};cross.x=PL+(cross.year/pts[pts.length-1].year)*cW;break;}}
        const yLabels=[];
        const step=rangeY<50000?10000:rangeY<200000?50000:100000;
        for(let v=Math.ceil(minY/step)*step;v<=maxY;v+=step)yLabels.push(v);
        return(
          <div ref={chartRef} style={{position:"relative"}} onMouseLeave={()=>setHovPt(null)}>
            <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",maxHeight:240,display:"block"}}>
              <defs>
                <linearGradient id="cfGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity="0.25"/>
                  <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02"/>
                </linearGradient>
                <linearGradient id="cfGradNeg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d97706" stopOpacity="0.02"/>
                  <stop offset="100%" stopColor="#d97706" stopOpacity="0.2"/>
                </linearGradient>
              </defs>
              {yLabels.map((v,i)=>{const yy=PT+cH-((v-minY)/rangeY)*cH;return(<g key={i}><line x1={PL} y1={yy} x2={W-PR} y2={yy} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray={v===0?"":"3,3"}/><text x={PL-8} y={yy+3.5} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="'DM Sans',sans-serif">{v>=0?"+":""}{Math.abs(v)>=1000?"$"+(v/1000)+"k":"$"+v}</text></g>)})}
              <line x1={PL} y1={zeroY} x2={W-PR} y2={zeroY} stroke="#64748b" strokeWidth="1"/>
              <clipPath id="aboveZero"><rect x={PL} y={PT} width={cW} height={zeroY-PT}/></clipPath>
              <clipPath id="belowZero"><rect x={PL} y={zeroY} width={cW} height={H-zeroY}/></clipPath>
              <path d={areaD} fill="url(#cfGrad)" clipPath="url(#aboveZero)"/>
              <path d={areaD} fill="url(#cfGradNeg)" clipPath="url(#belowZero)"/>
              <path d={pathD} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinejoin="round"/>
              {loanAmt>0&&(()=>{const tx=PL+(term/pts[pts.length-1].year)*cW;return(<><line x1={tx} y1={PT} x2={tx} y2={H-PB} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4,3"/><text x={tx} y={PT-6} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="'DM Sans',sans-serif">Loan paid off</text></>)})()}
              {cross&&<><circle cx={cross.x} cy={cross.y} r="5" fill="#16a34a" stroke="#fff" strokeWidth="2"/><text x={cross.x} y={cross.y-12} textAnchor="middle" fontSize="10" fill="#16a34a" fontWeight="600" fontFamily="'DM Sans',sans-serif">Payback yr {cross.year.toFixed(1)}</text></>}
              {pts.filter(p=>p.year%2===0).map((p,i)=><text key={i} x={xC(p)} y={H-PB+12} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="'DM Sans',sans-serif">{"Yr "+p.year}</text>)}
              {pts.map((p,i)=><circle key={i} cx={xC(p)} cy={yC(p)} r={hovPt===i?7:4.5} fill={p.cum>=0?"#16a34a":"#d97706"} stroke="#fff" strokeWidth={hovPt===i?2.5:1.5} style={{cursor:"pointer",transition:"r 0.1s"}} onMouseEnter={()=>setHovPt(i)} onMouseLeave={()=>setHovPt(null)}/>)}
            </svg>
            {hovPt!==null&&pts[hovPt]&&(()=>{
              const p=pts[hovPt];
              const pctX=(xC(p)/W)*100;
              const pctY=(yC(p)/H)*100;
              return(<div style={{position:"absolute",left:pctX+"%",top:pctY+"%",transform:"translate(-50%, -120%)",background:"#0f172a",color:"#fff",padding:"6px 10px",borderRadius:6,fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",pointerEvents:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.15)",zIndex:10}}>
                <div style={{fontSize:10,color:"#94a3b8",fontWeight:500}}>Year {p.year}</div>
                <div style={{fontFamily:"'Fraunces',serif",fontSize:15,color:p.cum>=0?"#4ade80":"#fbbf24"}}>{p.cum>=0?"+":""}{fD(p.cum)}</div>
                <div style={{position:"absolute",bottom:-4,left:"50%",marginLeft:-4,width:8,height:8,background:"#0f172a",transform:"rotate(45deg)"}}/>
              </div>);
            })()}
          </div>
        );
      })()}
      <div style={{fontSize:11,color:LT.body,lineHeight:1.5,marginTop:8}}>
        The amber zone shows cumulative subsidies while rent is below the loan payment. {cm.cfTimeline[cm.cfTimeline.length-1].cum>0?"The green zone shows when cumulative income exceeds costs — and it keeps growing after the loan is paid off.":"Over time, rent growth narrows the gap and eventually pushes you into positive territory."}
      </div>
    </div>

    {/* NET EQUITY POSITION — asset value minus loan plus accumulated cash */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:4}}>Net equity position over time</div>
      <div style={{fontSize:12,color:LT.body,marginBottom:14}}>Total wealth created by the ADU at any point — asset value <strong style={{color:LT.info}}>minus</strong> remaining loan balance <strong style={{color:LT.info}}>plus</strong> net cash collected. After the loan is paid off, the payment becomes pure income and growth accelerates.</div>
      {(()=>{
        const pts=cm.cfTimeline;
        const W=820,H=250,PL=60,PR=20,PT=20,PB=36;
        const cW=W-PL-PR,cH=H-PT-PB;
        const allVals=[...pts.map(p=>p.tot),...pts.map(p=>p.cum),...pts.map(p=>p.eq),...pts.map(p=>-p.loan),0];
        const minY2=Math.min(...allVals),maxY2=Math.max(...allVals);
        const rangeY2=maxY2-minY2||1;
        const xC2=p=>PL+(p.year/pts[pts.length-1].year)*cW;
        const yC2=(v)=>PT+cH-(((v-minY2)/rangeY2)*cH);
        const zeroY2=yC2(0);
        // Total return line
        const totD=pts.map((p,i)=>(i===0?"M":"L")+xC2(p).toFixed(1)+","+yC2(p.tot).toFixed(1)).join(" ");
        // CF-only line (for comparison)
        const cfD=pts.map((p,i)=>(i===0?"M":"L")+xC2(p).toFixed(1)+","+yC2(p.cum).toFixed(1)).join(" ");
        // Equity-only line
        const eqD=pts.map((p,i)=>(i===0?"M":"L")+xC2(p).toFixed(1)+","+yC2(p.eq).toFixed(1)).join(" ");
        // Loan balance line (plotted as negative)
        const loanD=pts.map((p,i)=>(i===0?"M":"L")+xC2(p).toFixed(1)+","+yC2(-p.loan).toFixed(1)).join(" ");
        // Area fill under total return
        const totArea=totD+" L"+xC2(pts[pts.length-1]).toFixed(1)+","+yC2(0).toFixed(1)+" L"+xC2(pts[0]).toFixed(1)+","+yC2(0).toFixed(1)+" Z";
        // Y-axis labels
        const yLabels2=[];
        const step2=rangeY2<100000?25000:rangeY2<400000?50000:100000;
        for(let v=Math.ceil(minY2/step2)*step2;v<=maxY2;v+=step2)yLabels2.push(v);
        return(
          <div style={{position:"relative"}} onMouseLeave={()=>setHovPt2(null)}>
            <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",maxHeight:270,display:"block"}}>
              <defs>
                <linearGradient id="totGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2"/>
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02"/>
                </linearGradient>
              </defs>
              {/* Grid */}
              {yLabels2.map((v,i)=>{const yy=yC2(v);return(<g key={i}><line x1={PL} y1={yy} x2={W-PR} y2={yy} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray={v===0?"":"3,3"}/><text x={PL-8} y={yy+3.5} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="'DM Sans',sans-serif">{v>=0?"+":""}{Math.abs(v)>=1000?"$"+(v/1000)+"k":"$"+v}</text></g>)})}
              {/* Zero line */}
              {minY2<0&&<line x1={PL} y1={zeroY2} x2={W-PR} y2={zeroY2} stroke="#64748b" strokeWidth="1"/>}
              {/* Total return area fill */}
              <path d={totArea} fill="url(#totGrad)"/>
              {/* CF-only line — dashed, muted */}
              <path d={cfD} fill="none" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.5"/>
              {/* Equity-only line — dotted, muted */}
              <path d={eqD} fill="none" stroke="#d97706" strokeWidth="1.5" strokeDasharray="2,4" opacity="0.5"/>
              {/* Loan balance line — declining red */}
              <path d={loanD} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.45"/>
              {/* Total return line — solid blue */}
              <path d={totD} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round"/>
              {/* Loan term boundary */}
              {loanAmt>0&&(()=>{const tx2=PL+(term/pts[pts.length-1].year)*cW;return(<><line x1={tx2} y1={PT} x2={tx2} y2={H-PB} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4,3"/><text x={tx2} y={PT-6} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="'DM Sans',sans-serif">Loan paid off</text></>)})()}
              {/* X-axis year labels */}
              {pts.filter(p=>p.year%2===0).map((p,i)=><text key={i} x={xC2(p)} y={H-PB+12} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="'DM Sans',sans-serif">{"Yr "+p.year}</text>)}
              {/* Data point dots on total return line */}
              {pts.map((p,i)=><circle key={i} cx={xC2(p)} cy={yC2(p.tot)} r={hovPt2===i?7:4.5} fill="#2563eb" stroke="#fff" strokeWidth={hovPt2===i?2.5:1.5} style={{cursor:"pointer"}} onMouseEnter={()=>setHovPt2(i)} onMouseLeave={()=>setHovPt2(null)}/>)}
            </svg>
            {hovPt2!==null&&pts[hovPt2]&&(()=>{
              const p=pts[hovPt2];
              const pctX=(xC2(p)/W)*100;
              const pctY=(yC2(p.tot)/H)*100;
              return(<div style={{position:"absolute",left:pctX+"%",top:pctY+"%",transform:"translate(-50%, -130%)",background:"#0f172a",color:"#fff",padding:"8px 12px",borderRadius:8,fontSize:12,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",pointerEvents:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.15)",zIndex:10,minWidth:155}}>
                <div style={{fontSize:10,color:"#94a3b8",fontWeight:500,marginBottom:4}}>Year {p.year}</div>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}>
                  <span style={{color:"#94a3b8",fontSize:11}}>ADU value</span>
                  <span style={{fontFamily:"'Fraunces',serif",fontSize:13,fontWeight:600,color:"#fbbf24"}}>{fD(p.eq)}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}>
                  <span style={{color:"#94a3b8",fontSize:11}}>Loan balance</span>
                  <span style={{fontFamily:"'Fraunces',serif",fontSize:13,fontWeight:600,color:p.loan>0?"#f87171":"#4ade80"}}>{p.loan>0?"-"+fD(p.loan):"$0"}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}>
                  <span style={{color:"#94a3b8",fontSize:11}}>Cash flow</span>
                  <span style={{fontFamily:"'Fraunces',serif",fontSize:13,fontWeight:600,color:p.cum>=0?"#4ade80":"#fbbf24"}}>{p.cum>=0?"+":""}{fD(p.cum)}</span>
                </div>
                {cashDownAmt>0&&<div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}>
                  <span style={{color:"#94a3b8",fontSize:11}}>Cash invested</span>
                  <span style={{fontFamily:"'Fraunces',serif",fontSize:13,fontWeight:600,color:"#f87171"}}>−{fD(cashDownAmt)}</span>
                </div>}
                <div style={{borderTop:"1px solid #334155",paddingTop:3,marginTop:2,display:"flex",justifyContent:"space-between",gap:12}}>
                  <span style={{color:"#e2e8f0",fontSize:11,fontWeight:600}}>Net equity</span>
                  <span style={{fontFamily:"'Fraunces',serif",fontSize:14,fontWeight:700,color:"#60a5fa"}}>{p.tot>=0?"+":""}{fD(p.tot)}</span>
                </div>
                <div style={{position:"absolute",bottom:-4,left:"50%",marginLeft:-4,width:8,height:8,background:"#0f172a",transform:"rotate(45deg)"}}/>
              </div>);
            })()}
          </div>
        );
      })()}
      <div style={{display:"flex",gap:16,marginTop:10,fontSize:11,color:LT.muted,flexWrap:"wrap"}}>
        <span><span style={{display:"inline-block",width:20,height:3,background:"#2563eb",borderRadius:2,verticalAlign:"middle",marginRight:5}}/>Net equity</span>
        <span><span style={{display:"inline-block",width:20,height:0,borderTop:"2px dotted #d97706",verticalAlign:"middle",marginRight:5,opacity:0.5}}/>ADU value</span>
        <span><span style={{display:"inline-block",width:20,height:0,borderTop:"2px dashed #ef4444",verticalAlign:"middle",marginRight:5,opacity:0.45}}/>Loan balance</span>
        <span><span style={{display:"inline-block",width:20,height:0,borderTop:"2px dashed #16a34a",verticalAlign:"middle",marginRight:5,opacity:0.5}}/>Cum. cash flow</span>
      </div>
    </div>

    {/* LIFE AFTER THE LOAN */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20,background:"linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",border:"1px solid #bbf7d0"}}>
      <div style={{fontSize:11,color:LT.pos,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:10}}>Life after the loan — year {term+1} onward</div>
      <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap",marginBottom:10}}>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:38,fontWeight:700,color:LT.pos,lineHeight:1}}>{fD(cm.postLoanMonthly)}/mo</div>
        <div style={{fontSize:15,color:"#166534"}}>= <strong>{fD(cm.postLoanAnnual)}/yr</strong> in passive income</div>
      </div>
      <div style={{fontSize:13,color:"#166534",lineHeight:1.6}}>
        Starting year {term+1}, your ADU generates approximately {fD(cm.postLoanMonthly)}/mo with no loan payment. That's net of property tax, insurance, maintenance, and vacancy — pure cash flow, growing with rent each year. This continues for as long as you own the property.
      </div>
    </div>

    {/* WHAT YOU KEEP */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:14}}>What you keep after {term} years</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
        <div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:14}}>
            <div style={{fontSize:11,color:LT.muted,minWidth:14,marginTop:2}}>✓</div>
            <div><div style={{fontSize:14,fontWeight:600,color:LT.text}}>A fully-paid ADU asset</div><div style={{fontSize:12,color:LT.body,lineHeight:1.5}}>Estimated value: <strong style={{color:LT.text}}>{fD(cm.yr10Asset)}</strong> (rent-multiplier method)</div></div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:14}}>
            <div style={{fontSize:11,color:LT.muted,minWidth:14,marginTop:2}}>✓</div>
            <div><div style={{fontSize:14,fontWeight:600,color:LT.text}}>Ongoing rental income</div><div style={{fontSize:12,color:LT.body,lineHeight:1.5}}>About <strong style={{color:LT.text}}>{fD(cm.yr10Net)}/mo</strong> net, with no mortgage payment</div></div>
          </div>
        </div>
        <div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:14}}>
            <div style={{fontSize:11,color:LT.muted,minWidth:14,marginTop:2}}>✓</div>
            <div><div style={{fontSize:14,fontWeight:600,color:LT.text}}>Cumulative cash flow</div><div style={{fontSize:12,color:LT.body,lineHeight:1.5}}>Approximately <strong style={{color:cm.cashCollected>=0?LT.pos:LT.warn}}>{cm.cashCollected>=0?"+":""}{fK2(cm.cashCollected)}</strong> {cm.cashCollected>=0?"collected":"in net subsidies"} over the loan term</div></div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:14}}>
            <div style={{fontSize:11,color:LT.muted,minWidth:14,marginTop:2}}>✓</div>
            <div><div style={{fontSize:14,fontWeight:600,color:LT.text}}>Multigenerational flexibility</div><div style={{fontSize:12,color:LT.body,lineHeight:1.5}}>You can house family, age in place, or change use without selling</div></div>
          </div>
        </div>
      </div>
    </div>

    {/* TOTAL ECONOMICS SUMMARY */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:14}}>The full picture after {term} years</div>
      <div style={{display:"flex",flexDirection:"column",gap:0}}>
        {[
          {label:"Cash you invested"+(cashDownAmt>0?" ("+Math.round(cashDownAmt/total*100)+"% down)":""),value:cashDownAmt>0?-cashDownAmt:0,sub:cashDownAmt===0?"100% financed — no cash out of pocket":"The rest is financed at "+rate.toFixed(1)+"%",color:LT.text,icon:"↓"},
          {label:"Cumulative net cash flow",value:cm.cashCollected,sub:cm.cashCollected>=0?"You collected more in rent than you paid on the loan":(cm.totalSubsidies>0?"You subsidized "+fD(cm.totalSubsidies)+" during negative months":"Monthly subsidies before rent caught up"),color:cm.cashCollected>=0?LT.pos:LT.warn,icon:cm.cashCollected>=0?"+":"−"},
          {label:"Property value created",value:featured.eq,sub:"Estimated ADU contribution to home value ("+fD(cm.yr1Value)+" day-1, growing to "+fK2(cm.yr10Asset)+" by year "+term+")",color:LT.pos,icon:"+"},
          {label:"Total return",value:featured.ret,sub:featured.roi.toFixed(1)+"%/yr annualized — and the ADU keeps generating "+fD(cm.postLoanMonthly)+"/mo after the loan",color:featured.ret>=0?LT.pos:LT.neg,icon:"=",bold:true},
        ].map((item,i)=>(<div key={i} style={{display:"flex",alignItems:"flex-start",padding:item.bold?"14px 16px":"11px 16px",borderBottom:i<3?"1px solid "+LT.borderLight:"none",background:item.bold?(featured.ret>=0?LT.posBg:LT.negBg):"transparent",borderRadius:item.bold?8:0}}>
          <span style={{fontSize:item.bold?16:14,color:LT.muted,width:22,textAlign:"center",fontWeight:600,marginTop:2}}>{item.icon}</span>
          <div style={{flex:1,marginLeft:8}}>
            <div style={{fontSize:item.bold?15:13,color:item.bold?LT.text:LT.body,fontWeight:item.bold?600:500}}>{item.label}</div>
            <div style={{fontSize:11,color:LT.muted,marginTop:2,lineHeight:1.4}}>{item.sub}</div>
          </div>
          <span style={{fontFamily:"'Fraunces',serif",fontSize:item.bold?24:17,fontWeight:700,color:item.color,marginLeft:12,whiteSpace:"nowrap"}}>{item.value===0?"$0":(item.value>=0?"+":"")+fK2(item.value)}</span>
        </div>))}
      </div>
    </div>

    {/* STRESS TESTS — featured metro, time-based outcomes */}
    <div style={{...ltCard,padding:"22px 26px",marginBottom:20}}>
      <div style={{fontSize:11,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:6}}>Stress tests for {featured.metro}</div>
      <div style={{fontSize:12,color:LT.body,marginBottom:14}}>How adverse conditions would shift your time-to-positivity and payback in this market:</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
        <thead>
          <tr style={{borderBottom:"1px solid "+LT.border}}>
            <th style={{textAlign:"left",padding:"8px 4px",fontSize:10,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Scenario</th>
            <th style={{textAlign:"right",padding:"8px 4px",fontSize:10,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Years to cash positive</th>
            <th style={{textAlign:"right",padding:"8px 4px",fontSize:10,color:LT.muted,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>Payback period</th>
          </tr>
        </thead>
        <tbody>
          {cm.featuredStress.map((t,i)=>{const cfCol=t.cfPlus<=0?LT.pos:t.cfPlus<=3?LT.pos:t.cfPlus<=term?LT.warn:LT.neg;const poCol=t.po<=term?LT.pos:t.po<=term*1.5?LT.warn:LT.neg;const isBase=i===0;return(<tr key={i} style={{borderBottom:i<cm.featuredStress.length-1?"1px solid "+LT.borderLight:"none",background:isBase?LT.borderLight:"transparent"}}>
            <td style={{padding:"10px 4px",color:LT.text,fontWeight:isBase?600:500}}>{t.label}</td>
            <td style={{padding:"10px 4px",textAlign:"right",fontFamily:"'Fraunces',serif",fontWeight:600,color:cfCol}}>{t.cfPlus<=0?"Day one":t.cfAtTerm?term+"+ yr":t.cfPlus.toFixed(1)+" yr"}</td>
            <td style={{padding:"10px 4px",textAlign:"right",fontFamily:"'Fraunces',serif",fontWeight:600,color:poCol}}>{t.po===Infinity?"Never":t.po>50?"50+ yr":t.po.toFixed(1)+" yr"}</td>
          </tr>)})}
        </tbody>
      </table>
      <div style={{fontSize:11,color:LT.muted,marginTop:14,lineHeight:1.5,fontStyle:"italic"}}>"Years to cash positive" is when growing rent overtakes the loan payment. "Payback period" is when cumulative net rent equals the full project cost. Each stress holds other assumptions constant; rent shortfalls and cost overruns of 15–25% are the most common surprises in published ADU projects.</div>
    </div>
    </>)}

{/* FOOTER */}
    <div style={{marginTop:24,padding:"14px 18px",borderRadius:8,background:LT.borderLight,fontSize:11,color:LT.muted,lineHeight:1.6}}>
      Estimates are for illustration only. Actual costs, rents, and returns will vary based on site conditions, local market dynamics, financing terms, and many other factors. Property value estimates use a simplified gross rent multiplier and are not a formal appraisal. Investment decisions should be made in consultation with qualified professionals.
      <div style={{marginTop:8}} className="no-print">
        <button onClick={()=>setShowMethod(!showMethod)} style={{background:"transparent",border:"none",padding:0,color:LT.info,fontSize:11,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>{showMethod?"Hide methodology ▴":"How these numbers are calculated ▾"}</button>
      </div>
      {showMethod&&<div style={{marginTop:14,padding:"14px 16px",background:LT.card,border:"1px solid "+LT.border,borderRadius:8,fontSize:11,color:LT.body,lineHeight:1.65}}>
        <div style={{fontSize:11,color:LT.text,fontWeight:600,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>Methodology</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Rent estimates</strong> use 2025–2026 mid-range rents for a 1-bedroom ADU in each listed metro, scaled sub-linearly by unit size (a 2-bedroom rents for less than 2× a 1-bedroom). Custom entries use your own input. Short-term rental income is computed from a nightly rate × ~30.4 nights, scaled by metro relative to a national reference.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Construction costs</strong> are built up from line-item components (structure, foundation, site work, permits, fees, design, surveys) at 2026 mid-range defaults, plus a builder/GC margin. Garage conversions, prefab units, and high-cost markets are reflected via slider tick marks. Costs vary substantially by region and site conditions — adjust the sliders to match local builder quotes.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Property value</strong> uses a gross rent multiplier of 110× monthly rent — a heuristic widely cited by lenders and builders. Real appraisals use comparable sales as the primary method, and multipliers can vary substantially by market: low-cost regions trend toward 80–120×, while expensive coastal markets often run 200–300×. The 110× default is conservative for high-rent metros.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Operating expenses</strong> include property tax (with annual escalator), insurance (scaled to ADU replacement cost, with annual escalator), vacancy, maintenance reserve, and property management. Escalator defaults reflect recent 2020–2025 trends and vary by jurisdiction.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Income tax</strong> is modeled on US Schedule E: rental income minus loan interest, depreciation (27.5-year straight-line on the ADU cost basis), and operating expenses. Default rate is 0% (not modeled); the Internal view's marginal-tax slider applies your combined federal + state rate. Passive activity loss rules and depreciation recapture at sale are not modeled.</div>
        <div style={{marginBottom:8}}><strong style={{color:LT.text}}>Cash flow simulation</strong> runs monthly across the loan term plus three post-loan years, with rent growth, expense escalation, and tax effects all compounded month-by-month. Loan amortization uses the standard mortgage formula.</div>
        <div><strong style={{color:LT.text}}>Limitations.</strong> The model does not capture construction cost overruns, regulatory changes, mortgage refinancing, depreciation recapture at sale, transaction costs at exit, jurisdiction-specific fees or incentives, short-term rental restrictions, or interactions with existing zoning. Always consult a tax professional and your local building department before committing capital.</div>
      </div>}
    </div>
  </>);
}

export default function App(){
  const[state,setState]=useState(DEF);const[loaded,setLoaded]=useState(false);
  useEffect(()=>{(async()=>{try{const r=await storage.get(SK);if(r?.value)setState(p=>({...p,...JSON.parse(r.value)}))}catch(e){}setLoaded(true)})()},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await storage.set(SK,JSON.stringify(state))}catch(e){}})()},[state,loaded]);
  // Auto-feature the custom market whenever the user enters/updates custom info
  useEffect(()=>{if(state.customRent>0)setState(s=>({...s,featuredIdx:0}))},[state.customRent,state.customName]);
  const set=useCallback(k=>v=>setState(s=>({...s,[k]:v})),[]);
  const{sqft,cpsf,permits,hookup,foundation,sitePrep,utilTrench,electrical,hardscape,design,surveys,markup,rentalMode,strADR,strCosts,strVacancy,strMonths,furnishing,cashDown,origFeeOn,origFee,rate,term,buildMonths,taxRate,taxGrowth,insurance,insGrowth,maint,vacancy,mgmt,growth,incomeTax,customRent,customName,view,featuredIdx}=state;
  const isSTR=rentalMode==="str",isHybrid=rentalMode==="hybrid",isLTR=rentalMode==="ltr";
  const hasSTR=isSTR||isHybrid;
  const buildCost=sqft*cpsf,siteCost=foundation+sitePrep+utilTrench+electrical+hardscape,softCost=permits+hookup+design+surveys+furnishing;
  const subtotal=buildCost+siteCost+softCost,markupAmt=Math.round(subtotal*(markup/100));
  const assetCost=subtotal+markupAmt;
  const origFeeAmt=origFeeOn?Math.round(assetCost*(origFee/100)):0;
  const total=assetCost+origFeeAmt;
  const cashDownAmt=Math.round(total*(cashDown/100)),loanAmt=total-cashDownAmt;
  const scale=rs(sqft),utype=ut(sqft),loanPmt=cMP(loanAmt,rate/100,term);

  const strMult=isSTR?(strADR*30.4/1900):isHybrid?((strMonths*(strADR*30.4/1900)+(12-strMonths))/12):1;
  const bSC=isSTR?strCosts:isHybrid?strCosts*(strMonths/12):0;
  const bSV=isSTR?strVacancy:isHybrid?strVacancy*(strMonths/12):0;
  const bMg=isSTR?0:isHybrid?mgmt*((12-strMonths)/12):mgmt;
  const bVc=isSTR?0:isHybrid?vacancy*((12-strMonths)/12):vacancy;

  const refRent=Math.round(1900*scale*strMult);const refCollected=refRent*(1-(bVc+bSV)/100);const refOp=refCollected*((maint+bMg+bSC)/100);const refExp=(assetCost*(taxRate/100))/12+(assetCost*(insurance/100))/12+(refRent-refCollected)+refOp;
  const refExpPct=refRent>0?Math.round((refExp/refRent)*100):0;

  const allMetros=customRent>0?[{metro:customName||"Custom",br:customRent},...M]:M;
  const rows=useMemo(()=>{const pmt=cMP(loanAmt,rate/100,term),mPT=(assetCost*(taxRate/100))/12,mIns=(assetCost*(insurance/100))/12,s=rs(sqft),g=growth/100,tx=incomeTax/100,bm=buildMonths,tg=taxGrowth/100,ig=insGrowth/100;const sm=isSTR?(strADR*30.4/1900):isHybrid?((strMonths*(strADR*30.4/1900)+(12-strMonths))/12):1;const sc=isSTR?strCosts:isHybrid?strCosts*(strMonths/12):0;const sv=isSTR?strVacancy:isHybrid?strVacancy*(strMonths/12):0;const mg=isSTR?0:isHybrid?mgmt*((12-strMonths)/12):mgmt;const vc=isSTR?0:isHybrid?vacancy*((12-strMonths)/12):vacancy;return allMetros.map(m=>{const rent=Math.round(m.br*s*sm),ltrRent=Math.round(m.br*s),collected=rent*(1-(vc+sv)/100),opPct=(maint+mg+sc)/100,rentNetOp=collected*(1-opPct),net=rentNetOp-mPT-mIns,sur=net-pmt,pen=sur>=0,cov=pmt>0?((net/pmt)*100).toFixed(0):(net>0?"∞":"0");const{cfPlus,cfAtTerm,po,cum}=sim({loanAmt,annRate:rate/100,termYr:term,rentNetOpY1:rentNetOp,mPTY1:mPT,mInsY1:mIns,rentGrowth:g,taxGrowthA:tg,insGrowthA:ig,taxMarg:tx,depBasis:assetCost,buildMo:bm});const eq=ltrRent*110,ret=cum-cashDownAmt+eq,roi=total>0?((ret/total)/term*100):0;return{...m,rent,ltrRent,net,sur,pen,cov,po,cfPlus,cfAtTerm,eq,ret,roi,retOk:ret>0}})},[rate,term,total,assetCost,loanAmt,cashDownAmt,sqft,rentalMode,strADR,strCosts,strVacancy,strMonths,taxRate,taxGrowth,insurance,insGrowth,maint,vacancy,mgmt,growth,incomeTax,buildMonths,customRent,customName]);
  const cfP=rows.filter(r=>r.pen).length,totP=rows.filter(r=>r.retOk).length;

  // Sensitivity analysis
  const sens=useMemo(()=>{
    const pmt=cMP(loanAmt,rate/100,term);
    const mPT=(assetCost*(taxRate/100))/12;
    const mIns=(assetCost*(insurance/100))/12;
    const s=rs(sqft);
    const sm=isSTR?(strADR*30.4/1900):isHybrid?((strMonths*(strADR*30.4/1900)+(12-strMonths))/12):1;
    const sc=isSTR?strCosts:isHybrid?strCosts*(strMonths/12):0;
    const sv=isSTR?strVacancy:isHybrid?strVacancy*(strMonths/12):0;
    const mg=isSTR?0:isHybrid?mgmt*((12-strMonths)/12):mgmt;
    const vc=isSTR?0:isHybrid?vacancy*((12-strMonths)/12):vacancy;
    const vacPct=(vc+sv)/100;
    const opPct=(maint+mg+sc)/100;
    // Break-even gross rent (in table-displayed units, i.e. includes STR mult)
    const beRent=(pmt+mPT+mIns)/((1-vacPct)*(1-opPct));
    // Convert to LTR-equivalent and to nightly if STR/hybrid
    const beRentLTR=sm>0?beRent/sm:beRent;
    const beADR=beRent/30.4;
    // Helper: count metros where year-1 net >= pmt, given a rent multiplier, rate override, and cost override
    const stress=(rentMult,rateOver,costMult)=>{
      const aCost2=assetCost*costMult,total2=aCost2+origFeeAmt;
      const cashDown2=Math.round(total2*(cashDown/100)),loanAmt2=total2-cashDown2;
      const r2=rateOver!==null?rateOver:rate/100;
      const pmt2=cMP(loanAmt2,r2,term);
      const mPT2=(aCost2*(taxRate/100))/12,mIns2=(aCost2*(insurance/100))/12;
      let pass=0;
      allMetros.forEach(m=>{
        const rent=m.br*s*sm*rentMult;
        const collected=rent*(1-vacPct);
        const net=collected*(1-opPct)-mPT2-mIns2;
        if(net>=pmt2)pass++;
      });
      return pass;
    };
    const tests=[
      {label:"Base case",pass:stress(1,null,1),tone:tk},
      {label:"Rent comes in 10% below est.",pass:stress(0.9,null,1),tone:yl},
      {label:"Rent comes in 20% below est.",pass:stress(0.8,null,1),tone:rd},
      {label:"Interest rate +100 bp",pass:stress(1,(rate+1)/100,1),tone:yl},
      {label:"Interest rate +200 bp",pass:stress(1,(rate+2)/100,1),tone:rd},
      {label:"Construction costs +15% over budget",pass:stress(1,null,1.15),tone:yl},
      {label:"Construction costs +25% over budget",pass:stress(1,null,1.25),tone:rd},
    ];
    // Per-metro margin of safety = (rent - breakeven) / rent
    const margins=rows.map(r=>{
      const m=r.rent>0?((r.rent-beRent)/r.rent)*100:-100;
      return{metro:r.metro,margin:m,rent:r.rent};
    });
    return{beRent,beRentLTR,beADR,tests,margins,total:allMetros.length};
  },[loanAmt,rate,term,assetCost,taxRate,insurance,sqft,rentalMode,strADR,strCosts,strVacancy,strMonths,maint,vacancy,mgmt,cashDown,origFeeAmt,rows,allMetros,isSTR,isHybrid]);

  // Consumer-view metrics for the featured metro
  const cm=useMemo(()=>{
    const f=rows[Math.min(featuredIdx,Math.max(0,rows.length-1))];
    if(!f)return null;
    const g=growth/100;
    const yr10Rent=f.rent*Math.pow(1+g,term);
    const yr10Net=f.net*Math.pow(1+g,term);
    const yr10Asset=Math.round(f.ltrRent*Math.pow(1+g,term)*110);
    const cashCollected=f.ret-f.eq+cashDownAmt;
    const margin=sens.margins[Math.min(featuredIdx,Math.max(0,sens.margins.length-1))];

    // Featured-metro stress tests — focused on time outcomes
    const s2=rs(sqft);
    const sm=isSTR?(strADR*30.4/1900):isHybrid?((strMonths*(strADR*30.4/1900)+(12-strMonths))/12):1;
    const sc=isSTR?strCosts:isHybrid?strCosts*(strMonths/12):0;
    const sv=isSTR?strVacancy:isHybrid?strVacancy*(strMonths/12):0;
    const mgF=isSTR?0:isHybrid?mgmt*((12-strMonths)/12):mgmt;
    const vcF=isSTR?0:isHybrid?vacancy*((12-strMonths)/12):vacancy;
    const vacPct=(vcF+sv)/100;
    const opPct=(maint+mgF+sc)/100;
    const tg=taxGrowth/100,ig=insGrowth/100,tx=incomeTax/100;
    const scenarios=[
      {label:"Base case",rentMult:1,costMult:1},
      {label:"Rent 10% below estimate",rentMult:0.9,costMult:1},
      {label:"Rent 20% below estimate",rentMult:0.8,costMult:1},
      {label:"Construction 15% over budget",rentMult:1,costMult:1.15},
      {label:"Construction 25% over budget",rentMult:1,costMult:1.25},
    ];
    const featuredStress=scenarios.map(sc2=>{
      const aCost2=assetCost*sc2.costMult,total2=aCost2+origFeeAmt;
      const cashDown2=Math.round(total2*(cashDown/100)),loanAmt2=total2-cashDown2;
      const mPT2=(aCost2*(taxRate/100))/12,mIns2=(aCost2*(insurance/100))/12;
      const rent2=f.br*s2*sm*sc2.rentMult;
      const collected2=rent2*(1-vacPct);
      const rentNetOp2=collected2*(1-opPct);
      const{cfPlus,cfAtTerm,po}=sim({loanAmt:loanAmt2,annRate:rate/100,termYr:term,rentNetOpY1:rentNetOp2,mPTY1:mPT2,mInsY1:mIns2,rentGrowth:g,taxGrowthA:tg,insGrowthA:ig,taxMarg:tx,depBasis:aCost2,buildMo:buildMonths});
      return{...sc2,cfPlus,cfAtTerm,po};
    });

    // Cash flow timeline — yearly cumulative after-tax CF for chart
    const ltrBase=f.ltrRent;
    const eqAtYr=yr=>Math.round(ltrBase*Math.pow(1+g,yr)*110);
    const cfTimeline=[{year:0,cum:0,eq:eqAtYr(0),loan:loanAmt,tot:eqAtYr(0)-loanAmt-cashDownAmt}];
    const mr2=rate/100/12,pmt2=cMP(loanAmt,rate/100,term),n2=term*12;
    const dep2=assetCost/27.5/12;
    const mPT0=(assetCost*(taxRate/100))/12,mIns0=(assetCost*(insurance/100))/12;
    const rent0=f.br*s2*sm,coll0=rent0*(1-vacPct),rNO0=coll0*(1-opPct);
    const mrG2=g>0?Math.pow(1+g,1/12)-1:0,mtG2=tg>0?Math.pow(1+tg,1/12)-1:0,miG2=ig>0?Math.pow(1+ig,1/12)-1:0;
    {let aB=loanAmt,cum2=0,totalSub=0;
    for(let m=0;m<n2;m++){
      const rN=rNO0*Math.pow(1+mrG2,m),pt=mPT0*Math.pow(1+mtG2,m),ins=mIns0*Math.pow(1+miG2,m);
      const net2=rN-pt-ins;
      const intM=aB>0?aB*mr2:0;
      if(aB>0)aB=Math.max(0,aB-(pmt2-intM));
      const taxable=net2-intM-dep2;
      const tax2=tx>0&&taxable>0?taxable*tx:0;
      const atNet=net2-tax2;
      const flow=atNet-pmt2;
      cum2+=flow;
      if(flow<0)totalSub+=Math.abs(flow);
      if((m+1)%12===0){const yr=(m+1)/12;const eqY=eqAtYr(yr);cfTimeline.push({year:yr,cum:cum2,eq:eqY,loan:Math.round(aB),tot:eqY-Math.round(aB)+cum2-cashDownAmt});}
    }
    // Post-loan years (2 extra years to show "free" income)
    for(let y=1;y<=3;y++){
      const m2=n2+(y*12)-1;
      const rN=rNO0*Math.pow(1+mrG2,m2),pt=mPT0*Math.pow(1+mtG2,m2),ins=mIns0*Math.pow(1+miG2,m2);
      const net2=rN-pt-ins;
      const taxable=net2-dep2;
      const tax2=tx>0&&taxable>0?taxable*tx:0;
      cum2+=(net2-tax2)*12;
      const yr2=term+y;const eqY2=eqAtYr(yr2);
      cfTimeline.push({year:yr2,cum:cum2,eq:eqY2,loan:0,tot:eqY2+cum2-cashDownAmt});
    }
    var _totalSubsidies=totalSub;}

    // Property value metrics
    const yr1Value=Math.round(f.ltrRent*110);
    const valueRatio=total>0?yr1Value/total:0;
    const instantEquity=yr1Value-total;

    // Post-loan income
    const postLoanMonthly=Math.round(yr10Net);
    const postLoanAnnual=postLoanMonthly*12;

    // Waterfall totals
    const totalPaid=total;
    const totalSubsidies=_totalSubsidies;
    const totalRentCollected=Math.round(cashCollected+pmt2*n2);
    const equityGained=Math.round(yr10Asset-total);

    // Yearly breakdown for consumer monthly bars
    const yearlyBars=[];
    {let aBY=loanAmt;
    for(let yr=1;yr<=term+3;yr++){
      const m0=(yr-1)*12;
      // Use mid-year (month 6) as representative
      const midM=m0+6;
      const rentY=Math.round(rent0*Math.pow(1+mrG2,midM));
      const collY=rentY*(1-vacPct);
      const opExY=Math.round(collY*opPct);
      const vacY=Math.round(rentY*vacPct);
      const ptY=Math.round(mPT0*Math.pow(1+mtG2,midM));
      const insY=Math.round(mIns0*Math.pow(1+miG2,midM));
      // Amortize loan balance through this year
      let intTotal=0;
      for(let mm=0;mm<12;mm++){
        const mIdx=m0+mm;
        if(yr<=term&&aBY>0){const iM=aBY*mr2;intTotal+=iM;aBY=Math.max(0,aBY-(pmt2-iM));}
      }
      const avgInt=yr<=term?intTotal/12:0;
      const pmtY=yr<=term?Math.round(pmt2):0;
      const interestY=Math.round(avgInt);
      const principalY=Math.max(0,pmtY-interestY);
      // Income tax: on (net - interest - depreciation)
      const netPreTax=collY-opExY-vacY-ptY-insY;
      const taxableY=netPreTax-avgInt-dep2;
      const taxY=tx>0&&taxableY>0?Math.round(taxableY*tx):0;
      const netY=collY-opExY-vacY-ptY-insY-pmtY-taxY;
      yearlyBars.push({year:yr,rent:rentY,opEx:opExY+vacY,propTax:ptY,ins:insY,incomeTax:taxY,pmt:pmtY,interest:interestY,principal:principalY,net:netY});
    }}

    // Fixed-horizon returns (10, 15, 20 years)
    const retAtHorizon=(H)=>{
      const entry=cfTimeline.find(p=>p.year===H);
      if(entry)return entry.tot;
      const last=cfTimeline[cfTimeline.length-1];
      let cumExt=last.cum;
      for(let y=last.year+1;y<=H;y++){
        const mIdx=n2+(y-term)*12-1;
        const rN=rNO0*Math.pow(1+mrG2,mIdx),pt=mPT0*Math.pow(1+mtG2,mIdx),ins=mIns0*Math.pow(1+miG2,mIdx);
        const net2=rN-pt-ins,taxable=net2-dep2,tax2=tx>0&&taxable>0?taxable*tx:0;
        cumExt+=(net2-tax2)*12;
      }
      return eqAtYr(H)+cumExt-cashDownAmt;
    };
    const ret10=retAtHorizon(10),ret15=retAtHorizon(15),ret20=retAtHorizon(20);
    const roi10=total>0?(ret10/total)/10*100:0;
    const roi15=total>0?(ret15/total)/15*100:0;
    const roi20=total>0?(ret20/total)/20*100:0;

        return{f,yearlyBars,yr10Rent,yr10Net,yr10Asset,cashCollected,margin,featuredStress,cfTimeline,yr1Value,valueRatio,instantEquity,postLoanMonthly,postLoanAnnual,totalPaid,totalSubsidies,totalRentCollected,equityGained,ret10,ret15,ret20,roi10,roi15,roi20};
  },[rows,featuredIdx,growth,term,sens,cashDownAmt,loanAmt,total,sqft,rentalMode,strADR,strCosts,strVacancy,strMonths,maint,vacancy,mgmt,assetCost,origFeeAmt,cashDown,taxRate,taxGrowth,insurance,insGrowth,rate,incomeTax,buildMonths,isSTR,isHybrid]);

  const headers=["Metro","Rent","Net","Cov.","+/−","CF+","Payback","Equity","Return"];
  const handleReset=async()=>{setState(DEF);try{await storage.delete(SK)}catch(e){}};
  if(!loaded)return(<div style={{fontFamily:"'DM Sans',sans-serif",background:"#0d1117",color:"#8b949e",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap" rel="stylesheet"/>Loading…</div>);

  return(
    <div style={{fontFamily:"'DM Sans',sans-serif",background:view==="consumer"?"#f8fafc":"#0d1117",color:view==="consumer"?"#0f172a":"#e6edf3",minHeight:"100vh",padding:"28px 16px",transition:"background 0.2s"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap" rel="stylesheet"/>
      <div style={{maxWidth:960,margin:"0 auto"}}>
        {/* VIEW SWITCHER — always visible */}
        <div className="no-print" style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
          <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:"1px solid "+(view==="consumer"?"#cbd5e1":"#30363d"),background:view==="consumer"?"#fff":"#161b22"}}>
            <div onClick={()=>set("view")("internal")} style={{padding:"6px 14px",fontSize:11,fontWeight:view==="internal"?600:400,cursor:"pointer",userSelect:"none",background:view==="internal"?(view==="consumer"?"#0f172a":"#30363d"):"transparent",color:view==="internal"?(view==="consumer"?"#fff":"#e6edf3"):(view==="consumer"?"#64748b":"#8b949e"),transition:"all 0.15s"}}>Internal</div>
            <div onClick={()=>set("view")("consumer")} style={{padding:"6px 14px",fontSize:11,fontWeight:view==="consumer"?600:400,cursor:"pointer",userSelect:"none",background:view==="consumer"?"#0f172a":"transparent",color:view==="consumer"?"#fff":(view==="consumer"?"#64748b":"#8b949e"),transition:"all 0.15s"}}>Consumer view</div>
          </div>
        </div>

      {view==="internal"&&(<>
        <div style={{marginBottom:26,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><h1 style={{fontFamily:"'Fraunces',serif",fontSize:26,fontWeight:700,margin:"0 0 5px",letterSpacing:"-0.02em",color:"#e6edf3"}}>Can ADU Rent Cover the Loan?</h1><p style={{color:"#8b949e",fontSize:13,margin:0,lineHeight:1.5}}>Build up costs from real components, set expenses and rent growth, and see which metros pencil.</p></div><button onClick={handleReset} style={{background:"transparent",border:"1px solid #30363d",borderRadius:6,color:"#8b949e",fontSize:11,padding:"5px 10px",cursor:"pointer",whiteSpace:"nowrap",marginTop:4,flexShrink:0}} onMouseEnter={e=>{e.target.style.borderColor=tb;e.target.style.color=tb}} onMouseLeave={e=>{e.target.style.borderColor="#30363d";e.target.style.color="#8b949e"}}>Reset all</button></div>

        {/* COSTS */}
        <div style={{...card,padding:"18px 22px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:16}}><span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>Project Costs</span><div><span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",marginRight:8}}>Hard cost est.</span><span style={{fontSize:24,fontFamily:"'Fraunces',serif",fontWeight:700,color:tb}}>{fD(total)}</span></div></div>

          <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:-8,marginBottom:10,fontStyle:"italic"}}>Hard cost only. Excludes: CA solar mandate ($5–10K), landscaping restoration ($2–8K), owner's time, and any incidentals during construction. A real quote would add ~$8–15K of typical adders.</div>
          <SL>Unit structure</SL>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label="ADU size" badge={utype} value={sqft} onChange={set("sqft")} min={300} max={1200} step={50} format={v=>v+" sq ft"} ticks={[{value:400,label:"Studio",color:tk},{value:600,label:"1-bed",color:tb},{value:800,label:"1–2 bed",color:tk},{value:1000,label:"Common cap",color:tk}]}/>
            <TS label="Structure $/sq ft (unit only)" value={cpsf} onChange={set("cpsf")} min={100} max={500} step={10} format={v=>"$"+v+"/ft²"} ticks={[{value:175,label:"Garage conv.",color:tk},{value:220,label:"Prefab",color:tb},{value:300,label:"Stick-built",color:tk},{value:400,label:"Bay Area",color:tk}]}/>
            <Sub label="Structure subtotal" value={buildCost}/>
            <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:2,fontStyle:"italic"}}>Includes: framing, roofing, siding, insulation, drywall, interior finishes, flooring, cabinets, countertops, windows, doors, interior plumbing fixtures, interior electrical (wiring, outlets, lighting), HVAC, and built-in kitchen appliances (refrigerator, range, dishwasher, hood). Does NOT include: foundation, panel upgrades, trenching, hardscape, or furnishing — those are separate below. Published "all-in $/sqft" figures often bundle site work — use a lower number here.</div>
          </div>

          <SL>Site work</SL>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label="Foundation" value={foundation} onChange={set("foundation")} min={3000} max={50000} step={1000} format={fD} ticks={[{value:5000,label:"Pier / post",color:gn},{value:10000,label:"Slab",color:tb},{value:18000,label:"Crawl space",color:tk},{value:35000,label:"Hillside eng.",color:rd}]}/>
            <TS label="Grading, demo & access" value={sitePrep} onChange={set("sitePrep")} min={1000} max={30000} step={500} format={fD} ticks={[{value:3000,label:"Flat / clear",color:gn},{value:8000,label:"Average",color:tk},{value:15000,label:"Tight access",color:yl},{value:25000,label:"Complex",color:rd}]}/>
            <TS label="Utility trenching" value={utilTrench} onChange={set("utilTrench")} min={2000} max={30000} step={500} format={fD} ticks={[{value:3000,label:"Short run",color:gn},{value:8000,label:"Average",color:tk},{value:15000,label:"Long / rocky",color:yl},{value:22000,label:"+sewer pump",color:rd}]}/>
            <TS label="Electrical panel upgrade" value={electrical} onChange={set("electrical")} min={0} max={8000} step={500} format={v=>v===0?"Not needed":fD(v)} ticks={[{value:0,label:"Not needed",color:gn},{value:2000,label:"Subpanel",color:tb},{value:5000,label:"200A upgrade",color:tk},{value:7000,label:"Complex",color:yl}]}/>
            <TS label="Hardscape & path" value={hardscape} onChange={set("hardscape")} min={0} max={10000} step={500} format={v=>v===0?"None":fD(v)} ticks={[{value:0,label:"None",color:gn},{value:1500,label:"Short path",color:tk},{value:4000,label:"Path + patio",color:tb},{value:8000,label:"Full hardscape",color:yl}]}/>
            <Sub label="Site subtotal" value={siteCost}/>
          </div>

          <SL>Fees & soft costs</SL>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label="Permits, plan check & inspections" value={permits} onChange={set("permits")} min={0} max={30000} step={500} format={fD} ticks={[{value:3000,label:"Small / waived",color:gn},{value:7000,label:"Sacramento",color:tk},{value:12000,label:"LA",color:tk},{value:20000,label:"SF",color:rd}]}/>
            <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:1,marginBottom:2,fontStyle:"italic"}}>Includes plan review and all construction inspections (foundation, framing, rough MEP, insulation, final/CO). Re-inspection fees if something fails are typically $100–$500 and come out of the builder's margin.</div>
            <TS label="Water & sewer fees" value={hookup} onChange={set("hookup")} min={0} max={60000} step={1000} format={fD} ticks={[{value:0,label:"Waived / incl.",color:gn},{value:4000,label:"San Diego",color:tk},{value:12000,label:"LA",color:tk},{value:20000,label:"SF",color:yl},{value:30000,label:"+lateral",color:rd}]}/>
            <TS label="Design & engineering" value={design} onChange={set("design")} min={0} max={25000} step={500} format={fD} ticks={[{value:3000,label:"Pre-approved",color:gn},{value:10000,label:"Custom arch.",color:tk},{value:18000,label:"Bay Area",color:tk}]}/>
            <TS label="Surveys & reports" value={surveys} onChange={set("surveys")} min={0} max={12000} step={500} format={v=>v===0?"Not required":fD(v)} ticks={[{value:0,label:"Not req'd",color:gn},{value:1500,label:"Survey only",color:tk},{value:3500,label:"Survey + soil",color:tb},{value:7000,label:"Full geotech",color:yl}]}/>
            <TS label="Furnishing" value={furnishing} onChange={set("furnishing")} min={0} max={25000} step={1000} format={v=>v===0?"Unfurnished":fD(v)} ticks={hasSTR?[{value:0,label:"Unfurnished",color:gn},{value:5000,label:"Basic",color:tk},{value:10000,label:"Standard",color:tb},{value:18000,label:"Design-forward",color:yl}]:[{value:0,label:"Unfurnished",color:gn},{value:1500,label:"Washer/dryer",color:tk},{value:5000,label:"Partial",color:tb},{value:12000,label:"Fully furnished",color:yl}]}/>
            <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:1,marginBottom:2,fontStyle:"italic"}}>{hasSTR?"Furniture, linens, kitchenware, decor — everything a guest needs. Built-in kitchen appliances (fridge, range, dishwasher) are already in structure $/sqft.":"Washer/dryer, furniture, or other extras beyond what the builder installs. Built-in kitchen appliances (fridge, range, dishwasher) are already in structure $/sqft. Set to $0 if tenant-supplied."}</div>
            <Sub label="Soft cost subtotal" value={softCost}/>
          </div>

          <SL>Builder / GC margin</SL>
          <TS label="Markup on project" value={markup} onChange={set("markup")} min={0} max={40} step={1} format={v=>v===0?"Owner-builder":v+"% ("+fD(markupAmt)+")"} ticks={[{value:0,label:"Owner-builder",color:gn},{value:10,label:"Prefab co.",color:tb},{value:20,label:"Typical GC",color:tk},{value:25,label:"Design-build",color:yl},{value:35,label:"Premium",color:rd}]}/>
          {origFeeOn&&origFeeAmt>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 1px",borderTop:"1px solid #21262d",marginTop:6}}><span style={{fontSize:11.5,color:yl}}>+ Dealer fee ({origFee}%)</span><span style={{fontSize:13,fontFamily:"'Fraunces',serif",fontWeight:600,color:yl}}>{fD(origFeeAmt)}</span></div>}
        </div>

        {/* RENTAL STRATEGY */}
        <div style={{...card,padding:"18px 22px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12}}>
            <span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>Rental Strategy</span>
          </div>
          <ModePills value={rentalMode} onChange={set("rentalMode")} options={[{value:"ltr",label:"Long-term"},{value:"hybrid",label:"Seasonal hybrid"},{value:"str",label:"Short-term"}]}/>
          <div style={{fontSize:10,color:"#8b949e",lineHeight:1.4,marginTop:6,fontStyle:"italic"}}>{isLTR?"Traditional 12-month lease to a single tenant.":isHybrid?"Short-term rental during peak season, long-term tenant the rest of the year. Rents and costs are blended across "+strMonths+" STR months and "+(12-strMonths)+" LTR months.":"Year-round Airbnb / VRBO. Higher rents, higher expenses, regulatory risk."}</div>
          {hasSTR&&(
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:12,paddingTop:10,borderTop:"1px solid #21262d"}}>
              {isHybrid&&<TS label="Peak STR months per year" value={strMonths} onChange={set("strMonths")} min={1} max={6} step={1} format={v=>v+" mo STR / "+(12-v)+" mo LTR"} ticks={[{value:2,label:"Ski / holiday",color:tk},{value:3,label:"Short summer",color:tb},{value:4,label:"Full summer",color:gn},{value:6,label:"Half year",color:yl}]}/>}
              <TS label={"Average nightly rate"+(isHybrid?" (peak)":"")} value={strADR} onChange={set("strADR")} min={50} max={400} step={5} format={v=>"$"+v+"/night"} ticks={[{value:Math.round(75*scale),label:"Budget",color:tk},{value:Math.round(125*scale),label:utype+" avg",color:tb},{value:Math.round(200*scale),label:"Strong metro",color:gn},{value:Math.round(300*scale),label:"Prime / resort",color:yl}]}/>
              {isHybrid&&<div style={{fontSize:10,color:tb,lineHeight:1.4,fontStyle:"italic"}}>Peak months: ${strADR}/night = ~{fD(Math.round(strADR*30.4))}/mo gross (before vacancy). Off-peak months use LTR rent. Blended {strMonths}mo STR + {12-strMonths}mo LTR = effective {strMult.toFixed(2)}× LTR year-round.</div>}
              <TS label="Hosting, cleaning & management" value={strCosts} onChange={set("strCosts")} min={3} max={40} step={1} format={v=>v+"% of STR gross"} ticks={[{value:3,label:"Airbnb 3%",color:gn},{value:5,label:"VRBO 5%",color:tk},{value:15,label:"+cleaning",color:tb},{value:22,label:"+co-host",color:tk},{value:30,label:"Full-svc mgr",color:yl}]}/>
              <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:1,marginBottom:2,fontStyle:"italic"}}>Platform fees + cleaning + management for STR {isHybrid?"months only. LTR months use the management rate in Operating Expenses below.":"year-round. Replaces property management in Operating Expenses."}</div>
              <TS label="Unbooked nights / vacancy" value={strVacancy} onChange={set("strVacancy")} min={5} max={40} step={1} format={v=>v+"% of nights"} ticks={[{value:8,label:"Hot market",color:gn},{value:15,label:"Typical",color:tb},{value:25,label:"Seasonal",color:yl},{value:35,label:"Soft / new",color:rd}]}/>
              <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:1,marginBottom:2,fontStyle:"italic"}}>{isHybrid?"Unbooked nights during STR months. LTR months use the vacancy rate in Operating Expenses below.":"Percentage of nights unbooked year-round. LTR vacancy is much lower at 3–8%."}</div>
              <div style={{fontSize:10,color:yl,lineHeight:1.4,marginTop:2,fontStyle:"italic"}}>STR income is less predictable and subject to local regulations. Many cities require permits, cap rental days, or ban STRs outright.</div>
            </div>
          )}
        </div>

        {/* OPERATING */}
        <div style={{...card,padding:"18px 22px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:16}}><span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>Operating Expenses</span><div><span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",marginRight:8}}>Eff. rate</span><span style={{fontSize:20,fontFamily:"'Fraunces',serif",fontWeight:700,color:refExpPct>35?rd:refExpPct>28?yl:gn}}>{refExpPct}%</span><span style={{fontSize:11,color:"#6e7681",marginLeft:4}}>of rent</span></div></div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label="Property tax" value={taxRate} onChange={set("taxRate")} min={0.5} max={3.0} step={0.1} format={v=>v.toFixed(1)+"% of ADU cost"} ticks={[{value:1.0,label:"CA",color:tb},{value:1.2,label:"Natl avg",color:tk},{value:2.2,label:"Texas",color:yl},{value:2.5,label:"NJ",color:rd}]}/>
            <TS label={"Insurance ("+fD(Math.round(assetCost*insurance/100))+"/yr)"} value={insurance} onChange={set("insurance")} min={0.2} max={3.5} step={0.1} format={v=>v.toFixed(1)+"% of cost"} ticks={[{value:0.3,label:"HI / VT",color:gn},{value:0.45,label:"CA / PNW",color:tb},{value:0.65,label:"Natl avg",color:tk},{value:1.2,label:"TX / CO",color:yl},{value:1.8,label:"OK / KS / NE",color:yl},{value:2.8,label:"FL coastal",color:rd}]}/>
            <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:1,marginBottom:2,fontStyle:"italic"}}>Scales with ADU cost — bigger or pricier ADUs need more coverage. Rate as a percentage of replacement cost is how insurers actually quote. Landlord policies (DP-3) run 15–25% above owner-occupied rates. Short-term rentals are excluded from standard and landlord policies — STR-specific coverage (Proper, Steadily, commercial) runs 2–3× landlord rates. Airbnb host protection is a supplement, not a replacement. CA wildfire-zone properties on the FAIR Plan can hit 1.5–2.5%.</div>
            <TS label="Maintenance reserve" value={maint} onChange={set("maint")} min={3} max={15} step={1} format={v=>v+"% of rent"} ticks={[{value:5,label:"New build",color:gn},{value:8,label:"Standard",color:tk},{value:12,label:"Aging",color:yl}]}/>
            {!isSTR&&<TS label="Vacancy allowance" value={vacancy} onChange={set("vacancy")} min={0} max={12} step={1} format={v=>v+"%"} ticks={[{value:3,label:"Tight",color:gn},{value:5,label:"Average",color:tk},{value:8,label:"Soft",color:yl}]}/>}
            {!isSTR&&<TS label="Property management" value={mgmt} onChange={set("mgmt")} min={0} max={12} step={1} format={v=>v===0?"Self-managed":v+"% of rent"} ticks={[{value:0,label:"Self",color:gn},{value:5,label:"Hybrid",color:tk},{value:10,label:"Full svc",color:yl}]}/>}
            {isHybrid&&<div style={{fontSize:10,color:tb,lineHeight:1.4,fontStyle:"italic"}}>These rates apply to the {12-strMonths} LTR months. STR months use the hosting/management rate above. Costs are blended automatically.</div>}
            {isSTR&&<div style={{fontSize:10,color:tb,lineHeight:1.4,fontStyle:"italic"}}>Vacancy and management are in the Rental Strategy section above — they work differently for short-term rentals.</div>}
          </div>
        </div>

        {/* INCOME & TAX */}
        <div style={{...card,padding:"18px 22px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}><span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>Income & Tax Assumptions</span></div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <TS label="Annual rent growth" value={growth} onChange={set("growth")} min={0} max={6} step={0.5} format={v=>v===0?"Flat":"+"+v+"%/yr"} ticks={[{value:0,label:"Flat",color:rd},{value:2,label:"Low",color:tk},{value:3,label:"Avg",color:tb},{value:5,label:"Hot",color:gn}]}/>
            <TS label="Property tax growth" value={taxGrowth} onChange={set("taxGrowth")} min={0} max={6} step={0.5} format={v=>v===0?"Flat":"+"+v+"%/yr"} ticks={[{value:0,label:"Flat",color:gn},{value:2,label:"CA Prop 13 cap",color:tb},{value:3,label:"Avg reassess",color:tk},{value:5,label:"Hot market",color:yl}]}/>
            <TS label="Insurance growth" value={insGrowth} onChange={set("insGrowth")} min={0} max={15} step={0.5} format={v=>v===0?"Flat":"+"+v+"%/yr"} ticks={[{value:0,label:"Flat",color:gn},{value:3,label:"Inflation",color:tk},{value:6,label:"Natl recent",color:tb},{value:10,label:"CA / FL",color:yl},{value:14,label:"Crisis",color:rd}]}/>
            <TS label="Marginal income tax rate" value={incomeTax} onChange={set("incomeTax")} min={0} max={50} step={1} format={v=>v===0?"Not modeled":v+"%"} ticks={[{value:0,label:"Not modeled",color:gn},{value:22,label:"22% fed",color:tk},{value:32,label:"32% fed",color:tb},{value:37,label:"Top fed",color:yl},{value:46,label:"+CA state",color:rd}]}/>
            <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:2,fontStyle:"italic"}}>Combined federal + state rate. Applied to taxable rental income after deducting loan interest and depreciation ({fD(Math.round(assetCost/27.5))}/yr). In early years, deductions often exceed income — no tax owed. Tax grows as the loan amortizes and interest shrinks. Cov. and +/− are always pre-tax year-1.</div>
          </div>
        </div>

        {/* FINANCING */}
        <div style={{...card,padding:"18px 22px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
            <span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>Financing</span>
            {loanAmt>0&&<div><span style={{fontSize:11,color:"#8b949e",marginRight:6}}>Loan amount</span><span style={{fontSize:18,fontFamily:"'Fraunces',serif",fontWeight:700,color:tb}}>{fD(loanAmt)}</span></div>}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <TS label="Cash / equity down" value={cashDown} onChange={set("cashDown")} min={0} max={100} step={5} format={v=>v===0?"100% financed":v+"% ("+fD(cashDownAmt)+")"} ticks={[{value:0,label:"All loan",color:tb},{value:20,label:"20%",color:tk},{value:50,label:"50/50",color:tk},{value:100,label:"All cash",color:gn}]}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
              <Sl label="Interest rate" value={rate} onChange={set("rate")} min={3} max={14} step={0.5} format={v=>v.toFixed(1)+"%"}/>
              <Sl label="Loan term" value={term} onChange={set("term")} min={5} max={20} step={1} format={v=>v+" yr"}/>
            </div>
            <div style={{marginTop:2}}>
              <Tog on={origFeeOn} onToggle={()=>set("origFeeOn")(!origFeeOn)} label="Loan origination / dealer fee" sub={origFeeOn?"Baked into the project price — like solar, the fee is invisible to the borrower":"Off — no origination fee (e.g. HELOC, credit union loan)"}/>
              {origFeeOn&&(
                <div style={{marginTop:8}}>
                  <TS label="Origination fee" value={origFee} onChange={set("origFee")} min={1} max={40} step={1} format={v=>v+"% ("+fD(origFeeAmt)+")"} ticks={[{value:2,label:"Mortgage",color:gn},{value:5,label:"Personal loan",color:tb},{value:15,label:"Solar-style",color:tk},{value:25,label:"High dealer fee",color:yl},{value:35,label:"Subprime",color:rd}]}/>
                  <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:2,fontStyle:"italic"}}>Works like a solar dealer fee: the lender adds {origFee}% to the project price. The homeowner's "cost" is {fD(total)}, not {fD(assetCost)} — the {fD(origFeeAmt)} fee is embedded in the price and the loan. Solar lenders charge 10–30%; an ADU fintech might charge 5–15%. The fee lets lenders offer lower rates and front-load their return for securitization. Property tax and depreciation are based on the actual asset cost ({fD(assetCost)}), not the inflated price.</div>
                </div>
              )}
            </div>
            <div style={{borderTop:"1px solid #21262d",marginTop:10,paddingTop:8}}>
              <TS label="Construction period" value={buildMonths} onChange={set("buildMonths")} min={0} max={18} step={1} format={v=>v===0?"Instant (prefab)":v+" months"} ticks={[{value:0,label:"Prefab",color:gn},{value:4,label:"Fast-track",color:tb},{value:6,label:"Typical",color:tk},{value:10,label:"Stick-built",color:yl},{value:15,label:"+permit delays",color:rd}]}/>
              <div style={{fontSize:10,color:"#6e7681",lineHeight:1.4,marginTop:2,fontStyle:"italic"}}>Months from permit approval to first rent check. Loan payments don't start until construction is complete — this is dead time with no income and no payments, like solar. Shifts CF+ and Payback forward by {buildMonths} months.</div>
            </div>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#8b949e",padding:"0 4px",marginBottom:20}}>
          <span>Monthly payment: <strong style={{color:"#e6edf3"}}>{loanAmt>0?fD(loanPmt)+"/mo":"$0 (all cash)"}</strong></span>
          <span>{loanAmt>0?"Total repaid: ":"Cash invested: "}<strong style={{color:"#e6edf3"}}>{loanAmt>0?fD(loanPmt*term*12):fD(total)}</strong>{cashDown>0&&loanAmt>0&&<span> + {fD(cashDownAmt)} cash</span>}</span>
        </div>

        {/* CUSTOM LOCATION */}
        <div style={{...card,padding:"14px 18px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500,flexShrink:0}}>Custom location</span>
            <input type="text" value={customName} onChange={e=>set("customName")(e.target.value)} placeholder="Location name" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"5px 10px",color:"#e6edf3",fontSize:13,fontFamily:"'DM Sans',sans-serif",width:160,outline:"none"}} onFocus={e=>e.target.style.borderColor=tb} onBlur={e=>e.target.style.borderColor="#30363d"}/>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12,color:"#8b949e"}}>$</span>
              <input type="number" value={customRent||""} onChange={e=>set("customRent")(parseInt(e.target.value)||0)} placeholder="Est. rent" style={{background:"#0d1117",border:"1px solid #30363d",borderRadius:6,padding:"5px 10px",color:"#e6edf3",fontSize:13,fontFamily:"'Fraunces',serif",width:110,outline:"none"}} onFocus={e=>e.target.style.borderColor=tb} onBlur={e=>e.target.style.borderColor="#30363d"}/>
              <span style={{fontSize:11,color:"#8b949e"}}>/mo</span>
            </div>
            <span style={{fontSize:10,color:"#6e7681",fontStyle:"italic"}}>Size scaling and STR premium apply automatically</span>
          </div>
        </div>

        {/* TABLE */}
        <div style={{marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:6}}>
          <span style={{fontSize:11,color:"#8b949e"}}>{sqft} sq ft {utype.toLowerCase()}, {isSTR?<span style={{color:yl}}>${strADR}/night STR</span>:isHybrid?<span style={{color:tb}}>{strMonths}mo @ ${strADR}/night + {12-strMonths}mo LTR</span>:"long-term lease"}{growth>0&&<span style={{color:tb}}> · +{growth}%/yr</span>}{incomeTax>0&&<span style={{color:yl}}> · {incomeTax}% tax</span>}{buildMonths>0&&<span style={{color:yl}}> · {buildMonths}mo build</span>}</span>
          <div style={{display:"flex",gap:10,fontSize:11,fontWeight:600}}><span style={{color:cfP>0?gn:rd}}>{cfP}/{rows.length} yr-1 CF</span><span style={{color:"#30363d"}}>·</span><span style={{color:totP>0?gn:rd}}>{totP}/{rows.length} total return</span></div>
        </div>
        <div style={{border:"1px solid #21262d",borderRadius:10,overflow:"visible"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,tableLayout:"fixed"}}>
            <colgroup><col style={{width:"13%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"9%"}}/><col style={{width:"13%"}}/><col style={{width:"19%"}}/></colgroup>
            <thead><tr style={{background:"#161b22"}}>{headers.map((h,i)=>(<th key={h} style={{padding:"8px 5px",textAlign:i===0?"left":"right",fontSize:8.5,textTransform:"uppercase",letterSpacing:"0.08em",color:"#8b949e",fontWeight:500,borderBottom:"1px solid #21262d",position:"relative",overflow:"visible"}}><span style={{whiteSpace:"nowrap"}}>{h}<IT text={CI[h]} align={HA[i]}/></span></th>))}</tr></thead>
            <tbody>{rows.map((r,i)=>{const isCustom=customRent>0&&i===0;const bw=Math.min(parseFloat(r.cov),200),cn=parseFloat(r.cov),eqR=total>0?r.eq/total:0,eqC=eqR>=1?gn:eqR>=0.7?yl:rd,retC=r.ret>0?gn:rd,roiC=r.roi>=10?gn:r.roi>=5?tb:r.roi>=0?yl:rd;return(<tr key={r.metro} style={{borderBottom:i<rows.length-1?"1px solid #21262d":"none",background:isCustom?"rgba(88,166,255,0.06)":i%2===0?"transparent":"rgba(255,255,255,0.015)"}}>
              <td style={{padding:"6px 5px",fontWeight:isCustom?600:500,fontSize:11,color:isCustom?tb:"#e6edf3"}}>{r.metro}</td>
              <td style={{padding:"6px 5px",textAlign:"right",fontFamily:"'Fraunces',serif",fontSize:11}}>${r.rent.toLocaleString()}</td>
              <td style={{padding:"6px 5px",textAlign:"right",color:"#8b949e",fontFamily:"'Fraunces',serif",fontSize:11}}>${Math.round(r.net).toLocaleString()}</td>
              <td style={{padding:"6px 5px",textAlign:"right"}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4}}><div style={{width:32,height:4,background:"#21262d",borderRadius:2,overflow:"hidden"}}><div style={{width:`${Math.min(bw/2,100)}%`,height:"100%",background:r.pen?gn:bw>=80?yl:rd,borderRadius:2,transition:"width 0.3s"}}/></div><span style={{fontFamily:"'Fraunces',serif",fontWeight:600,fontSize:11,color:r.pen?gn:cn>=80?yl:rd,minWidth:26,textAlign:"right"}}>{r.cov}%</span></div></td>
              <td style={{padding:"6px 5px",textAlign:"right",fontFamily:"'Fraunces',serif",fontWeight:600,fontSize:11,color:r.pen?gn:rd}}>{r.sur>=0?"+":""}{fD(r.sur)}</td>
              <td style={{padding:"6px 5px",textAlign:"right",fontFamily:"'Fraunces',serif",fontSize:11,color:r.cfPlus<=0?gn:r.cfPlus<=3?gn:r.cfPlus<=5?tb:r.cfAtTerm?yl:r.cfPlus<=term?yl:rd}}>{r.cfPlus<=0?"Now":r.cfAtTerm?term+" yr*":r.cfPlus.toFixed(1)+" yr"}</td>
              <td style={{padding:"6px 5px",textAlign:"right",fontFamily:"'Fraunces',serif",fontSize:11,color:r.po<=term?gn:r.po<=term*1.5?yl:rd}}>{r.po===Infinity?"Never":r.po>50?"50+ yr":r.po.toFixed(1)+" yr"}</td>
              <td style={{padding:"6px 5px",textAlign:"right"}}><span style={{fontFamily:"'Fraunces',serif",fontWeight:600,fontSize:11,color:eqC}}>{fK(r.eq)}</span></td>
              <td style={{padding:"6px 5px",textAlign:"right"}}><span style={{fontFamily:"'Fraunces',serif",fontWeight:600,fontSize:11.5,color:retC}}>{fK(r.ret)}</span><span style={{fontSize:9,fontWeight:600,color:roiC,marginLeft:3,padding:"1px 3px",background:r.roi>=0?"rgba(63,185,80,0.08)":"rgba(248,81,73,0.08)",borderRadius:3}}>{r.roi>=0?"+":""}{r.roi.toFixed(0)}%<span style={{fontWeight:400,fontSize:7.5}}>/yr</span></span></td>
            </tr>)})}</tbody>
          </table>
        </div>

        {/* LEGEND */}
        <div style={{marginTop:16,padding:"14px 18px",...card,fontSize:11,lineHeight:1.7,color:"#8b949e"}}>
          <strong style={{color:"#e6edf3"}}>Reading the table: </strong>
          <strong style={{color:tb}}>Cov.</strong> and <strong style={{color:tb}}>+/−</strong> are year-1 pre-tax cash flow.
          <strong style={{color:tb}}> CF+</strong>, <strong style={{color:yl}}>Payback</strong>, and <strong style={{color:gn}}>Return</strong> all account for rent growth{incomeTax>0?" and income tax at "+incomeTax+"%":""}.
          <strong style={{color:gn}}> Equity</strong> = rough value-added estimate (110× LTR rent via GRM — a heuristic; actual appraisals use comparable sales, and coastal-market GRMs run 200–300×).
          Builder markup of {markup}% ({fD(markupAmt)}) included. Structure $/sqft covers the unit shell, finishes, MEP, and built-in appliances — foundation, panel upgrades, site work, and furnishing are separate (no double-counting).
          <strong style={{color:"#e6edf3"}}> Not included:</strong> solar panels (mandatory in CA, $5–10K), landscaping restoration, or HOA fees.
          <span style={{color:tb}}> Settings saved automatically.</span>
        </div>

        {/* TAX EXPLAINER */}
        <div style={{marginTop:12,padding:"16px 18px",...card,fontSize:11,lineHeight:1.7,color:"#8b949e"}}>
          <strong style={{color:"#e6edf3"}}>How ADU rental income is taxed</strong>
          <div style={{marginTop:6}}>
            Rental income goes on <strong style={{color:"#c9d1d9"}}>Schedule E</strong> — no LLC needed. You deduct expenses, loan interest, and depreciation ({fD(Math.round(assetCost/27.5))}/yr over 27.5 years). Early on, deductions typically exceed income — no tax owed. As the loan amortizes and interest shrinks, taxable income grows. The <strong style={{color:"#c9d1d9"}}>passive activity rules</strong> limit how useful early-year paper losses are: the $25K loss allowance phases out above $100K MAGI and disappears at $150K. Most coastal-metro homeowners can't use it. Suspended losses carry forward until sale. The tax slider applies your combined federal + state rate to taxable income after deductions in CF+, Payback, and Return. Set to 0% for the pre-tax view.
          </div>
        </div>

        {/* SOURCES */}
        <div style={{marginTop:24,padding:"18px 22px",...card}}>
          <div style={{fontSize:11,color:"#8b949e",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500,marginBottom:6}}>Sources & data provenance</div>
          <div style={{fontSize:11,color:"#8b949e",lineHeight:1.6,marginBottom:16,maxWidth:760}}>Each source below is annotated with what it contributed to the model. Defaults and tick marks reflect cross-referenced 2025–2026 data, primarily from Terner Center academic research, IRS publications, builder cost reporting, and aggregated insurance-rate data. Where sources conflict, the model uses the median or the more conservative value.</div>
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            {SRC.map(s=>(
              <div key={s.cat}>
                <div style={{fontSize:12,fontWeight:600,color:"#e6edf3",marginBottom:8,paddingBottom:4,borderBottom:"1px solid #21262d"}}>{s.cat}</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {s.links.map((l,i)=>(
                    <div key={i} style={{paddingLeft:8,borderLeft:"2px solid #21262d"}}>
                      <a href={l.u} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:tb,textDecoration:"none",lineHeight:1.5,fontWeight:500,display:"inline-block"}} onMouseEnter={e=>e.target.style.textDecoration="underline"} onMouseLeave={e=>e.target.style.textDecoration="none"}>{l.t} ↗</a>
                      {l.n&&<div style={{fontSize:10.5,color:"#8b949e",lineHeight:1.6,marginTop:3,fontStyle:"italic"}}>{l.n}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>)}

      {view==="consumer"&&cm&&(<ConsumerView featured={cm.f} cm={cm} sens={sens} rows={rows} featuredIdx={featuredIdx} setFeaturedIdx={set("featuredIdx")} total={total} loanPmt={loanPmt} loanAmt={loanAmt} cashDownAmt={cashDownAmt} rate={rate} term={term} setTerm={set("term")} growth={growth} buildMonths={buildMonths} sqft={sqft} utype={utype} rentalMode={rentalMode} strADR={strADR} isSTR={isSTR} isHybrid={isHybrid} strMonths={strMonths} hasCustom={customRent>0} customName={customName} cashDown={cashDown} setCashDown={set("cashDown")} incomeTax={incomeTax} customRent={customRent} setCustomRent={set("customRent")} setCustomName={set("customName")} />)}

      </div>
    </div>
  );
}
