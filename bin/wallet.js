#!/usr/bin/env node
"use strict";

/**
 * @typedef {import('../').Config} Config
 * @typedef {import('../').Safe} Safe
 * @typedef {import('../').Walleter} Walleter
 */

let Os = require("node:os");
let home = Os.homedir();

require("dotenv").config({ path: `${home}/.config/dash/env` });
require("dotenv").config({ path: `${home}/.config/dash/.env.secret` });

let Path = require("node:path");
let Fs = require("node:fs/promises");

let Wallet = require("../wallet.js");

let Base58Check = require("@root/base58check").Base58Check;
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
  storeConfig.path = Path.join(storeConfig.dir, "private-keys.json");
  config.store = Storage.create(storeConfig, config);

  config.safe = await config.store.init(storeConfig);

  let wallet = await Wallet.create(config);
  await config.store.save();

  let friend = removeFlag(args, ["friend"]);
  if (friend) {
    await befriend(config, wallet, args);
    return;
  }

  if (!args[0]) {
    usage();
    process.exit(1);
  }
  throw new Error(`'${args[0]}' is not a recognized subcommand`);
}

function usage() {
  console.info(`Usage:`);
  console.info(`    wallet friend <handle> [xpub]`);
}

/**
 * @param {Config} config
 * @param {Walleter} wallet
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
  /**
   * @returns {Promise<Safe>}
   */
  async function init() {
    await Fs.mkdir(storeConfig.dir, { recursive: true });

    let fh = await Fs.open(storeConfig.path, "a");
    await fh.close();

    let text = await Fs.readFile(storeConfig.path, "utf8");
    /** @type {Safe} */
    let safe = JSON.parse(text || "{}");

    return safe;
  }

  /**
   * Safely save the safe
   */
  async function save() {
    await safeReplace(
      storeConfig.path,
      JSON.stringify(config.safe, null, 2),
      "utf8",
    );
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
  .then(function () {
    console.info();
    process.exit(0);
  })
  .catch(function (err) {
    console.error("Fail:");
    console.error(err.stack || err);
    process.exit(1);
  });
