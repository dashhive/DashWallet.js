(function (exports) {
  "use strict";

  let Wallet = {};
  //@ts-ignore
  exports.Wallet = Wallet;

  let DashHd = require("dashhd");
  let Bip39 = require("bip39");
  //let Passphrase = require("@root/passphrase");
  let DashApi = require("./dashapi.js");
  let COIN_TYPE = 5;

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
   * @prop {String} [addr] - may be added (but not stored)
   * @prop {Number} checked_at
   * @prop {String} hdpath - hdkey path (ex: "m/44'/5'/0'/0")
   * @prop {Number} index - hdkey path index
   * @prop {Array<[Number, String]>} txs - tx.time and tx.txid
   * @prop {Array<MiniUtxo>} utxos
   * @prop {String} wallet - name of wallet (not a true id)
   *
   * @typedef WalletWifPartial
   * @prop {String} wif - private key
   *
   * @typedef {Required<WalletAddress> & WalletWifPartial} WalletWif
   */

  /**
   * @typedef Config
   * @prop {Number} staletime
   * @prop {Safe} safe
   * @prop {Store} store
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
   * @prop {StoreSave} save
   *
   * @callback StoreSave
   * @param { Cache|
   *    Object.<String,PayWallet>|
   *    Preferences|
   *    Object.<String,PrivateWallet> } data
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
   * Add or generate and return (mutual) xpub key(s) for a contact
   * @callback Befriend
   * @param {BefriendOpts} opts
   * @returns {Promise<[String, PayWallet]>} - rxXPub, txXPub, txStaticAddr
   *
   * @typedef BefriendOpts
   * @prop {String} handle
   * @prop {String} xpub - receive-only xpub key from friend
   * @prop {String} addr - reusable address, e.g. for Coinbase
   */

  /**
   * Find a friend's xpub key
   * @callback FindPayWallets
   * @param {FindFriendOpts} opts
   * @returns {Array<PayWallet>} - wallets matching this friend
   *
   * @typedef FindFriendOpts
   * @prop {String} handle
   */

  /**
   * Find a private wallet by handle
   * @callback FindPrivateWallets
   * @param {FindFriendOpts} opts
   * @returns {Array<PrivateWallet>} - wallets matching this friend
   */

  /**
   * @typedef Safe
   * @prop {Object<String, PrivateWallet>} privateWallets
   * @prop {Object<String, PayWallet>} payWallets
   * @prop {Preferences} preferences
   * @prop {Cache} cache
   *
   * @typedef {Object.<String, unknown>} Preferences
   *
   * TODO txs and wifs?
   * @typedef Cache
   * @prop {Object<String, WalletAddress>} addresses
   */

  /**
   * @typedef PrivateWallet
   * @prop {String?} contact
   * @prop {String?} device
   * @prop {String} label
   * @prop {Array<String>} mnemonic
   * @prop {Array<WifInfo>} wifs - TODO maybe Object.<String, WifInfo>
   * @prop {String} name
   * @prop {Number} priority
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   *
   * @typedef WifInfo
   * @prop {String} addr
   * @prop {String} wif
   * @prop {String} created_at - ISO Date
   */

  /**
   * @typedef PayWallet
   * @prop {String?} contact
   * @prop {String?} device
   * @prop {String} label
   * @prop {String} name
   * @prop {Number} priority
   * @prop {String} addr - instead of xpub, e.g. for coinbase
   * @prop {String} xpub
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   */

  Wallet.DashTypes = DashApi.DashTypes;
  Wallet.DUFFS = DashApi.DUFFS;
  Wallet.getBalance = DashApi.getBalance;
  Wallet.toDash = DashApi.toDash;
  Wallet.toDuff = DashApi.toDuff;

  /**
   * @param {Config} config
   * @returns {Promise<WalletInstance>}
   */
  Wallet.create = async function (config) {
    let safe = config.safe;
    let wallet = {};
    let dashsight = config.dashsight;

    if ("undefined" === typeof config.staletime) {
      config.staletime = 60 * 1000;
    }

    // TODO rename addContactByXPub, addContactByAddr?
    /** @type Befriend */
    wallet.befriend = async function ({ handle, xpub, addr }) {
      if (!handle) {
        throw new Error(`no 'handle' given`);
      }

      let safe = config.safe;

      /** @type {PayWallet} */
      let txWallet;
      let hasAddr = xpub || addr;
      if (hasAddr) {
        txWallet = await _getPayWallet(handle, xpub, addr);
        // most recently added will sort first;
        txWallet.priority = Date.now();
        await config.store.save(safe.payWallets);
      } else {
        let txws = await wallet.findPayWallets({ handle });
        txWallet = txws[0];
      }

      /** @type {PrivateWallet} */
      let rxWallet;
      /** @type {Array<PrivateWallet>} */
      let rxws = Object.values(safe.privateWallets)
        .filter(function (wallet) {
          return wallet.contact === handle;
        })
        .sort(wallet._sort);
      if (!rxws.length) {
        // TODO use main wallet as seed
        rxWallet = Wallet.generate({
          name: handle,
          label: handle,
          priority: Date.now(),
          contact: handle,
        });

        for (let i = 1; ; i += 1) {
          if (!safe.privateWallets[`${handle}:${i}`]) {
            safe.privateWallets[`${handle}:${i}`] = rxWallet;
            break;
          }
        }
        await config.store.save(safe.privateWallets);

        rxws.push(rxWallet);
      }
      rxWallet = rxws[0];

      // Note: we should never have a WIF wallet here

      // TODO use derivation from main for non-imported wallets
      let seed = await Bip39.mnemonicToSeed(rxWallet.mnemonic.join(" "));
      let walletKey = await DashHd.fromSeed(seed);
      // The full path looks like `m/44'/5'/0'/0/0`
      // We "harden" the prefix `m/44'/5'/0'/0`
      let account = 0;
      let usage = 0;
      let hdPath = `m/44'/${COIN_TYPE}'/${account}'/${usage}`;
      /** @type {import('dashhd').HDXKey} */
      let xprvKey = await DashHd.derivePath(walletKey, hdPath);
      let selfXPub = await DashHd.toXPub(xprvKey);
      return [selfXPub, txWallet];
    };

    /**
     * @param {String} handle - contact's handle
     * @param {String} xpub
     * @param {String} addr
     * @returns {Promise<PayWallet>}
     */
    async function _getPayWallet(handle, xpub, addr) {
      if (xpub) {
        await Wallet.assertXPub(xpub);
      }

      let txWallet = Object.values(safe.payWallets)
        .sort(wallet._sort)
        .find(function (wallet) {
          if (wallet.contact !== handle) {
            return false;
          }

          if (xpub.length > 0) {
            return xpub === wallet.xpub;
          }

          if (addr.length > 0) {
            return addr === wallet.addr;
          }

          return false;
        });
      if (!txWallet) {
        txWallet = Wallet.generatePayWallet({
          handle: handle,
          xpub: xpub,
          addr: addr,
        });
        for (let i = 1; ; i += 1) {
          if (!safe.payWallets[`${handle}:${i}`]) {
            safe.payWallets[`${handle}:${i}`] = txWallet;
            break;
          }
        }
      }
      return txWallet;
    }

    /**
     * Show balances of addresses for which we have the private keys (WIF)
     * (don't forget to sync first!)
     * @returns {Promise<Object.<String, Number>>}
     */
    wallet.balances = async function () {
      /** @type {Object.<String, Number>} */
      let balances = {};

      Object.values(safe.cache.addresses).forEach(function (addrInfo) {
        if (!addrInfo.hdpath) {
          return;
        }

        if ("*" === addrInfo.hdpath) {
          // ignore wifs
        }

        let b = addrInfo.utxos.reduce(
          /**
           * @param {Number} satoshis
           * @param {InsightUtxo} utxo
           */
          function (satoshis, utxo) {
            return utxo.satoshis + satoshis;
          },
          0,
        );

        if (!balances[addrInfo.wallet]) {
          balances[addrInfo.wallet] = 0;
        }
        balances[addrInfo.wallet] += b;
      });

      return balances;
    };

    /**
     * @param {Object} opts
     * @param {Array<String>} opts.wifs
     * @param {Number} opts.now - ms since epoch (e.g. Date.now())
     * @returns {Promise<Array<WalletAddress>>}
     * TODO - multiuse: true
     */
    wallet.import = async function ({ wifs, now = Date.now() }) {
      /** @type {Array<WalletAddress>} */
      let addrInfos = [];

      await wifs.reduce(async function (promise, wif) {
        await promise;

        let addr = await DashApi.wifToAddr(wif);
        let addrInfo = safe.cache.addresses[addr];

        await indexWifAddr(addr, now);

        addrInfos.push(
          Object.assign({ addr: addr }, safe.cache.addresses[addr]),
        );

        // TODO force duplicate option? (for partially-synced wallets)
        // don't add an address that's already in an HD wallet
        if (addrInfo?.hdpath.startsWith("m")) {
          return;
        }

        let exists = safe.privateWallets.wifs.wifs.some(
          /** @param {WifInfo} wifInfo */
          function (wifInfo) {
            if (wifInfo.wif === wif) {
              return true;
            }
          },
        );
        if (!exists) {
          safe.privateWallets.wifs.wifs.push({
            addr: addr,
            wif: wif,
            created_at: new Date().toISOString(),
          });
        }
      }, Promise.resolve());

      await config.store.save(safe.privateWallets);
      await config.store.save(safe.cache);

      return addrInfos;
    };

    /**
     * @returns {Promise<Array<CoreUtxo>>}
     */
    wallet.utxos = async function () {
      /** @type {Array<Required<MiniUtxo>>} */
      let utxos = [];

      Object.keys(safe.cache.addresses).forEach(function (addr) {
        let addrInfo = safe.cache.addresses[addr];
        if (!addrInfo.hdpath) {
          return;
        }

        if ("*" === addrInfo.hdpath) {
          // ignore wifs
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

    /**
     * Find the address that matches the prefix.
     * @param {String} addrPrefix -
     * @returns {Promise<Required<WalletAddress>?>}
     */
    wallet.findAddr = async function (addrPrefix) {
      let addrInfos = await wallet.findAddrs(addrPrefix);
      if (!addrInfos.length) {
        return null;
      }
      if (1 === addrInfos.length) {
        return addrInfos[0];
      }
      throw new Error(
        `ambiguous address prefix '${addrPrefix}' has multiple matches`,
      );
    };

    /**
     * Find the address that matches the prefix.
     * @param {String} addrPrefix -
     * @returns {Promise<Array<Required<WalletAddress>>>}
     */
    wallet.findAddrs = async function (addrPrefix) {
      /** @type {Array<Required<WalletAddress>>} */
      let addrInfos = [];

      if (34 === addrPrefix.length) {
        let addrInfo = safe.cache.addresses[addrPrefix];
        if (addrInfo) {
          addrInfos.push(Object.assign({ addr: addrPrefix }, addrInfo));
        }
        return addrInfos;
      }

      let addrs = Object.keys(safe.cache.addresses)
        .sort()
        .filter(function (addr) {
          if (addr.startsWith(addrPrefix)) {
            return true;
          }
        });

      addrs.forEach(function (addr) {
        let addrInfo = safe.cache.addresses[addr];
        addrInfos.push(Object.assign({ addr: addr }, addrInfo));
      });

      return addrInfos;
    };

    /** @type {FindPayWallets} */
    wallet.findPayWallets = async function ({ handle }) {
      // TODO filter out archived wallets?
      let txws = Object.values(safe.payWallets)
        .filter(function (wallet) {
          return wallet.contact === handle;
        })
        .sort(wallet._sort);
      return txws;
    };

    /**
     * @param {PayWallet|PrivateWallet} a
     * @param {PayWallet|PrivateWallet} b
     */
    wallet._sort = function (a, b) {
      return b.priority - a.priority;
    };

    /** @type {FindPrivateWallets } */
    wallet.findPrivateWallets = async function ({ handle }) {
      // TODO filter out archived wallets?
      let txws = Object.values(safe.privateWallets)
        .filter(function (wallet) {
          return wallet.contact === handle;
        })
        .sort(wallet._sort);
      return txws;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle - a private wallet name
     * @param {Number} opts.usage - 0 for deposit, 1 for change
     * @returns {Promise<String>} - pay address
     */
    wallet._nextWalletAddr = async function ({ handle, usage }) {
      let count = 1;
      let addrsInfo = await wallet._nextWalletAddrs({
        handle,
        usage,
        count,
      });
      return addrsInfo.addrs[0];
    };

    /**
     * @typedef NextInfo
     * @prop {Number} start
     * @prop {String} [addr]
     * @prop {Array<String>} addrs
     */

    /**
     * @param {Object} opts
     * @param {String} opts.handle - a private wallet name
     * @param {Number} opts.usage - 0 for deposit, 1 for change
     * @param {Number} opts.count - how many next addresses
     * @returns {Promise<NextInfo>} - info about next addresses
     */
    wallet._nextWalletAddrs = async function ({ handle, usage, count = 1 }) {
      let ws = await wallet.findPrivateWallets({ handle });
      let w = ws[0] || safe.privateWallets.main;

      let hasMnemonic = w.mnemonic?.length > 0;
      if (!hasMnemonic) {
        throw new Error(
          "[Sanity Fail] must use private, mnemonic wallet (not WIF or pay wallet)",
        );
      }

      let mnemonic = w.mnemonic.join(" ");
      let seed = await Bip39.mnemonicToSeed(mnemonic);
      let walletKey = await DashHd.fromSeed(seed);

      let account = 0; // main
      let hdpath = `m/44'/${COIN_TYPE}'/${account}'/${usage}`;

      /** @type {import('dashhd').HDXKey} */
      let xprvKey = await DashHd.derivePath(walletKey, hdpath);

      let now = Date.now();
      let nextIndex = await indexPayAddrs(w.name, xprvKey, hdpath, now);
      await config.store.save(safe.cache);

      let addrs = [];
      for (let i = 0; i < count; i += 1) {
        let index = nextIndex + i;

        let addressKey = await deriveAddress(xprvKey, index);
        let addr = await DashHd.toAddr(addressKey.publicKey);
        addrs.push(addr);
      }
      return { start: nextIndex, addr: addrs[0], addrs: addrs };
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     */
    wallet.createNextPayAddr = async function ({ handle }) {
      let ws = await wallet.findPayWallets({ handle });
      let payWallet = ws[0];

      if (payWallet.addr) {
        return {
          addr: payWallet.addr,
          index: null,
        };
      }

      let xpubKey = DashHd.fromXKey(payWallet.xpub);

      let now = Date.now();
      let nextIndex = await indexPayAddrs(payWallet.name, xpubKey, "", now);
      await config.store.save(safe.cache);

      let addressKey = await deriveAddress(xpubKey, nextIndex);
      let addr = await DashHd.toAddr(addressKey.publicKey);
      return {
        addr,
        index: nextIndex,
      };
    };

    /**
     * @param {import('dashhd').HDXKey} xKey
     * @param {Number} index
     * @returns {Promise<import('dashhd').HDXKey>}
     */
    async function deriveAddress(xKey, index) {
      let hardened = false;
      let addressKey = await DashHd.deriveChild(xKey, index, hardened);
      return addressKey;
    }

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.count
     */
    wallet.createNextReceiveAddr = async function ({ handle, count = 1 }) {
      let ws = await wallet.findPrivateWallets({ handle });
      let privateWallet = ws[0];

      if (!privateWallet.mnemonic.length) {
        // TODO generate new WIF
        throw new Error("not implemented");
      }

      // TODO get back NextIndex
      let receiveAddrsInfo = await wallet._nextWalletAddrs({
        handle: handle,
        usage: 0,
        count: count,
      });
      await config.store.save(safe.cache);

      return receiveAddrsInfo;
    };

    /**
     * Send with change back to main wallet
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.amount - duffs/satoshis
     * @param {Array<CoreUtxo>?} [opts.utxos]
     */
    wallet.pay = async function ({ handle, amount, utxos }) {
      let tx = await wallet.createTx({ handle, amount, utxos });

      let result = await dashsight.instantSend(tx.hex).catch(
        /** @param {Error} err */
        function (err) {
          //@ts-ignore
          err.failedTx = tx.hex;
          //@ts-ignore
          err.failedUtxos = tx.utxos;
          throw err;
        },
      );

      let now = Date.now();
      await wallet._spendUtxos({ utxos: tx.utxos, now: now });
      await wallet._updateAddrInfo(tx._changeAddr, now, 0);
      await config.store.save(safe.cache);

      return Object.assign({ response: result }, tx);
    };

    /**
     * Mark UTXOs as spent
     * @param {Object} opts
     * @param {Number} opts.now
     * @param {Array<CoreUtxo>} opts.utxos
     */
    wallet._spendUtxos = async function ({ utxos, now }) {
      utxos.forEach(function (utxo) {
        let addrInfo = safe.cache.addresses[utxo.address];

        let index = addrInfo.utxos.findIndex(
          /** @param {MiniUtxo} _utxo */
          function (_utxo) {
            let txMatch = utxo.txId === _utxo.txId;
            let voutMatch = utxo.outputIndex === _utxo.outputIndex;

            return txMatch && voutMatch;
          },
        );

        if (index >= 0) {
          addrInfo.utxos.splice(index, 1);
          addrInfo.checked_at = now;
        }
      });
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number?} opts.amount - duffs/satoshis
     * @param {Array<CoreUtxo>?} [opts.utxos]
     * @param {Number} [opts.now] - ms
     */
    wallet.createTx = async function ({
      handle,
      amount,
      utxos,
      now = Date.now(),
    }) {
      let nextPayAddr = "";
      let isPayAddr = _isPayAddr(handle);
      if (isPayAddr) {
        nextPayAddr = handle;
      }

      let lessFees = false;
      if (!amount) {
        if (!utxos?.length) {
          throw new Error(
            `amount must be a positive number unless 'utxos' are specified`,
          );
        }
        lessFees = true;
        amount = utxos.reduce(function (total, utxo) {
          return total + utxo.satoshis;
        }, 0);
      }

      if (!nextPayAddr) {
        let payWallets = await wallet.findPayWallets({ handle });
        let payWallet = payWallets[0];
        if (!payWallet) {
          throw new Error(`no pay-to wallet found for '${handle}'`);
        }

        nextPayAddr = payWallet.addr;
        if (!nextPayAddr) {
          let xpubKey = await DashHd.fromXKey(payWallet.xpub);
          let nextIndex = await indexPayAddrs(payWallet.name, xpubKey, "", now);
          await config.store.save(safe.cache);

          let addressKey = await deriveAddress(xpubKey, nextIndex);
          nextPayAddr = await DashHd.toAddr(addressKey.publicKey);
        }
      }

      let feePreEstimate = 1000;
      let balance;
      let allUtxos;
      if (utxos) {
        allUtxos = utxos;
        balance = DashApi.getBalance(utxos);
      } else {
        // TODO make more accurate? How many bytes per additional utxo? signature?
        allUtxos = await wallet.utxos();
        utxos = await DashApi.getOptimalUtxos(
          allUtxos,
          amount + feePreEstimate,
        );

        balance = DashApi.getBalance(utxos);

        if (!utxos.length) {
          let totalBalance = DashApi.getBalance(allUtxos);
          let dashBalance = DashApi.toDash(totalBalance);
          let dashAmount = DashApi.toDash(amount);
          throw new Error(
            `insufficient funds: cannot pay ${dashAmount} (+fees) with ${dashBalance}`,
          );
        }

        // (estimate) don't send dust back as change
        if (balance - amount <= DashApi.DUST + DashApi.FEE) {
          // TODO see note about Dash Direct
          // amount = balance;
          feePreEstimate = balance - amount;
        }
      }

      // TODO check utxos are available
      // (or preferably fail and retry)

      let wifs = await wallet._utxosToWifs(utxos);
      if (!wifs.length) {
        throw new Error(
          `could not find private keys corresponding to chosen utxos`,
        );
      }

      let payAmount = amount;
      if (lessFees) {
        payAmount = amount - feePreEstimate;
      }

      //@ts-ignore - no input required, actually
      let tmpTx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tmpTx.to(nextPayAddr, payAmount);
      //@ts-ignore - the JSDoc is wrong in dashcore-lib/lib/transaction/transaction.js
      let changeAddr = await wallet._nextWalletAddr({
        handle: "main",
        usage: 1,
      });
      await config.store.save(safe.cache);
      tmpTx.change(changeAddr);
      tmpTx.sign(wifs);

      // TODO getsmartfeeestimate??
      // fee = 1duff/byte (2 chars hex is 1 byte)
      //       +2 to be safe (there's a possibility of an extra BigInt padding byte on 3 byte sequences)
      let fee = 2 + tmpTx.toString().length / 2;
      if (lessFees) {
        payAmount = amount - fee;
      }

      // (adjusted) don't send dust back as change
      if (balance + -payAmount + -fee <= DashApi.DUST) {
        //payAmount = balance - fee;

        // Dash Direct requires exact amounts, I believe
        // TODO double check
        fee = balance - payAmount;
      }

      //console.log("DEBUG tx");
      //console.log(JSON.stringify(utxos, null, 2));
      //console.log("Pay Addr", nextPayAddr);
      //console.log("Amount", payAmount);
      //console.log("Fee", fee);
      //console.log("Change Addr", changeAddr.slice(0, 4));

      //@ts-ignore - no input required, actually
      let tx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tx.to(nextPayAddr, payAmount);
      tx.fee(fee);
      //@ts-ignore - see above
      tx.change(changeAddr);
      tx.sign(wifs);

      let txHex = tx.serialize();

      // TODO pre-sync with return info
      safe.cache.addresses[changeAddr].sync_at = now + 3000;
      let recipAddrInfo = safe.cache.addresses[changeAddr];
      if (recipAddrInfo) {
        recipAddrInfo.sync_at = now + 3000;
      }

      return {
        hex: txHex,
        utxos: utxos,
        balance: balance,
        _recipientAddr: nextPayAddr,
        amount: payAmount,
        fee: fee,
        change: balance - (payAmount + fee),
        _changeAddr: changeAddr,
      };
    };

    /**
     * @param {String} addr
     * @returns {Boolean}
     */
    function _isPayAddr(addr) {
      if (34 !== addr?.length) {
        return false;
      }

      if (!["X", "Y"].includes(addr[0])) {
        return false;
      }

      return true;
    }

    /**
     * @param {Array<CoreUtxo>} utxos
     * @returns {Promise<Array<String>>} - wifs
     */
    wallet._utxosToWifs = async function (utxos) {
      /** @type {Object.<String, Boolean>} */
      let wifs = {};

      await utxos.reduce(async function (promise, utxo) {
        await promise;

        let wifInfo = await wallet.findWif({
          addr: utxo.address,
          _error: true,
        });
        if (wifInfo) {
          wifs[wifInfo.wif] = true;
        }
      }, Promise.resolve());

      let wifkeys = Object.keys(wifs);
      return wifkeys;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.addr - pay address
     * @param {Boolean} opts._error - for internal use
     * @returns {Promise<WalletWif?>} - addr info with wif
     */
    wallet.findWif = async function ({ addr, _error }) {
      let wifData = await wallet._findWif(addr).catch(function (err) {
        if (_error || "E_NO_PRIVATE_KEY" !== err.code) {
          throw err;
        }
      });
      if (!wifData) {
        return null;
      }

      let addrInfo = safe.cache.addresses[addr];
      return Object.assign({ addr: addr, wif: wifData.wif }, addrInfo);
    };

    /**
     * @param {String} addr - pay address
     */
    wallet._findWif = async function (addr) {
      let addrInfo = safe.cache.addresses[addr];
      if (!addrInfo) {
        throw new Error(`cannot find address info for '${addr}'`);
      }

      if (!addrInfo.hdpath) {
        let err = new Error(`private key for '${addr}' has not been imported`);
        //@ts-ignore
        err.code = "E_NO_PRIVATE_KEY";
        throw err;
      }

      let w = Object.values(safe.privateWallets).find(function (wallet) {
        return wallet.name === addrInfo.wallet;
      });
      if (!w) {
        throw new Error(`cannot find wallet for '${addr}'`);
      }

      if ("*" === addrInfo.hdpath) {
        let wifInfo = w.wifs.find(
          /** @param {WifInfo} wifInfo */
          function (wifInfo) {
            return addr === wifInfo.addr;
          },
        );
        return {
          _wallet: w,
          wif: wifInfo.wif,
        };
      }

      let mnemonic = w.mnemonic.join(" ");
      let seed = await Bip39.mnemonicToSeed(mnemonic);
      let walletKey = await DashHd.fromSeed(seed);

      /** @type {import('dashhd').HDXKey} */
      let xprvKey = await DashHd.derivePath(walletKey, addrInfo.hdpath);

      let addressKey = await xprvKey.deriveAddress(addrInfo.index);
      let address = await DashHd.toAddr(addressKey.publicKey);

      if (address !== addr) {
        throw new Error(
          `check fail: hdpath '${addrInfo.hdpath}/${addrInfo.index}' for '${addr}' derived '${address}'`,
        );
      }
      if (!addressKey.privateKey) {
        // this can never happen since xprvKey is private
        throw new Error(`TypeGuard`);
      }
      let wif = await DashHd.toWif(addressKey.privateKey);

      return { _wallet: w, wif: wif };
    };

    /**
     * @param {Object} opts
     * @param {String} opts.addr - pay address
     * @param {Boolean} opts._error - for internal use
     * @returns {Promise<WalletWif?>} - addr info with wif
     */
    wallet.removeWif = async function ({ addr }) {
      let addrInfo = safe.cache.addresses[addr];
      if (!addrInfo) {
        return null;
      }

      let wifData = await wallet._findWif(addr).catch(function (err) {
        if ("E_NO_PRIVATE_KEY" !== err.code) {
          throw err;
        }
        return null;
      });
      if (!wifData) {
        return null;
      }

      let wifIndex = wifData._wallet.wifs.findIndex(
        /** @param {WifInfo} wifInfo */
        function (wifInfo) {
          return wifInfo.addr === addr;
        },
      );
      wifData._wallet.wifs.splice(wifIndex, 1);
      await config.store.save(safe.cache);

      // TODO should there be an importAddr as compliment of importWif?
      delete safe.cache.addresses[addr];
      await config.store.save(safe.cache);

      return Object.assign({ addr: addr, wif: wifData.wif }, addrInfo);
    };

    /**
     * Shows balance, tx, and wallet stats for the given pay address
     * @param {Object} opts
     * @param {Array<String>} opts.addrs
     * @param {Number} opts.now
     * @param {Number} [opts.staletime]
     * @returns {Promise<Array<WalletAddress>>}
     */
    wallet.stat = async function ({
      addrs,
      now = Date.now(),
      staletime = config.staletime,
    }) {
      /** @type {Array<WalletAddress>} */
      let addrInfos = [];

      await addrs.reduce(async function (promise, addr) {
        await promise;

        let addrInfo = safe.cache.addresses[addr];
        if (!addrInfo) {
          // TODO just import on stat? --import option?
          throw new Error(
            `'${addr}' has not been generated by or imported into this wallet`,
          );
        }

        await wallet._updateAddrInfo(addr, now, staletime);
        addrInfo = safe.cache.addresses[addr];

        addrInfos.push(Object.assign({ addr: addr }, addrInfo));
      }, Promise.resolve());

      await config.store.save(safe.cache);

      return addrInfos;
    };

    // 1. Check cached addresses until finding 20 with no transactions
    // 2. Check 20 forward from last index for any transaction at all
    //    - If yes, check for balance
    //    - if it has txs and no balance, it's probably donezo
    // 3. Check empty (sparse) addresses for transactions
    // 4. For anything that has a balance, check again
    // TODO - select specific wallets
    /**@type {Sync} */
    wallet.sync = async function ({ now, staletime = config.staletime }) {
      await Object.values(safe.privateWallets).reduce(async function (
        promise,
        w,
      ) {
        await promise;

        if (w.wifs) {
          for (let wifInfo of w.wifs) {
            await indexWifAddr(wifInfo.addr, now, staletime);
          }
          await config.store.save(safe.privateWallets);
        }

        let mnemonic = w.mnemonic.join(" ");
        // TODO use derivation from main for non-imported wallets
        let seed = await Bip39.mnemonicToSeed(mnemonic);
        let walletKey = await DashHd.fromSeed(seed);
        // The full path looks like `m/44'/5'/0'/0/0`
        // We "harden" the prefix `m/44'/5'/0'/0`
        let account = 0;

        {
          // rx addresses
          let usage = 0;
          let hdpath = `m/44'/${COIN_TYPE}'/${account}'/${usage}`;
          /** @type {import('dashhd').HDXKey} */
          let xprvKey = await DashHd.derivePath(walletKey, hdpath);
          await indexPrivateAddrs(w.name, xprvKey, hdpath, now, staletime);
        }

        {
          // usage key for type 'change'
          let usage = 1;
          let hdpath = `m/44'/${COIN_TYPE}'/${account}'/${usage}`;
          /** @type {import('dashhd').HDXKey} */
          let changeKey = await DashHd.derivePath(walletKey, hdpath);
          await indexPrivateAddrs(w.name, changeKey, hdpath, now, staletime);
        }

        await config.store.save(safe.privateWallets);
      },
      Promise.resolve());

      await config.store.save(safe.cache);
    };

    /**
     * @param {String} addr
     * @param {Number} now - ex: Date.now()
     * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
     * @returns {Promise<void>}
     */
    async function indexWifAddr(addr, now, staletime = config.staletime) {
      let addrInfo = safe.cache.addresses[addr];
      if (!addrInfo) {
        // TODO option for indexOrCreateWif effect vs stricter index-known-only
        addrInfo = Wallet.generateAddress({
          wallet: "wifs",
          hdpath: "*",
          index: -1,
        });
        safe.cache.addresses[addr] = addrInfo;
      }

      await wallet._updateAddrInfo(addr, now, staletime);
    }

    /**
     * @param {String} addr
     * @param {Number} now - ex: Date.now()
     * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
     * @prop {Boolean} [_force] - treat as a new address, even if it's been used
     */
    wallet._updateAddrInfo = async function (
      addr,
      now,
      staletime = config.staletime,
      _force = false,
    ) {
      let addrInfo = safe.cache.addresses[addr];

      let fresh = false;
      if (staletime) {
        fresh = now - addrInfo.checked_at < staletime;
      }

      // TODO pre-sync change addr with instant send utxo results
      if (addrInfo.sync_at) {
        if (now > addrInfo.sync_at) {
          fresh = false;
          addrInfo.sync_at = undefined;
        }
      }

      if (!fresh) {
        let mightBeSpendable = addrInfo.utxos.length;
        let mightBeNew = !mightBeSpendable && !addrInfo.txs.length;

        let _force = false;
        if (_force || mightBeNew) {
          let insightTxs = await dashsight.getTxs(addr, 1);
          let tx = insightTxs.txs[0];
          if (tx?.time) {
            let txid = tx.txid;
            // TODO store many txs
            addrInfo.txs = [[tx.time, txid]];
            // TODO determine this from txs?
            addrInfo.utxos = await getMiniUtxos(addr);
          }
        } else if (mightBeSpendable) {
          // we don't need to recheck transactions
          addrInfo.utxos = await getMiniUtxos(addr);
        }

        addrInfo.checked_at = now;
      }

      return addrInfo;
    };

    /**
     * @param {String} walletName
     * @param {import('dashhd').HDXKey} xKey
     * @param {String} hdpath - derivation path
     * @param {Number} now - ex: Date.now()
     * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
     * @returns {Promise<Number>} - the next, possibly sparse, unused address index
     */
    async function indexPayAddrs(
      walletName,
      xKey,
      hdpath,
      now,
      staletime = config.staletime,
    ) {
      let MAX_SPARSE_UNCHECKED = 20;
      let MAX_SPARSE_CHECKED = 2;

      let recentlyUsedIndex = -1;
      let count = 0;
      for (let index = 0; ; index += 1) {
        let addressKey = await deriveAddress(xKey, index);
        let addr = await DashHd.toAddr(addressKey.publicKey);

        let addrInfo = safe.cache.addresses[addr];
        if (addrInfo?.txs.length) {
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

        let addressKey = await deriveAddress(xKey, index);
        let addr = await DashHd.toAddr(addressKey.publicKey);

        let addrInfo = safe.cache.addresses[addr];
        if (!addrInfo) {
          addrInfo = Wallet.generateAddress({
            wallet: walletName,
            hdpath: hdpath,
            index: index,
          });
          safe.cache.addresses[addr] = addrInfo;
        }

        await wallet._updateAddrInfo(addr, now, staletime);
        addrInfo = safe.cache.addresses[addr];

        // TODO check addrs that have utxos?

        // TODO also skip addresses that are known to be pending receiving a payment?

        if (addrInfo.txs.length) {
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
     * @param {String} walletName
     * @param {import('dashhd').HDXKey} xprvKey
     * @param {String} hdpath - derivation path
     * @param {Number} now - ex: Date.now()
     * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
     * @returns {Promise<Number>} - the next, possibly sparse, unused address index
     */
    async function indexPrivateAddrs(
      walletName,
      xprvKey,
      hdpath,
      now,
      staletime = config.staletime,
    ) {
      let addrEntries = Object.entries(safe.cache.addresses);
      await addrEntries.reduce(async function (promise, [addr, addrInfo]) {
        await promise;

        if (walletName !== addrInfo.wallet) {
          return;
        }

        // also indicates the wallet is private
        // (and that there's a corresponding private key)
        if (hdpath !== addrInfo.hdpath) {
          return;
        }

        await wallet._updateAddrInfo(addr, now, staletime);
      }, Promise.resolve());

      return await indexPayAddrs(walletName, xprvKey, hdpath, now, staletime);
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

    if (!safe.cache) {
      safe.cache = { addresses: {} };
    }
    if (!safe.cache.addresses) {
      safe.cache.addresses = {};
    }
    if (!safe.payWallets) {
      safe.payWallets = {};
    }
    if (!safe.preferences) {
      safe.preferences = {};
    }
    if (!safe.privateWallets) {
      safe.privateWallets = {};
    }
    if (!safe.privateWallets.wifs) {
      safe.privateWallets.wifs = Wallet.generate({
        label: "WIFs",
        name: "wifs",
        priority: 0,
        wifs: [],
      });
      await config.store.save(safe.privateWallets);
    }
    if (!safe.privateWallets.main) {
      safe.privateWallets.main = Wallet.generate({
        name: "main",
        label: "Main",
        priority: 1,
      });
      await config.store.save(safe.privateWallets);
    }

    return wallet;
  };

  /**
   * @param {Object} opts
   * @param {String} opts.wallet - name of (HD) wallet
   * @param {String} opts.hdpath - derivation path, without index (ex: "m/44'/5'/0'/0")
   * @param {Number} opts.index - xpub or hdpath index
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
   * @param {Number} opts.priority - sparse index, higher is higher
   * @param {String?} [opts.contact] - handle of contact
   * @param {Array<WifInfo>} [opts.wifs] - loose wifs instead of mnemonic
   * @returns {PrivateWallet}
   */
  Wallet.generate = function ({ name, label, priority, contact = null, wifs }) {
    let mnemonic = "";
    if (!wifs) {
      mnemonic = Bip39.generateMnemonic();
    }

    //let mnemonic = await Passphrase.generate(128);
    return {
      name: name.toLowerCase(),
      label: label,
      device: null,
      contact: contact,
      priority: priority || 0,
      mnemonic: mnemonic.split(/[,\s\n\|]+/g),
      wifs: wifs || [],
      created_at: new Date().toISOString(),
      archived_at: null,
    };
  };

  /**
   * Generate a wallet with creation date set
   * @param {Object} opts
   * @param {String} opts.handle
   * @param {String} opts.xpub
   * @param {String} opts.addr
   * @returns {PayWallet}
   */
  Wallet.generatePayWallet = function ({ handle, xpub, addr }) {
    let d = new Date();
    return {
      contact: handle,
      device: null,
      label: handle,
      name: handle.toLowerCase(),
      priority: d.valueOf(),
      addr: addr,
      xpub: xpub,
      created_at: d.toISOString(),
      archived_at: null,
    };
  };

  /**
   * @param {String} xpub
   * @returns {Promise<void>}
   * @throws {Error}
   */
  Wallet.assertXPub = async function (xpub) {
    try {
      await DashHd.fromXKey(xpub);
    } catch (e) {
      //@ts-ignore - tsc bug
      if (!e.message.includes("Invalid checksum")) {
        throw e;
      }
      throw new Error(
        `failed to parse contact's xpub (bad checksum): '${xpub}'`,
      );
    }
  };

  /**
   * @param {String} xpub
   * @returns {Promise<Boolean>} - is xpub with valid checksum
   */
  Wallet.isXPub = async function (xpub = "") {
    // TODO check length

    if (!xpub.startsWith("xpub")) {
      return false;
    }

    if (xpub.length !== 111) {
      return false;
    }

    try {
      await Wallet.assertXPub(xpub);
    } catch (e) {
      return false;
    }

    return true;
  };

  if ("undefined" !== typeof module) {
    module.exports = Wallet;
  }
})(("undefined" !== typeof module && module.exports) || window);
