"use strict";

let Wallet = require("../dashwallet.js");

let DENOM_INFO = null;

function test() {
  // 0.00100000
  // 1.00100000
  //
  // 1.00000000
  // 0.99900000
  //
  // 1.00000000
  // 0.00164584
  let table = [
    {
      amount: "0.00000001",
      satoshis: 1,
      faceValue: 0,
      stamps: 0,
      dust: 1,
    },
    {
      amount: "0.00001000",
      satoshis: 1000,
      faceValue: 0,
      stamps: 5,
      dust: 0,
    },
    {
      amount: "0.00010001",
      satoshis: 10001,
      faceValue: 0,
      stamps: 50,
      dust: 1,
    },
    {
      amount: "1.00000000",
      satoshis: 100000000,
      faceValue: 100000000,
      stamps: 0,
      dust: 0,
    },
    {
      amount: "1.00010000",
      satoshis: 100010000,
      faceValue: 100000000,
      stamps: 50,
      dust: 0,
    },

    {
      amount: "1.00100000",
      satoshis: 100100000,
      faceValue: 100100000,
      stamps: 0,
      dust: 0,
    },
    {
      amount: "1.11111111",
      satoshis: 111111111,
      faceValue: 111100000,
      stamps: 55,
      dust: 111,
    },
    {
      amount: "9.99999999",
      satoshis: 999999999,
      faceValue: 999900000,
      stamps: 499,
      dust: 199,
    },
    {
      amount: "8.37422585",
      satoshis: 837422585,
      faceValue: 837400000,
      stamps: 112,
      dust: 185,
    },
  ];

  console.info(`       Sat Val:   Face, Stamps, Dust ✅`);
  for (let row of table) {
    let result = Wallet._parseCoinInfo(DENOM_INFO, row.satoshis);
    let unmetExpectations = [];

    if (result.faceValue !== row.faceValue) {
      unmetExpectations.push(
        `expected face value to be ${row.faceValue}, but got ${result.faceValue}`,
      );
    }
    if (result.stamps !== row.stamps) {
      unmetExpectations.push(
        `expected to have ${row.stamps} stamps, but have ${result.stamps}`,
      );
    }
    if (result.dust !== row.dust) {
      unmetExpectations.push(
        `expected ${row.dust} unusable (dust) satoshis, but got ${result.dust}`,
      );
    }

    if (unmetExpectations.length) {
      let msg = unmetExpectations.join("\n\t");
      throw new Error(`unmet expectations for ${row.amount}:\n\t${msg}`);
    }

    let sats = row.satoshis.toString();
    sats = sats.padStart(10, " ");

    let faceValue = row.faceValue.toString();
    faceValue = faceValue.slice(0, -5);
    faceValue = faceValue.padStart(6, " ");

    let stamps = row.stamps.toString();
    stamps = stamps.padStart(6, " ");

    let dust = row.dust.toString();
    dust = dust.padStart(3, "0");
    dust = dust.padStart(4, " ");
    console.info(`  - ${sats}: ${faceValue}, ${stamps}, ${dust} ✅`);
  }
}

test();
console.info("PASS");
