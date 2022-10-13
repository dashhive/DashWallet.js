(function (exports) {
  "use strict";

  let Wallet = {};
  //@ts-ignore
  exports.Wallet = Wallet;

  let HdKey = require("hdkey");
  let Bip39 = require("bip39");
  //let Passphrase = require("@root/passphrase");

  Wallet.DashTypes = {
    name: "dash",
    pubKeyHashVersion: "4c",
    privateKeyVersion: "cc",
    coinType: "5",
  };

  /**
   * @typedef Config
   * @prop {Safe} safe
   * @prop {Store} store
   * @prop {Wallet} main
   */

  /**
   * @typedef Store
   * @prop {Function} save
   */

  /**
   * @typedef Walleter
   * @prop {WalleterBefriend} befriend
   */

  /**
   * // TODO doc: send-only (to you) xpub key to share with friend
   * Add and/or generate a friend's xpub key
   * @callback WalleterBefriend
   * @param {BefriendOpts} opts
   * @returns {Promise<[String, String]>} - rxXPub & txXPub
   *
   * @typedef BefriendOpts
   * @prop {String} handle
   * @prop {String} xpub - receive-only xpub key from friend
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
   * @typedef PrivateWallet
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

  /**
   * @param {Config} config - modifiedh
   * @returns {Promise<Walleter>}
   */
  Wallet.create = async function (config) {
    let wallet = {};

    /** @type WalleterBefriend */
    wallet.befriend = async function ({ handle, xpub }) {
      if (!handle) {
        throw new Error(`no 'handle' given`);
      }
      let txXPub = xpub;

      let safe = config.safe;

      let txWallet;
      if (txXPub) {
        /** @type {PrivateWallet} */
        txWallet = Object.values(safe.wallets)
          .sort(function (a, b) {
            return (
              new Date(b.created_at).valueOf() -
              new Date(a.created_at).valueOf()
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
          txWallet = Wallet.importXPub(handle, txXPub);
          for (let i = 1; ; i += 1) {
            if (!safe.wallets[`${handle}:${i}`]) {
              safe.wallets[`${handle}:${i}`] = txWallet;
              break;
            }
          }
          await config.store.save();
        }
      } else {
        /** @type {Array<PrivateWallet>} */
        let txws = Object.values(safe.wallets)
          .filter(function (wallet) {
            return wallet.contact === handle && "tx" === wallet.mode;
          })
          .sort(function (a, b) {
            return a.priority - b.priority;
          });
        txWallet = txws[0];
      }

      /*
      safe.wallets.main = generateWallet("main", "Main", "full");
      await safeReplace(confPath, JSON.stringify(safe, null, 2), "utf8");
      */

      /** @type {PrivateWallet} */
      let rxWallet;
      /** @type {Array<PrivateWallet>} */
      let rxws = Object.values(safe.wallets)
        .filter(function (wallet) {
          return wallet.contact === handle && "rx" === wallet.mode;
        })
        .sort(function (a, b) {
          return a.priority - b.priority;
        });
      if (!rxws.length) {
        // TODO use main wallet as seed
        rxWallet = Wallet.generate(handle, handle, "rx", 0);

        for (let i = 1; ; i += 1) {
          if (!safe.wallets[`${handle}:${i}`]) {
            safe.wallets[`${handle}:${i}`] = rxWallet;
            break;
          }
        }
        await config.store.save();

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
      let derivationPath = `m/44'/${Wallet.DashTypes.coinType}'/${account}'/${direction}`;
      let publicParentExtendedKey =
        privateRoot.derive(derivationPath).publicExtendedKey;
      return [publicParentExtendedKey, txWallet?.xpubkey];
    };

    // init
    let safe = config.safe;
    if (!safe.wallets) {
      safe.wallets = {};
    }
    if (!safe.wallets.main) {
      safe.wallets.main = Wallet.generate("main", "Main", "full", 1);
      await config.store.save();
    }
    config.main = safe.wallets.main;

    return wallet;
  };

  /**
   * Generate a wallet with creation date set
   * @param {String} name - all lower case
   * @param {String} label - human friendly
   * @param {WalletMode} mode - rx, tx, or full
   * @param {Number} priority - sparse index, lowest is highest
   * @returns {PrivateWallet}
   */
  Wallet.generate = function (name, label, mode, priority) {
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
  };

  /**
   * Generate a wallet with creation date set
   * @param {String} handle
   * @param {String} xpubkey
   * @returns {PrivateWallet}
   */
  Wallet.importXPub = function (handle, xpubkey) {
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
  };

  if ("undefined" !== typeof module) {
    module.exports = Wallet;
  }
})(("undefined" !== typeof module && module.exports) || window);
