(function (exports) {
  "use strict";

  let Wallet = {};
  //@ts-ignore
  exports.Wallet = Wallet;

  let HdKey = require("hdkey");
  let Bip39 = require("bip39");
  //let Passphrase = require("@root/passphrase");
  let DashApi = require("./dashapi.js");

  /** @typedef {import('dashsight').DashSightInstance} DashSightInstance */
  /** @typedef {import('dashsight').InsightUtxo} InsightUtxo */

  //@ts-ignore
  //let Dashcore = exports.dashcore || require("./lib/dashcore.js");
  //let Transaction = Dashcore.Transaction;

  /**
   * Like CoreUtxo, but only the parts we need for a transaction
   * @typedef MiniUtxo
   * @property {String} [txId]
   * @property {Number} outputIndex - a.k.a. vout index
   * @property {String} address - coined pubKeyHash
   * @property {String} script - hex
   * @property {Number} satoshis
   */

  //@ts-ignore
  let b58c = exports.DashCheck || require("./lib/dashcheck.js");

  /**
   * @typedef Config
   * @prop {Safe} safe
   * @prop {Store} store
   * @prop {Wallet} main
   * @prop {DashSightInstance} dashsight
   */

  /**
   * @typedef Store
   * @prop {Function} save
   */

  /**
   * @typedef Walleter
   * @prop {WalleterBefriend} befriend
   * @prop {Reindexer} reindex
   */

  /**
   * @callback Reindexer
   * @param {Number} now - value to be used for 'checked_at'
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
   * Find a friend's xpub key
   * @callback WalleterFindFriend
   * @param {FindFriendOpts} opts
   * @returns {Array<PayWallet>} - wallets matching this friend
   *
   * @typedef FindFriendOpts
   * @prop {String} handle
   */

  /**
   * @typedef Safe
   * @prop {Object<String, Wallet>} wallets
   * @prop {Object<String, Wallet>} addresses
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
   * @prop {String?} xpubkey - TODO move to public structure TODO rename xpub
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   */

  /**
   * @typedef PayWallet
   * @prop {String} name
   * @prop {String} label
   * @prop {WalletMode} mode
   * @prop {String?} device
   * @prop {Number} priority
   * @prop {String?} contact
   * @prop {String} xpubkey - TODO move to public structure TODO rename xpub
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   */

  Wallet.DashTypes = DashApi.DashTypes;
  Wallet.DUFFS = DashApi.DUFFS;

  /**
   * @param {Config} config
   * @returns {Promise<Walleter>}
   */
  Wallet.create = async function (config) {
    let safe = config.safe;
    let wallet = {};
    let dashsight = config.dashsight;

    /** @type WalleterBefriend */
    wallet.befriend = async function ({ handle, xpub }) {
      if (!handle) {
        throw new Error(`no 'handle' given`);
      }
      let txXPub = xpub;

      let safe = config.safe;

      /** @type {PayWallet} */
      let txWallet;
      if (txXPub) {
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
        let txws = wallet.findFriend({ handle });
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
        rxWallet = Wallet.generate(handle, handle, "rx", 0, handle);

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
      let derivationPath = `m/44'/${DashApi.DashTypes.coinType}'/${account}'/${direction}`;
      let publicParentExtendedKey =
        privateRoot.derive(derivationPath).publicExtendedKey;
      return [publicParentExtendedKey, txWallet?.xpubkey];
    };

    // TODO 'sync' and 'reindex' options?
    // TODO show only receive balances, not paid-to-friend balances
    wallet.balances = async function () {
      /** @type {Object.<String, Number>} */
      let balances = {};

      Object.values(safe.addresses).forEach(function (addr) {
        let b = addr.utxos.reduce(
          /**
           * @param {Number} satoshis
           * @param {InsightUtxo} utxo
           */
          function (satoshis, utxo) {
            return utxo.satoshis + satoshis;
          },
          0,
        );

        if (!balances[addr.wallet]) {
          balances[addr.wallet] = 0;
        }
        balances[addr.wallet] += b;
      });

      return balances;
    };

    /** @type {WalleterFindFriend} */
    wallet.findFriend = async function ({ handle }) {
      // TODO filter out archived wallets?
      let txws = Object.values(safe.wallets)
        .filter(function (wallet) {
          return wallet.contact === handle && "tx" === wallet.mode;
        })
        .sort(function (a, b) {
          return a.priority - b.priority;
        });
      return txws;
    };

    /**
     * Send with change back to main wallet
     * @param {String} handle
     * @param {Number} amount - in whole satoshis
     */
    wallet.pay = async function (handle, amount) {
      let nextPayAddr = "";
      if (34 === handle.length) {
        if (["X", "Y"].includes(handle[0])) {
          nextPayAddr = handle;
        }
      }

      {
        let payWallets = wallet.findFriend({ handle });
        let payWallet = payWallets[0];
        if (!payWallet) {
          throw new Error(`no pay-to wallet found for '${handle}'`);
        }

        let now = Date.now();
        let derivedRoot = HdKey.fromExtendedKey(payWallet.xpubkey || "");
        console.log(
          `[DEBUG] checking friend xpub wallet '${payWallet.name}'...`,
        );
        let nextIndex = await discoverAddresses(payWallet, derivedRoot, now);
        let derivedChild = derivedRoot.deriveChild(nextIndex);
        nextPayAddr = await b58c.encode({
          version: DashApi.DashTypes.pubKeyHashVersion,
          pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
        });
      }

      // TODO figure out how to send good utxos from multiple coins
      // (and multiple wallets)
      let utxoAddr = await Wallet.wifToAddr(privKey);
      if (!changeAddr) {
        changeAddr = utxoAddr;
      }

      // TODO make more accurate?
      let feePreEstimate = 1000;
      let insightUtxos = await dashsight.getUtxos(utxoAddr);
      let allUtxos = await DashApi.getUtxos(insightUtxos);
      let utxos = await DashApi.getOptimalUtxos(
        allUtxos,
        amount + feePreEstimate,
      );
      let balance = DashApi.getBalance(utxos);

      if (!utxos.length) {
        throw new Error(`not enough funds available in utxos for ${utxoAddr}`);
      }

      // (estimate) don't send dust back as change
      if (balance - amount <= DashApi.DUST + DashApi.FEE) {
        amount = balance;
      }

      //@ts-ignore - no input required, actually
      let tmpTx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tmpTx.to(nextPayAddr, amount);
      //@ts-ignore - the JSDoc is wrong in dashcore-lib/lib/transaction/transaction.js
      tmpTx.change(changeAddr);
      tmpTx.sign(pk);

      // TODO getsmartfeeestimate??
      // fee = 1duff/byte (2 chars hex is 1 byte)
      //       +10 to be safe (the tmpTx may be a few bytes off - probably only 4 -
      //       due to how small numbers are encoded)
      let fee = 10 + tmpTx.toString().length / 2;

      // (adjusted) don't send dust back as change
      if (balance + -amount + -fee <= DUST) {
        amount = balance - fee;
      }

      //@ts-ignore - no input required, actually
      let tx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tx.to(nextPayAddr, amount);
      tx.fee(fee);
      //@ts-ignore - see above
      tx.change(changeAddr);
      tx.sign(pk);

      return tx;
    };

    // 1. Check cached addresses until finding 20 with no transactions
    // 2. Check 20 forward from last index for any transaction at all
    //    - If yes, check for balance
    //    - if it has txs and no balance, it's probably donezo
    // 3. Check empty (sparse) addresses for transactions
    // 4. For anything that has a balance, check again
    /**@type {Reindexer} */
    wallet.reindex = async function (now) {
      // full and rx wallets
      await Object.values(safe.wallets).reduce(async function (promise, w) {
        await promise;

        let derivedRoot;
        let xpub = w.xpub || w.xpubkey;
        if (xpub) {
          derivedRoot = HdKey.fromExtendedKey(xpub);
          console.log(`[DEBUG] checking xpub wallet '${w.name}'...`);
          await discoverAddresses(w, derivedRoot, now);
        } else {
          let mnemonic = w.mnemonic.join(" ");
          // TODO use derivation from main for non-imported wallets
          let seed = await Bip39.mnemonicToSeed(mnemonic);
          let privateRoot = HdKey.fromMasterSeed(seed);
          // The full path looks like `m/44'/5'/0'/0/0`
          // We "harden" the prefix `m/44'/5'/0'/0`
          let account = 0;

          // rx addresses
          let direction = 0;
          let derivationPath = `m/44'/${DashApi.DashTypes.coinType}'/${account}'/${direction}`;
          console.log("[DEBUG] derivationPath:", derivationPath);
          derivedRoot = privateRoot.derive(derivationPath);
          console.log(`[DEBUG] checking DEPOSIT wallet '${w.name}'...`);
          await discoverAddresses(w, derivedRoot, now);

          // change addresses
          direction = 1;
          derivationPath = `m/44'/${DashApi.DashTypes.coinType}'/${account}'/${direction}`;
          console.log("[DEBUG] derivationPath:", derivationPath);
          derivedRoot = privateRoot.derive(derivationPath);
          console.log(`[DEBUG] checking for CHANGE in '${w.name}'...`);
          await discoverAddresses(w, derivedRoot, now);
        }

        // TODO optimize later
        await config.store.save();
      }, Promise.resolve());
    };

    /**
     * @param {PayWallet|PrivateWallet} w
     * @param {unknown} derivedRoot - TODO
     * @param {Number} now
     * @returns {Promise<Number>} - the next, possibly sparse, unused address index
     */
    async function discoverAddresses(w, derivedRoot, now) {
      let MAX_SPARSE_UNCHECKED = 20;
      let MAX_SPARSE_CHECKED = 5;

      let recentlyUsedIndex = -1;
      let count = 0;
      for (let index = 0; ; index += 1) {
        let derivedChild = derivedRoot.deriveChild(index);
        let addr = await b58c.encode({
          version: DashApi.DashTypes.pubKeyHashVersion,
          pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
        });
        let info = safe.addresses[addr];
        if (info?.txs.length) {
          //console.log("[DEBUG] [used]", index);
          recentlyUsedIndex = index;
          count = 0;
        } else {
          //console.log("[DEBUG] possibly unused", index);
          count += 1;
        }
        if (count >= MAX_SPARSE_UNCHECKED) {
          // we've checked this wallet for the maximum consecutive unused
          // addresses from the last (possibly sparsely) used address
          break;
        }
      }
      console.log("[DEBUG] recentlyUsedIndex", recentlyUsedIndex);

      count = 0;
      for (let index = recentlyUsedIndex; ; ) {
        index += 1;

        //@ts-ignore
        let derivedChild = derivedRoot.deriveChild(index);
        let addr = await b58c.encode({
          version: DashApi.DashTypes.pubKeyHashVersion,
          pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
        });
        let info = safe.addresses[addr];
        if (!info) {
          // TODO support non-HD wallets
          info = Wallet.generateAddress(w.name, index);
          safe.addresses[addr] = info;
        }

        if (!info.txs.length) {
          let insightTxs = await dashsight.getTxs(addr, 1);
          let tx = insightTxs.txs[0];
          if (tx?.time) {
            console.log(`[DEBUG] update ${index}: txs`);
            let txid = tx.txid;
            info.txs.push([tx.time, txid]);
            // TODO second pass is to check utxos again
            info.checked_at = now;
            info.utxos = await getMiniUtxos(addr);
          } else {
            console.log(`[DEBUG] update ${index}: NO txs`);
          }
        }
        // TODO also skip addresses that are known to be pending receiving a payment?
        if (info.txs.length) {
          recentlyUsedIndex = index;
          count = 0;
        } else {
          count += 1;
          if (count >= MAX_SPARSE_CHECKED) {
            // we've checked this wallet for the maximum consecutive unused
            // addresses from the last (possibly sparsely) used address
            break;
          }
        }
      }
      return recentlyUsedIndex + 1;
    }

    /**
     * @param {String} addr
     * @returns {Promise<Array<MiniUtxo>>}
     */
    async function getMiniUtxos(addr) {
      // TODO get addr info
      let insightUtxos = await dashsight.getUtxos(addr);
      let utxos = insightUtxos.map(function ({
        txid,
        vout,
        satoshis,
        scriptPubKey,
      }) {
        return {
          //txId: txid,
          outputIndex: vout,
          //address: utxo.address,
          script: scriptPubKey,
          satoshis: satoshis,
        };
      });

      return utxos;
    }

    if (!safe.addresses) {
      safe.addresses = {};
    }
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
   * @param {String} wallet - name of (HD) wallet
   * @param {Number} index - name of wallet
   */
  Wallet.generateAddress = function (wallet, index) {
    return {
      index: index,
      wallet: wallet,
      utxos: [],
      txs: [],
      balance: 0,
      checked_at: 0,
    };
  };

  /**
   * Generate a wallet with creation date set
   * @param {String} name - all lower case
   * @param {String} label - human friendly
   * @param {WalletMode} mode - rx, tx, or full
   * @param {Number} priority - sparse index, lowest is highest
   * @param {String?} contact - handle of contact
   * @returns {PrivateWallet}
   */
  Wallet.generate = function (name, label, mode, priority, contact = null) {
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
      contact: contact,
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
   * @returns {PayWallet}
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
      xpubkey: xpubkey,
      created_at: d.toISOString(),
      archived_at: null,
    };
  };

  if ("undefined" !== typeof module) {
    module.exports = Wallet;
  }
})(("undefined" !== typeof module && module.exports) || window);
