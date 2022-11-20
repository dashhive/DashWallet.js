(function (exports) {
  "use strict";

  let Wallet = {};
  //@ts-ignore
  exports.Wallet = Wallet;

  let HdKey = require("hdkey");
  let Bip39 = require("bip39");
  //let Passphrase = require("@root/passphrase");
  let DashApi = require("./dashapi.js");

  /** @typedef {import('dashsight').CoreUtxo} CoreUtxo */
  /** @typedef {import('dashsight').GetTxs} GetTxs */
  /** @typedef {import('dashsight').GetUtxos} GetUtxos */
  /** @typedef {import('dashsight').InstantSend} InstantSend */
  /** @typedef {import('dashsight').InsightUtxo} InsightUtxo */

  //@ts-ignore
  let Dashcore = exports.dashcore || require("./lib/dashcore.js");
  let Transaction = Dashcore.Transaction;

  /**
   * Like CoreUtxo, but only the parts we need for a transaction
   * @typedef MiniUtxo
   * @property {String} txId
   * @property {Number} outputIndex - a.k.a. vout index
   * @property {String} [address] - coined pubKeyHash
   * @property {String} script - hex
   * @property {Number} satoshis
   */

  /**
   * @typedef WalletAddress
   * @prop {Number} checked_at
   * @prop {String} hdpath - hdkey path (ex: "m/44'/5'/0'/0")
   * @prop {Number} index - hdkey path index
   * @prop {Array<[Number, String]>} txs - tx.time and tx.txid
   * @prop {Array<MiniUtxo>} utxos
   * @prop {String} wallet - name of wallet (not a true id)
   */

  //@ts-ignore
  let b58c = exports.DashCheck || require("./lib/dashcheck.js");

  /**
   * @typedef Config
   * @prop {Safe} safe
   * @prop {Store} store
   * @prop {Wallet} main
   * @prop {DashSightPartial} dashsight
   */

  /**
   * @typedef DashSightPartial
   * @prop {InstantSend} instantSend
   * @prop {GetTxs} getTxs
   * @prop {GetUtxos} getUtxos
   */

  /**
   * @typedef Store
   * @prop {Function} save
   */

  /**
   * @typedef WalletInstance
   * @prop {Befriend} befriend
   * @prop {Sync} sync
   */

  /**
   * @callback Sync
   * @param {SyncOpts} opts
   *
   * @typedef SyncOpts
   * @prop {Number} now - value to be used for 'checked_at'
   * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
   */

  /**
   * // TODO doc: send-only (to you) xpub key to share with friend
   * Add and/or generate a friend's xpub key
   * @callback Befriend
   * @param {BefriendOpts} opts
   * @returns {Promise<[String, String]>} - rxXPub & txXPub
   *
   * @typedef BefriendOpts
   * @prop {String} handle
   * @prop {String} xpub - receive-only xpub key from friend
   */

  /**
   * Find a friend's xpub key
   * @callback FindFriendWallet
   * @param {FindFriendOpts} opts
   * @returns {Array<PayWallet>} - wallets matching this friend
   *
   * @typedef FindFriendOpts
   * @prop {String} handle
   */

  /**
   * Find a change wallet
   * @callback FindChangeWallet
   * @param {FindFriendOpts} opts
   * @returns {Array<PrivateWallet>} - wallets matching this friend
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
   * @prop {String?} xpub
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   */

  /**
   * @typedef PayWallet
   * @prop {String} name
   * @prop {String} label
   * @prop {Array<String>} [mnemonic] - empty array
   * @prop {WalletMode} mode
   * @prop {String?} device
   * @prop {Number} priority
   * @prop {String?} contact
   * @prop {String} xpub
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   */

  Wallet.toDuff = DashApi.toDuff;
  Wallet.DashTypes = DashApi.DashTypes;
  Wallet.DUFFS = DashApi.DUFFS;

  /**
   * @param {Config} config
   * @returns {Promise<WalletInstance>}
   */
  Wallet.create = async function (config) {
    let safe = config.safe;
    let wallet = {};
    let dashsight = config.dashsight;

    /** @type Befriend */
    wallet.befriend = async function ({ handle, xpub }) {
      if (!handle) {
        throw new Error(`no 'handle' given`);
      }

      let txXPub = xpub;

      let safe = config.safe;

      /** @type {PayWallet} */
      let txWallet;
      if (txXPub) {
        try {
          HdKey.fromExtendedKey(xpub);
        } catch (e) {
          //@ts-ignore - tsc bug
          if (!e.message.includes("Invalid checksum")) {
            throw e;
          }
          throw new Error(
            `failed to parse contact's xpub (bad checksum): '${xpub}'`,
          );
        }

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
              txXPub === wallet.xpub &&
              ["tx"].includes(wallet.mode)
            );
          });
        if (!txWallet) {
          txWallet = Wallet.generateXPubWallet({
            handle: handle,
            xpub: txXPub,
          });
          for (let i = 1; ; i += 1) {
            if (!safe.wallets[`${handle}:${i}`]) {
              safe.wallets[`${handle}:${i}`] = txWallet;
              break;
            }
          }
          await config.store.save();
        }
      } else {
        let txws = await wallet.findFriend({ handle });
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
        rxWallet = Wallet.generate({
          name: handle,
          label: handle,
          mode: "rx",
          priority: 0,
          contact: handle,
        });

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
      return [publicParentExtendedKey, txWallet?.xpub];
    };

    /**
     * Show balances of addresses for which we have the private keys (WIF)
     * (don't forget to sync first!)
     * @returns {Promise<Object.<String, Number>>}
     */
    wallet.balances = async function () {
      /** @type {Object.<String, Number>} */
      let balances = {};

      Object.values(safe.addresses).forEach(function (addr) {
        if (!addr.hdpath) {
          return;
        }

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

    /**
     * @returns {Promise<Array<CoreUtxo>>}
     */
    wallet.utxos = async function () {
      /** @type {Array<Required<MiniUtxo>>} */
      let utxos = [];

      Object.keys(safe.addresses).forEach(function (addr) {
        let addrInfo = safe.addresses[addr];
        if (!addrInfo.hdpath) {
          return;
        }
        addrInfo.utxos.forEach(
          /** @param {MiniUtxo} utxo */
          function (utxo) {
            let _utxo = Object.assign({ address: addr }, utxo);
            utxos.push(_utxo);
          },
        );
      });

      return utxos;
    };

    /** @type {FindFriendWallet} */
    wallet.findFriend = async function ({ handle }) {
      // TODO filter out archived wallets?
      let txws = Object.values(safe.wallets)
        .filter(function (wallet) {
          // Pay-To
          return wallet.contact === handle && ["tx"].includes(wallet.mode);
        })
        .sort(function (a, b) {
          return a.priority - b.priority;
        });
      return txws;
    };

    /** @type {FindChangeWallet } */
    wallet.findChangeWallet = async function ({ handle }) {
      // TODO filter out archived wallets?
      let txws = Object.values(safe.wallets)
        .filter(function (wallet) {
          return (
            wallet.contact === handle && ["rx", "full"].includes(wallet.mode)
          );
        })
        .sort(function (a, b) {
          return a.priority - b.priority;
        });
      txws.push(safe.wallets.main);
      return txws;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle - a wallet name
     * @returns {Promise<String>} - pay address
     */
    wallet.nextChangeAddr = async function ({ handle }) {
      let ws = await wallet.findChangeWallet({ handle });
      let w = ws[0];
      let account = 0; // main
      let direction = 1; // change
      return await wallet._getNextAddr(w, account, direction);
    };

    /**
     * @param {PrivateWallet} w
     * @param {Number} account - 0 for main / primary
     * @param {Number} direction - 0 for deposit, 1 for change
     * TODO give this the correct name
     */
    wallet._getNextAddr = async function (w, account, direction) {
      let mnemonic = w.mnemonic.join(" ");
      let seed = await Bip39.mnemonicToSeed(mnemonic);
      let privateRoot = HdKey.fromMasterSeed(seed);

      let derivationPath = `m/44'/${DashApi.DashTypes.coinType}'/${account}'/${direction}`;
      let derivedRoot = privateRoot.derive(derivationPath);

      let now = Date.now();
      let nextIndex = await checkPayAddrs(w, derivedRoot, derivationPath, now);
      //@ts-ignore - tsc bug
      let derivedChild = derivedRoot.deriveChild(nextIndex);
      let nextPayAddr = await b58c.encode({
        version: DashApi.DashTypes.pubKeyHashVersion,
        pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
        compressed: true,
      });

      return nextPayAddr;
    };

    /**
     * Send with change back to main wallet
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.amount - duffs/satoshis
     */
    wallet.pay = async function ({ handle, amount }) {
      let txHex = await wallet.createTx({ handle, amount });

      let result = await dashsight.instantSend(txHex).catch(
        /** @param {Error} err */
        function (err) {
          //@ts-ignore
          err.failedTx = txHex;
          throw err;
        },
      );
      return result;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.amount - duffs/satoshis
     */
    wallet.createTx = async function ({ handle, amount }) {
      let nextPayAddr = "";
      if (34 === handle.length) {
        if (["X", "Y"].includes(handle[0])) {
          nextPayAddr = handle;
        }
      }

      {
        let payWallets = await wallet.findFriend({ handle });
        let payWallet = payWallets[0];
        if (!payWallet) {
          throw new Error(`no pay-to wallet found for '${handle}'`);
        }

        let now = Date.now();
        let derivedRoot = HdKey.fromExtendedKey(payWallet.xpub || "");
        let nextIndex = await checkPayAddrs(payWallet, derivedRoot, "", now);
        //@ts-ignore - tsc bug
        let derivedChild = derivedRoot.deriveChild(nextIndex);
        nextPayAddr = await b58c.encode({
          version: DashApi.DashTypes.pubKeyHashVersion,
          pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
          compressed: true,
        });
      }

      let allUtxos = await wallet.utxos();

      // TODO make more accurate? How many bytes per additional utxo? signature?
      let feePreEstimate = 1000;
      //let insightUtxos = await dashsight.getUtxos(utxoAddr);
      //let allUtxos = await DashApi.getUtxos(insightUtxos);
      let utxos = await DashApi.getOptimalUtxos(
        allUtxos,
        amount + feePreEstimate,
      );
      let balance = DashApi.getBalance(utxos);

      if (!utxos.length) {
        let totalBalance = DashApi.getBalance(allUtxos);
        let dashBalance = DashApi.toDash(totalBalance);
        let dashAmount = DashApi.toDash(amount);
        throw new Error(
          `insufficient funds: cannot pay ${dashAmount} (+fees) with ${dashBalance}`,
        );
      }

      let wifs = await wallet._utxosToWifs(utxos);
      if (!wifs.length) {
        throw new Error(
          `could not find private keys corresponding to chosen utxos`,
        );
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
      let changeAddr = await wallet.nextChangeAddr({ handle });
      tmpTx.change(changeAddr);
      tmpTx.sign(wifs);

      // TODO getsmartfeeestimate??
      // fee = 1duff/byte (2 chars hex is 1 byte)
      //       +10 to be safe (the tmpTx may be a few bytes off - probably only 4 -
      //       due to how small numbers are encoded)
      let fee = 10 + tmpTx.toString().length / 2;

      // (adjusted) don't send dust back as change
      if (balance + -amount + -fee <= DashApi.DUST) {
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
      tx.sign(wifs);

      let txHex = tx.serialize();
      return txHex;
    };

    /**
     * @param {Array<CoreUtxo>} utxos
     * @returns {Promise<Array<String>>} - wifs
     */
    wallet._utxosToWifs = async function (utxos) {
      /** @type {Object.<String, Boolean>} */
      let wifs = {};

      await utxos.reduce(async function (promise, utxo) {
        await promise;

        let wif = await wallet._toWif(utxo.address);
        wifs[wif] = true;
      }, Promise.resolve());

      let wifkeys = Object.keys(wifs);
      return wifkeys;
    };

    /**
     * @param {String} addr - pay address
     * @returns {Promise<String>} - wif (private key)
     */
    wallet._toWif = async function (addr) {
      let addrInfo = safe.addresses[addr];
      if (!addrInfo) {
        throw new Error(`cannot find address info for '${addr}'`);
      }

      let w = Object.values(safe.wallets).find(function (wallet) {
        return (
          wallet.name === addrInfo.wallet &&
          ["rx", "full"].includes(wallet.mode)
        );
      });
      if (!w) {
        throw new Error(`cannot find wallet for '${addr}'`);
      }

      let mnemonic = w.mnemonic.join(" ");
      let seed = await Bip39.mnemonicToSeed(mnemonic);
      let privateRoot = HdKey.fromMasterSeed(seed);

      let derivedRoot = privateRoot.derive(addrInfo.hdpath);

      //@ts-ignore - tsc bug
      let derivedChild = derivedRoot.deriveChild(addrInfo.index);

      let address = await b58c.encode({
        version: DashApi.DashTypes.pubKeyHashVersion,
        pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
        compressed: true,
      });
      if (address !== addr) {
        throw new Error(
          `check fail: hdpath '${addrInfo.hdpath}/${addrInfo.index}' for '${addr}' derived '${address}'`,
        );
      }
      let wif = await b58c.encode({
        version: DashApi.DashTypes.privateKeyVersion,
        pubKeyHash: derivedChild.privateKey.toString("hex"),
        compressed: true,
      });
      return wif;
    };

    // 1. Check cached addresses until finding 20 with no transactions
    // 2. Check 20 forward from last index for any transaction at all
    //    - If yes, check for balance
    //    - if it has txs and no balance, it's probably donezo
    // 3. Check empty (sparse) addresses for transactions
    // 4. For anything that has a balance, check again
    /**@type {Sync} */
    wallet.sync = async function ({ now, staletime = 60 * 1000 }) {
      // full and rx wallets
      await Object.values(safe.wallets).reduce(async function (promise, w) {
        await promise;

        let derivedRoot;
        let xpub = w.xpub;
        if (xpub) {
          derivedRoot = HdKey.fromExtendedKey(xpub);
          await checkPayAddrs(w, derivedRoot, "", now, staletime);
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
          derivedRoot = privateRoot.derive(derivationPath);
          await checkPayAddrs(w, derivedRoot, derivationPath, now, staletime);

          // change addresses
          direction = 1;
          derivationPath = `m/44'/${DashApi.DashTypes.coinType}'/${account}'/${direction}`;
          derivedRoot = privateRoot.derive(derivationPath);
          await checkPayAddrs(w, derivedRoot, derivationPath, now, staletime);
        }

        // TODO optimize later
        await config.store.save();
      }, Promise.resolve());
    };

    /**
     * @param {PayWallet|PrivateWallet} w
     * @param {import('hdkey')} derivedRoot - TODO
     * @param {String} hdpath - derivation path
     * @param {Number} now
     * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
     * @returns {Promise<Number>} - the next, possibly sparse, unused address index
     */
    async function checkPayAddrs(
      w,
      derivedRoot,
      hdpath,
      now,
      staletime = 60 * 1000,
    ) {
      let MAX_SPARSE_UNCHECKED = 20;
      let MAX_SPARSE_CHECKED = 5;

      let recentlyUsedIndex = -1;
      let count = 0;
      for (let index = 0; ; index += 1) {
        //@ts-ignore
        let derivedChild = derivedRoot.deriveChild(index);
        let addr = await b58c.encode({
          version: DashApi.DashTypes.pubKeyHashVersion,
          pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
          compressed: true,
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
      //console.log("[DEBUG] recentlyUsedIndex", recentlyUsedIndex);

      count = 0;
      for (let index = recentlyUsedIndex; ; ) {
        index += 1;

        //@ts-ignore
        let derivedChild = derivedRoot.deriveChild(index);
        let addr = await b58c.encode({
          version: DashApi.DashTypes.pubKeyHashVersion,
          pubKeyHash: derivedChild.pubKeyHash.toString("hex"),
          compressed: true,
        });
        let info = safe.addresses[addr];
        if (!info) {
          info = Wallet.generateAddress({
            wallet: w.name,
            hdpath: hdpath,
            index: index,
          });
          safe.addresses[addr] = info;
        }

        let fresh = now - info.checked_at < staletime;
        if (!info.txs.length && !fresh) {
          let insightTxs = await dashsight.getTxs(addr, 1);
          let tx = insightTxs.txs[0];
          if (tx?.time) {
            //console.log(`[DEBUG] update ${index}: txs`);
            let txid = tx.txid;
            // TODO link utxos to txs
            info.txs.push([tx.time, txid]);
            // TODO second pass is to check utxos again
            info.utxos = await getMiniUtxos(addr);
          } else {
            //console.log(`[DEBUG] update ${index}: NO txs`);
          }
          info.checked_at = now;
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
      let insightUtxos = await dashsight.getUtxos(addr);
      let utxos = insightUtxos.map(function ({
        txid,
        vout,
        satoshis,
        scriptPubKey,
      }) {
        return {
          txId: txid,
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
      safe.wallets.main = Wallet.generate({
        name: "main",
        label: "Main",
        mode: "full",
        priority: 1,
      });
      await config.store.save();
    }
    config.main = safe.wallets.main;

    return wallet;
  };

  /**
   * @param {Object} opts
   * @param {String} opts.wallet - name of (HD) wallet
   * @param {String} opts.hdpath - derivation path, without index (ex: "m/44'/5'/0'/0")
   * @param {Number} opts.index - xpub index or hdpath index
   * @returns {WalletAddress}
   */
  Wallet.generateAddress = function ({ wallet, hdpath, index }) {
    return {
      checked_at: 0,
      hdpath: hdpath,
      index: index,
      txs: [],
      utxos: [],
      wallet: wallet,
    };
  };

  /**
   * Generate a wallet with creation date set
   * @param {Object} opts
   * @param {String} opts.name - machine friendly (lower case, no spaces)
   * @param {String} opts.label - human friendly
   * @param {WalletMode} opts.mode - rx, tx, or full
   * @param {Number} opts.priority - sparse index, lowest is highest
   * @param {String?} [opts.contact] - handle of contact
   * @returns {PrivateWallet}
   */
  Wallet.generate = function ({ name, label, mode, priority, contact = null }) {
    let mnemonic = Bip39.generateMnemonic();
    if (!priority) {
      priority = Date.now();
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
      xpub: null,
      created_at: new Date().toISOString(),
      archived_at: null,
    };
  };

  /**
   * Generate a wallet with creation date set
   * @param {Object} opts
   * @param {String} opts.handle
   * @param {String} opts.xpub
   * @returns {PayWallet}
   */
  Wallet.generateXPubWallet = function ({ handle, xpub }) {
    let d = new Date();
    return {
      name: handle.toLowerCase(),
      label: handle,
      device: null,
      contact: handle,
      mode: "tx",
      priority: d.valueOf(),
      xpub: xpub,
      created_at: d.toISOString(),
      archived_at: null,
    };
  };

  if ("undefined" !== typeof module) {
    module.exports = Wallet;
  }
})(("undefined" !== typeof module && module.exports) || window);
