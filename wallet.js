(function (exports) {
  "use strict";

  let Path = require("node:path");
  let Fs = require("node:fs/promises");
  let Os = require("node:os");

  let Base58Check = require("@root/base58check").Base58Check;

  let HdKey = require("hdkey");
  let Bip39 = require("bip39");
  //let Passphrase = require("@root/passphrase");

  let home = Os.homedir();
  /*
  require("dotenv").config({ path: ".env" });
  require("dotenv").config({ path: ".env.secret" });

  let Base58Check = require("@root/base58check").Base58Check;

  let Qr = require("./qr.js");
  */

  let DashTypes = {
    name: "dash",
    pubKeyHashVersion: "4c",
    privateKeyVersion: "cc",
    coinType: "5",
  };
  let b58c = Base58Check.create({
    pubKeyHashVersion: DashTypes.pubKeyHashVersion,
    privateKeyVersion: DashTypes.privateKeyVersion,
  });

  /**
   * @typedef Config
   * @prop {Safe} safe
   * @prop {String} dir
   * @prop {String} path
   * @prop {Wallet} main
   */

  /**
   * @typedef Safe
   * @prop {Object<String, Wallet>} wallets
   */

  /**
   * Mode is one of "rx" Receive, "tx" Send, or "full" for both
   * @typedef {"tx" | "rx" | "full"} WalletMode
   */

  /**
   * @typedef Wallet
   * @prop {String} name
   * @prop {String} label
   * @prop {WalletMode} mode
   * @prop {String?} device
   * @prop {Number} priority
   * @prop {String?} contact
   * @prop {Array<String>} mnemonic
   * @prop {String?} xpubkey - TODO move to public structure
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   */

  /** @type {Config} */
  //@ts-ignore
  let config = {
    dir: `${home}/.config/dash`,
    path: "",
  };
  async function main() {
    let args = process.argv.slice(2);
    let confDir = removeFlagAndArg(args, ["-c", "--config-dir"]);
    if (confDir) {
      // TODO check validity
      config.dir = confDir;
    }
    config.path = Path.join(config.dir, "private-keys.json");

    //@ts-ignore
    config.safe = await init(config);
    await save(config);

    let friend = removeFlag(args, ["friend"]);
    if (friend) {
      await befriend(config, args);
      return;
    }
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

  /**
   * @param {Config} config - modifiedh
   * @returns {Promise<Safe>}
   */
  async function init(config) {
    await Fs.mkdir(config.dir, { recursive: true });

    let fh = await Fs.open(config.path, "a");
    await fh.close();

    let text = await Fs.readFile(config.path, "utf8");
    /** @type {Safe} */
    let safe = JSON.parse(text || "{}");
    if (!safe.wallets) {
      safe.wallets = {};
    }
    if (!safe.wallets.main) {
      safe.wallets.main = generateWallet("main", "Main", "full", 1);
    }
    config.main = safe.wallets.main;

    return safe;
  }

  /**
   * Add and/or generate a friend's xpub key
   * @param {Config} config
   * @param {Array<String>} args
   */
  async function befriend(config, args) {
    let [handle, txXPub] = args;
    if (!handle) {
      throw Error(`Usage: wallet friend <handle> [xpub]`);
    }

    let safe = config.safe;

    let txWallet;
    if (txXPub) {
      /** @type {Wallet} */
      txWallet = Object.values(safe.wallets)
        .sort(function (a, b) {
          return (
            new Date(b.created_at).valueOf() - new Date(a.created_at).valueOf()
          );
        })
        .find(function (wallet) {
          return (
            wallet.contact === handle &&
            txXPub === wallet.xpubkey &&
            "tx" === wallet.mode
          );
        });
      if (!txWallet) {
        txWallet = importXPubKey(handle, txXPub);
        for (let i = 1; ; i += 1) {
          if (!safe.wallets[`${handle}:${i}`]) {
            safe.wallets[`${handle}:${i}`] = txWallet;
            break;
          }
        }
        await save(config);
      }
    } else {
      /** @type {Array<Wallet>} */
      let txws = Object.values(safe.wallets)
        .filter(function (wallet) {
          return wallet.contact === handle && "tx" === wallet.mode;
        })
        .sort(function (a, b) {
          return a.priority - b.priority;
        });
      txWallet = txws[0];
    }
    if (txWallet?.xpubkey) {
      let derivedRoot = HdKey.fromExtendedKey(txWallet.xpubkey);
      // TODO print out first **unused** address
      let userIndex = 0;
      //@ts-ignore
      let derivedChild = derivedRoot.deriveChild(userIndex);
      let addrFromXPubKey = await b58c.encode({
        version: DashTypes.pubKeyHashVersion,
        pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
      });

      console.info();
      console.info(`Send DASH to ${handle} with this address:`);
      // TODO QR
      console.info(addrFromXPubKey);
    }

    /*
      safe.wallets.main = generateWallet("main", "Main", "full");
      await safeReplace(confPath, JSON.stringify(safe, null, 2), "utf8");
    */

    /** @type {Wallet} */
    let rxWallet;
    /** @type {Array<Wallet>} */
    let rxws = Object.values(safe.wallets)
      .filter(function (wallet) {
        return wallet.contact === handle && "rx" === wallet.mode;
      })
      .sort(function (a, b) {
        return a.priority - b.priority;
      });
    if (!rxws.length) {
      // TODO use main wallet as seed
      rxWallet = generateWallet(handle, handle, "rx", 0);

      for (let i = 1; ; i += 1) {
        if (!safe.wallets[`${handle}:${i}`]) {
          safe.wallets[`${handle}:${i}`] = rxWallet;
          break;
        }
      }

      rxws.push(rxWallet);
    }
    rxWallet = rxws[0];
    // TODO use derivation from main for non-imported wallets
    let seed = await Bip39.mnemonicToSeed(rxWallet.mnemonic.join(" "));
    let privateRoot = HdKey.fromMasterSeed(seed);
    // The full path looks like `m/44'/5'/0'/0/0`
    // We "harden" the prefix `m/44'/5'/0'/0`
    let account = 0;
    let direction = 0;
    let derivationPath = `m/44'/${DashTypes.coinType}'/${account}'/${direction}`;
    let publicParentExtendedKey =
      privateRoot.derive(derivationPath).publicExtendedKey;

    console.info();
    console.info(`Share this address with '${handle}':`);
    // TODO QR
    console.info(publicParentExtendedKey);
  }

  /**
   * Generate a wallet with creation date set
   * @param {String} name - all lower case
   * @param {String} label - human friendly
   * @param {WalletMode} mode - rx, tx, or full
   * @param {Number} priority - sparse index, lowest is highest
   * @returns {Wallet}
   */
  function generateWallet(name, label, mode, priority) {
    let mnemonic = Bip39.generateMnemonic();
    if (!priority) {
      // TODO maybe just increment from the last?
      priority = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    }
    //let mnemonic = await Passphrase.generate(128);
    return {
      name: name.toLowerCase(),
      label: label,
      device: null,
      contact: null,
      mode: mode,
      priority: 0,
      mnemonic: mnemonic.split(/[,\s\n\|]+/g),
      xpubkey: null,
      created_at: new Date().toISOString(),
      archived_at: null,
    };
  }

  /**
   * Generate a wallet with creation date set
   * @param {String} handle
   * @param {String} xpubkey
   * @returns {Wallet}
   */
  function importXPubKey(handle, xpubkey) {
    let d = new Date();
    return {
      name: handle.toLowerCase(),
      label: handle,
      device: null,
      contact: handle,
      mode: "tx",
      priority: d.valueOf(),
      mnemonic: [],
      xpubkey: xpubkey,
      created_at: d.toISOString(),
      archived_at: null,
    };
  }

  /**
   * Safely save the safe
   * @param {Config} config
   */
  async function save(config) {
    await safeReplace(
      config.path,
      JSON.stringify(config.safe, null, 2),
      "utf8",
    );
  }

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
    .then(function () {
      console.info();
      process.exit(0);
    })
    .catch(function (err) {
      console.error("Fail:");
      console.error(err.stack || err);
      process.exit(1);
    });

  if ("undefined" !== typeof module) {
    //module.exports = Foo;
  }
})(("undefined" !== typeof module && module.exports) || window);
