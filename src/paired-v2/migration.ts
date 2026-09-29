import { assertValidPairedProfile, type PairedProfile } from "../profile.js";
import { assertValidPairedProfileV2 } from "./validator.js";
import { parseProfileV2Json, canonicalizeProfileV2, computeRawSourceSha256, assertSafeDataV2, compareUtf8Keys } from "./canonical.js";
import { NEUTRAL_TO_SOLAR_COLOR_MAP, SOLAR_TO_NEUTRAL_COLOR_MAP, semanticLeaves } from "./mapping.js";
import { toUnitlessPx, deepFreeze } from "./normalize.js";
import { MigrationV2Error, PairedProfileV2Error, ERROR_CODES } from "./errors.js";
import { PAIRED_V2_ADAPTER_NAME, PAIRED_V2_ADAPTER_VERSION, type PairedProfileV2, type MigrationResult, type MigrationLoss, type MigrationOptions } from "./types.js";
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
function bytes(source:string|Uint8Array):Uint8Array {if(typeof source!=="string"&&!(source instanceof Uint8Array))throw new MigrationV2Error("Migration requires source bytes; serialize drafts explicitly");parseProfileV2Json(source);return typeof source==="string"?Buffer.from(source):new Uint8Array(source);}
function finish<T>(source:Uint8Array,profile:T,fromVersion:string,toVersion:string,losses:MigrationLoss[]):MigrationResult<T>{
 const resultJson=canonicalizeProfileV2(profile),resultBytes=Buffer.from(resultJson),sourceSha256=computeRawSourceSha256(source),resultSha256=computeRawSourceSha256(resultBytes),adapter={name:PAIRED_V2_ADAPTER_NAME,version:PAIRED_V2_ADAPTER_VERSION};
 const report={adapter,fromVersion,toVersion,sourceSha256,resultSha256,losses};
 return {...report,sourceBytes:new Uint8Array(source),resultBytes,resultJson,profile:deepFreeze(profile),isLossless:losses.length===0,conversionReportDigest:computeRawSourceSha256("tf-paired-version-adapter-v1\n"+canonicalizeProfileV2(report))};
}
function upgrade(v1:PairedProfile):PairedProfileV2 {
 assertValidPairedProfile(v1);
 const raw=v1.targetOverrides;
 // V1 accepted broad retained overrides. Only its actually applied closed subset upgrades.
 if(raw?.solarSail&&Object.keys(raw.solarSail).some(k=>k!=="surfaces"))throw new MigrationV2Error("Unsupported retained v1 Solar override cannot be guessed");
 if(raw?.loom&&Object.keys(raw.loom).some(k=>!["content","primaryFamily","secondaryFamily","defaultAccent"].includes(k)))throw new MigrationV2Error("Unsupported retained v1 Loom override cannot be guessed");
 const color:any={light:{},dark:{}};const optional:any={light:{},dark:{}};
 for(const mode of ["light","dark"] as const)for(const [key,value]of Object.entries(v1.palette[mode])){const role=SOLAR_TO_NEUTRAL_COLOR_MAP[key];if(role)color[mode][role]=value;else optional[mode][key]=value;}
 const targetOverrides:any={version:"v2",...(raw?copy(raw):{})};
 if(Object.keys(optional.light).length||Object.keys(optional.dark).length)targetOverrides.solarSail={...targetOverrides.solarSail,palette:optional};
 const v2:PairedProfileV2={schemaVersion:"tf-paired-profile-v2",name:v1.name,version:v1.version,...(v1.description!==undefined?{description:v1.description}:{}),color,typography:{body:{family:v1.typography.fontSans},...(v1.typography.fontHeading?{heading:{family:v1.typography.fontHeading}}:{}),...(v1.typography.fontMono?{code:{family:v1.typography.fontMono}}:{})},radius:{control:v1.surfaces.radius},...(v1.surfaces.borderWidth!==undefined?{elevation:{borderWidth:v1.surfaces.borderWidth}}:{}),...(v1.surfaces.content!==undefined?{reading:{measure:`${v1.surfaces.content}px`}}:{}),...(Object.keys(targetOverrides).length>1?{targetOverrides}: {})};
 assertValidPairedProfileV2(v2);return v2;
}
export function migrateV1ToV2(source:string|Uint8Array):MigrationResult<PairedProfileV2>{
 const raw=bytes(source),v1=parseProfileV2Json(raw) as PairedProfile;
 if(v1?.schemaVersion!=="tf-paired-profile-v1")throw new PairedProfileV2Error("Unsupported source version",ERROR_CODES.UNKNOWN_FUTURE_VERSION);
 return finish(raw,upgrade(v1),"tf-paired-profile-v1","tf-paired-profile-v2",[]);
}
export function migrateV2ToV1(source:string|Uint8Array,options:MigrationOptions={}):MigrationResult<PairedProfile>{
 assertSafeDataV2(options);if(Object.keys(options).some(k=>k!=="allowLossy")||options.allowLossy!==undefined&&typeof options.allowLossy!=="boolean")throw new MigrationV2Error("Invalid migration options");
 const raw=bytes(source),p=parseProfileV2Json(raw) as PairedProfileV2;
 if(p?.schemaVersion!=="tf-paired-profile-v2")throw new PairedProfileV2Error("Unsupported source version",ERROR_CODES.UNKNOWN_FUTURE_VERSION);
 assertValidPairedProfileV2(p);
 const palette:any={light:{},dark:{}};for(const mode of ["light","dark"] as const){for(const [role,key]of Object.entries(NEUTRAL_TO_SOLAR_COLOR_MAP))palette[mode][key]=(p.color[mode] as any)[role];Object.assign(palette[mode],p.targetOverrides?.solarSail?.palette?.[mode]??{});}
 const target:any={};if(p.targetOverrides?.solarSail?.surfaces)target.solarSail={surfaces:copy(p.targetOverrides.solarSail.surfaces)};
 const own=p.targetOverrides?.loom;if(own){target.loom=Object.fromEntries(Object.entries(own).filter(([k])=>["content","primaryFamily","secondaryFamily","defaultAccent"].includes(k)));}
 if(p.targetOverrides?.syntax)target.syntax=copy(p.targetOverrides.syntax);
 const content=p.reading?.measure===undefined?null:toUnitlessPx(p.reading.measure);
 const result:PairedProfile={schemaVersion:"tf-paired-profile-v1",name:p.name,version:p.version,...(p.description!==undefined?{description:p.description}:{}),palette,surfaces:{radius:p.radius?.control??"0px",...(p.elevation?.borderWidth!==undefined?{borderWidth:p.elevation.borderWidth}:{}),...(content!==null&&content>0&&Number.isSafeInteger(content)?{content}:{})},typography:{fontSans:p.typography?.body?.family??"system-ui",...(p.typography?.heading?{fontHeading:p.typography.heading.family}:{}),...(p.typography?.code?{fontMono:p.typography.code.family}:{})},...(Object.keys(target).length?{targetOverrides:target}:{})};
 assertValidPairedProfile(result);
 const roundTrip=upgrade(result),after=new Map(semanticLeaves(roundTrip).map(x=>[x.path,x.value]));
 const before=new Map(semanticLeaves(p).map(x=>[x.path,x.value]));
 const losses:MigrationLoss[]=[];
 for(const [path,value]of before){if(path==="schemaVersion"||path==="targetOverrides.version")continue;if(!after.has(path)||canonicalizeProfileV2(after.get(path))!==canonicalizeProfileV2(value))losses.push({path,lossType:"structural_loss",message:"Source leaf cannot round-trip through the maintained v1 adapter",sourceValue:value});}
 for(const path of ["radius.control","typography.body.family"])if(!before.has(path))losses.push({path,lossType:"structural_loss",message:"V1 requires a generated default absent from source intent"});
 losses.sort((a,b)=>compareUtf8Keys(a.path,b.path));
 if(losses.length&&!options.allowLossy)throw new MigrationV2Error("Lossy downgrade requires allowLossy: true",losses);
 return finish(raw,result,"tf-paired-profile-v2","tf-paired-profile-v1",losses);
}
