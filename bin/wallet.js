#!/usr/bin/env node
"use strict";

//@ts-ignore
let pkg = require("../package.json");

/**
 * @typedef {import('../').Config} Config
 * @typedef {import('../').Safe} Safe
 * @typedef {import('../').Cache} Cache
 * @typedef {import('dashsight').CoreUtxo} CoreUtxo
 * @typedef {import('../').MiniUtxo} MiniUtxo
 * @typedef {import('../').PayWallet} PayWallet
 * @typedef {import('../').Preferences} Preferences
 * @typedef {import('../').PrivateWallet} PrivateWallet
 * @typedef {import('../').WalletAddress} WalletAddress
 * @typedef {import('../').WalletInstance} WalletInstance
 * @typedef {CoreUtxo & WalletUtxoPartial} WalletUtxo
 *
 * @typedef WalletUtxoPartial
 * @prop {String} wallet
 */

let Path = require("node:path");
let Fs = require("node:fs/promises");

let Crypto = require("node:crypto");
let Os = require("node:os");

let envSuffix = "";
require("dotenv").config({ path: Path.join(__dirname, "../.env") });
if (process.env.DASH_ENV) {
  envSuffix = `.${process.env.DASH_ENV}`;
}

let home = Os.homedir();

let Wallet = require("../wallet.js");
let Cli = require("./_cli.js");

let b58c = require("../lib/dashcheck.js");
let Dashsight = require("dashsight");
let Secp256k1 = require("secp256k1");
// let Qr = require("./qr.js");

let colorize = require("@pinojs/json-colorizer");

/**
 * @typedef FsStoreConfig
 * @prop {String} dir
 * @prop {String} cachePath
 * @prop {String} payWalletsPath
 * @prop {String} preferencesPath
 * @prop {String} privateWalletsPath
 */

/** @type {Config} */
//@ts-ignore
let config = { staletime: 5 * 60 * 1000 };

/**
 * @callback Subcommand
 * @param {Config} config
 * @param {WalletInstance} wallet
 * @param {Array<String>} args
 */

let jsonOut = false;
let offline = false;

async function main() {
  /* jshint maxcomplexity:1000 */
  let args = process.argv.slice(2);

  let confName = Cli.removeOption(args, ["-c", "--config-name"]);
  if (null !== confName) {
    // intentional empty string on CLI takes precedence over ENVs
    envSuffix = confName;
  }

  /** @type {FsStoreConfig} */
  let storeConfig = {
    dir: `${home}/.config/dash${envSuffix}`,

    // paths
    cachePath: "",
    payWalletsPath: "",
    preferencesPath: "",
    privateWalletsPath: "",
  };
  if (envSuffix.length > 0) {
    console.error(`🚜 DASH_ENV=${process.env.DASH_ENV}`);
    console.error(`⚙️ ~/.config/dash${envSuffix}/`);
    console.error();
  }

  require("dotenv").config({ path: `${storeConfig.dir}/env` });
  require("dotenv").config({ path: `${storeConfig.dir}/.env.secret` });

  let confDir = removeFlagAndArg(args, ["-c", "--config-dir"]);
  if (confDir) {
    // TODO check validity
    storeConfig.dir = confDir;
  }

  let jsonArg = removeFlag(args, ["--json"]);
  if (jsonArg) {
    jsonOut = true;
  }

  let syncNow = removeFlagAndArg(args, ["--sync"]);
  if (syncNow) {
    config.staletime = 0;
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

  storeConfig.cachePath = Path.join(storeConfig.dir, "cache.json");
  storeConfig.payWalletsPath = Path.join(storeConfig.dir, "pay-wallets.json");
  storeConfig.preferencesPath = Path.join(storeConfig.dir, "preferences.json");
  storeConfig.privateWalletsPath = Path.join(
    storeConfig.dir,
    "private-wallets.json",
  );
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

  let version = removeFlag(args, ["version", "-V", "--version"]);
  if (version) {
    showVersion();
    process.exit(0);
    return;
  }

  let friend = removeFlag(args, ["contact", "friend"]);
  if (friend) {
    await befriend(config, wallet, args);
    return wallet;
  }

  let importWif = removeFlag(args, ["import"]);
  if (importWif) {
    await createWif(config, wallet, args);
    return wallet;
  }

  let list = removeFlag(args, ["coins", "list"]);
  if (list) {
    await listCoins(config, wallet, args);
    return wallet;
  }

  let send = removeFlag(args, ["send", "pay"]);
  if (send) {
    await pay(config, wallet, args);
    return wallet;
  }

  let showBalances = removeFlag(args, ["accounts", "balance", "balances"]);
  if (showBalances) {
    await getBalances(config, wallet, args);
    return null;
  }

  // TODO add note/comment to wallet, address, tx, etc

  let exp = removeFlag(args, ["export"]);
  if (exp) {
    await exportWif(config, wallet, args);
    return wallet;
  }

  let gen = removeFlag(args, ["create", "generate", "new"]);
  if (gen) {
    let genWif = removeFlag(args, ["wif", "address"]);
    if (!genWif) {
      console.error(`Unrecognized subcommand '${gen} ${args[0]}'`);
      process.exit(1);
    }
    await generateWif(config, wallet, args);
    return wallet;
  }

  let rm = removeFlag(args, ["delete", "remove", "rm"]);
  if (rm) {
    await remove(config, wallet, args);
    return wallet;
  }

  let showStats = removeFlag(args, ["stat", "stats", "status"]);
  if (showStats) {
    await stat(config, wallet, args);
    return wallet;
  }

  let forceSync = removeFlag(args, ["reindex", "sync"]);
  if (forceSync) {
    let now = Date.now();
    console.info("syncing...");
    await wallet.sync({ now: now, staletime: 0 });
    return null;
  }

  let help = removeFlag(args, ["help", "--help", "-h"]);
  if (help) {
    usage();
    return null;
  }

  if (!args[0]) {
    usage();
    process.exit(1);
    return;
  }

  throw new Error(`'${args[0]}' is not a recognized subcommand`);
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

let SHORT_VERSION = `dashwallet v${pkg.version} - ${pkg.description}`;

function showVersion() {
  console.info(SHORT_VERSION);
  let tuples = Object.entries(pkg.dependencies);
  for (let [name, version] of tuples) {
    if (!name.match("dash")) {
      continue;
    }
    console.info(`  ${name} v${version}`);
  }
}

let USAGE = [
  `${SHORT_VERSION}`,
  ``,
  `USAGE:`,
  `    wallet <subcommand> [flags] [options] [--] [args]`,
  ``,
  `SUBCOMMANDS:`,
  `    accounts                           show accounts (and extra wallets)`,
  `    export <addr> [./dir/ or x.wif]    write private keys to disk`,
  `    contact <handle> [xpub-or-addr]    add contact or show xpubs & addrs`,
  `    generate address                   gen and store one-off wif`,
  `    import <./path/to.wif>             save private keys`,
  `    coins [--sort wallet,amount,addr]  show all spendable coins`,
  `    send <handle|pay-addr> <DASH>      send to an address or contact`,
  `                    [--dry-run] [--coins Xxxxx:xx:0,...]`,
  // TODO or contact
  `    remove <addr> [--no-wif]           remove stand-alone key`,
  `    stat <addr>                        show current coins & balance`,
  `    sync                               update address caches`,
  `    version                            show version and exit`,
  ``,
  `OPTIONS:`,
  `    DASH_ENV, -c, --config-name ''     use ~/.config/dash{.suffix}/`,
  `    --config-dir ~/.config/dash/       change full config path`,
  `    --json                             output as JSON (if possible)`,
  //`    --offline                             no sync, cache updates, balance checks, etc`,
  `    --sync                             wait for sync first`,
  ``,
].join("\n");

function usage() {
  console.info(USAGE);
}

/** @type {Subcommand} */
async function befriend(config, wallet, args) {
  let [handle, xpubOrAddr] = args;
  if (!handle) {
    throw Error(`Usage: wallet friend <handle> [xpub-or-static-addr]`);
  }

  let xpub = "";
  let addr = "";
  let isXPub = await Wallet.isXPub(xpubOrAddr);
  if (isXPub) {
    xpub = xpubOrAddr;
  } else {
    addr = xpubOrAddr;
  }

  let [rxXPub, txWallet] = await wallet.befriend({
    handle,
    xpub,
    addr,
  });

  let txAddr = {
    addr: txWallet?.addr || "",
    index: 0,
  };
  if (txWallet?.xpub) {
    txAddr = await wallet.createNextPayAddr({ handle });
  }
  if (txAddr.addr) {
    let addrIndex = `#${txAddr.index}`;
    if (txWallet?.addr) {
      addrIndex = `multi-use`;
    }

    console.info();
    console.info(`Send DASH to '${handle}' at this address (${addrIndex}):`);
    // TODO QR
    console.info(`${txAddr.addr}`);
  }

  console.info();
  console.info(`Share this "dropbox" wallet (xpub) with '${handle}':`);
  // TODO QR
  console.info(rxXPub);
  console.info();
  let count = 3;
  let rxAddr = await wallet.createNextReceiveAddr({ handle, count });
  if (count === 1) {
    console.info(`(next address is '${rxAddr.addr}')`);
    return;
  }
  console.info(`Next addresses:`);
  rxAddr.addrs.forEach(
    /**
     * @param {String} addr
     * @param {Number} i
     */
    function (addr, i) {
      let index = i + rxAddr.start;
      console.info(`    ${addr} (${index})`);
    },
  );
}

/** @type {Subcommand} */
async function createWif(config, wallet, args) {
  let wifPaths = args;
  if (!wifPaths.length) {
    throw Error(`Usage: wallet import <./path/1.wif> [./path/2.wif, ...]`);
  }

  /** @type {Array<String>} */
  let wifs = [];
  await wifPaths.reduce(async function (promise, wifPath) {
    await promise;

    let wif = await Fs.readFile(wifPath, "utf8");
    // TODO check wif-y-ness
    wifs.push(wif.trim());
  }, Promise.resolve());

  let addrInfos = await wallet.import({
    wifs,
  });

  console.info();
  console.info(`Imported the following into the standalone 'wifs' wallet:`);
  addrInfos.forEach(
    /** @param {WalletAddress} addrInfo */
    function (addrInfo) {
      let totalBalance = Wallet.getBalance(addrInfo.utxos);
      let dashBalance = Wallet.toDash(totalBalance).toFixed(8);
      console.info(`    ${addrInfo.addr} (Đ${dashBalance})`);
    },
  );
}

/** @type {Subcommand} */
async function remove(config, wallet, args) {
  let noWif = removeFlag(args, ["--no-wif"]);
  let force = removeFlag(args, ["--force"]);
  let [addrPrefix] = args;

  if (!addrPrefix?.length) {
    throw Error(`Usage: wallet remove <addr> [--no-wif]`);
  }

  let addrInfo = await wallet.findAddr(addrPrefix);
  if (!addrInfo) {
    console.error();
    console.error(`'${addrPrefix}' did not matches any address in any wallets`);
    console.error();
    process.exit(1);
  }

  let wifInfo = await wallet.findWif({ addr: addrInfo.addr });
  if (!wifInfo) {
    console.info();
    console.info(`Deleted cached info for '${addrInfo.addr}'`);
    console.info(`(no associated WIF was found`);
    return;
  }

  let totalBalance = Wallet.getBalance(wifInfo.utxos);
  if (totalBalance > 0) {
    if (!force) {
      let dashBalance = Wallet.toDash(totalBalance).toFixed(8);
      console.error();
      console.error(
        `'${addrInfo.addr}' still has a balance of ${dashBalance}. Use --force to continue..`,
      );
      console.error();

      process.exit(1);
      return;
    }
  }

  await wallet.removeWif({ addr: addrInfo.addr });
  if (!noWif) {
    console.info();
    console.info(`Removed WIF '${wifInfo.wif}'`);
    console.info("(you may wish to save that as a backup)");
    return;
  }

  console.info();
  console.info(`Removed '${addrInfo.addr}' (and its associated WIF)`);
}

/** @type {Subcommand} */
async function exportWif(config, wallet, args) {
  let [addrPrefix, wifPath] = args;

  if (!addrPrefix?.length) {
    throw Error(`Usage: wallet export <addr> [./dir/ or ./file.wif]`);
  }

  let addrInfos = await wallet.findAddrs(addrPrefix);
  if (!addrInfos.length) {
    console.error();
    console.error(`'${addrPrefix}' did not matches any address in any wallets`);
    console.error();
    process.exit(1);
  }

  if (addrInfos.length > 1) {
    console.error();
    console.error(
      `'${addrPrefix}' matches the following addresses (pick one):`,
    );
    console.error();
    addrInfos.forEach(
      /** @param {Required<WalletAddress>} addrInfo */
      function (addrInfo) {
        console.error(`    ${addrInfo.addr}`);
      },
    );
    console.error();
    process.exit(1);
  }

  let addrInfo = addrInfos[0];
  let wifInfo = await wallet.findWif(addrInfo);

  if (!wifPath) {
    wifPath = ".";
  }

  let showAddr = true;
  let fullPath;
  let stat = await Fs.stat(wifPath).catch(function (err) {
    if ("ENOENT" === err.code) {
      return null;
    }
    throw err;
  });
  if (!stat) {
    // assumed to be a file that doesn't exist
    fullPath = wifPath;
  } else if (stat?.isDirectory()) {
    showAddr = false;
    fullPath = Path.join(wifPath, `${addrInfo.addr}.wif`);
    let pathish = fullPath.startsWith(".") || fullPath.startsWith("/");
    if (!pathish) {
      fullPath = `./${fullPath}`;
    }
  } else {
    // TODO --force
    throw new Error(`'${wifPath}' already exists`);
  }

  await Fs.writeFile(fullPath, wifInfo.wif, "ascii");

  console.info();
  let addr = "";
  if (showAddr) {
    addr = ` (${addrInfo.addr})`;
  }
  console.info(`Wrote WIF to '${fullPath}'${addr}`);
}

/** @type {Subcommand} */
async function generateWif(config, wallet, args) {
  let privKey;
  for (;;) {
    // TODO browser
    privKey = Crypto.randomBytes(32);
    if (Secp256k1.privateKeyVerify(privKey)) {
      break;
    }
  }

  let wif = await b58c.encode({
    privateKey: privKey.toString("hex"),
    compressed: true,
  });

  // TODO --no-import
  // TODO --offline (we don't need to check txs on what we just generated)
  let addrInfos = await wallet.import({ wifs: [wif] });
  let addrInfo = addrInfos[0];

  console.info();
  console.info(`Generated (and imported) the following private key (wif):`);
  console.info();
  console.info(`    ${addrInfo.addr}`);
  console.info();
}

// pay <handle> <coins> send these coins to person x, minus fees
// pay <handle> <amount> [coins] send this amount to person x,
//     using ALL coins, and send back the change
/** @type {Subcommand} */
async function pay(config, wallet, args) {
  let dryRun = removeFlag(args, ["--dry-run"]);
  let coinList = removeFlagAndArg(args, ["--coins"]);

  // TODO sort between addrs, wifs, and utxos
  let [handle, amountOrCoins] = args;
  let isComplete = handle && amountOrCoins;
  if (!isComplete) {
    throw Error(
      [
        `Usage: wallet pay <handle-or-addr> <amount-or-coins>`,
        `Example: wallet send @joey 1.0`,
        `Example: wallet send @joey Xzzz:xx:0,Xyyy:ab:1`,
        `Example: wallet send @joey 1.0 --coins Xzzz:xx:0,Xyyy:ab:1`,
      ].join("\n"),
    );
  }

  let satoshis;
  let isCoin = amountOrCoins.startsWith("X");
  if (isCoin) {
    if (coinList?.length) {
      let err = new Error(
        `cannot specify '${amountOrCoins}' and --coins '${coinList}'`,
      );
      //@ts-ignore
      err.type = "E_BAD_INPUT";
      throw err;
    }
    coinList = amountOrCoins;
    satoshis = null;
  } else {
    let hasDecimal = amountOrCoins?.split(".").length >= 2;
    satoshis = Wallet.toDuff(parseFloat(amountOrCoins));
    if (!hasDecimal || !satoshis) {
      let err = new Error(
        `DASH amount must be given in decimal form, such as 1.0 or 0.00100000, not '${amountOrCoins}'`,
      );
      //@ts-ignore
      err.type = "E_BAD_INPUT";
      throw err;
    }
  }

  let utxos = await coinListToUtxos(wallet, coinList);

  let tx = await wallet.createTx({
    handle: handle,
    amount: satoshis,
    utxos: utxos,
  });

  console.info();
  if (dryRun) {
    console.info(
      "Transaction Hex: (inspect at https://live.blockcypher.com/dash/decodetx/)",
    );
    console.info(tx.hex);
  } else {
    // TODO sendTx
    let txResult = await config.dashsight.instantSend(tx.hex);
    console.info("Sent!");
    console.info();
    console.info(`https://insight.dash.org/tx/${txResult.body.txid}`);
  }
  console.info();

  let wutxos = tx.utxos.map(
    /**
     * @param {CoreUtxo} utxo
     * @return {WalletUtxo} utxo
     */
    function (utxo) {
      let walletName = config.safe.cache.addresses[utxo.address].wallet;
      return Object.assign({ wallet: walletName }, utxo);
    },
  );

  wutxos.sort(
    /** @type {CoinSorter} */
    function (a, b) {
      let result = 0;
      ["amount", "wallet", "addr"].some(function (sortBy) {
        if (!coinSorters[sortBy]) {
          throw new Error(`unrecognized sort '${sortBy}'`);
        }

        //@ts-ignore - TODO
        result = coinSorters[sortBy](sortatizeUtxo(a), sortatizeUtxo(b));
        return result;
      });
      return result;
    },
  );

  let maxLen = Wallet.toDash(wutxos[0].satoshis).toFixed(8).length;
  //let amountLabel = "Amount".padStart(maxLen, " ");

  console.info(`Coin inputs (utxos):`);

  //console.info(`    ${amountLabel}  Coin (Addr:Tx:Out)  Wallet`);
  wutxos.forEach(
    /** @param {WalletUtxo} utxo */
    function (utxo) {
      let dashAmount = Wallet.toDash(utxo.satoshis)
        .toFixed(8)
        .padStart(maxLen, " ");
      let coin = utxoToCoin(utxo.address, utxo);

      console.info(
        `                         ${dashAmount}  ${coin}  ${utxo.wallet}`,
      );
    },
  );
  let balanceAmount = Wallet.toDash(tx.balance)
    .toFixed(8)
    .padStart(maxLen, " ");
  console.info(`                       -------------`);
  console.info(`                         ${balanceAmount}  (total)`);

  console.info();

  let sentAmount = Wallet.toDash(tx.amount).toFixed(8).padStart(maxLen, " ");
  console.info(`Paid to Recipient:       ${sentAmount}  (${handle})`);

  let feeAmount = Wallet.toDash(tx.fee).toFixed(8).padStart(maxLen, " ");
  console.info(`Network Fee:             ${feeAmount}`);

  let changeAmount = Wallet.toDash(tx.change).toFixed(8).padStart(maxLen, " ");
  console.info(`Change:                  ${changeAmount}`);

  if (!dryRun) {
    // TODO move to sendTx
    let now = Date.now();
    await wallet._spendUtxos({
      utxos: tx.utxos,
      now: now,
    });
    await wallet._updateAddrInfo(tx._changeAddr, now, 0);

    // TODO pre-sync with return info
    config.safe.cache.addresses[tx._changeAddr].sync_at = now + 3000;
    let recipAddrInfo = config.safe.cache.addresses[tx._recipientAddr];
    if (recipAddrInfo) {
      recipAddrInfo.sync_at = now + 3000;
    }
  }

  await config.store.save(config.safe.cache);
}

/**
 * @param {WalletInstance} wallet
 * @param {String?} coinList
 * @returns {Promise<Array<CoreUtxo>?>}
 */
async function coinListToUtxos(wallet, coinList) {
  if (null === coinList) {
    return null;
  }

  // '' => []
  // 'a,b c,,  d' => ['a', 'b', 'c', 'd']
  let coins = coinList.split(/[\s,]+/).filter(Boolean);

  /** @type {Array<CoreUtxo>} utxos */
  let utxos = [];
  /** @type {Object.<String, Boolean>} dups */
  let dups = {};

  await coins.reduce(async function (promise, coin) {
    await promise;

    // 'Xaddr1'
    // 'Xaddr2:tx:0'
    let [addrPre, txPre, voutStr] = coin.split(":");
    let addrUtxos = await mustGetAddrUtxos(wallet, addrPre);

    if (!txPre) {
      addrUtxos.forEach(
        /** @param {CoreUtxo} utxo */
        function addUtxo(utxo) {
          let dupId = `${utxo.address}:${utxo.txId}:${utxo.outputIndex}`;
          if (dups[dupId]) {
            return;
          }

          dups[dupId] = true;

          utxos.push(utxo);
        },
      );
      return;
    }

    let utxo = addrUtxos.find(
      /** @param {CoreUtxo} utxo */
      function byMatchingCoin(utxo) {
        let dupId = `${utxo.address}:${utxo.txId}:${utxo.outputIndex}`;
        if (dups[dupId]) {
          return false;
        }

        if (!utxo.txId.startsWith(txPre)) {
          // TODO how to ensure no short 'txPre's?
          return false;
        }

        let vout = parseFloat(voutStr);
        if (vout !== utxo.outputIndex) {
          return false;
        }

        dups[dupId] = true;
        return true;
      },
    );
    if (!utxo) {
      throw new Error(`no coin matches '${coin}'`);
    }

    utxos.push(utxo);
  }, Promise.resolve());

  return utxos;
}

/**
 * @param {WalletInstance} wallet
 * @param {String} addrPrefix
 */
async function mustGetAddrUtxos(wallet, addrPrefix) {
  let addrInfos = await wallet.findAddrs(addrPrefix);
  if (!addrInfos.length) {
    let errMsg = `'${addrPrefix}' did not matches any address in any wallets`;
    let err = Error(errMsg);
    //@ts-ignore
    err.type = "E_BAD_INPUT";
    throw err;
  }

  if (addrInfos.length > 1) {
    let errLines = [
      `'${addrPrefix}' matches the following addresses (pick one):`,
    ];
    errLines.push("");
    addrInfos.forEach(
      /** @param {Required<WalletAddress>} addrInfo */
      function (addrInfo) {
        errLines.push(`    ${addrInfo.addr}`);
      },
    );

    let err = new Error(errLines.join("\n"));
    //@ts-ignore
    err.type = "E_BAD_INPUT";
    throw err;
  }

  let addrInfo = addrInfos[0];
  let utxos = addrInfo.utxos.map(
    /** @param {MiniUtxo} utxo */
    function (utxo) {
      return Object.assign({ address: addrInfo.addr }, utxo);
    },
  );

  return utxos;
}

/** @type {Subcommand} */
async function getBalances(config, wallet, args) {
  let balance = 0;

  console.info("syncing... (updating info over 5 minutes old)");
  let now = Date.now();
  await wallet.sync({ now: now, staletime: config.staletime });

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
 * @callback CoinSorter
 * @param {Pick<WalletUtxo,"address"|"satoshis"|"wallet">} a
 * @param {Pick<WalletUtxo,"address"|"satoshis"|"wallet">} b
 * @returns {Number}
 */

/** @type {Object.<String, CoinSorter>} */
let coinSorters = {
  addr:
    /** @type {CoinSorter} */
    function byAddrAsc(a, b) {
      if (a.address > b.address) {
        return 1;
      }
      if (a.address < b.address) {
        return -1;
      }
      return 0;
    },
  amount:
    /** @type {CoinSorter} */
    function bySatoshisDesc(a, b) {
      return b.satoshis - a.satoshis;
    },
  wallet:
    /** @type {CoinSorter} */
    function byWalletAsc(a, b) {
      if (a.wallet > b.wallet) {
        return 1;
      }
      if (a.wallet < b.wallet) {
        return -1;
      }
      return 0;
    },
};

/** @type {Subcommand} */
async function listCoins(config, wallet, args) {
  let sortArg = removeFlagAndArg(args, ["--sort"]) || "";
  let sortBys = sortArg.split(/[\s,]/).filter(Boolean);
  if (!sortBys.length) {
    sortBys = ["wallet", "amount", "addr"];
  }

  let safe = config.safe;

  let _utxos = await wallet.utxos();
  if (!_utxos.length) {
    let sadMsg = `Your wallet is empty. No coins. Sad day. 😢`;
    if (jsonOut) {
      console.error(sadMsg);
      console.info(JSON.stringify("[]", null, 2));
      return;
    }
    console.info();
    console.info(sadMsg);
    return;
  }

  let utxos = _utxos.map(
    /** @param {CoreUtxo} utxo */
    function (utxo) {
      return Object.assign(
        {
          wallet: safe.cache.addresses[utxo.address].wallet,
        },
        utxo,
      );
    },
  );
  utxos.sort(
    /** @type {CoinSorter} */
    function (a, b) {
      let result = 0;
      sortBys.some(function (sortBy) {
        if (!coinSorters[sortBy]) {
          throw new Error(`unrecognized sort '${sortBy}'`);
        }

        //@ts-ignore - TODO
        result = coinSorters[sortBy](sortatizeUtxo(a), sortatizeUtxo(b));
        return result;
      });
      return result;
    },
  );

  let maxLen = Wallet.toDash(utxos[0].satoshis).toFixed(8).length;
  let amountLabel = "Amount".padStart(maxLen, " ");

  if (jsonOut) {
    console.info(JSON.stringify(utxos, null, 2));
    return;
  }
  console.info();
  console.info(`    ${amountLabel}  Coin (Addr:Tx:Out)    Wallet`);

  /** @type {Object.<String, Boolean>} */
  let usedAddrs = {};
  utxos.forEach(
    /** @param {MiniUtxo} utxo */
    function (utxo) {
      let dashAmount = Wallet.toDash(utxo.satoshis)
        .toFixed(8)
        .padStart(maxLen, " ");

      let txId = utxo.txId.slice(0, 6);

      let addrId = utxo.address.slice(0, 9);
      let reused = " ";
      if (!usedAddrs[utxo.address]) {
        usedAddrs[utxo.address] = true;
      } else {
        reused = `*`;
      }

      let walletName = safe.cache.addresses[utxo.address].wallet;

      console.info(
        `    ${dashAmount}  ${addrId}:${txId}:${utxo.outputIndex} ${reused}  ${walletName}`,
      );
    },
  );
}

/** @param {WalletUtxo} utxo */
function sortatizeUtxo(utxo) {
  return Object.assign({}, utxo, {
    wallet: utxo.wallet
      .toLowerCase()
      // make contacts sort lower
      .replace(/^@/, "|"),
  });
}

/**
 * @param {String} addr
 * @param {MiniUtxo} utxo
 * @returns {String} - `${addrId}:${txId}:${utxo.outputIndex}` (18 chars)
 */
function utxoToCoin(addr, utxo) {
  let addrId = addr.slice(0, 9);
  let txId = utxo.txId.slice(0, 6);

  return `${addrId}:${txId}:${utxo.outputIndex}`;
}

/** @type {Subcommand} */
async function stat(config, wallet, args) {
  let [addrPrefix] = args;
  if (!addrPrefix) {
    throw Error(`Usage: wallet stat <addr-like>`);
  }

  let addrInfos = await wallet.findAddrs(addrPrefix);
  if (!addrInfos.length) {
    let searchable = !offline && addrPrefix.length === 34;
    if (!searchable) {
      console.error();
      console.error(`'${addrPrefix}' did not match any address in any wallets`);
      console.error();
      process.exit(1);
      return;
    }

    let utxos = await config.dashsight.getCoreUtxos(addrPrefix);
    if (jsonOut) {
      let json = JSON.stringify(utxos, null, 2);
      if (process.stdout.isTTY) {
        json = colorize(json);
      }
      console.info(json);
      return;
    }
    addrInfos = [
      {
        wallet: "(not imported)",
        hdpath: "-",
        index: "-",
        addr: addrPrefix,
        utxos: utxos,
      },
    ];
  }

  if (addrInfos.length > 1) {
    let errLines = [
      `'${addrPrefix}' matches the following addresses (pick one):`,
    ];
    errLines.push("");
    addrInfos.forEach(
      /** @param {Required<WalletAddress>} addrInfo */
      function (addrInfo) {
        errLines.push(`    ${addrInfo.addr}`);
      },
    );

    let err = new Error(errLines.join("\n"));
    //@ts-ignore
    err.type = "E_BAD_INPUT";
    throw err;
  }

  if (!addrInfos[0].utxos) {
    let addrs = addrInfos.map(
      /** @param {Required<WalletAddress>} addrInfo */
      function (addrInfo) {
        return addrInfo.addr;
      },
    );
    addrInfos = await wallet.stat({ addrs: addrs });
  }

  addrInfos.forEach(printAddrInfo);

  /** @param {WalletAddress} addrInfo */
  function printAddrInfo(addrInfo) {
    // TODO timestamp
    let totalBalance = Wallet.getBalance(addrInfo.utxos);
    let dashBalance = Wallet.toDash(totalBalance).toFixed(8);
    console.info(
      `${addrInfo.addr} (${dashBalance}) - ${addrInfo.wallet}:${addrInfo.hdpath}/${addrInfo.index}`,
    );
    if (addrInfo.utxos.length > 1) {
      addrInfo.utxos.forEach(
        /** @param {MiniUtxo} utxo */
        function (utxo) {
          console.info(`    ${utxo.satoshis}`);
        },
      );
    }
  }
}

let Storage = {}; //jshint ignore:line

/**
 * @param {FsStoreConfig} storeConfig
 * @param {Config} config
 */
Storage.create = function (storeConfig, config) {
  /**
   * Fetches all the config and wallet data
   * @returns {Promise<Safe>}
   */
  async function init() {
    let cache = await _init(storeConfig.cachePath);
    let payWallets = await _init(storeConfig.payWalletsPath);
    let preferences = await _init(storeConfig.preferencesPath);
    let privateWallets = await _init(storeConfig.privateWalletsPath);

    return {
      cache,
      payWallets,
      preferences,
      privateWallets,
    };
  }

  /**
   * Fetches all data from the file
   * @param {String} path
   */
  async function _init(path) {
    await Fs.mkdir(storeConfig.dir, { recursive: true });

    let fh = await Fs.open(path, "a");
    await fh.close();

    let text = await Fs.readFile(path, "utf8");
    let data = JSON.parse(text || "{}");
    /*
    data._path = function () {
      return path;
    };
    */
    // TODO find a better way to do this
    Object.defineProperty(data, "_path", {
      enumerable: false,
      value: function () {
        return path;
      },
    });

    return data;
  }

  /**
   * @typedef {Object<String, PayWallet>} DPayWallets
   * @typedef {Object<String, PrivateWallet>} DPrivateWallets
   */

  /**
   * Safely save the safe
   * TODO - encrypt private wallets
   * @param {Cache|DPayWallets|DPrivateWallets|Preferences} data
   * @returns {Promise<void>}
   */
  async function save(data) {
    if ("function" !== typeof data?._path) {
      let t = typeof data;
      let keys = Object.keys(data || {});
      throw new Error(
        `[Sanity Fail] no '_path' on 'data' (${t}: ${keys}) (probably a developer error)`,
      );
    }
    let path = data._path();
    await safeReplace(path, JSON.stringify(data, null, 2), "utf8");
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

main()
  .then(async function (wallet) {
    if (!wallet) {
      process.exit(0);
    }

    // TODO 'q' to quit with process.stdin listener?
    let syncMsg = "syncing... (ctrl+c to quit)";
    if (jsonOut) {
      console.error();
      console.error(syncMsg);
    } else {
      console.info();
      console.info(syncMsg);
    }
    let now = Date.now();
    await wallet.sync({ now: now, staletime: config.staletime });
    console.info();

    process.exit(0);
  })
  .catch(function (err) {
    if ("E_BAD_INPUT" === err.type) {
      console.error("Error:");
      console.error();
      console.error(err.message);
      console.error();
      process.exit(1);
      return;
    }

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
