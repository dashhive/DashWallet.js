(function (exports) {
  "use strict";

  let Dash = {};
  //@ts-ignore
  exports.DashApi = Dash;

  const DUFFS = 100000000;
  const DUST = 10000;
  const FEE = 1000;
  Dash.DUFFS = DUFFS;

  //@ts-ignore
  let b58c = exports.DashCheck || require("./lib/dashcheck.js");
  //@ts-ignore
  let Dashcore = exports.dashcore || require("./lib/dashcore.js");
  let RIPEMD160 = require("ripemd160");
  let Secp256k1 = require("secp256k1");
  //@ts-ignore
  let Sha256 = exports.Sha256 || require("./lib/sha256.js");
  let Transaction = Dashcore.Transaction;

  Dash.DashTypes = {
    name: "dash",
    pubKeyHashVersion: "4c",
    privateKeyVersion: "cc",
    coinType: "5",
  };

  Dash.DUST = DUST;
  Dash.FEE = FEE;

  /**
   * @typedef {import('@dashevo/dashcore-lib').Address} CoreAddress
   * @typedef {import('dashsight').CoreUtxo} CoreUtxo
   * @typedef {import('dashsight').InstantBalance} InstantBalance
   * @typedef {import('dashsight').InsightTxVout} InsightTxVout
   * @typedef {import('dashsight').InsightUtxo} InsightUtxo
   */

  Dash.create = function ({
    //@ts-ignore TODO
    insightApi,
  }) {
    let dashApi = {};

    /**
     * Instant Balance is accurate with Instant Send
     * @param {String} address
     * @returns {Promise<InstantBalance>}
     */
    dashApi.getInstantBalance = async function (address) {
      let insightUtxos = await insightApi.getUtxos(address);
      let utxos = await Dash.getUtxos(insightUtxos);
      let balance = utxos.reduce(function (total, utxo) {
        return total + utxo.satoshis;
      }, 0);
      // because 0.1 + 0.2 = 0.30000000000000004,
      // but we would only want 0.30000000
      let floatBalance = parseFloat((balance / DUFFS).toFixed(8));

      return {
        addrStr: address,
        balance: floatBalance,
        balanceSat: balance,
        _utxoCount: utxos.length,
        _utxoAmounts: utxos.map(function (utxo) {
          return utxo.satoshis;
        }),
      };
    };

    /**
     * Full Send!
     * TODO allow multiple wifs
     * @param {String} wif - private key
     * @param {String} pub - pay addr
     */
    dashApi.createBalanceTransfer = async function (wif, pub) {
      // this is required by the sdk, but won't be used
      let changeAddr = await Dash.wifToAddr(wif);

      let insightUtxos = await insightApi.getUtxos(changeAddr);
      let utxos = await Dash.getUtxos(insightUtxos);
      let balance = utxos.reduce(function (total, utxo) {
        return total + utxo.satoshis;
      }, 0);

      //@ts-ignore - no input required, actually
      let tmpTx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tmpTx.to(pub, balance - 1000);
      tmpTx.sign(wif);

      // TODO getsmartfeeestimate??
      // fee = 1duff/byte (2 chars hex is 1 byte)
      //       +10 to be safe (the tmpTx may be a few bytes off)
      let fee = 10 + tmpTx.toString().length / 2;

      //@ts-ignore - no input required, actually
      let tx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tx.to(pub, balance - fee);
      tx.fee(fee);
      tx.sign(wif);

      return tx;
    };

    /**
     * Send with change back
     * @param {String} wif - private key
     * @param {String|CoreAddress} payAddr
     * @param {Number} amount
     * @param {String|CoreAddress} [changeAddr]
     */
    dashApi.createPayment = async function (wif, payAddr, amount, changeAddr) {
      let utxoAddr = await Dash.wifToAddr(wif);
      if (!changeAddr) {
        changeAddr = utxoAddr;
      }

      // TODO make more accurate?
      let feePreEstimate = 1000;

      // get smallest coin larger than transaction
      // if that would create dust, donate it as tx fee
      let insightUtxos = await insightApi.getUtxos(utxoAddr);
      let allUtxos = await Dash.getUtxos(insightUtxos);
      let utxos = await Dash.getOptimalUtxos(allUtxos, amount + feePreEstimate);
      let balance = Dash.getBalance(utxos);

      if (!utxos.length) {
        throw new Error(`not enough funds available in utxos for ${utxoAddr}`);
      }

      // (estimate) don't send dust back as change
      if (balance - amount <= DUST + FEE) {
        amount = balance;
      }

      //@ts-ignore - no input required, actually
      let tmpTx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tmpTx.to(payAddr, amount);
      //@ts-ignore - the JSDoc is wrong in dashcore-lib/lib/transaction/transaction.js
      tmpTx.change(changeAddr);
      tmpTx.sign(wif);

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
      tx.to(payAddr, amount);
      tx.fee(fee);
      //@ts-ignore - see above
      tx.change(changeAddr);
      tx.sign(wif);

      return tx;
    };

    return dashApi;
  };

  /**
   * @template {Pick<CoreUtxo, "satoshis">} T
   * @param {Array<T>} utxos
   * @param {Number} fullAmount - including fee estimate
   * @return {Array<T>}
   */
  Dash.getOptimalUtxos = function (utxos, fullAmount) {
    let balance = Dash.getBalance(utxos);

    if (balance < fullAmount) {
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
      if (utxo.satoshis > fullAmount) {
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
    utxos.some(function (utxo) {
      included.push(utxo);
      total += utxo.satoshis;
      return total >= fullAmount;
    });
    return included;
  };

  /**
   * @template {Pick<CoreUtxo, "satoshis">} T
   * @param {Array<T>} utxos
   * @returns {Number}
   */
  Dash.getBalance = function (utxos) {
    return utxos.reduce(function (total, utxo) {
      return total + utxo.satoshis;
    }, 0);
  };

  /**
   * Convert InsightUtxo to CoreUtxo
   * @param {Array<InsightUtxo>} insightUtxos
   * @returns {Promise<Array<CoreUtxo>>}
   */
  Dash.getUtxos = async function (insightUtxos) {
    /** @type Array<CoreUtxo> */
    let utxos = [];

    await insightUtxos.reduce(async function (promise, utxo) {
      await promise;

      let data = await insightApi.getTx(utxo.txid);

      // TODO the ideal would be the smallest amount that is greater than the required amount

      let utxoIndex = -1;

      /**
       * @template {InsightTxVout} T
       * @param {T} vout
       * @param {Number} index
       * @returns {Boolean}
       */
      function findAndSetUtxoIndex(vout, index) {
        if (!vout.scriptPubKey?.addresses?.includes(utxo.address)) {
          return false;
        }

        let satoshis = Math.round(parseFloat(vout.value) * DUFFS);
        if (utxo.satoshis !== satoshis) {
          return false;
        }

        utxoIndex = index;
        return true;
      }

      data.vout.some(findAndSetUtxoIndex);

      // TODO test without txid
      utxos.push({
        txId: utxo.txid,
        outputIndex: utxoIndex,
        address: utxo.address,
        script: utxo.scriptPubKey,
        satoshis: utxo.satoshis,
      });
    }, Promise.resolve());

    return utxos;
  };

  /**
   * @param {String} wif - private key
   * @returns {Promise<String>}
   */
  Dash.wifToAddr = async function (wif) {
    let parts = await b58c.verify(wif);
    let privBuf = Buffer.from(parts.privateKey, "hex");
    let valid = Secp256k1.privateKeyVerify(privBuf);
    if (!valid) {
      throw new Error(`can't convert invalid wif to private key`);
    }
    let pubBuf = Secp256k1.publicKeyCreate(privBuf);
    let addr = await b58c.encode({
      version: Dash.DashTypes.pubKeyHashVersion,
      pubKeyHash: await Dash._hashPubkey(pubBuf),
      compressed: true,
    });
    return addr;
  };

  /**
   * @template {Pick<InsightUtxo,
   *  "txid"|"vout"|"address"|"scriptPubKey"|"satoshis"
   * >} T
   * @param {Array<T>} insightUtxos
   * @returns {Array<CoreUtxo>}
   */
  Dash.toCoreUtxos = function (insightUtxos) {
    let coreUtxos = insightUtxos.map(function (utxo) {
      return {
        txId: utxo.txid,
        outputIndex: utxo.vout,
        address: utxo.address,
        script: utxo.scriptPubKey,
        satoshis: utxo.satoshis,
      };
    });

    return coreUtxos;
  };

  /**
   * @param {Uint8Array|Buffer} buf
   * @returns {Promise<String>}
   */
  Dash._hashPubkey = async function (buf) {
    let shaBuf = await Sha256.sum(buf);

    let ripemd = new RIPEMD160();
    //@ts-ignore
    ripemd.update(shaBuf);
    let hash = ripemd.digest();

    return hash.toString("hex");
  };

  /**
   * @param {Number} dash - as DASH (not duffs / satoshis)
   * @returns {Number} - duffs
   */
  Dash.toDuff = function (dash) {
    return Math.round(dash * DUFFS);
  };

  /**
   * @param {Number} duffs - DASH sastoshis
   * @returns {Number} - float
   */
  Dash.toDash = function (duffs) {
    let floatBalance = parseFloat((duffs / DUFFS).toFixed(8));
    return floatBalance;
  };

  /**
   * @param {Number} duffs - DASH sastoshis
   * @returns {String} - formatted with all 8 decimal places
   */
  Dash.toDashFixed = function (duffs) {
    let floatBalance = (duffs / DUFFS).toFixed(8);
    return floatBalance;
  };

  if ("undefined" !== typeof module) {
    module.exports = Dash;
  }
})(("undefined" !== typeof module && module.exports) || window);
