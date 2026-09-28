import { assertValidPairedProfileV2 } from "./validator.js";
import { assertSafeDataV2, parseProfileV2Json, canonicalizeProfileV2, computeRawSourceSha256, computeCanonicalDigestV2 } from "./canonical.js";
import { deepFreeze } from "./normalize.js";
import { RecipeError } from "./errors.js";
import type { PairedProfileV2, RecipeResult } from "./types.js";
export interface ProfileRecipe { schema: "tf-paired-recipe-v1"; type: "density"|"radius"|"typography"; variant: string; }
export type DensityRecipe=ProfileRecipe;
export type RadiusRecipe=ProfileRecipe;
export type TypographyRecipe=ProfileRecipe;
export const DENSITY_RECIPES=deepFreeze({compact:{base:"6px",density:"compact"},comfortable:{base:"8px",density:"comfortable"},spacious:{base:"10px",density:"spacious"}});
export const RADIUS_RECIPES=deepFreeze({sharp:{control:"0px",surface:"0px",overlay:"0px"},compact:{control:"4px",surface:"4px",overlay:"4px"},default:{control:"8px",surface:"8px",overlay:"8px"},relaxed:{control:"12px",surface:"12px",overlay:"12px"},pill:{control:"24px",surface:"24px",overlay:"24px"}});
export const TYPOGRAPHY_RECIPES=deepFreeze({editorial:{family:"Georgia, serif",size:"32px",lineHeight:1.25},modern:{family:"system-ui",size:"28px",lineHeight:1.25},technical:{family:"monospace",size:"24px",lineHeight:1.4},system:{family:"system-ui",size:"24px",lineHeight:1.4}});
export const RECIPE_CATALOG=deepFreeze({density:DENSITY_RECIPES,radius:RADIUS_RECIPES,typography:TYPOGRAPHY_RECIPES});
export function applyRecipe(source:string|Uint8Array,recipe:ProfileRecipe):RecipeResult {
 assertSafeDataV2(recipe);
 if(!recipe||recipe.schema!=="tf-paired-recipe-v1"||Object.keys(recipe).some(k=>!["schema","type","variant"].includes(k))||!Object.hasOwn(RECIPE_CATALOG,recipe.type))throw new RecipeError("unknown","Invalid structured recipe");
 const table=RECIPE_CATALOG[recipe.type] as Record<string,unknown>;
 if(!Object.hasOwn(table,recipe.variant))throw new RecipeError(recipe.variant,"Unknown recipe variant");
 const profile=parseProfileV2Json(source) as PairedProfileV2;assertValidPairedProfileV2(profile);
 const result=JSON.parse(JSON.stringify(profile));const group=recipe.type==="density"?"spacing":recipe.type==="radius"?"radius":"typography";
 const before=group==="typography"?result.typography?.heading:result[group];
 const after=JSON.parse(JSON.stringify(table[recipe.variant]));
 if(group==="typography")result.typography={...result.typography,heading:after};else result[group]=after;
 assertValidPairedProfileV2(result);
 const resultJson=canonicalizeProfileV2(result),deltas=[{path:group==="typography"?"typography.heading":group,before:before??null,after}];
 const sourceSha256=computeRawSourceSha256(source),resultSha256=computeRawSourceSha256(resultJson);
 const implementation={name:"tf-paired-recipes",version:"1.0.0"};
 const identity={implementation,recipe,sourceSha256,resultSha256,deltas};
 return deepFreeze({recipeName:recipe.variant,recipeType:recipe.type,recipeVersion:"1.0.0",implementation,sourceSha256,resultSha256,canonicalDigest:computeCanonicalDigestV2(resultJson),deltas,profile:result,recipe,digest:computeRawSourceSha256("tf-paired-recipe-result-v1\n"+canonicalizeProfileV2(identity)),resultJson});
}
