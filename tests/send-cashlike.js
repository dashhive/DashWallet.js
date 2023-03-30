"use strict";

let Wallet = require("../dashwallet.js");

let STAMP = 200;
let MIN_DENOM = 100000;

function test() {
  let pocketA = [
    1.29905,
    1.12505,
    1.00205,
    1.00105, //  => 1.000, 0.001
    0.71105,
    0.50005,
    0.23405, // => 0.2, 0.02, 0.01, 0.02. 0.02
    0.20005,
    0.20005,
    0.10005,
    0.02005,
    0.02005,
    0.00505,
    0.00205,
    0.00105,
  ];

  let pocketB = [
    1.29905,
    1.12505, // => 1, 0.1, 0.02, 0.005
    0.71105,
    0.50005,
    0.23405, // => 0.2, 0.02, 0.01, 0.02. 0.02
    0.20005,
    0.20005,
    0.10005,
    0.02005,
    0.02005,
    0.00505,
    0.00205,
    0.00105,
  ];

  let table = [
    {
      amount: "1.73302800",
      satoshis: 173302800,
      _lowFaceValue: 173300000,
      faceValue: 173300000,
      dustNeeded: 2800,
    },
    {
      amount: "1.73302801",
      satoshis: 173302801,
      _lowFaceValue: 173300000,
      faceValue: 173400000,
      dustNeeded: 2801,
    },
    {
      amount: "1.73399900",
      satoshis: 173399900,
      _lowFaceValue: 173300000,
      faceValue: 173400000,
      dustNeeded: 99900,
    },
    {
      amount: "1.73400000",
      satoshis: 173400000,
      _lowFaceValue: 173400000,
      faceValue: 173400000,
      dustNeeded: 0,
    },
    {
      amount: "2.73400000",
      satoshis: 273400000,
      _lowFaceValue: 273400000,
      faceValue: 273400000,
      dustNeeded: 0,
    },
    {
      amount: "992.73400000",
      satoshis: 99273400000,
      _lowFaceValue: 99273400000,
      faceValue: 99273400000,
      dustNeeded: 0,
      error: "E_INSUFFICIENT_FUNDS",
    },
  ];

  let sendInfos = [];
  for (let row of table) {
    let sendInfo = Wallet._parseSendInfo(MIN_DENOM, STAMP, row.satoshis);
    assertSendInfo(row, sendInfo);
    sendInfos.push([row, sendInfo]);
  }

  let denomInfosA = [];
  for (let coinValue of pocketA) {
    let coinSats = coinValue * Wallet.SATOSHIS;
    coinSats = Math.round(coinSats);
    let coinInfo = Wallet._parseCoinInfo(MIN_DENOM, STAMP, coinSats);
    let denomInfo = Wallet._denominateCoin(Wallet.DENOM_SATS, STAMP, coinInfo);
    denomInfosA.push(denomInfo);
  }
  console.log("denomInfosA:");
  console.log(denomInfosA);

  for (let [row, sendInfo] of sendInfos) {
    if (row) {
      // todo
    }

    let cashLikeInfo;
    let code;
    try {
      cashLikeInfo = Wallet._cashLikeSelect(
        MIN_DENOM,
        STAMP,
        sendInfo,
        denomInfosA,
      );
    } catch (e) {
      if (!e.code) {
        throw e;
      }
      if (row.error !== e.code) {
        throw e;
      }
      code = e.code;
    }
    if (row.error !== code) {
      throw new Error(
        `${row.amount}: expected error '${row.error}' but got '${code}'`,
      );
    }
    if (code) {
      continue;
    }

    console.log(cashLikeInfo);
  }

  function assertSendInfo(row, result) {
    let unmetExpectations = [];

    if (result.faceValue !== row.faceValue) {
      unmetExpectations.push(
        `expected face value to be ${row.faceValue}, but got ${result.faceValue}`,
      );
    }
    if (result._lowFaceValue !== row._lowFaceValue) {
      unmetExpectations.push(
        `expected low face value to be ${row._lowFaceValue}, but got ${result._lowFaceValue}`,
      );
    }
    if (result.dustNeeded !== row.dustNeeded) {
      unmetExpectations.push(
        `expected to need ${row.dustNeeded} additional dust, but ${result.dustNeeded} are reported as needed`,
      );
    }

    if (unmetExpectations.length) {
      let msg = unmetExpectations.join("\n\t");
      throw new Error(`unmet expectations for ${row.amount}:\n\t${msg}`);
    }

    let sats = row.satoshis.toString();
    sats = sats.padStart(10, " ");

    let faceValue = row.faceValue.toString();
    faceValue = faceValue.slice(0, 4);
    faceValue = faceValue.padStart(4, " ");

    // let highFaceValue = row.highFaceValue.toString();
    // highFaceValue = highFaceValue.slice(0, 4);
    // highFaceValue = highFaceValue.padStart(4, " ");

    let dustNeeded = row.dustNeeded.toString();
    dustNeeded = dustNeeded.padStart(5, " ");

    console.info(
      //`  - ${sats}: ${faceValue}~${highFaceValue}, ${dustNeeded} ✅`,
      `  - ${sats}: ${faceValue} ✅`,
    );
  }
}

test();
console.info("PASS");
