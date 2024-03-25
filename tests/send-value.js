"use strict";

let Wallet = require("../dashwallet.js");

let STAMP = 200;
let MIN_DENOM = 100000;

function test() {
  let table = [
    {
      // 7 coins * 2 stamps * 200 per stamp = 2800
      // (1; 5, 2; 2, 1; 2, 1)
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
  ];

  let DENOM_INFO = null;
  for (let row of table) {
    let result = Wallet._parseSendInfo(DENOM_INFO, row.satoshis);
    let unmetExpectations = [];

    if (result._lowFaceValue !== row._lowFaceValue) {
      unmetExpectations.push(
        `expected face value to be ${row._lowFaceValue}, but got ${result._lowFaceValue}`,
      );
    }
    if (result.faceValue !== row.faceValue) {
      unmetExpectations.push(
        `expected high face value to be ${row.faceValue}, but got ${result.faceValue}`,
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

    let faceValue = row._lowFaceValue.toString();
    faceValue = faceValue.slice(0, 4);
    faceValue = faceValue.padStart(4, " ");

    let highFaceValue = row.faceValue.toString();
    highFaceValue = highFaceValue.slice(0, 4);
    highFaceValue = highFaceValue.padStart(4, " ");

    let dustNeeded = row.dustNeeded.toString();
    dustNeeded = dustNeeded.padStart(5, " ");

    console.info(
      `  - ${sats}: ${faceValue}~${highFaceValue}, ${dustNeeded} ✅`,
    );
  }
}

test();
console.info("PASS");
