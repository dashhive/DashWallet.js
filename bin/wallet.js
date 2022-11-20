#!/usr/bin/env node
"use strict";

//@ts-ignore
let pkg = require("../package.json");

/**
 * @typedef {import('../').Config} Config
 * @typedef {import('../').Safe} Safe
 * @typedef {import('../').WalletInstance} WalletInstance
 */

let Os = require("node:os");
let home = Os.homedir();

require("dotenv").config({ path: `${home}/.config/dash/env` });
require("dotenv").config({ path: `${home}/.config/dash/.env.secret` });

let Path = require("node:path");
let Fs = require("node:fs/promises");

let Wallet = require("../wallet.js");

let Base58Check = require("@root/base58check").Base58Check;
let Dashsight = require("dashsight");
// let Qr = require("./qr.js");

let HdKey = require("hdkey");
let b58c = Base58Check.create({
  pubKeyHashVersion: Wallet.DashTypes.pubKeyHashVersion,
  privateKeyVersion: Wallet.DashTypes.privateKeyVersion,
});

/**
 * @typedef FsStoreConfig
 * @prop {String} dir
 * @prop {String} path
 */

/** @type {FsStoreConfig} */
let storeConfig = {
  dir: `${home}/.config/dash`,
  path: "",
};

/** @type {Config} */
//@ts-ignore
let config = {};

async function main() {
  let args = process.argv.slice(2);

  let confDir = removeFlagAndArg(args, ["-c", "--config-dir"]);
  if (confDir) {
    // TODO check validity
    storeConfig.dir = confDir;
  }

  config.dashsight = Dashsight.create({
    baseUrl: "", // TODO baseUrl is deprecated and should not be required
    insightBaseUrl:
      process.env.INSIGHT_BASE_URL || "https://insight.dash.org/insight-api",
    dashsightBaseUrl:
      process.env.DASHSIGHT_BASE_URL ||
      "https://dashsight.dashincubator.dev/insight-api",
    dashsocketBaseUrl:
      process.env.DASHSOCKET_BASE_URL || "https://insight.dash.org/socket.io",
  });

  storeConfig.path = Path.join(storeConfig.dir, "private-keys.json");
  config.store = Storage.create(storeConfig, config);
  // TODO
  //getWallets / getEachWallet
  //getWallets
  //getWallet
  //setWallet
  //getAddresses / getEachAddress
  //getAddress
  //setAddress

  config.safe = await config.store.init(storeConfig);

  let wallet = await Wallet.create(config);
  await config.store.save();

  let version = removeFlag(args, ["version", "-V", "--version"]);
  if (version) {
    console.info(`dashwallet v${pkg.version}`);
    process.exit(0);
    return;
  }

  let friend = removeFlag(args, ["friend"]);
  if (friend) {
    await befriend(config, wallet, args);
    return wallet;
  }

  let send = removeFlag(args, ["send", "pay"]);
  if (send) {
    await pay(config, wallet, args);
    return wallet;
  }

  let showBalances = removeFlag(args, ["balance", "balances"]);
  if (showBalances) {
    await getBalances(config, wallet, args);
    return wallet;
  }

  let forceSync = removeFlag(args, ["reindex", "sync"]);
  if (forceSync) {
    let now = Date.now();
    console.info("syncing...");
    await wallet.sync({ now: now, staletime: 0 });
    return wallet;
  }

  if (!args[0]) {
    usage();
    let help = removeFlag(args, ["help", "--help", "-h"]);
    if (help) {
      process.exit(0);
      return;
    }
    process.exit(1);
    return;
  }
  throw new Error(`'${args[0]}' is not a recognized subcommand`);
}

function usage() {
  console.info();
  console.info(`Usage:`);
  console.info(`    wallet balances`);
  console.info(`    wallet friend <handle> [xpub]`);
  console.info(`    wallet pay <handle|pay-addr> <DASH> [--dry-run]`);
  console.info(`    wallet sync`);
  console.info(`    wallet version`);
  console.info();
  console.info(`Global Options:`);
  console.info(`    --config-dir ~/.config/dash/`);
  console.info();
}

/**
 * @param {Config} config
 * @param {WalletInstance} wallet
 * @param {Array<String>} args
 */
async function befriend(config, wallet, args) {
  let [handle, xpub] = args;
  if (!handle) {
    throw Error(`Usage: wallet friend <handle> [xpub]`);
  }

  let [rxXPub, txXPub] = await wallet.befriend({ handle, xpub });
  if (txXPub) {
    let derivedRoot = HdKey.fromExtendedKey(txXPub);
    // TODO print out first **unused** address
    let userIndex = 0;
    //@ts-ignore
    let derivedChild = derivedRoot.deriveChild(userIndex);
    let addrFromXPubKey = await b58c.encode({
      version: Wallet.DashTypes.pubKeyHashVersion,
      pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
      compressed: true,
    });
    console.info();
    console.info(`Send DASH to '${handle}' at this address:`);
    // TODO QR
    console.info(addrFromXPubKey);
  }

  console.info();
  console.info(`Share this "dropbox" wallet (xpub) with '${handle}':`);
  // TODO QR
  console.info(rxXPub);
}

/**
 * @param {Config} config
 * @param {WalletInstance} wallet
 * @param {Array<String>} args
 */
async function pay(config, wallet, args) {
  let dryRun = removeFlag(args, ["--dry-run"]);

  let [handle, DASH] = args;
  if (!handle) {
    throw Error(
      `Usage: wallet send <handle> <DASH>\nExample: wallet send @joey 1.0`,
    );
  }

  let hasDecimal = DASH?.split(".").length;
  let satoshis = Wallet.toDuff(parseFloat(DASH));
  if (!hasDecimal || !satoshis) {
    throw Error(
      `DASH amount must be given in decimal form, such as 1.0 or 0.00100000`,
    );
  }

  let txHex = await wallet.createTx({ handle, amount: satoshis });

  if (dryRun) {
    console.info();
    console.info(
      "Transaction Hex: (inspect at https://live.blockcypher.com/dash/decodetx/)",
    );
    console.info(txHex);
    console.info();
    return;
  }

  let txResult = await config.dashsight.instantSend(txHex);
  console.info();
  console.info("Sent!");
  console.info();
  console.info(`https://insight.dash.org/tx/${txResult.body.txid}`);
  console.info();
}

/**
 * @param {Config} config
 * @param {WalletInstance} wallet
 * @param {Array<String>} args
 */
async function getBalances(config, wallet, args) {
  let balance = 0;

  console.info("syncing...");
  let now = Date.now();
  await wallet.sync({ now });

  console.info();
  console.info("Wallets:");
  console.info();

  let balances = await wallet.balances();
  Object.entries(balances).forEach(function ([wallet, satoshis]) {
    balance += satoshis;
    let floatBalance = parseFloat((satoshis / Wallet.DUFFS).toFixed(8));
    console.info(`    ${wallet}: ${floatBalance}`);
  });

  console.info();
  let floatBalance = parseFloat((balance / Wallet.DUFFS).toFixed(8));
  console.info(`Total: ${floatBalance}`);
}

/**
 * @param {Array<String>} arr
 * @param {Array<String>} aliases
 * @returns {String?}
 */
function removeFlag(arr, aliases) {
  /** @type {String?} */
  let arg = null;
  aliases.forEach(function (item) {
    let index = arr.indexOf(item);
    if (-1 === index) {
      return null;
    }

    if (arg) {
      throw Error(`duplicate flag ${item}`);
    }

    arg = arr.splice(index, 1)[0];
  });

  return arg;
}

let Storage = {}; //jshint ignore:line

/**
 * @param {FsStoreConfig} storeConfig
 * @param {Config} config
 */
Storage.create = function (storeConfig, config) {
  /** @type {Safe} */
  let safe;

  /**
   * @returns {Promise<Safe>}
   */
  async function init() {
    await Fs.mkdir(storeConfig.dir, { recursive: true });

    let fh = await Fs.open(storeConfig.path, "a");
    await fh.close();

    let text = await Fs.readFile(storeConfig.path, "utf8");
    /** @type {Safe} */
    safe = JSON.parse(text || "{}");

    return safe;
  }

  /**
   * Safely save the safe
   */
  async function save() {
    await safeReplace(storeConfig.path, JSON.stringify(safe, null, 2), "utf8");
  }

  return {
    init,
    save,
  };
};

/**
 * Safely replacing a file by renaming the original as a .bak before replacement
 * @param {String} filepath
 * @param {String|ArrayBuffer} contents
 * @param {String?} enc
 */
async function safeReplace(filepath, contents, enc = null) {
  await Fs.writeFile(`${filepath}.tmp`, contents, enc);
  await Fs.unlink(`${filepath}.bak`).catch(Object);
  await Fs.rename(`${filepath}`, `${filepath}.bak`);
  await Fs.rename(`${filepath}.tmp`, `${filepath}`);
}

/**
 * @param {Array<String>} arr
 * @param {Array<String>} aliases
 * @returns {String?}
 */
function removeFlagAndArg(arr, aliases) {
  /** @type {String?} */
  let arg = null;
  aliases.forEach(function (item) {
    let index = arr.indexOf(item);
    if (-1 === index) {
      return null;
    }

    // flag
    let flag = arr.splice(index, 1);

    if (arg) {
      throw Error(`duplicate flag ${item}`);
    }

    // flag's arg
    arg = arr.splice(index, 1)[0];
    if ("undefined" === typeof arg) {
      throw Error(`'${flag}' requires an argument`);
    }
  });

  return arg;
}

main()
  .then(async function (wallet) {
    if (wallet) {
      console.info();
      console.info("reindexing...");
      let now = Date.now();
      await wallet.sync({ now: now });
      console.info();
    }
    process.exit(0);
  })
  .catch(function (err) {
    console.error("Fail:");
    console.error(err.stack || err);
    if (err.failedTx) {
      console.error(
        "Failed Transaciton: (inspect at https://live.blockcypher.com/dash/decodetx/)",
      );
      console.error(err.failedTx);
    }
    if (err.response) {
      console.error(err.response);
    }
    process.exit(1);
  });
