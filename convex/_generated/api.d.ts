/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as agentmail from "../agentmail.js";
import type * as auth from "../auth.js";
import type * as executor from "../executor.js";
import type * as funding from "../funding.js";
import type * as http from "../http.js";
import type * as intents from "../intents.js";
import type * as lib_browserUse from "../lib/browserUse.js";
import type * as lib_captchaSolver from "../lib/captchaSolver.js";
import type * as lib_paymentsUtils from "../lib/paymentsUtils.js";
import type * as lib_solana from "../lib/solana.js";
import type * as lib_taskBuilders from "../lib/taskBuilders.js";
import type * as lib_treasuryCard from "../lib/treasuryCard.js";
import type * as observability from "../observability.js";
import type * as offerings from "../offerings.js";
import type * as publicCliAssets from "../publicCliAssets.js";
import type * as secrets from "../secrets.js";
import type * as shopifyExecutor from "../shopifyExecutor.js";
import type * as treasury from "../treasury.js";
import type * as waitlist from "../waitlist.js";
import type * as wallets from "../wallets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  agentmail: typeof agentmail;
  auth: typeof auth;
  executor: typeof executor;
  funding: typeof funding;
  http: typeof http;
  intents: typeof intents;
  "lib/browserUse": typeof lib_browserUse;
  "lib/captchaSolver": typeof lib_captchaSolver;
  "lib/paymentsUtils": typeof lib_paymentsUtils;
  "lib/solana": typeof lib_solana;
  "lib/taskBuilders": typeof lib_taskBuilders;
  "lib/treasuryCard": typeof lib_treasuryCard;
  observability: typeof observability;
  offerings: typeof offerings;
  publicCliAssets: typeof publicCliAssets;
  secrets: typeof secrets;
  shopifyExecutor: typeof shopifyExecutor;
  treasury: typeof treasury;
  waitlist: typeof waitlist;
  wallets: typeof wallets;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
