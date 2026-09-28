import { COMPILER_NAME, COMPILER_VERSION, type ColorTokens, type ThemeSpecification } from "../types.js";
import { validateThemeSpecification } from "../validator.js";
import type { ProfileSyntaxModel, MappingReport, PairedProfile } from "../profile.js";
import { assertValidPairedProfileV2 } from "./validator.js";
import { canonicalizeProfileV2, computeCanonicalDigestV2, computeRawSourceSha256, assertSafeDataV2, compareUtf8Keys } from "./canonical.js";
import { normalizeHexColor, toUnitlessPx, deepFreeze } from "./normalize.js";
import { PairedProfileV2Error, ERROR_CODES } from "./errors.js";
import { PAIRED_V2_ADAPTER_NAME, PAIRED_V2_ADAPTER_VERSION, type PairedProfileV2, type MappingReportV2, type MappingReportEntryV2, type StellarLoomMappingOptionsV2, type SolarSailMappingOptionsV2 } from "./types.js";

export const NEUTRAL_TO_SOLAR_COLOR_MAP: Readonly<Record<string,keyof ColorTokens>> = Object.freeze({canvas:"background",canvasText:"foreground",surface:"card",surfaceText:"cardForeground",elevatedSurface:"popover",elevatedSurfaceText:"popoverForeground",primaryAction:"primary",primaryActionText:"primaryForeground",secondaryAction:"secondary",secondaryActionText:"secondaryForeground",mutedSurface:"muted",mutedText:"mutedForeground",highlight:"accent",highlightText:"accentForeground",danger:"destructive",dangerText:"destructiveForeground",border:"border",fieldBorder:"input",focus:"ring"});
export const SOLAR_TO_NEUTRAL_COLOR_MAP: Readonly<Record<string,string>> = Object.freeze(Object.fromEntries(Object.entries(NEUTRAL_TO_SOLAR_COLOR_MAP).map(([a,b])=>[b,a])));
const groups=["color","typography","radius","spacing","elevation","focus","code","reading","navigation"];
export function semanticLeaves(node: unknown, prefix=""): Array<{path:string,value:unknown}> {
 if(node && typeof node==="object") return Object.entries(node).sort(([a],[b])=>compareUtf8Keys(a,b)).flatMap(([k,v])=>semanticLeaves(v,prefix?`${prefix}.${k}`:k));
 return [{path:prefix,value:node}];
}
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
function bad(message:string):never {throw new PairedProfileV2Error(message,ERROR_CODES.UNSUPPORTED_MAPPING);}
function optionsCheck(options:Record<string,unknown>,allowed:string[]) {assertSafeDataV2(options);for(const k of Object.keys(options))if(!allowed.includes(k))bad(`Unknown mapping option ${k}`);}
const syntaxRoles:Record<string,string>={comment:"mutedText",string:"primaryAction",number:"highlight",constant:"highlight",keyword:"primaryAction",function:"primaryAction",type:"primaryAction",variable:"canvasText",punctuation:"mutedText",tag:"primaryAction",attribute:"highlight"};
const chromeRoles:Record<string,string>={background:"canvas",foreground:"canvasText",border:"border",focus:"focus",tabBarBackground:"surface",tabBarBorder:"border",activeTabBackground:"canvas",activeTabForeground:"canvasText",activeTabBorder:"border",terminalTitlebarBackground:"mutedSurface",terminalTitlebarForeground:"canvasText",copyButtonForeground:"mutedText",copyButtonBorder:"border",tooltipSuccessBackground:"primaryAction",tooltipSuccessForeground:"primaryActionText"};

/** Projection and report share one effect table: no independent optimistic reporter. */
function project(profile:PairedProfileV2,target:"solar-sail"|"stellar-loom",options:Record<string,any>={},source?:string,sourceVerification:MappingReportV2["sourceVerification"]=source?"source-bytes":"serialized-profile") {
 assertValidPairedProfileV2(profile);
 if(target!=="solar-sail"&&target!=="stellar-loom")bad("Unknown target");
 optionsCheck(options,target==="solar-sail"?["sourceProfileSha256"]:["catalog","tokenSetKey","primaryFamily","secondaryFamily","defaultAccent","familyBindings"]);
 const entries=semanticLeaves(profile).filter(x=>groups.includes(x.path.split(".")[0]!)||x.path.startsWith("targetOverrides.")&&x.path!=="targetOverrides.version").map(x=>({sourcePath:x.path,sourceValue:x.value,classification:"unsupported",reason:"No native representation in this adapter"}) as MappingReportEntryV2);
 const byPath=new Map(entries.map(e=>[e.sourcePath,e]));const destinations=new Map<string,MappingReportEntryV2>();
 const normalizedDestinations=new Map<string,boolean>();
 const overriddenLeaves=new Set<MappingReportEntryV2>();
 const defaults:Array<{targetPath:string,targetValue:unknown,reason:string}>=[];
 let output:any;
 const syntax:any={syntax:{light:{},dark:{}},chrome:{light:{},dark:{}},frame:"editor",copy:"standard",tabs:{activeIndicator:"accent"}};
 const get=(path:string)=>path.split(".").reduce((o,k)=>o?.[k],profile as any);
 const effect=(path:string,dest:string,value:unknown,reason:string,normalized=false)=>{
  const e=byPath.get(path);if(!e)return;
  const previous=destinations.get(dest);if(previous&&previous!==e){overriddenLeaves.add(previous);previous.classification="overridden";previous.reason=`Overridden by ${path}`;}
  destinations.set(dest,e);normalizedDestinations.set(dest,normalized);
  if(e.classification!=="overridden")e.classification=normalized?"normalized":"consumed";
  e.targetPath=e.targetPath?`${e.targetPath};${dest}`:dest;e.targetValue=value;e.reason=reason;
 };
 const color=(path:string,dest:string,set:(x:string)=>void)=>{const v=get(path);if(v===undefined)return;const normalized=normalizeHexColor(v);if(target==="stellar-loom"&&normalized.length!==7){const e=byPath.get(path)!;e.reason="Loom requires six-digit opaque sRGB; alpha is retained unsupported";return;}set(normalized);effect(path,dest,normalized,"Hex spelling projection",v!==normalized);};
 const length=(path:string,dest:string,set:(x:number)=>void)=>{const v=get(path);if(v===undefined)return;const px=toUnitlessPx(v);if(px===null){byPath.get(path)!.reason="Relative length retained; no assumed root conversion";return;}set(px);effect(path,dest,px,"Explicit pixels projected to native pixel number",true);};
 if(target==="solar-sail"){
  output={schemaVersion:"tfss.theme-v1",name:profile.name,version:profile.version,description:profile.description??`${profile.name} application theme`,palette:{light:{},dark:{}},surfaces:{radius:"0px"},typography:{fontSans:"system-ui"}};
  if(!profile.radius?.control)defaults.push({targetPath:"surfaces.radius",targetValue:"0px",reason:"Adapter default; absent control radius"});
  if(!profile.typography?.body)defaults.push({targetPath:"typography.fontSans",targetValue:"system-ui",reason:"Adapter default; absent body family"});
  for(const mode of ["light","dark"] as const)for(const [role,dest]of Object.entries(NEUTRAL_TO_SOLAR_COLOR_MAP))color(`color.${mode}.${role}`,`palette.${mode}.${dest}`,v=>output.palette[mode][dest]=v);
  for(const [role,dest]of Object.entries({body:"fontSans",heading:"fontHeading",code:"fontMono"}))if(profile.typography?.[role as "body"]){const v=get(`typography.${role}.family`);output.typography[dest]=v;effect(`typography.${role}.family`,`typography.${dest}`,v,"Native font role");}
  for(const [path,dest]of [["radius.control","radius"],["elevation.borderWidth","borderWidth"]])if(get(path!)!==undefined){output.surfaces[dest!]=get(path!);effect(path!,`surfaces.${dest}`,get(path!),"Native CSS length");}
  for(const mode of ["light","dark"])color(`focus.color.${mode}`,`palette.${mode}.ring`,v=>output.palette[mode].ring=v);
  const own=profile.targetOverrides?.solarSail;
  for(const mode of ["light","dark"] as const)for(const key of Object.keys(own?.palette?.[mode]??{}))color(`targetOverrides.solarSail.palette.${mode}.${key}`,`palette.${mode}.${key}`,v=>output.palette[mode][key]=v);
  for(const [key,v]of Object.entries(own?.surfaces??{})){output.surfaces[key]=v;effect(`targetOverrides.solarSail.surfaces.${key}`,`surfaces.${key}`,v,"Explicit target override wins");}
  if(options.sourceProfileSha256!==undefined){if(typeof options.sourceProfileSha256!=="string"||! /^[a-f0-9]{64}$/.test(options.sourceProfileSha256))bad("Invalid source hash");output.sourceProfileSha256=options.sourceProfileSha256;}
  const valid=validateThemeSpecification(output);if(!valid.valid)bad(valid.errors.join("; "));
 } else {
  const own=profile.targetOverrides?.loom;
  for(const key of ["tokenSetKey","primaryFamily","secondaryFamily","defaultAccent"]){const v=(own as any)?.[key]??options[key];if(typeof v!=="string"||! /^[a-z][a-z0-9-]*$/.test(v))bad(`Explicit Loom ${key} required`);}
  const tokenSet=own?.tokenSetKey??options.tokenSetKey,primary=own?.primaryFamily??options.primaryFamily,secondary=own?.secondaryFamily??options.secondaryFamily,accent=own?.defaultAccent??options.defaultAccent;
  if(!options.catalog?.tokenSets?.[tokenSet]||!options.catalog?.accentVariants?.[primary]||!options.catalog?.accentVariants?.[secondary]||!options.catalog?.accentVariants?.[accent])bad("Explicit catalog selections must exist");
  if(options.catalog.accentVariants[primary].tokenSet!==tokenSet||options.catalog.accentVariants[secondary].tokenSet!==tokenSet)bad("Selected families must use selected token set");
  output=copy(options.catalog);output.name=profile.name;output.version=profile.version;output.defaultAccent=accent;
  const loomRoles:Record<string,string[]>={canvas:["page"],canvasText:["body"],surface:["card"],elevatedSurface:["raised"],mutedText:["muted"],primaryAction:["accent-base","link"],border:["hairline","border"],focus:["focus"],selection:["selection-background"],selectionText:["selection-text"]};
  const token=(path:string,family:string,mode:string,role:string)=>{const key=`paired-${family}-${mode}-${role}`;color(path,`accentVariants.${family}.${mode}.${role}`,v=>{output.tokenSets[tokenSet][key]=v;output.accentVariants[family][mode][role]=key;});};
  for(const mode of ["light","dark"]) {for(const [role,natives]of Object.entries(loomRoles))for(const native of natives)token(`color.${mode}.${role}`,primary,mode,native);for(const role of ["accent-base","link","focus"])token(`color.${mode}.highlight`,secondary,mode,role);token(`focus.color.${mode}`,primary,mode,"focus");}
  for(const [path,dest]of [["radius.surface","radii"],["elevation.borderWidth","border"],["focus.width","focus"],["focus.offset","focusOffset"],["reading.measure","content"]])length(path!,`surfaces.${dest}`,v=>output.surfaces[dest!]=v);
  length("spacing.base","surfaces.spacing",v=>output.surfaces.spacing=v);
  if(profile.spacing?.density){const scale={compact:0.75,comfortable:1,spacious:1.25}[profile.spacing.density];output.surfaces.spacing*=scale;effect("spacing.density","surfaces.spacing.multiplier",output.surfaces.spacing,"Versioned density multiplier on explicit/base catalog spacing",true);}
  if(profile.elevation?.borderStyle){output.surfaces.borderStyle=profile.elevation.borderStyle;effect("elevation.borderStyle","surfaces.borderStyle",profile.elevation.borderStyle,"Native border style");}
  if(options.familyBindings!==undefined&&(!options.familyBindings||typeof options.familyBindings!=="object"||Array.isArray(options.familyBindings)))bad("familyBindings must be an object");
  for(const [role,values]of Object.entries(profile.typography??{})){
   const id=options.familyBindings?.[values.family];
   if(id!==undefined){if(typeof id!=="string"||!(["system-sans","system-serif","system-mono","system-code","system-ui"].includes(id)||output.fonts.some((f:any)=>f.id===id)))bad("Unknown bound font resource");output.typography[role].font=id;effect(`typography.${role}.family`,`typography.${role}.font`,id,"Explicit family-to-font-ID binding",true);}
   length(`typography.${role}.size`,`typography.${role}.size`,v=>output.typography[role].size=v);
   if(values.lineHeight!==undefined){output.typography[role].lineHeight=values.lineHeight;effect(`typography.${role}.lineHeight`,`typography.${role}.lineHeight`,values.lineHeight,"Native line height");}
  }
  for(const mode of ["light","dark"]){
   for(const [group,roles]of [["syntax",syntaxRoles],["chrome",chromeRoles]] as const)for(const [key,role]of Object.entries(roles)){
    const dest=`${group}.${mode}.${key}`,fallback=mode==="light"?"#000000":"#ffffff";
    syntax[group][mode][key]=fallback;
    defaults.push({targetPath:dest,targetValue:fallback,reason:"Adapter fallback; no supported source projection"});
    color(`color.${mode}.${role}`,dest,v=>syntax[group][mode][key]=v);
    if(group==="syntax")color(`code.syntax.${mode}.${key}`,dest,v=>syntax[group][mode][key]=v);
   }
  }
  defaults.push({targetPath:"tabs.activeIndicator",targetValue:"accent",reason:"Adapter default"});
  for(const k of ["frame","copy"]){const v=get(`code.${k}`);if(v!==undefined){syntax[k]=v;effect(`code.${k}`,k,v,"Native code presentation");}else defaults.push({targetPath:k,targetValue:syntax[k],reason:"Adapter default"});}
  const override=profile.targetOverrides?.syntax;
  for(const {path,value}of semanticLeaves(override??{},"targetOverrides.syntax")){
   const parts=path.split(".").slice(2);const dest=parts.join(".");let cursor=syntax;for(const k of parts.slice(0,-1))cursor=cursor[k]??=( {} );
   if(typeof value==="string"&&value.startsWith("#"))color(path,dest,v=>cursor[parts.at(-1)!]=v);else {cursor[parts.at(-1)!]=value;effect(path,dest,value,"Explicit syntax override wins");}
  }
  for(const [key,value]of Object.entries(own??{})) {const dest=({content:"content",radii:"radii",border:"border"} as Record<string,string>)[key];if(dest)output.surfaces[dest]=value;effect(`targetOverrides.loom.${key}`,dest?`surfaces.${dest}`:`selection.${key}`,value,"Explicit Loom override wins");}
 }
 for(const e of entries)if(e.sourcePath.startsWith("targetOverrides.")&&!(target==="solar-sail"?e.sourcePath.startsWith("targetOverrides.solarSail."):e.sourcePath.startsWith("targetOverrides.loom.")||e.sourcePath.startsWith("targetOverrides.syntax."))){e.classification="target-specific";e.reason="Retained for another adapter";}
 // A shared leaf may have several destinations. Only call it overridden when ALL effects were replaced.
 for(const e of entries){
  const surviving=[...destinations].filter(([,owner])=>owner===e);
  if(surviving.length){
   e.classification=surviving.some(([dest])=>normalizedDestinations.get(dest))?"normalized":"consumed";
   if(overriddenLeaves.has(e))e.reason=`At least one projection remains ${e.classification}; explicit refinement or override replaced another projection`;
  }
 }
 // Count only defaults still present in the final projection, never source-derived effects.
 const generatedDefaults=defaults.filter(d=>!destinations.has(d.targetPath));
 const capableGroups=target==="solar-sail"?["color","typography","radius","elevation","focus"]:groups.filter(g=>g!=="navigation");
 const canonical=canonicalizeProfileV2(profile);const count=(s:string)=>entries.filter(e=>e.classification===s).length;
 const report:MappingReportV2={schema:"tf-paired-mapping-report-v2",target,profileName:profile.name,profileVersion:profile.version,sourceSha256:source??computeRawSourceSha256(canonical),sourceVerification,canonicalDigest:computeCanonicalDigestV2(canonical),adapter:{name:PAIRED_V2_ADAPTER_NAME,version:PAIRED_V2_ADAPTER_VERSION},compiler:{name:target==="solar-sail"?COMPILER_NAME:"tfsl.theme-compiler-v2-catalog",version:target==="solar-sail"?COMPILER_VERSION:"catalog-1"},options:copy(options),entries,defaults:generatedDefaults,groups:groups.map(group=>({group,applicable:capableGroups.includes(group),reason:capableGroups.includes(group)?"Adapter supports a subset of this group; see supplied leaf dispositions":"No native representation for this group in this adapter"})),summary:{totalSemanticLeaves:entries.length,consumed:count("consumed"),normalized:count("normalized"),overridden:count("overridden"),targetSpecific:count("target-specific"),unsupported:count("unsupported"),generatedDefaultsCount:generatedDefaults.length},digest:""};
 const {digest,...projection}=report;report.digest=computeRawSourceSha256("tf-paired-mapping-report-v2\n"+canonicalizeProfileV2(projection));
 return {output,syntax,report:deepFreeze(report)};
}
export function generateMappingReportV2(p:PairedProfileV2,t:"solar-sail"|"stellar-loom",o:Record<string,any>={},source?:string,sourceVerification?:MappingReportV2["sourceVerification"]):MappingReportV2{return project(p,t,o,source,sourceVerification).report;}
export function mapProfileToSolarSailV2(p:PairedProfileV2,o:SolarSailMappingOptionsV2={}):ThemeSpecification{return project(p,"solar-sail",o).output;}
export function mapProfileToSolarSailWithReportV2(p:PairedProfileV2,o:SolarSailMappingOptionsV2={}){const r=project(p,"solar-sail",o);return {specification:r.output as ThemeSpecification,report:r.report};}
export function mapProfileToStellarLoomV2(p:PairedProfileV2,c:Record<string,any>,o:StellarLoomMappingOptionsV2={}){return project(p,"stellar-loom",{...o,catalog:c}).output;}
export function mapProfileToStellarLoomWithReportV2(p:PairedProfileV2,c:Record<string,any>,o:StellarLoomMappingOptionsV2={}){const r=project(p,"stellar-loom",{...o,catalog:c});return {catalog:r.output,syntax:r.syntax as ProfileSyntaxModel,report:r.report};}
export function mapProfileToSyntaxPaletteV2(_p:PairedProfileV2):ProfileSyntaxModel {bad("Syntax projection requires explicit Loom application inputs; use bound mapToStellarLoom");}
/** Legacy reports omit effects and mix defaults into leaves; never invent a faithful conversion. */
export function adaptLegacyMappingReportV2(_profile:PairedProfile,report:MappingReport):never {bad(report.entries.some(e=>e.classification==="degraded")?"Legacy degraded disposition has no lossless conversion":"Legacy report requires rerunning a versioned profile adapter; standalone conversion unsupported");}
