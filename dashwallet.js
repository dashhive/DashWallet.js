(function (exports) {
  "use strict";

  let Wallet = {};
  //@ts-ignore
  exports.Wallet = Wallet;

  let DashApi = {};
  //@ts-ignore
  let DashHd = exports.DashHd || require("dashhd");
  //@ts-ignore
  let DashKeys = exports.DashKeys || require("dashkeys");
  //@ts-ignore
  let DashPhrase = exports.DashPhrase || require("dashphrase");
  //@ts-ignore
  let DashTx = exports.DashTx || require("dashtx");
  let dashTx = DashTx.create();

  /*
  let Secp256k1 = require("@dashincubator/secp256k1");

  async function sign({ privateKey, hash }) {
    let sigOpts = { canonical: true };
    let sigBuf = await Secp256k1.sign(hash, privateKey, sigOpts);
    return Tx.utils.u8ToHex(sigBuf);
  }
  */

  /** @typedef {import('dashsight').CoreUtxo} CoreUtxo */
  /** @typedef {import('dashtx').TxOutput} TxOutput */
  /** @typedef {import('dashsight').GetTxs} GetTxs */
  /** @typedef {import('dashsight').GetUtxos} GetUtxos */
  /** @typedef {import('dashsight').InstantSend} InstantSend */
  /** @typedef {import('dashsight').InsightUtxo} InsightUtxo */

  const DUFFS = 100000000;
  const DUST = 10000;
  const FEE = 1000;
  DashApi.DUFFS = DUFFS;

  DashApi.DashTypes = {
    name: "dash",
    pubKeyHashVersion: "4c",
    privateKeyVersion: "cc",
    coinType: "5",
  };

  DashApi.DUST = DUST;
  DashApi.FEE = FEE;

  const SATOSHIS = 100000000;
  Wallet.SATOSHIS = SATOSHIS;

  const XPUBS_WALLET = "__XPUBS__";
  const ADDRS_WALLET = "__ADDRS__";
  const XPUB_CHAR_LEN = 111;
  const ADDR_CHAR_LEN = 34;

  let XPUB_VERSIONS = ["xpub", "tpub"];
  let ADDR_VERSIONS = ["X", "Y"];

  /** @param {Number} satoshis */
  function toDustFixed(satoshis) {
    let dashNum = satoshis / SATOSHIS;
    let dash = dashNum.toFixed(8);
    dash = dash.slice(0, 6) + " " + dash.slice(6);
    return dash;
  }

  /**
   * @template {Pick<CoreUtxo, "satoshis">} T
   * @param {Array<T>} utxos
   * @param {Number} output - including fee estimate
   * @return {Array<T>}
   */
  DashApi.selectOptimalUtxos = function (utxos, output) {
    let balance = DashApi.getBalance(utxos);
    let fees = DashTx.appraise({
      //@ts-ignore
      inputs: [{}],
      outputs: [{}],
    });

    let fullSats = output + fees.min;

    if (balance < fullSats) {
      return [];
    }

    // from largest to smallest
    utxos.sort(function (a, b) {
      return b.satoshis - a.satoshis;
    });

    /** @type Array<T> */
    let included = [];
    let total = 0;

    // try to get just one
    utxos.every(function (utxo) {
      if (utxo.satoshis > fullSats) {
        included[0] = utxo;
        total = utxo.satoshis;
        return true;
      }
      return false;
    });
    if (total) {
      return included;
    }

    // try to use as few coins as possible
    utxos.some(function (utxo, i) {
      included.push(utxo);
      total += utxo.satoshis;
      if (total >= fullSats) {
        return true;
      }

      // it quickly becomes astronomically unlikely to hit the one
      // exact possibility that least to paying the absolute minimum,
      // but remains about 75% likely to hit any of the mid value
      // possibilities
      if (i < 2) {
        // 1 input 25% chance of minimum (needs ~2 tries)
        // 2 inputs 6.25% chance of minimum (needs ~8 tries)
        fullSats = fullSats + DashTx.MIN_INPUT_SIZE;
        return false;
      }
      // but by 3 inputs... 1.56% chance of minimum (needs ~32 tries)
      // by 10 inputs... 0.00953674316% chance (needs ~524288 tries)
      fullSats = fullSats + DashTx.MIN_INPUT_SIZE + 1;
    });
    return included;
  };

  /**
   * @template {Pick<CoreUtxo, "satoshis">} T
   * @param {Array<T>} utxos
   * @returns {Number}
   */
  DashApi.getBalance = function (utxos) {
    return utxos.reduce(function (total, utxo) {
      return total + utxo.satoshis;
    }, 0);
  };

  /**
   * @param {Number} dash - as DASH (not duffs / satoshis)
   * @returns {Number} - duffs
   */
  DashApi.toDuff = function (dash) {
    return Math.round(dash * DUFFS);
  };

  /**
   * @param {Number} satoshis
   * @returns {Number} - float
   */
  DashApi.toDash = function (satoshis) {
    let floatBalance = parseFloat((satoshis / DUFFS).toFixed(8));
    return floatBalance;
  };

  let COIN_TYPE = 5;

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
   * How we interpret a coin for selection and usage
   * @typedef CoinInfo
   * @prop {Number} satoshis
   * @prop {Number} faceValue
   * @prop {Number} stamps
   * @prop {Number} dust
   */

  /**
   * How we interpret how a coin will be denominated
   * @typedef {CoinInfo & DenomInfoPartial} DenomInfo
   *
   * @typedef DenomInfoPartial
   * @prop {Array<Number>} denoms
   * @prop {Number} stampsPerCoin
   * @prop {Number} stampsRemaining
   * @prop {Number} fee
   * @prop {Boolean} transactable - if stampsPerCoin >= 2
   * @prop {Number} stampsNeeded - if stampsPerCoin < 2
   */

  /**
   * Coin info + Utxo info
   * @typedef {CoinInfo & CoreUtxo} UtxoCoinInfo
   */

  /**
   * How we interpret a send amount
   * @typedef SendInfo
   * @prop {Number} satoshis
   * @prop {Array<Number>} denoms
   * @prop {Number} _lowFaceValue
   * @prop {Number} faceValue
   * @prop {Number} dustNeeded
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
   * @prop {Array<Number>} denomAmounts - TODO move to settings
   * @prop {Array<Number>} denomSatoshis - TODO move to settings
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
   * @prop {Contact} contact
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
   * @callback Contact
   * @param {ContactOpts} opts
   * @returns {Promise<[String, PayWallet]>} - rxXPub, txXPub, txStaticAddr
   *
   * @typedef ContactOpts
   * @prop {String} handle
   * @prop {String} xpub - receive-only xpub key from friend
   * @prop {String} address - reusable address, e.g. for Coinbase
   * @prop {Boolean} [legacyPrefix] - to allow recovery of non-prefixed contacts
   * @prop {String} [addr] - legacy property for address
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
   * @prop {String} phrase
   * @prop {Array<WifInfo>} wifs - TODO maybe Object.<String, WifInfo>
   * @prop {String} name
   * @prop {Number} priority
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   *
   * @typedef WifInfo
   * @prop {String} address
   * @prop {String} [addr] - deprecated, use address
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
   * @prop {String} address - instead of xpub, e.g. for coinbase
   * @prop {String} addr - deprecated, use address
   * @prop {String} xpub
   * @prop {String} created_at - ISO Date
   * @prop {String?} archived_at - ISO Date
   */

  Wallet.DashTypes = DashApi.DashTypes;
  Wallet.DUFFS = DashApi.DUFFS;
  Wallet.getBalance = DashApi.getBalance;
  Wallet.toDash = DashApi.toDash;
  Wallet.toDuff = DashApi.toDuff;
  Wallet.DENOM_AMOUNTS = [
    1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01,
    0.005, 0.002, 0.001,
  ];
  // Ex: we could add additional denoms via some setting
  if (false) {
    Wallet.DENOM_AMOUNTS.push(0.0005);
    Wallet.DENOM_AMOUNTS.push(0.0002);
    Wallet.DENOM_AMOUNTS.push(0.0001);
  }

  /** @type {Array<Number>} */
  Wallet.DENOM_SATS = [];
  amountsToSats(Wallet.DENOM_AMOUNTS, Wallet.DENOM_SATS);

  /**
   * @param {Array<Number>} amounts
   * @param {Array<Number>} sats
   */
  function amountsToSats(amounts, sats) {
    for (let amount of amounts) {
      let satoshis = amount * SATOSHIS;
      satoshis = Math.round(satoshis);
      sats.push(satoshis);
    }
    return sats;
  }

  /**
   * @param {Config} config
   * @returns {Promise<WalletInstance>}
   */
  Wallet.create = async function (config) {
    let safe = config.safe;
    let wallet = {};
    let dashsight = config.dashsight;

    // TODO: move to config
    wallet.__DENOMS__ = Wallet.DENOM_SATS;
    let __LAST_DENOM__ = wallet.__DENOMS__.length - 1;
    wallet.__MIN_DENOM__ = Wallet.DENOM_SATS[__LAST_DENOM__];
    wallet.__STAMP__ = 200;
    wallet.__MIN_STAMPS__ = 2;

    if (!config.denomAmounts?.length) {
      config.denomAmounts = Wallet.DENOM_AMOUNTS;
    }
    config.denomSatoshis = amountsToSats(config.denomAmounts, []);

    if ("undefined" === typeof config.staletime) {
      config.staletime = 60 * 1000;
    }

    // TODO rename shareXPubWith, receiveXPubFrom, receiveAddrFrom?
    /** @type {Contact} */
    wallet.contact = async function ({
      handle,
      xpub,
      address,
      addr,
      legacyPrefix,
    }) {
      address = address || addr || "";
      if (!handle) {
        throw new Error(`no 'handle' given`);
      }

      let specials = ["main", "savings", "wifs"];
      let ihandle = handle.toLowerCase();
      let isSpecial = specials.includes(ihandle);
      if (isSpecial) {
        throw new Error(`${handle} may not be used as a contact name`);
      }

      if (!legacyPrefix) {
        let prefixes = ["#", "@"];
        let prefix = handle[0];
        let validPrefix = prefixes.includes(prefix);
        if (!validPrefix) {
          throw new Error(
            `contact names should start with '#' (ex: '#john') for local contacts, or '@' for live-wallet/self-published contacts (ex: '@john.dev'), not '${handle}'`,
          );
        }
      }

      let safe = config.safe;

      /** @type {PayWallet} */
      let txWallet;
      let hasAddr = xpub || address;
      if (hasAddr) {
        txWallet = await _getOrCreateWallet(handle, xpub, address);
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
        rxWallet = await Wallet.generate({
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

      _transitionPhrase(rxWallet); // TODO remove

      let salt = "";
      let seed = await DashPhrase.toSeed(rxWallet.phrase, salt);
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
    wallet.befriend = wallet.contact;

    /**
     * @param {String} handle - contact's handle
     * @param {String} xpub
     * @param {String} address
     * @returns {Promise<PayWallet>}
     */
    async function _getOrCreateWallet(handle, xpub, address) {
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

          if (address.length > 0) {
            return address === wallet.address || wallet.addr;
          }

          return false;
        });
      if (!txWallet) {
        txWallet = Wallet.generatePayWallet({
          handle: handle,
          xpub: xpub,
          address: address,
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
     * @typedef WalletAccount
     * @prop {Number} faceValue - spendable amount
     * @prop {Number} _satoshis - spendable + dust amounts
     * @prop {Array<CoreUtxo>} utxos
     */

    /**
     * @returns {Object<String, WalletAccount>}
     */
    wallet.accounts = function () {
      /** @type {Object<String, Array<Required<MiniUtxo>>>} */
      let accounts = {};

      let addrs = Object.keys(safe.cache.addresses);
      for (let addr of addrs) {
        let addrInfo = safe.cache.addresses[addr];

        let isSpendable = hasWif(addrInfo);
        if (!isSpendable) {
          continue;
        }

        let accountName = addrInfo.wallet;
        if (!accounts[accountName]) {
          accounts[accountName] = {
            faceValue: 0,
            _satoshis: 0,
            utxos: [],
          };
        }
        let account = accounts[accountName];

        let isLooseWif = hasLooseWif(addrInfo);
        if (isLooseWif) {
          // ignore wifs
        }

        for (let utxo of addrInfo.utxos) {
          let _utxo = Object.assign({ address: addr }, utxo);
          account.utxos.push(_utxo);

          // TODO maybe denominate and break change for more accurate face value
          //let outputInfo = Wallet._denominateCoins(d, inputInfos, breakChange);
          let coinInfo = Wallet._parseCoinInfo(wallet, _utxo.satoshis);
          account.faceValue += coinInfo.faceValue;
          account._satoshis += _utxo.satoshis;
        }
      }

      return accounts;
    };

    /**
     * Show balances of addresses for which we have the private keys (WIF)
     * (don't forget to sync first!)
     * @returns {Promise<Object.<String, Number>>}
     */
    wallet.balances = async function () {
      /** @type {Object.<String, Number>} */
      let balances = {};

      Object.values(safe.cache.addresses).forEach(function (addrInfo) {
        let isSpendable = hasWif(addrInfo);
        if (!isSpendable) {
          return;
        }

        let isLooseWif = hasLooseWif(addrInfo);
        if (isLooseWif) {
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
     * @param {Number} [opts.now] - ms since epoch (e.g. Date.now())
     * @param {Number} [opts.staletime] - when to refresh
     * @returns {Promise<Array<WalletAddress>>}
     * TODO - multiuse: true
     */
    wallet.import = async function ({ wifs, now = Date.now(), staletime = 0 }) {
      /** @type {Array<WalletAddress>} */
      let addrInfos = [];

      await wifs.reduce(async function (promise, wif) {
        await promise;

        //@ts-ignore bad export
        let addr = await DashKeys.wifToAddr(wif);
        let addrInfo = safe.cache.addresses[addr];

        await indexNonHdAddr("wifs", addr, now, staletime);

        addrInfos.push(
          Object.assign(
            { address: addr, addr: addr },
            safe.cache.addresses[addr],
          ),
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
          // the first "wifs" is the name of the wallet
          safe.privateWallets.wifs.wifs.push({
            address: addr,
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
     * @returns {Array<CoreUtxo>}
     */
    wallet.utxos = function () {
      /** @type {Array<Required<MiniUtxo>>} */
      let utxos = [];

      let addrs = Object.keys(safe.cache.addresses);
      for (let addr of addrs) {
        let addrInfo = safe.cache.addresses[addr];
        let isSpendable = hasWif(addrInfo);
        if (!isSpendable) {
          continue;
        }

        if ("*" === addrInfo.hdpath) {
          // ignore wifs
        }

        for (let utxo of addrInfo.utxos) {
          let _utxo = Object.assign({ address: addr }, utxo);
          utxos.push(_utxo);
        }
      }

      return utxos;
    };

    /** @param {WalletAddress} addrInfo */
    function hasWif(addrInfo) {
      return !!addrInfo.hdpath;
    }

    /** @param {WalletAddress} addrInfo */
    function hasLooseWif(addrInfo) {
      return "*" === addrInfo.hdpath;
    }

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

      if (ADDR_CHAR_LEN === addrPrefix.length) {
        let addrInfo = safe.cache.addresses[addrPrefix];
        if (addrInfo) {
          addrInfos.push(
            Object.assign({ address: addrPrefix, addr: addrPrefix }, addrInfo),
          );
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
        addrInfos.push(Object.assign({ address: addr, addr: addr }, addrInfo));
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
          return wallet.contact === handle || wallet.name === handle;
        })
        .sort(wallet._sort);
      return txws;
    };

    /**
     * @typedef NextInfo
     * @prop {Number} start
     * @prop {String} [addr]
     * @prop {Array<String>} addrs
     */

    /**
     * @param {Object} opts
     * @param {import('dashhd').HDXKey} opts.xKey
     * @param {Number} opts.count - how many next addresses
     * @param {Number} opts.offset - where to start
     * @returns {Promise<Array<String>>} - next n unused addresses
     */
    wallet._nextWalletAddrs = async function ({ xKey, count = 1, offset }) {
      let addrs = [];
      for (let i = 0; i < count; i += 1) {
        let index = offset + i;

        let addressKey = await deriveAddress(xKey, index);
        let addr = await DashHd.toAddr(addressKey.publicKey);
        addrs.push(addr);
      }
      return addrs;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {String} opts.hdpath
     * @returns {Promise<import('dashhd').HDXKey>}
     */
    wallet._recoverXPrv = async function ({ handle, hdpath }) {
      let ws = await wallet.findPrivateWallets({ handle });
      if (!ws.length) {
        throw new Error(`could not find wallet or account for '${handle}'`);
      }
      ws.forEach(function (w) {
        _transitionPhrase(w); // TODO remove
      });

      let w = ws[0];
      let hasRecoveryPhrase = w.phrase?.length > 0;
      if (!hasRecoveryPhrase) {
        throw new Error(
          "[Sanity Fail] must use private wallet from a recovery phrase (not WIF or pay wallet)",
        );
      }

      let salt = "";
      let seed = await DashPhrase.toSeed(w.phrase, salt);
      let walletKey = await DashHd.fromSeed(seed);

      /** @type {import('dashhd').HDXKey} */
      let xprvKey = await DashHd.derivePath(walletKey, hdpath);

      return xprvKey;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.count
     * @param {Number} [opts.now]
     * @param {Number} [opts.staletime]
     * @param {Boolean} [opts.allowReuse]
     */
    wallet.getNextPayAddrs = async function ({
      handle,
      count = 1,
      now = Date.now(),
      staletime = config.staletime,
      allowReuse = false,
    }) {
      let walletName;
      let xpub;

      let isAddrLen = handle.length === ADDR_CHAR_LEN;
      let isXPubLen = handle.length === XPUB_CHAR_LEN;
      let wallets = await wallet.findPayWallets({ handle });
      let payWallet = wallets?.[0]; // newest is first
      if (payWallet?.name) {
        walletName = payWallet.name;
        xpub = payWallet.xpub;
      } else if (isXPubLen) {
        let prefix = handle.slice(0, 4);
        let isValid = XPUB_VERSIONS.includes(prefix);
        if (isValid) {
          walletName = XPUBS_WALLET;
          xpub = handle;
        }
      }
      if (xpub) {
        let addrsInfo = await wallet._getNextPayAddrs({
          walletName: payWallet.name,
          xpub: payWallet.xpub,
          count: count,
          now: now,
        });
        //@ts-ignore
        addrsInfo.xpub = xpub;
        return addrsInfo;
      }

      if (isAddrLen) {
        if (count !== 1) {
          let err = new Error(
            `can't get ${count} addresses from single address for '${handle}'`,
          );
          Object.assign(err, {
            code: "E_TOO_FEW_ADDRESSES",
            need: count,
            lastAddress: [handle],
          });
          throw err;
        }

        let addrInfo = await indexPayAddr(
          ADDRS_WALLET,
          handle,
          "*",
          -1,
          now,
          staletime,
        );

        if (addrInfo.txs.length) {
          if (!allowReuse) {
            throw createReuseError(addrInfo.address);
          }
        }

        let addrsInfo = { index: -1, addresses: [handle] };
        return addrsInfo;
      }

      let limit = count;
      let addrsInfo = await wallet._getNextLooseAddrs({
        wallets,
        limit,
        now,
        staletime,
        allowReuse,
      });
      let lossyCount = addrsInfo?.addresses?.length || 0;
      let hasAddrs = count === lossyCount;
      if (!hasAddrs) {
        let err = new Error(
          `there is no xpub, and only ${lossyCount} (need ${count}) lossy addresses associated with '${handle}'`,
        );
        Object.assign(err, {
          code: "E_TOO_FEW_ADDRESSES",
          need: count,
          lastAddress: addrsInfo?.addresses?.at(-1),
        });
        throw err;
      }

      return addrsInfo;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.walletName
     * @param {String} opts.xpub
     * @param {Number} opts.count
     * @param {Number} [opts.now]
     * @param {Number} [opts.staletime]
     * @param {Boolean} [opts.allowReuse]
     */
    wallet._getNextPayAddrs = async function ({
      walletName = XPUBS_WALLET,
      xpub,
      count = 1,
      now = Date.now(),
      staletime = config.staletime,
      allowReuse = false,
    }) {
      let xKey = await DashHd.fromXKey(xpub);

      let hdpath = ""; // TODO include in xKey
      let offset = await indexPayAddrs(walletName, xKey, hdpath, now);
      await config.store.save(safe.cache);

      let payAddrs = await wallet._nextWalletAddrs({
        xKey,
        offset,
        count,
      });
      await config.store.save(safe.cache);

      return { index: offset, addresses: payAddrs };
    };

    /**
     * @param {Object} opts
     * @param {Array<PayWallet>} opts.wallets
     * @param {Number} [opts.limit]
     * @param {Number} [opts.now]
     * @param {Number} [opts.staletime]
     * @param {Boolean} [opts.allowReuse]
     */
    wallet._getNextLooseAddrs = async function ({
      wallets,
      limit,
      now = Date.now(),
      staletime = config.staletime,
      allowReuse = false,
    }) {
      let payWallet = wallets[0]; // newest is first
      if (!payWallet?.addr) {
        return null;
      }

      // get all not-known-to-be-used addrs
      let addrs = [];
      for (let w of wallets) {
        let addr = w.address || w.addr;
        let addrInfo = safe.cache.addresses[addr];
        if (!addrInfo) {
          addrInfo = Wallet.generateAddress({
            wallet: w.name,
            hdpath: "*",
            index: -1,
          });
          safe.cache.addresses[addr] = addrInfo;
        }
        let used = isUsed(addrInfo);
        if (!used) {
          // reverse to oldest to newest
          addrs.unshift(addr);
        }
      }

      // check if they have been used, just recently
      let available = [];
      let online = true;
      let lastAddr;
      if (online) {
        for (let addr of addrs) {
          lastAddr = addr;
          let addrInfo = await wallet._updateAddrInfo(addr, now, staletime);
          let used = isUsed(addrInfo);
          if (!used) {
            available.push(addr);
          }
        }
      }

      if (!available.length) {
        if (!allowReuse) {
          throw createReuseError(lastAddr);
        }
        available.push(payWallet.addr);
      }

      let addresses = available.slice(0, limit);

      return { index: -1, addresses: addresses };
    };

    /** @param {WalletAddress} addrInfo */
    function isUsed(addrInfo) {
      return addrInfo.txs?.length > 0;
    }

    /**
     * @param {String} address
     */
    function createReuseError(lastAddress) {
      let err = new Error(
        `no unused addresses are available (set 'allowReuse' to use the most recent)`,
      );
      //@ts-ignore
      err.code = `E_NO_UNUSED_ADDR`;
      err.lastAddress = lastAddress;

      return err;
    }

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
     * @param {Number} opts.now
     */
    wallet.getNextChangeAddrs = async function ({
      handle,
      count = 1,
      now = Date.now(),
    }) {
      let addrsInfo = await wallet._getNextXPrvAddrs({
        handle,
        count,
        usage: 1,
        now,
      });

      return addrsInfo;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.count
     * @param {Number} opts.now
     */
    wallet.getNextReceiveAddrs = async function ({
      handle,
      count = 1,
      now = Date.now(),
    }) {
      let addrsInfo = await wallet._getNextXPrvAddrs({
        handle,
        count,
        usage: 0,
        now,
      });

      return addrsInfo;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.count
     * @param {Number} opts.now
     * @param {Number} opts.usage
     */
    wallet._getNextXPrvAddrs = async function ({ handle, count, usage, now }) {
      let ws = await wallet.findPrivateWallets({ handle });
      if (!ws.length) {
        throw new Error(`could not find wallet or account for '${handle}'`);
      }
      let privWallet = ws[0];

      ws.forEach(_transitionPhrase); // TODO remove

      if (!privWallet.phrase?.length) {
        // TODO generate new WIF
        throw new Error("generate new WIF not implemented");
      }

      let account = 0; // main
      let hdpath = `m/44'/${COIN_TYPE}'/${account}'/${usage}`;
      let xKey = await wallet._recoverXPrv({ handle, hdpath });

      let offset = await indexPayAddrs(privWallet.name, xKey, hdpath, now);
      await config.store.save(safe.cache);

      let receiveAddrs = await wallet._nextWalletAddrs({
        xKey,
        count,
        offset,
      });
      await config.store.save(safe.cache);

      let xpub = await DashHd.toXPub(xKey);
      return { index: offset, addresses: receiveAddrs, xpub: xpub };
    };

    /**
     * Send with change back to main wallet
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Boolean} [opts.allowReuse] - allow non-hd addresses
     * @param {Number} opts.satoshis - duffs/satoshis
     * @param {Array<CoreUtxo>} [opts.selectedCoins]
     * @param {Array<CoreUtxo>} [opts.availableCoins]
     * @param {Number} [opts.now] - ms since epoch (e.g. Date.now())
     * @param {Number} [opts.staletime] - ms old after which to sync
     * @param {Boolean} [opts.breakChange] - Ex: exact 3.00000000 is only worth 2.999 and must be split into 7 coins instead of 1
     */
    wallet.send = async function ({
      handle,
      allowReuse = false,
      satoshis,
      selectedCoins = [],
      availableCoins = [],
      now = Date.now(),
      staletime = config.staletime,
      breakChange = false,
    }) {
      let msg = "not implemented";
      let err = new Error(msg);
      throw err;
    };

    /**
     * Send with change back to main wallet
     * @template {DenomInfo} D
     * @param {Object} opts
     * @param {SendInfo} opts.output - duffs/satoshis
     * @param {Array<CoreUtxo>} [opts.utxos]
     * @param {Boolean} [opts.breakChange] - Ex: exact 3.00000000 is only worth 2.999 and must be split into 7 coins instead of 1
     * @return {CoinSelection<D>}
     */
    wallet.useMatchingCoins = function ({
      output,
      utxos = [],
      breakChange = false,
    }) {
      let d = wallet;

      if (!output?.denoms?.length) {
        throw new Error("can't send 0.000");
      }

      let utxoInfos = Wallet._parseUtxosInfo(d, utxos);

      let denomInfos = [];
      for (let utxoInfo of utxoInfos) {
        // considering each utxo individually (rather than collectively)
        // because we haven't selected them yet
        let denomInfo = Wallet._denominateCoin(d, utxoInfo, breakChange);
        denomInfos.push(denomInfo);
      }

      let cashLikeInfo = Wallet._pairInputsToOutputs(d, output, denomInfos);

      let selection = {
        inputs: cashLikeInfo.inputs,
        output: cashLikeInfo.output,
        change: cashLikeInfo.change,
      };

      return selection;
    };

    /**
     * @param {Object} opts
     * @param {Array<CoreUtxo>} opts.utxos
     * @param {Boolean} opts.breakChange
     */
    wallet.useAllCoins = function ({ utxos, breakChange }) {
      let hasSelectedCoins = utxos.length > 0;
      if (!hasSelectedCoins) {
        let err = wallet._createNeedsInputsError();
        throw err;
      }

      let d = wallet;
      let inputInfos = Wallet._parseUtxosInfo(d, utxos);
      let outputInfo = Wallet._denominateCoins(d, inputInfos, breakChange);
      if (!outputInfo.transactable) {
        throw wallet._createNonTransactableError(outputInfo);
      }
      let selection = {
        inputs: inputInfos,
        output: outputInfo,
        change: null,
      };

      return selection;
    };

    /**
     * @template {DenomInfo} D
     * @typedef CoinSelection
     * @prop {Array<D>} inputs
     * @prop {DenomInfo} output
     * @prop {DenomInfo?} change
     */

    /**
     * @param {DenomInfo} outputInfo
     */
    wallet._createNonTransactableError = function (outputInfo) {
      let d = wallet;

      let satsNeeded = outputInfo.stampsNeeded * d.__STAMP__;
      satsNeeded += d.__STAMP__;

      let maxDenoms = satsNeeded / d.__MIN_DENOM__;
      maxDenoms = Math.ceil(maxDenoms);

      let maxSats = maxDenoms * d.__MIN_DENOM__;

      let dashInput = DashApi.toDash(outputInfo.satoshis);
      let dashNeeded = DashApi.toDash(satsNeeded);
      let maxDash = DashApi.toDash(maxSats);

      let err = new Error(
        `cannot spend Đ${dashInput} without breaking change: add another coin of between Đ${dashNeeded} and Đ${maxDash}, or break change first`,
      );
      //@ts-ignore
      err.code = "E_BREAK_CHANGE";
      //@ts-ignore
      err.outputInfo = outputInfo;
      //@ts-ignore
      err.satoshisNeeded = satsNeeded;
      //@ts-ignore
      err.minDenom = d.__MIN_DENOM__;

      return err;
    };

    wallet._createNeedsInputsError = function () {
      let msg = `'satoshis' must be a positive number unless 'inputs' are specified`;
      let err = new Error(msg);
      //@ts-ignore
      err.code = "E_BAD_REQUEST";
      //@ts-ignore
      err.status = 400;

      return err;
    };

    /**
     * @param {Object} opts
     * @param {Array<CoreUtxo>?} [opts.inputs] - which inputs to use / send
     * @param {Array<String>} [opts.addresses] - which addresses to use
     * @param {Number} [opts.satoshis] - how much to send
     * @param {Number} [opts.now] - ms
     * @param {Number} [opts.staletime]
     * x@param {Array<import('dashtx').TxOutput>} opts.outputs
     */
    wallet.createTx = async function ({
      inputs,
      addresses,
      satoshis,
      now,
      staletime,
    }) {
      let txInfoRaw = await wallet.denominate({
        inputs,
        addresses,
        satoshis,
        now,
        staletime,
      });
      if (!txInfoRaw.inputs) {
        let err = new Error(`inconceivable`);
        //@ts-ignore
        err.code = "INCONCEIVABLE";
        throw err;
      }

      let dashTx = DashTx.create();
      let keys;
      try {
        keys = await wallet._utxosToPrivKeys(txInfoRaw.inputs);
      } catch (e) {
        throw e;
      }
      if (!keys) {
        return;
      }

      let txInfo = await dashTx.hashAndSignAll(txInfoRaw, keys);
      return txInfo;
    };

    /**
     * @param {Object} opts
     * @param {Array<CoreUtxo>?} [opts.inputs]
     * @param {Array<String>} [opts.addresses]
     * @param {Number} [opts.satoshis]
     * x@param {Array<import('dashtx').TxOutput>} opts.outputs
     * @param {Number} [opts.now] - ms
     * @param {Number} [opts.staletime]
     */
    wallet.denominate = async function ({
      inputs,
      addresses,
      satoshis,
      now,
      staletime,
    }) {
      // TODO try first to hit the target output values
      if (!inputs) {
        let utxos = wallet.utxos();
        inputs = Wallet._mustSelectInputs({
          utxos: utxos,
          satoshis: satoshis,
        });
      }

      let fauxTxos = inputs;
      //let fauxTxos = await inputListToFauxTxos(wallet, inputList);
      let balance = Wallet.getBalance(fauxTxos);

      // TODO XXX check determine if it's already denominated
      // - last 5 digits mod 200 with no leftover
      //   - 0.000x xxxx % 200 === 0
      // - last 5 digits are over 2 * 200
      //   - 0.000x xxxx > 400
      // - has exactly one significant digit of denominated value
      //   - xxxx.xxx0 0000

      // 0.0001 0000
      let dusty = 10000;

      // can give at least 3 txs to at least 2 coins
      let sixFees = 1200;

      if (balance <= dusty) {
        let balanceStr = toDustFixed(balance);
        let err = new Error(`can't redenominate ${balanceStr}`);
        //@ts-ignore
        err.code = "E_NO_DENOM";
        //@ts-ignore
        err.satoshis = balance;
        throw err;
      }

      let denoms = config.denomAmounts.map(function (v) {
        return v * SATOSHIS;
      });

      /** @type {Object<String, String>} */
      let denomStrs = {};
      for (let denom of denoms) {
        denomStrs[denom] = toDustFixed(denom);
      }

      let dust = balance - sixFees;
      /** @type {Object<String, Number>} */
      let newCoins = {};
      let outputs = [];
      for (let denom of denoms) {
        let n = dust / denom;
        n = Math.floor(n);
        if (!n) {
          continue;
        }

        // less fee estimate per each output
        dust = dust % denom;
        let denomStr = denomStrs[denom];
        newCoins[denomStr] = n;
        for (let i = 0; i < n; i += 1) {
          let partialOut = {
            satoshis: denom,
          };
          outputs.push(partialOut);
        }
      }
      dust += sixFees;
      let cost = dust;

      let fees = DashTx.appraise({ inputs: inputs, outputs: outputs });
      let feeStr = toDustFixed(fees.mid);

      if (dust < fees.mid) {
        throw new Error("dust < fee recalc not implemented");
      }

      dust -= fees.mid;

      let stampSats = 200;
      let numStamps = dust / stampSats;
      let dustDust = dust % 200;
      numStamps = Math.floor(numStamps);
      if (numStamps < outputs.length) {
        throw new Error("numStamps < numOutputs recalc not implemented");
      }

      let stampsExtra = numStamps % outputs.length;
      let stampsEach = numStamps / outputs.length;
      stampsEach = Math.floor(stampsEach);

      outputs.forEach(function (output) {
        output.satoshis += stampsEach * stampSats;
      });
      outputs
        .slice()
        .reverse()
        .some(function (output, i) {
          if (stampsExtra === 0) {
            return true;
          }

          output.satoshis += stampSats;
          stampsExtra -= 1;
        });

      console.info(outputs);
      console.info(
        `Fee:  ${feeStr}  (${inputs.length} inputs, ${outputs.length} outputs)`,
      );
      console.info(
        `Stamps: ${numStamps} x 0.0000 0200 (${stampsEach} per output)`,
      );

      let dustStr = toDustFixed(dust);
      let dustDustStr = toDustFixed(dustDust);
      console.info(`Dust: ${dustDustStr} (${dustStr})`);
      console.info(``);

      let costStr = toDustFixed(cost);
      console.info(`Cost to Denominate: ${costStr}`);
      console.info(``);

      // TODO handle should link to hash of seed and account # of other wallet
      // TODO deposit into coinjoin account
      let addrsInfo = await wallet.getNextPayAddrs({
        handle: "main",
        count: outputs.length,
      });
      if (!addrsInfo) {
        throw new Error(
          `[Sanity Fail] cannot generate addresses for 'main' account`,
        );
      }

      let payAddresses = addrsInfo.addresses.slice(0);
      fauxTxos.sort(Wallet.sortInputs);
      for (let output of outputs) {
        output = Object.assign(output, {
          address: payAddresses.pop(),
        });
      }
      outputs.sort(Wallet.sortOutputs);

      for (let output of outputs) {
        //@ts-ignore TODO bad export
        let pkh = await DashKeys.addrToPkh(output.address);
        //@ts-ignore TODO bad export
        let pkhHex = DashKeys.utils.bytesToHex(pkh);
        Object.assign(output, { pubKeyHash: pkhHex });
      }

      let txInfoRaw = {
        inputs: fauxTxos,
        outputs: outputs,
      };
      return txInfoRaw;
    };

    /**
     * Send with change back to main wallet
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Boolean} [opts.allowReuse] - allow non-hd addresses
     * @param {Number} opts.satoshis - duffs/satoshis
     * @param {Array<CoreUtxo>?} [opts.utxos]
     * @param {Number} [opts.now] - ms since epoch (e.g. Date.now())
     * @param {Number} [opts.staletime] - ms old after which to sync
     */
    // TODO "exposedSend" suggested by onetime
    wallet.sendWithFingerprint = async function ({
      handle,
      allowReuse = false,
      satoshis,
      utxos,
      now = Date.now(),
      staletime = config.staletime,
    }) {
      let count = 1;
      let addrsInfo = await wallet.getNextPayAddrs({
        handle,
        allowReuse,
        count,
        now,
        staletime,
      });

      let dirtyTx = await wallet.createDirtyTx({
        inputs: utxos,
        output: { address: addrsInfo.addresses[0], satoshis: satoshis },
      });

      let result = await dashsight.instantSend(dirtyTx.transaction).catch(
        /** @param {Error} err */
        function (err) {
          //@ts-ignore
          err.failedTx = dirtyTx.transaction;
          //@ts-ignore
          err.failedUtxos = dirtyTx.inputs;
          throw err;
        },
      );
      //@ts-ignore TODO type summary
      await wallet.captureDirtyTx({ summary: dirtyTx, now });

      return Object.assign({ response: result }, dirtyTx);
    };

    /**
     * DEPRECATED, use wallet.send (renamed)
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} opts.satoshis - duffs/satoshis
     * @param {Array<CoreUtxo>} [opts.utxos]
     * @param {Number} [opts.now] - ms since epoch (e.g. Date.now())
     */
    wallet.pay = async function ({
      handle,
      satoshis,
      utxos,
      now = Date.now(),
    }) {
      console.warn("wallet.pay is deprecated, use wallet.send");
      let result = await wallet.send({
        handle: handle,
        satoshis: satoshis,
        selectedCoins: utxos,
        now: now,
      });
      return result;
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
     * @param {Array<CoreUtxo>?} [opts.inputs]
     * @param {Number} opts.satoshis
     * @param {Number} opts.forceDonation
     * @param {Number} [opts.now] - ms
     */
    wallet.createDonationTx = async function ({
      inputs,
      satoshis = -1,
      forceDonation = -1,
      now = Date.now(),
    }) {
      if (!inputs) {
        let utxos = wallet.utxos();
        inputs = Wallet._mustSelectInputs({
          utxos: utxos,
          satoshis: satoshis,
        });
      }

      let totalAvailable = DashApi.getBalance(inputs);
      let fees = DashTx.appraise({ inputs: inputs, outputs: [] });

      if (satoshis > 0) {
        let belowMaxFee = satoshis < fees.max;
        if (belowMaxFee) {
          let donationAmount = DashApi.toDash(satoshis);
          let feeAmount = DashApi.toDash(fees.max);
          throw new Error(
            `'${donationAmount}' does not meet the minmium donation of ${feeAmount}`,
          );
        }

        // Out of the dust and into the significant digits!
        // 0.0001 0000
        let tooGenerous = satoshis >= 10000;
        if (tooGenerous) {
          let isVeryGenerous = forceDonation === satoshis;
          if (!isVeryGenerous) {
            let donationAmount = DashApi.toDash(satoshis);
            let err = new Error(
              `rejecting possibly accidental donation of ${donationAmount}`,
            );
            //@ts-ignore
            err.code = "E_TOO_KIND";
            throw err;
          }
        }
      }

      let feeEstimate = Math.max(fees.max, satoshis);

      let outputs = [];

      let change = { address: "", satoshis: 0 };
      change.satoshis =
        totalAvailable + -satoshis + -feeEstimate + -DashTx.OUTPUT_SIZE;
      let hasChange = change.satoshis > DashApi.DUST;

      if (hasChange) {
        let count = 1;
        let handle = "main";
        let account = 0; // main
        let usage = 1;

        let hdpath = `m/44'/${COIN_TYPE}'/${account}'/${usage}`;
        let xKey = await wallet._recoverXPrv({ handle, hdpath });

        // XXX is handle always name? (it is for main)
        let offset = await indexPayAddrs(handle, xKey, hdpath, now);
        await config.store.save(safe.cache);

        let addrs = await wallet._nextWalletAddrs({ xKey, offset, count });

        change.address = addrs[0];
        outputs.push(change);
        feeEstimate += DashTx.OUTPUT_SIZE;
      } else {
        // Re: Dash Direct: we round in favor of the network (exact payments)
        feeEstimate = totalAvailable + -satoshis;
      }

      let txInfoRaw = {
        inputs: inputs,
        outputs: outputs,
        _DANGER_donate: true,
      };
      let keys = await wallet._utxosToPrivKeys(inputs);
      let txInfo = await dashTx.hashAndSignAll(txInfoRaw, keys);

      let summary = summarizeDonationTx(txInfo);
      //@ts-ignore TODO type summary
      await wallet._authDirtyTx({ summary, now });
      return summary;
    };

    // XXX pass in known-good change addrs
    /**
     * @param {Object} opts
     * @param {Array<CoreUtxo>?} [opts.inputs]
     * @param {import('dashtx').TxOutput} opts.output
     * @param {Number} [opts.now] - ms
     */
    wallet.createDirtyTx = async function ({
      inputs,
      output,
      now = Date.now(),
    }) {
      if (!inputs) {
        let utxos = wallet.utxos();
        inputs = Wallet._mustSelectInputs({
          utxos: utxos,
          satoshis: output.satoshis,
        });
      }

      let totalAvailable = DashApi.getBalance(inputs);
      let fees = DashTx.appraise({ inputs: inputs, outputs: [output] });

      let feeEstimate = fees.min;
      let minimumIsUnlikely = inputs.length > 2;
      if (minimumIsUnlikely) {
        let likelyPadByteSize = 2 * inputs.length;
        feeEstimate += likelyPadByteSize;
      }

      let recip = Object.assign({}, output);
      if (!recip.satoshis) {
        recip.satoshis = totalAvailable + -feeEstimate;
      }
      let outputs = [recip];

      let change = { address: "", satoshis: 0 };
      change.satoshis =
        totalAvailable + -recip.satoshis + -feeEstimate + -DashTx.OUTPUT_SIZE;
      let hasChange = change.satoshis > DashApi.DUST;

      if (hasChange) {
        let count = 1;
        let handle = "main";
        let account = 0; // main
        let usage = 1;

        let hdpath = `m/44'/${COIN_TYPE}'/${account}'/${usage}`;
        let xKey = await wallet._recoverXPrv({ handle, hdpath });

        // TODO should be name, not handle (though they're the same for main)
        let offset = await indexPayAddrs(handle, xKey, hdpath, now);
        await config.store.save(safe.cache);

        let addrs = await wallet._nextWalletAddrs({ xKey, offset, count });

        change.address = addrs[0];
        outputs.push(change);
        feeEstimate += DashTx.OUTPUT_SIZE;
      } else {
        // Re: Dash Direct: we round in favor of the network (exact payments)
        feeEstimate = totalAvailable + -recip.satoshis;
      }

      for (let output of outputs) {
        //@ts-ignore TODO bad export
        let pkh = await DashKeys.addrToPkh(output.address);
        //@ts-ignore TODO bad export
        let pkhHex = DashKeys.utils.bytesToHex(pkh);
        Object.assign(output, { pubKeyHash: pkhHex });
      }

      let txInfoRaw = {
        inputs: inputs,
        outputs: outputs,
      };
      let keys = await wallet._utxosToPrivKeys(inputs);

      /** @type {import('dashtx').TxInfoSigned} */
      let txInfo = await _signToTarget(txInfoRaw, feeEstimate, keys).catch(
        async function (e) {
          //@ts-ignore
          if ("E_NO_ENTROPY" !== e.code) {
            throw e;
          }
          let txInfo = await _signFeeWalk(
            txInfoRaw,
            output,
            feeEstimate,
            change,
            keys,
          );
          return txInfo;
        },
      );

      let summary = summarizeDirtyTx(txInfo);
      //@ts-ignore TODO type summary
      await wallet._authDirtyTx({ summary, now });
      return summary;
    };

    /**
     * @param {Object} opts
     * @param {Object} opts.summary
     * @param {Object} opts.summary.output
     * @param {String} [opts.summary.output.address]
     * @param {Number} [opts.summary.output.satoshis]
     * @param {Object} [opts.summary.change]
     * @param {String} [opts.summary.change.address]
     * @param {Number} [opts.summary.change.satoshis]
     * @param {Array<CoreUtxo>?} [opts.summary.inputs]
     * @param {Number} [opts.now] - ms
     */
    wallet._authDirtyTx = async function ({ summary, now = Date.now() }) {
      let offset = 3000;
      let recipAddr = summary.output?.address || "";
      let recipAddrInfo = safe.cache.addresses[recipAddr];
      if (recipAddrInfo) {
        recipAddrInfo.sync_at = now + offset;
      }

      let changeAddr = summary.change?.address;
      if (changeAddr) {
        safe.cache.addresses[changeAddr].sync_at = now + offset;
        let recipAddrInfo = safe.cache.addresses[changeAddr];
        if (recipAddrInfo) {
          recipAddrInfo.sync_at = now + offset;
        }
      }

      await config.store.save(safe.cache);
    };

    /**
     * @param {Object} opts
     * @param {Array<CoreUtxo>?} [opts.inputs]
     * @param {Array<TxOutput>?} [opts.outputs]
     * @param {Number} [opts.now] - ms
     */
    wallet.captureTx = async function ({ inputs, outputs, now = Date.now() }) {
      if (inputs?.length) {
        await wallet._spendUtxos({ utxos: inputs, now: now });
      }

      if (outputs?.length) {
        for (let output of outputs) {
          if (!output.address) {
            // TODO guarantee address from pkh
            continue;
          }
          // TODO offline update
          await indexNonHdAddr(ADDRS_WALLET, output.address, now, 0);
        }
      }

      await config.store.save(safe.cache);
    };

    /**
     * @param {Object} opts
     * @param {Object} opts.summary
     * @param {Object} opts.summary.output
     * @param {String} [opts.summary.output.address]
     * @param {Number} [opts.summary.output.satoshis]
     * @param {Object} opts.summary.change
     * @param {String} [opts.summary.change.address]
     * @param {Number} [opts.summary.change.satoshis]
     * @param {Array<CoreUtxo>?} [opts.summary.inputs]
     * @param {Number} [opts.now] - ms
     */
    wallet.captureDirtyTx = async function ({ summary, now = Date.now() }) {
      /** @type {Array<CoreUtxo>} */
      //@ts-ignore
      let stxos = summary.inputs;
      await wallet._spendUtxos({ utxos: stxos, now: now });

      if (summary.change?.address) {
        // TODO offline update
        await wallet._updateAddrInfo(summary.change.address, now, 0);
      }

      if (summary.output?.address) {
        let recipInfo = config.safe.cache.addresses[summary.output.address];
        if (recipInfo) {
          // TODO offline update
          await wallet._updateAddrInfo(summary.output.address, now, 0);
        }
      }

      await config.store.save(safe.cache);
    };

    /**
     * @param {import('dashtx').TxInfoSigned} txInfo
     */
    function summarizeDonationTx(txInfo) {
      let totalAvailable = 0;
      for (let coin of txInfo.inputs) {
        //@ts-ignore - our inputs are mixed with CoreUtxo
        totalAvailable += coin.satoshis;
      }

      let fee = totalAvailable;

      let changeSats = 0;
      let change = txInfo.outputs[1];
      if (change) {
        changeSats = change.satoshis;
      }
      fee -= changeSats;

      let summary = Object.assign(txInfo, {
        total: totalAvailable,
        fee: fee,
        change: change,
      });

      return summary;
    }

    /**
     * @param {import('dashtx').TxInfoSigned} txInfo
     */
    function summarizeDirtyTx(txInfo) {
      let totalAvailable = 0;
      for (let coin of txInfo.inputs) {
        //@ts-ignore - our inputs are mixed with CoreUtxo
        totalAvailable += coin.satoshis;
      }

      let recipient = txInfo.outputs[0];
      // to satisfy tsc
      if (!recipient.address) {
        recipient.address = "";
      }

      let sent = recipient.satoshis;
      let fee = totalAvailable - sent;

      let changeSats = 0;
      let change = txInfo.outputs[1];
      if (change) {
        changeSats = change.satoshis;
      }
      fee -= changeSats;

      let summary = Object.assign(txInfo, {
        total: totalAvailable,
        sent: sent,
        fee: fee,
        output: recipient,
        recipient: recipient,
        change: change,
      });

      return summary;
    }

    /**
     * @param {import('dashtx').TxInfo} txInfoRaw
     * @param {Number} feeEstimate
     * @param {Array<Uint8Array>} keys
     */
    async function _signToTarget(txInfoRaw, feeEstimate, keys) {
      let limit = 128;
      let lastTx = "";
      let hasEntropy = true;

      /** @type {import('dashtx').TxInfoSigned} */
      let txInfo;

      for (let n = 0; true; n += 1) {
        txInfo = await dashTx.hashAndSignAll(txInfoRaw, keys);
        //console.log("DEBUG txInfoRaw (entropy):");
        //console.log(txInfoRaw);

        lastTx = txInfo.transaction;
        let fee = txInfo.transaction.length / 2;
        if (fee <= feeEstimate) {
          break;
        }

        if (txInfo.transaction === lastTx) {
          hasEntropy = false;
          break;
        }
        if (n >= limit) {
          throw new Error(
            `(near-)infinite loop: fee is ${fee} trying to hit target fee of ${feeEstimate}`,
          );
        }
      }

      return txInfo;
    }

    /**
     * @param {import('dashtx').TxInfo} txInfoRaw
     * @param {Object} output
     * @param {Number} [output.satoshis]
     * @param {Number} feeEstimate
     * @param {Object} change
     * @param {Number} change.satoshis
     * @param {Array<Uint8Array>} keys
     */
    async function _signFeeWalk(txInfoRaw, output, feeEstimate, change, keys) {
      let fees = DashTx.appraise(txInfoRaw);
      let limit = fees.max - feeEstimate;

      /** @type {import('dashtx').TxInfoSigned} */
      let txInfo;

      for (let n = 0; true; n += 1) {
        let isTransfer = !output.satoshis;
        let hasExtra = change.satoshis > 0;
        let canIncreaseFee = isTransfer || hasExtra;
        if (!canIncreaseFee) {
          // TODO try to add another utxo before failing
          throw new Error(
            `no signing entropy and the fee variance is too low to cover the marginal cost of all possible signature iterations`,
          );
        }

        let outIndex = 0;
        if (hasExtra) {
          outIndex = txInfoRaw.outputs.length - 1;
          change.satoshis -= 1;
        }
        txInfoRaw.outputs[outIndex].satoshis -= 1;

        txInfo = await dashTx.hashAndSignAll(txInfoRaw, keys);

        //console.log("DEBUG txInfoRaw (walk fee):");
        //console.log(txInfoRaw);

        let fee = txInfo.transaction.length / 2;
        if (fee <= feeEstimate) {
          break;
        }

        if (n >= limit) {
          throw new Error(
            `(near-)infinite loop: fee is ${fee} trying to hit target fee of ${feeEstimate}`,
          );
        }
      }

      return txInfo;
    }

    // TODO nix
    /**
     * @param {Object} opts
     * @param {String} opts.handle
     * @param {Number} [opts.now] - ms
     */
    wallet.getNextPayAddr = async function ({ handle, now = Date.now() }) {
      let isPayAddr = Wallet.isAddrLike(handle);
      if (isPayAddr) {
        return handle;
      }

      let nextPayAddr = "";
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

      return nextPayAddr;
    };

    /**
     * @param {Array<CoreUtxo>} utxos
     * @returns {Promise<Array<Uint8Array>>} - wifs
     */
    wallet._utxosToPrivKeys = async function (utxos) {
      ///** @type {Object.<String, Uint8Array>} */
      //let wifs = {};
      /** @type {Array<Uint8Array>} */
      let privKeys = [];

      await utxos.reduce(async function (promise, utxo) {
        await promise;

        let wifInfo = await wallet.findWif({
          address: utxo.address,
          addr: utxo.address,
          _error: true,
        });
        if (!wifInfo) {
          return;
        }
        /*
        if (wifs[wifInfo.wif]) {
          return;
        }

              //@ts-ignore TODO bad type export
        wifs[wifInfo.wif] = await DashKeys.wifToPrivKey(wifInfo.wif);
        */

        //@ts-ignore TODO bad type export
        let privKey = await DashKeys.wifToPrivKey(wifInfo.wif);
        privKeys.push(privKey);
      }, Promise.resolve());

      //let privKeys = Object.values(wifs);
      return privKeys;
    };

    /**
     * @param {Object} opts
     * @param {String} opts.address - pay address
     * @param {String} [opts.addr] - deprecated, use address
     * @param {Boolean} opts._error - for internal use
     * @returns {Promise<WalletWif?>} - addr info with wif
     */
    wallet.findWif = async function ({ address, addr, _error }) {
      address = address || addr || "";
      let wifData = await wallet._findWif(address).catch(function (err) {
        if (_error || "E_NO_PRIVATE_KEY" !== err.code) {
          throw err;
        }
      });
      if (!wifData) {
        return null;
      }

      let addrInfo = safe.cache.addresses[address];
      return Object.assign(
        { address: address, addr: address, wif: wifData.wif },
        addrInfo,
      );
    };

    /**
     * @param {String} address - pay address
     */
    wallet._findWif = async function (address) {
      let addrInfo = safe.cache.addresses[address];
      if (!addrInfo) {
        throw new Error(`cannot find address info for '${address}'`);
      }

      let isSpendable = hasWif(addrInfo);
      if (!isSpendable) {
        let err = new Error(
          `private key for '${address}' has not been imported`,
        );
        //@ts-ignore
        err.code = "E_NO_PRIVATE_KEY";
        throw err;
      }

      let w = Object.values(safe.privateWallets).find(function (wallet) {
        return wallet.name === addrInfo.wallet;
      });
      if (!w) {
        throw new Error(`cannot find wallet for '${address}'`);
      }

      let isLooseWif = hasLooseWif(addrInfo);
      if (isLooseWif) {
        let wifInfo = w.wifs.find(
          /** @param {WifInfo} wifInfo */
          function (wifInfo) {
            return address === (wifInfo.address || wifInfo.addr);
          },
        );
        return {
          _wallet: w,
          wif: wifInfo.wif,
        };
      }

      _transitionPhrase(w); // TODO remove

      let salt = "";
      let seed = await DashPhrase.toSeed(w.phrase, salt);
      let walletKey = await DashHd.fromSeed(seed);

      /** @type {import('dashhd').HDXKey} */
      let xprvKey = await DashHd.derivePath(walletKey, addrInfo.hdpath);

      let addressKey = await deriveAddress(xprvKey, addrInfo.index);
      let _address = await DashHd.toAddr(addressKey.publicKey);

      if (_address !== address) {
        throw new Error(
          `check fail: hdpath '${addrInfo.hdpath}/${addrInfo.index}' for '${address}' derived '${_address}'`,
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
     * @param {String} opts.address - pay address
     * @param {String} [opts.addr] - deprecated, use address
     * @param {Boolean} opts._error - for internal use
     * @returns {Promise<WalletWif?>} - addr info with wif
     */
    wallet.removeWif = async function ({ address, addr }) {
      address = address || addr || "";
      let addrInfo = safe.cache.addresses[address];
      if (!addrInfo) {
        return null;
      }

      let wifData = await wallet._findWif(address).catch(function (err) {
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
      delete safe.cache.addresses[address];
      await config.store.save(safe.cache);

      return Object.assign(
        { address: addr, addr: addr, wif: wifData.wif },
        addrInfo,
      );
    };

    /**
     * Shows balance, tx, and wallet stats for the given pay address
     * @param {Object} opts
     * @param {Array<String>} opts.addresses
     * @param {Array<String>} [opts.addrs] - deprecated, use addresses
     * @param {Number} opts.now
     * @param {Number} [opts.staletime]
     * @returns {Promise<Array<WalletAddress>>}
     */
    wallet.stat = async function ({
      addresses,
      addrs,
      now = Date.now(),
      staletime = config.staletime,
    }) {
      /** @type {Array<WalletAddress>} */
      let addrInfos = [];
      addresses = addresses || addrs || [];

      await addresses.reduce(async function (promise, addr) {
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

        addrInfos.push(Object.assign({ address: addr, addr: addr }, addrInfo));
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
            await indexNonHdAddr("wifs", wifInfo.addr, now, staletime);
          }
          await config.store.save(safe.privateWallets);
        }
        {
          // TODO transition to w.address, then to w.addresses
          let addr = w.address || w.addr;
          if (addr) {
            await indexNonHdAddr(w.name, addr, now, staletime);
          }
          // for (let addrInfo of w.addresses) {
          //   await indexNonHdAddr(w.name, addrInfo.address, now, staletime);
          // }
        }

        _transitionPhrase(w); // TODO remove
        if (!w.phrase) {
          return;
        }

        let salt = "";
        let seed = await DashPhrase.toSeed(w.phrase, salt);
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
      }, Promise.resolve());

      await config.store.save(safe.cache);
    };

    /**
     * @param {String} walletName
     * @param {String} addr
     * @param {Number} now - ex: Date.now()
     * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
     * @returns {Promise<void>}
     */
    async function indexNonHdAddr(
      walletName,
      addr,
      now,
      staletime = config.staletime,
    ) {
      let addrInfo = safe.cache.addresses[addr];
      if (!addrInfo) {
        // TODO option for indexOrCreateWif effect vs stricter index-known-only
        addrInfo = Wallet.generateAddress({
          wallet: walletName,
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

        let addrInfo = await indexPayAddr(
          walletName,
          addr,
          hdpath,
          index,
          now,
          staletime,
        );

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
     * @param {String} addr
     * @param {String} hdpath - derivation path
     * @param {Number} index
     * @param {Number} now - ex: Date.now()
     * @prop {Number} [staletime] - default 60_000 ms, set to 0 to force checking
     * @returns {Promise<WalletAddress>}
     */
    async function indexPayAddr(
      walletName,
      addr,
      hdpath,
      index,
      now,
      staletime = config.staletime,
    ) {
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

      return addrInfo;
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

      let nextIndex = await indexPayAddrs(
        walletName,
        xprvKey,
        hdpath,
        now,
        staletime,
      );
      return nextIndex;
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
    if (!safe.privateWallets.savings) {
      safe.privateWallets.savings = await Wallet.generate({
        name: "savings",
        label: "Savings",
        priority: 10,
      });
      await config.store.save(safe.privateWallets);
    }
    if (!safe.privateWallets.wifs) {
      safe.privateWallets.wifs = await Wallet.generate({
        label: "WIFs",
        name: "wifs",
        priority: 50,
        wifs: [],
      });
      await config.store.save(safe.privateWallets);
    }
    if (!safe.privateWallets.main) {
      safe.privateWallets.main = await Wallet.generate({
        name: "main",
        label: "Main",
        priority: 100,
      });
      await config.store.save(safe.privateWallets);
    }

    return wallet;
  };

  /**
   * @param {Array<CoreUtxo>} allInputs
   * @param {Number} satoshis
   */
  Wallet._createInsufficientFundsError = function (allInputs, satoshis) {
    let totalBalance = DashApi.getBalance(allInputs);
    let dashBalance = DashApi.toDash(totalBalance);
    let dashAmount = DashApi.toDash(satoshis);
    let fees = DashTx.appraise({
      inputs: allInputs,
      outputs: [{}],
    });
    let feeAmount = DashApi.toDash(fees.mid);

    let err = new Error(
      `insufficient funds: cannot pay ${dashAmount} (+${feeAmount} fee) with ${dashBalance}`,
    );
    throw err;
  };

  /**
   * @param {Object} opts
   * @param {Array<CoreUtxo>} opts.utxos
   * @param {Number} [opts.satoshis]
   * @param {Number} [opts.now] - ms
   */
  Wallet._mustSelectInputs = function ({ utxos, satoshis }) {
    if (!satoshis) {
      let msg = `expected target selection value 'satoshis' to be a positive integer but got '${satoshis}'`;
      let err = new Error(msg);
      throw err;
    }

    let selected = DashApi.selectOptimalUtxos(utxos, satoshis);

    if (!selected.length) {
      throw Wallet._createInsufficientFundsError(utxos, satoshis);
    }

    return selected;
  };

  /**
   * Returns clamped value, number of stamps, and unusable dust
   * @param {DenomConfig} d
   * @param {Number} satoshis
   * @returns {CoinInfo} - faceValue, stamps, etc
   */
  Wallet._parseCoinInfo = function (d, satoshis) {
    let MIN_DENOM = d.__MIN_DENOM__;
    let STAMP = d.__STAMP__;
    let mdash = satoshis / MIN_DENOM;
    mdash = Math.floor(mdash);

    let udash = satoshis % MIN_DENOM;
    let dust = udash % STAMP;

    let stamps = udash / STAMP;
    stamps = Math.floor(stamps);

    let faceValue = mdash * MIN_DENOM;
    faceValue = Math.round(faceValue);

    let coinInfo = {
      satoshis,
      faceValue,
      stamps,
      dust,
    };

    return coinInfo;
  };

  /**
   * @typedef DenomConfig
   * @prop {Number} __MIN_DENOM__ - typically 100000 sats
   * @prop {Number} __MIN_STAMPS__ - typically 2 (a coin must be self-spendable by the person you send it to, and once more)
   * @prop {Number} __STAMP__ - typically 200 sats
   * @prop {Array<Number>} __DENOMS__ - typically doubles, wholes, and halves of each order of magnitude down to (100000) (0.001)
   */

  /**
   * Returns clamped value, number of stamps, and unusable dust
   * @param {DenomConfig}  d
   * @param {Array<CoreUtxo>} utxos
   * @returns {Array<UtxoCoinInfo>}
   */
  Wallet._parseUtxosInfo = function (d, utxos) {
    /** @type {Array<UtxoCoinInfo>} */
    let utxoInfos = [];

    for (let utxo of utxos) {
      let coinInfo = Wallet._parseCoinInfo(d, utxo.satoshis);
      let utxoInfo = Object.assign({}, utxo, coinInfo);
      utxoInfos.push(utxoInfo);
    }

    return utxoInfos;
  };

  /**
   * a cash-like selection of matching inputs given target outputs
   * @template {DenomInfo} D
   * @param {DenomConfig}  d
   * @param {SendInfo} sendInfo
   * @param {Array<D>} denomInfos
   * @returns CoinSelection
   */
  Wallet._pairInputsToOutputs = function (d, sendInfo, denomInfos) {
    let MIN_STAMPS = d.__MIN_STAMPS__;
    let STAMP = d.__STAMP__;
    let DENOMS = d.__DENOMS__;
    let HEADER_SIZE = 10;
    let INPUT_SIZE = 149;
    let OUTPUT_SIZE = 34;

    let R_DENOMS = DENOMS.slice(0);
    R_DENOMS.reverse();

    let sendVals = [];

    let _denomInfos = denomInfos.slice(0);
    _denomInfos.sort(Wallet._byNumberOfCoins);

    let minStamps = MIN_STAMPS + 1;
    let numCoinsOut = sendInfo.denoms.length;
    let stampsCount = minStamps * numCoinsOut;
    let minStampsValue = stampsCount * STAMP;
    let totalSelectedSats = -minStampsValue;

    let totalFaceValue = 0;
    let selectedFaceValue = 0;
    let totalSelected = 0;

    // Note: the receiving party may wish to have the coins broken
    // into something other than the ideal change.
    // In the future we may wish to account for that
    // (probably the same inputs, but 34 more sats per additional output).

    /** @type {Object.<String, Number>} */
    let needed = {};
    for (let denom of DENOMS) {
      needed[denom] = { count: 0, have: 0 };
    }

    sendVals = sendInfo.denoms.slice(0);
    for (let denom of sendVals) {
      totalFaceValue += denom;
      needed[denom].count += 1;
    }

    // Pass #1: fill all possible slots

    /** @type {Array<D>} */
    let coins = [];
    /** @type {Array<D>} */
    let leftovers = [];
    for (let denomInfo of _denomInfos) {
      // TODO recalc 'coins' 'needed' on every iteration of loop
      // to account for a range of possibilities based on total number of stamps
      // in excess of the minimum for the group
      let usable = countUsableCoins(needed, denomInfo);
      let extra = denomInfo.denoms.length - usable;
      let consumable = extra === 0;

      // {
      //   let faceValue = denomInfo.faceValue.toString();
      //   faceValue = faceValue.padStart(10, " ");

      //   let good = "";
      //   if (consumable) {
      //     good = "✅";
      //   }

      //   let change = denomInfo.denoms.length - usable;
      //   console.log(`consumable: ${faceValue}, ${usable}-${change}, ${good}`);
      // }

      if (!consumable) {
        leftovers.push(denomInfo);
        continue;
      }

      totalSelectedSats += denomInfo.satoshis;
      for (let denom of denomInfo.denoms) {
        needed[denom].have += 1;
        selectedFaceValue += denom;
      }
      totalSelected += denomInfo.denoms.length;
      coins.push(denomInfo);
    }
    _denomInfos = leftovers;
    leftovers = [];

    // Pass #2: select the highest coin to fill the gap

    let totalDiff = totalFaceValue - selectedFaceValue;
    // console.log("[DEBUG] 1st selection diff:", totalDiff);
    if (totalDiff > 0) {
      let sorter = Wallet._byLeastChangeLowestValue(d, totalDiff);
      _denomInfos.sort(sorter);
      for (let denomInfo of _denomInfos) {
        if (totalDiff <= 0) {
          leftovers.push(denomInfo);
          continue;
        }

        if (denomInfo.faceValue >= totalDiff) {
          totalSelectedSats += denomInfo.satoshis;
          selectedFaceValue += denomInfo.faceValue;
          coins.push(denomInfo);
          totalSelected += denomInfo.denoms.length;
          totalDiff = 0;
          continue;
        }

        leftovers.push(denomInfo);
      }
      _denomInfos = leftovers;
      leftovers = [];
    }

    totalDiff = totalFaceValue - selectedFaceValue;
    // console.log("[DEBUG] 2nd selection diff:", totalDiff);
    if (totalDiff > 0) {
      _denomInfos.sort(Wallet._byFaceValueDesc);
      for (let denomInfo of _denomInfos) {
        if (totalDiff <= 0) {
          leftovers.push(denomInfo);
          continue;
        }

        // TODO (needs big brain): once the target is hit,
        // try other combos to see if they yield fewer coins
        totalSelectedSats += denomInfo.satoshis;
        selectedFaceValue += denomInfo.faceValue;
        totalSelected += denomInfo.denoms.length;
        totalDiff -= denomInfo.faceValue;
        coins.push(denomInfo);
      }
      _denomInfos = leftovers;
      leftovers = [];
    }

    totalDiff = totalFaceValue - totalSelectedSats;
    // console.log("[DEBUG] 3rd selection diff:", totalDiff);
    if (totalDiff > 0) {
      let dashReqValue = DashApi.toDash(totalFaceValue).toFixed(3);
      //let dashFaceValue = DashApi.toDash(selectedFaceValue).toFixed(3);
      let dashFaceValue = DashApi.toDash(totalSelectedSats).toFixed(8);
      let err = new Error(
        `cannot accumulate ${dashReqValue} with the coins provided (${dashFaceValue})`,
      );
      //@ts-ignore
      err.code = "E_INSUFFICIENT_FUNDS";
      throw err;
    }

    let fee = 0;
    let satoshis = 0;
    let change = 0;

    // iterate over the coins that we've selected to determine
    // if their value meets the requirement, otherwise select another
    _denomInfos.sort(Wallet._byFaceValueAsc);
    for (;;) {
      satoshis = 0;
      fee = 0;

      fee = HEADER_SIZE;
      fee += OUTPUT_SIZE * sendVals.length;
      satoshis = 0;
      for (let coinInfo of coins) {
        fee += INPUT_SIZE;
        satoshis += coinInfo.satoshis;
      }

      let stampsCount = MIN_STAMPS * sendVals.length;
      change = satoshis - sendInfo.satoshis;
      change -= fee;
      change -= stampsCount * STAMP;
      if (change >= 0) {
        break;
      }

      if (!_denomInfos.length) {
        throw new Error("not enough coins to pay fees, etc");
      }

      let removed = _denomInfos.splice(0, 1);
      let denomInfo = removed[0];
      coins.push(denomInfo);
    }

    let changeDenomInfo = Wallet._denominateToOutputs(d, coins, sendVals);
    //let changeCoins = changeDenomInfo.denoms.slice(0);
    //changeDenomInfo.denoms = changeDenomInfo.denoms.concat(sendVals);

    // TODO adjust changeDenomInfo + sendInfo
    // (spread the stamp values across)
    // 1. make objects for sendInfo denoms
    // 2. concat all objects
    // 3. sort deterministically
    // 4. spread stamps
    // 5. dust?? fees?
    return {
      inputs: coins,
      // TODO can we make this more denom-info-y?
      // TODO forget "change", it's a "layer 2" thing
      //output: { denoms: sendVals, },
      output: changeDenomInfo,
      change: null,
      //change: changeCoins,
      //change: changeDenomInfo,
    };
  };

  // TODO select coins that are a better match than the ideal
  // # of inputs+outputs < # of ideal inputs

  /**
   * @param {Object.<String, Number>} needed
   * @param {DenomInfo} info
   */
  function countUsableCoins(needed, info) {
    /** @type {Object.<String, Number>} */
    let _needed = {};
    let denoms = Object.keys(needed);
    for (let denom of denoms) {
      _needed[denom] = Object.assign({}, needed[denom]);
    }

    let usable = 0;
    for (let denom of info.denoms) {
      let need = _needed[denom].count - _needed[denom].have;
      let isNeeded = need > 0;
      if (!isNeeded) {
        continue;
      }
      _needed[denom].have += 1;
      usable += 1;
    }

    return usable;
  }

  /**
   * Sort deterministic by Tx, VOut, Addr (all Asc), and Sats (Dsc)
   *
   * Note: it's important that it's deterministic (or random)
   * to maintain the cash-like quality transfer - rather than
   * by payee and change, which leaks more information to bad actors.
   *
   * TODO move to DashTx
   *
   * @param {CoreUtxo} a
   * @param {CoreUtxo} b
   * @returns Number
   */
  Wallet.sortInputs = function (a, b) {
    // Ascending TxID (Lexicographical)
    if (a.txId > b.txId) {
      return 1;
    }
    if (a.txId < b.txId) {
      return -1;
    }

    // Ascending Vout (Numerical)
    let indexDiff = a.outputIndex - b.outputIndex;
    if (indexDiff !== 0) {
      return indexDiff;
    }

    // Ascending Address (Lexicographical)
    if (a.address > b.address) {
      return 1;
    }
    if (a.address < b.address) {
      return -1;
    }

    // Descending Sats (Numberical)
    return b.satoshis - a.satoshis;
  };

  /**
   * Sort deterministic by Addr (all Asc), and Sats (Dsc)
   *
   * Note: it's important that it's deterministic (or random)
   * to maintain the cash-like quality transfer - rather than
   * by payee and change, which leaks more information to bad actors.
   *
   * TODO move to DashTx
   *
   * @param {TxOutput} a
   * @param {TxOutput} b
   * @returns Number
   */
  Wallet.sortOutputs = function (a, b) {
    if (a.pubKeyHash && b.pubKeyHash) {
      // Ascending PKH (Lexicographical)
      if (a.pubKeyHash > b.pubKeyHash) {
        return 1;
      }
      if (a.pubKeyHash < b.pubKeyHash) {
        return -1;
      }
    }

    if (a.address && b.address) {
      // Ascending Address (Lexicographical)
      if (a.address > b.address) {
        return 1;
      }
      if (a.address < b.address) {
        return -1;
      }
    }

    // Descending Sats (Numberical)
    return b.satoshis - a.satoshis;
  };

  /**
   * Sort DenomInfos first by lowest face value first
   * @param {DenomInfo} a
   * @param {DenomInfo} b
   * @returns {Number}
   */
  Wallet._byFaceValueAsc = function (a, b) {
    return a.faceValue - b.faceValue;
  };

  /**
   * Sort DenomInfos first by lowest face value first
   * @param {DenomInfo} a
   * @param {DenomInfo} b
   * @returns {Number}
   */
  Wallet._byFaceValueDesc = function (a, b) {
    return b.faceValue - a.faceValue;
  };

  /**
   * Sort DenomInfos
   * @callback DenomSorter
   * @param {DenomInfo} a
   * @param {DenomInfo} b
   * @returns {Number}
   */

  /**
   * Create a sorter that optimizes for the least change
   * @param {DenomConfig} d
   * @param {Number} faceValue
   * @returns {DenomSorter}
   */
  Wallet._byLeastChangeLowestValue = function (d, faceValue) {
    /** @type {DenomSorter} */
    function sorter(a, b) {
      let fa = a.faceValue - faceValue;
      let fb = b.faceValue - faceValue;

      // can't calculate change for insufficient funds
      if (fa < 0) {
        if (fb < 0) {
          return fa - fb;
        }
        return 1;
      }
      if (fb < 0) {
        return -1;
      }

      let ca = Wallet._parseCoinInfo(d, fa);
      let cb = Wallet._parseCoinInfo(d, fb);
      let da = Wallet._denominateCoin(d, ca);
      let db = Wallet._denominateCoin(d, cb);

      return da.denoms.length - db.denoms.length;
    }

    return sorter;
  };

  /**
   * Sort DenomInfos first by denoms per coin, then by lowest value
   * @param {DenomInfo} a
   * @param {DenomInfo} b
   * @returns {Number}
   */
  Wallet._byNumberOfCoins = function (a, b) {
    let extraCoins = a.denoms.length - b.denoms.length;
    if (extraCoins > 0) {
      return -1;
    }

    if (extraCoins === 0) {
      let diff = a.faceValue - b.faceValue;
      if (diff < 0) {
        return -1;
      }

      if (diff === 0) {
        return 0;
      }
    }

    return 1;
  };

  /**
   * @param {DenomConfig} d
   * @param {Number} satoshis
   * @returns {SendInfo}
   */
  Wallet._parseSendInfo = function (d, satoshis) {
    let MIN_DENOM = d.__MIN_DENOM__;
    let MIN_STAMPS = d.__MIN_STAMPS__;
    let STAMP = d.__STAMP__;
    let DENOMS = d.__DENOMS__;

    let missing = 0;
    let dustNeeded = satoshis % MIN_DENOM;
    if (dustNeeded) {
      missing = MIN_DENOM - dustNeeded;
    }

    let _lowFaceValue = satoshis - dustNeeded;
    let faceValue = _lowFaceValue;

    let denoms = [];
    let remainder = faceValue;
    for (let denom of DENOMS) {
      while (remainder >= denom) {
        denoms.push(denom);
        remainder -= denom;
      }
    }

    let extra = denoms.length * STAMP * MIN_STAMPS;
    if (extra < dustNeeded) {
      faceValue = satoshis + missing;
      denoms = [];
      remainder = faceValue;
      for (let denom of DENOMS) {
        while (remainder >= denom) {
          denoms.push(denom);
          remainder -= denom;
        }
      }
    }

    return {
      satoshis,
      denoms,
      _lowFaceValue,
      faceValue,
      dustNeeded,
    };
  };

  /**
   * @param {DenomConfig} d
   * @param {CoinInfo} coinInfo
   * @param {Boolean} force - make change to create stamps if necessary
   * @return {DenomInfo}
   */
  Wallet._denominateCoin = function (d, coinInfo, force = false) {
    let DENOMS = d.__DENOMS__;
    let STAMP = d.__STAMP__;

    if (force) {
      return Wallet._denominateSelfPayCoins(d, [coinInfo]);
    }
    let denoms = [];

    let remainder = coinInfo.faceValue;
    for (let denom of DENOMS) {
      while (remainder >= denom) {
        denoms.push(denom);
        remainder -= denom;
      }
    }

    let fees = DashTx.appraise({
      inputs: [coinInfo],
      outputs: denoms,
    });
    let fee = fees.max;

    let transactable = false;
    let stampsPerCoin = 0;
    let stampsRemaining = 0;
    let MIN_STAMPS = 2;
    let stampsNeeded = MIN_STAMPS * denoms.length;
    stampsNeeded -= coinInfo.stamps;
    stampsNeeded = Math.max(0, stampsNeeded);

    let denomInfo = Object.assign(coinInfo, {
      denoms,
      stampsPerCoin,
      stampsRemaining,
      fee,
      transactable,
      stampsNeeded,
    });

    denomInfo.stampsPerCoin = _stampsPerCoin(STAMP, denomInfo);
    denomInfo.transactable = denomInfo.stampsPerCoin >= MIN_STAMPS;

    let evenStamps = denomInfo.stampsPerCoin * denomInfo.denoms.length;
    denomInfo.stampsRemaining = coinInfo.stamps - evenStamps;
    let feeStamps = fee / STAMP;
    feeStamps = Math.ceil(feeStamps);
    denomInfo.stampsRemaining -= feeStamps;

    return denomInfo;
  };

  /**
   * @param {DenomConfig} d
   * @param {Array<CoinInfo>} coinInfos
   * @param {Array<Number>} [_outputs] - how the change should be broken
   * @return {DenomInfo}
   */
  Wallet._denominateSelfPayCoins = function (d, coinInfos, _outputs = []) {
    let DENOMS = d.__DENOMS__;
    let STAMP = d.__STAMP__;
    let MIN_STAMPS = d.__MIN_STAMPS__;
    // TODO decide on a particularly reasonable value
    let SUFFICIENT_STAMPS = 250;
    let HEADER_SIZE = 10;
    let INPUT_SIZE = 149;
    let OUTPUT_SIZE = 34;
    let minStampFee = MIN_STAMPS * STAMP;

    let fee = HEADER_SIZE;
    let satoshis = 0;
    for (let coinInfo of coinInfos) {
      satoshis += coinInfo.satoshis;
      fee += INPUT_SIZE;
    }

    let numCoins = 0;
    let denoms = [];
    let faceValue = 0;
    let stamps = 0;
    let excess = satoshis - fee;

    for (let denom of _outputs) {
      let selfPayDenom = denom;
      selfPayDenom = denom + minStampFee + OUTPUT_SIZE;
      if (excess < selfPayDenom) {
        let requested = _outputs.join(", ");
        let err = new Error(
          `requested denominations (${requested}) exceed requested amount '${satoshis}' (${coinInfos.length})`,
        );
        //@ts-ignore
        err.code = "E_INVALID_REQUEST";
        throw err;
      }
      numCoins += 1;
      stamps += MIN_STAMPS;
      excess -= selfPayDenom;
      fee += OUTPUT_SIZE;
      faceValue += denom;
    }

    for (let denom of DENOMS) {
      let selfPayDenom = denom + minStampFee + OUTPUT_SIZE;
      while (excess >= selfPayDenom) {
        numCoins += 1;
        denoms.push(denom);
        stamps += MIN_STAMPS;
        excess -= selfPayDenom;
        fee += OUTPUT_SIZE;
        faceValue += denom;
      }
    }

    if (numCoins === 0) {
      let err = new Error(
        `cannot create a spendable coin from '${satoshis}' sats across ${coinInfos.length} coins (dust)`,
      );
      //@ts-ignore
      err.code = "E_FORCE_DUST";
      throw err;
    }

    let dust = excess % STAMP;
    let extraStamps = excess / STAMP;
    extraStamps = Math.floor(extraStamps);
    stamps += extraStamps;

    let stampsPerCoin = stamps / numCoins;
    stampsPerCoin = Math.floor(stampsPerCoin);

    if (_outputs.length) {
      let stampDenom = 0;
      for (; denoms.length; ) {
        //@ts-ignore
        stampDenom = denoms.pop();
        numCoins -= 1;
        fee -= OUTPUT_SIZE;

        let extraStamps2 = stampDenom / STAMP;
        extraStamps2 = Math.floor(extraStamps2);
        stamps += extraStamps2;

        let stampsPerCoin2 = stamps / numCoins;
        stampsPerCoin2 = Math.floor(stampsPerCoin2);

        // rewind
        if (stampsPerCoin2 > SUFFICIENT_STAMPS) {
          stamps -= extraStamps2;
          fee += OUTPUT_SIZE;
          numCoins += 1;
          denoms.push(stampDenom);
          break;
        }
      }
      stampsPerCoin = stamps / numCoins;
      stampsPerCoin = Math.floor(stampsPerCoin);
    }
    // console.log("[DEBUG] STAMPS_PER_COIN:", stampsPerCoin);

    // adjusting for the normal calculation that uses fees to calculate stamps
    let stampDust = fee + dust;
    let dustStamps = stampDust / STAMP;
    dustStamps = Math.floor(dustStamps);
    stamps += dustStamps;
    dust = stampDust % STAMP;

    let evenStamps = stampsPerCoin * numCoins;
    let stampsRemaining = stamps - evenStamps;

    let coinInfo = {
      satoshis,
      faceValue,
      stamps,
      dust,
    };

    let transactable = true;
    let stampsNeeded = 0;
    let denomInfo = Object.assign(coinInfo, {
      denoms,
      stampsPerCoin,
      stampsRemaining,
      fee,
      transactable,
      stampsNeeded,
    });

    denomInfo.stampsRemaining = coinInfo.stamps - evenStamps;
    let feeStamps = fee / STAMP;
    feeStamps = Math.ceil(feeStamps);
    denomInfo.stampsRemaining -= feeStamps;

    return denomInfo;
  };

  /**
   * @param {DenomConfig} d
   * @param {Array<CoinInfo>} coinInfos
   * @param {Array<Number>} _outputs - how the change should be broken
   * @return {DenomInfo}
   */
  Wallet._denominateToOutputs = function (d, coinInfos, _outputs = []) {
    let SATS_NUM_DIGITS = 8;

    let DENOMS = d.__DENOMS__;
    let MIN_DENOM = d.__MIN_DENOM__;

    let HEADER_SIZE = 10;
    let INPUT_SIZE = 149;
    let OUTPUT_SIZE = 34;

    let STAMP = d.__STAMP__;
    let MIN_STAMPS = d.__MIN_STAMPS__;
    let MIN_STAMPS_SATS = MIN_STAMPS * STAMP;
    let MAX_STAMPS = MIN_DENOM / STAMP;
    MAX_STAMPS = ieeeSafeFloor(MAX_STAMPS, SATS_NUM_DIGITS);
    MAX_STAMPS -= 1;

    //let TARGET_STAMPS = MAX_STAMPS + 1 / 2;
    //TARGET_STAMPS = ieeeSafeFloor(TARGET_STAMPS, SATS_NUM_DIGITS);

    let requiredFee = 0;
    requiredFee += HEADER_SIZE;

    let totalSatsIn = 0;
    for (let coinInfo of coinInfos) {
      totalSatsIn += coinInfo.satoshis;
      requiredFee += INPUT_SIZE;
    }

    let faceSatsOut = 0;

    for (let denom of _outputs) {
      requiredFee += OUTPUT_SIZE;
      faceSatsOut += denom;
    }

    let totalStampsOut = MIN_STAMPS * _outputs.length;
    let minStampSatsOut = MIN_STAMPS_SATS * _outputs.length;

    let partialSatsOut = requiredFee + faceSatsOut;

    let dirtSats = totalSatsIn - partialSatsOut;
    let totalUnforcedSats = dirtSats - minStampSatsOut;
    if (totalUnforcedSats < 0) {
      let requested = _outputs.join(", ");
      let err = new Error(
        [
          `requested outputs exceed given inputs:`,
          `    inputs: ${coinInfos.length} coins totaling ${totalSatsIn}`,
          `    outputs: coins of ${requested} + ${totalStampsOut} stamps + ${requiredFee} fee`,
        ].join("\n"),
      );
      //@ts-ignore
      err.code = "E_INVALID_REQUEST";
      throw err;
    }

    //let maxStamps = MAX_STAMPS;
    let extraStampsPerCoin = 0;
    let extraStampsOut = 0;
    let maxStampsPerCoin = 0;
    let minStampsPerCoin = 0;
    let denoms = _outputs.slice(0);
    //let STAMP_AND_FEE = STAMP + OUTPUT_SIZE;
    for (;;) {
      //extraStampsOut = totalUnforcedSats / STAMP_AND_FEE;
      extraStampsOut = totalUnforcedSats / STAMP;
      extraStampsOut = ieeeSafeFloor(extraStampsOut, SATS_NUM_DIGITS);
      dirtSats = totalUnforcedSats % STAMP;

      extraStampsPerCoin = extraStampsOut / denoms.length;
      maxStampsPerCoin = Math.ceil(extraStampsPerCoin) + MIN_STAMPS;
      extraStampsPerCoin = ieeeSafeFloor(extraStampsPerCoin, SATS_NUM_DIGITS);
      minStampsPerCoin = extraStampsPerCoin + MIN_STAMPS;
      extraStampsOut = extraStampsOut % denoms.length;

      if (maxStampsPerCoin < MAX_STAMPS) {
        break;
      }

      // TODO increase min stamp values?

      for (let denom of DENOMS) {
        let denomAndFeeAndStamps = denom + OUTPUT_SIZE + MIN_STAMPS_SATS;
        while (totalUnforcedSats >= denomAndFeeAndStamps) {
          denoms.push(denom);
          faceSatsOut += denom;
          requiredFee += OUTPUT_SIZE;
          totalUnforcedSats -= denomAndFeeAndStamps;
        }
      }

      // If we have change, it means there's a minimum of 2 coins with 3 stamps each.
      // If that's the case, it's impossible to get into the case of exactly 0.002
      // being 0.001 + 500 stamps where creating a coin would go below the min stamps
      // and creating stamps will go above the max 499 stamps.
      if (!denoms.length) {
        throw new Error(
          `[Sanity Fail] it should be impossible to get into a situation where both creating a coin form stamps and turning a coin into stamps exceed the limits`,
        );
      }
    }
    totalStampsOut += extraStampsOut + extraStampsPerCoin * denoms.length;

    let coinInfo = {
      satoshis: totalSatsIn,
      faceValue: faceSatsOut,
      stamps: totalStampsOut,
      dust: dirtSats,
    };

    let stampsRemaining = extraStampsOut;

    let denomInfo = Object.assign(coinInfo, {
      denoms: denoms,
      stampsPerCoin: minStampsPerCoin,
      maxStampsPerCoin: maxStampsPerCoin,
      stampsRemaining: stampsRemaining,
      fee: requiredFee,
      transactable: true,
      stampsNeeded: 0,
    });

    return denomInfo;
  };

  /**
   * Like Math.floor(), but accounts for IEEE floating point errors
   *     1.0000000000000003 => 1.0 (IEEE error ignored)
   *     1.9999999999999999 => 2.0 (IEEE error corrected)
   *     1.99999999         => 1.0 (already correct)
   * Floor legitimate remainder and then round down (1.9 => 1.0)
   * @param {Number} n
   * @param {Number} numSignificant - how many digits to care about
   * @returns {Number}
   */
  function ieeeSafeFloor(n, numSignificant) {
    let s = n.toFixed(numSignificant);
    n = parseFloat(s);
    n = Math.floor(n);
    return n;
  }

  /**
   * @param {Number} STAMP
   * @param {DenomInfo} denomInfo
   * @return {Number} - stampsPerCoin (zero if undefined, negative if not transactable)
   */
  function _stampsPerCoin(STAMP, denomInfo) {
    let stamps = denomInfo.stamps;
    let extraDust = denomInfo.dust - denomInfo.fee;
    while (extraDust < 0) {
      stamps -= 1;
      extraDust += STAMP;
    }

    let stampsPerCoin = 0;
    let numCoins = denomInfo.denoms.length;
    if (numCoins > 0) {
      stampsPerCoin = stamps / denomInfo.denoms.length;
      stampsPerCoin = Math.floor(stampsPerCoin);
    }

    return stampsPerCoin;
  }

  /**
   * @param {DenomConfig} d
   * @param {Array<CoinInfo>} coinInfos
   * @param {Boolean} force - make change to create stamps if necessary
   * @return {DenomInfo}
   */
  Wallet._denominateCoins = function (d, coinInfos, force = false) {
    let DENOMS = d.__DENOMS__;
    let STAMP = d.__STAMP__;

    if (force) {
      return Wallet._denominateSelfPayCoins(d, coinInfos);
    }

    let denoms = [];

    let satoshis = 0;
    for (let coinInfo of coinInfos) {
      satoshis += coinInfo.satoshis;
      //faceValue += coinInfo.faceValue;
      //stamps += coinInfo.stamps;
      //dust += coinInfo.dust;
    }

    let coinInfo = Wallet._parseCoinInfo(d, satoshis);

    let remainder = coinInfo.faceValue;
    for (let denom of DENOMS) {
      while (remainder >= denom) {
        denoms.push(denom);
        remainder -= denom;
      }
    }

    let fees = DashTx.appraise({
      inputs: coinInfos,
      outputs: denoms,
    });
    let fee = fees.max;

    let transactable = false;
    let stampsPerCoin = 0;
    let stampsRemaining = 0;
    let MIN_STAMPS = 2;
    let stampsNeeded = MIN_STAMPS * denoms.length;
    stampsNeeded -= coinInfo.stamps;
    stampsNeeded = Math.max(0, stampsNeeded);

    let denomInfo = Object.assign(coinInfo, {
      denoms,
      stampsPerCoin,
      stampsRemaining,
      fee,
      transactable,
      stampsNeeded,
    });

    denomInfo.stampsPerCoin = _stampsPerCoin(STAMP, denomInfo);
    denomInfo.transactable = denomInfo.stampsPerCoin > MIN_STAMPS;

    let evenStamps = denomInfo.stampsPerCoin * denomInfo.denoms.length;
    denomInfo.stampsRemaining = coinInfo.stamps - evenStamps;
    let feeStamps = fee / STAMP;
    feeStamps = Math.ceil(feeStamps);
    denomInfo.stampsRemaining -= feeStamps;

    return denomInfo;
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
   * @param {Array<WifInfo>} [opts.wifs] - loose wifs instead of recovery phrase
   * @returns {Promise<PrivateWallet>}
   */
  Wallet.generate = async function ({
    name,
    label,
    priority,
    contact = null,
    wifs,
  }) {
    let phrase = "";
    if (!wifs) {
      phrase = await DashPhrase.generate();
    }

    return {
      name: name.toLowerCase(),
      label: label,
      device: null,
      contact: contact,
      priority: priority || 0,
      phrase: phrase,
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
   * @param {String} opts.address
   * @param {String} [opts.addr] - deprecated, use address
   * @returns {PayWallet}
   */
  Wallet.generatePayWallet = function ({ handle, xpub, addr, address }) {
    address = address || addr || "";

    let d = new Date();
    return {
      contact: handle,
      device: null,
      label: handle,
      name: handle.toLowerCase(),
      priority: d.valueOf(),
      address: address,
      addr: address,
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
   * @param {String} addr
   * @returns {Boolean}
   */
  Wallet.isAddrLike = function (addr) {
    if (ADDR_CHAR_LEN !== addr?.length) {
      return false;
    }

    if (!ADDR_VERSIONS.includes(addr[0])) {
      return false;
    }

    return true;
  };

  /**
   * @param {String} addr
   * @returns {Promise<Boolean>}
   */
  Wallet.isAddr = async function (addr) {
    let isAddrLike = Wallet.isAddrLike(addr);
    if (!isAddrLike) {
      return false;
    }

    // TODO DashKeys.assertAddr(addr)
    //@ts-ignore TODO bad export
    await DashKeys.addrToPkh(addr);

    return true;
  };

  /**
   * @param {String} xpub
   * @returns {Promise<Boolean>} - is xpub with valid checksum
   */
  Wallet.isXPub = async function (xpub = "") {
    // TODO check length

    if (!XPUB_VERSIONS.includes("xpub")) {
      return false;
    }

    if (xpub.length !== XPUB_CHAR_LEN) {
      return false;
    }

    try {
      await Wallet.assertXPub(xpub);
    } catch (e) {
      return false;
    }

    return true;
  };

  /**
   * @param {Object} w
   * @param {Array<String>} [w.mnemonic]
   * @param {String} [w.phrase]
   */
  function _transitionPhrase(w) {
    //@ts-ignore
    if (w.mnemonic?.length > 0) {
      //@ts-ignore
      w.phrase = w.mnemonic;
    }
    if (!w.phrase) {
      w.phrase = "";
    }

    let isMnemonic = Array.isArray(w.phrase);
    if (isMnemonic) {
      //@ts-ignore
      w.phrase = w.phrase.filter(Boolean).join(" ");
    }
  }

  if ("undefined" !== typeof module) {
    module.exports = Wallet;
  }
})(("undefined" !== typeof module && module.exports) || window);
