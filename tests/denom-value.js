"use strict";

let Wallet = require("../dashwallet.js");

let DENOM_INFO = null;

// TODO
// - what's the fee to split as-is?
// - what's are the denoms and fees to self-split?
function test() {
  let table = [
    {
      amount: "0.00000001",
      satoshis: 1,
      faceValue: 0,
      denoms: [],
      stamps: 0,
      stampsPerCoin: 0,
      dust: 1,
      fee: 9999,
      transactable: false,
      stampsNeeded: 0,
    },
    {
      amount: "0.00001000",
      satoshis: 1000,
      faceValue: 0,
      denoms: [],
      stamps: 5,
      stampsPerCoin: 0,
      dust: 0,
      fee: 159,
      transactable: false,
      stampsNeeded: 0,
    },
    {
      amount: "0.00010001",
      satoshis: 10001,
      faceValue: 0,
      denoms: [],
      stamps: 50,
      stampsPerCoin: 0,
      dust: 1,
      fee: 159,
      transactable: false,
      stampsNeeded: 0,
    },
    {
      amount: "1.00000000",
      satoshis: 100000000,
      faceValue: 100000000,
      denoms: [100000000],
      stamps: 0,
      stampsPerCoin: -1,
      dust: 0,
      fee: 193,
      transactable: false,
      stampsNeeded: 2,
    },
    {
      amount: "1.00010000",
      satoshis: 100010000,
      faceValue: 100000000,
      denoms: [100000000],
      stamps: 50,
      stampsPerCoin: 49,
      dust: 0,
      fee: 193,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "1.00100000",
      satoshis: 100100000,
      faceValue: 100100000,
      denoms: [100000000, 100000],
      stamps: 0,
      stampsPerCoin: -1,
      dust: 0,
      fee: 227,
      transactable: false,
      stampsNeeded: 4,
    },
    {
      amount: "1.01111110",
      satoshis: 101111110,
      faceValue: 101100000,
      denoms: [100000000, 1000000, 100000],
      stamps: 55,
      stampsPerCoin: 18,
      dust: 110,
      fee: 261,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "1.11111111",
      satoshis: 111111111,
      faceValue: 111100000,
      denoms: [100000000, 10000000, 1000000, 100000],
      stamps: 55,
      stampsPerCoin: 13,
      dust: 111,
      fee: 295,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "9.99999999",
      satoshis: 999999999,
      faceValue: 999900000,
      denoms: [
        500000000, 200000000, 200000000, 50000000, 20000000, 20000000, 5000000,
        2000000, 2000000, 500000, 200000, 200000,
      ],
      stamps: 499,
      stampsPerCoin: 41,
      dust: 199,
      fee: 567,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "8.37422585",
      satoshis: 837422585,
      faceValue: 837400000,
      denoms: [
        500000000, 200000000, 100000000, 20000000, 10000000, 5000000, 2000000,
        200000, 200000,
      ],
      stamps: 112,
      stampsPerCoin: 12,
      dust: 185,
      fee: 465,
      transactable: true,
      stampsNeeded: 0,
    },
  ];

  console.info(`    Satoshis Value Fee Stamps | Coins`);
  for (let row of table) {
    let coinInfo = Wallet._parseCoinInfo(DENOM_INFO, row.satoshis);
    let v = calcResult(row, coinInfo);
    console.info(
      `✅ ${v.satoshis} ${v.faceDash} ${v.fee} ${v.stampsPerCoin} | ${v.dashDenomsList}`,
    );
  }
}

function calcResult(row, coinInfo) {
  let result = Wallet._denominateCoin(DENOM_INFO, coinInfo);

  assertExpectedValues(row, result);

  let faceDashVal = Wallet.toDash(row.faceValue);
  let faceDash = faceDashVal.toFixed(3);

  let stamps = row.stamps.toString();
  stamps = stamps.padStart(3, " ");

  let dashDenoms = [];
  for (let denom of result.denoms) {
    let dash = Wallet.toDash(denom);
    dashDenoms.push(dash);
  }
  if (!dashDenoms.length) {
    dashDenoms.push("-");
  }
  let dashDenomsList = "";
  while (dashDenoms.length) {
    let someDenoms = dashDenoms.splice(0, 8);
    let start = "  ";
    if (dashDenomsList.length > 0) {
      start = "\\ ";
    }
    dashDenomsList += start.padStart(32, " ");
    dashDenomsList += someDenoms.join(", ");
    dashDenomsList += "\n";
  }
  dashDenomsList = dashDenomsList.trim();

  let fee = result.fee.toString();
  //fee = fee.padStart(4, "0");

  let stampsPerCoin = "-";
  if (row.stampsPerCoin >= 2) {
    stampsPerCoin = row.stampsPerCoin.toString();
  }
  stampsPerCoin = stampsPerCoin.padStart(6, " ");

  /*
    let transactable = "✔";
    if (!result.transactable) {
      transactable = " ";
    }
    */

  let satoshis = row.satoshis.toString();
  satoshis = satoshis.padStart(9, " ");

  let showInfo = {
    satoshis,
    faceDash,
    fee,
    stampsPerCoin,
    dashDenomsList,
  };

  return showInfo;
}

function assertExpectedValues(row, result) {
  let unmetExpectations = [];

  if (result.faceValue !== row.faceValue) {
    unmetExpectations.push(
      `expected face value to be ${row.faceValue}, but got ${result.faceValue}`,
    );
  }
  let expectedDenoms = row.denoms.join(", ");
  let actualDenoms = result.denoms.join(", ");
  if (expectedDenoms !== actualDenoms) {
    unmetExpectations.push(
      `expected denoms of ${expectedDenoms}, but got ${actualDenoms}`,
    );
  }
  if (result.stampsPerCoin !== row.stampsPerCoin) {
    unmetExpectations.push(
      `expected to have ${row.stampsPerCoin} stamps per coin, but have ${result.stampsPerCoin}`,
    );
  }
  if (result.stamps !== row.stamps) {
    unmetExpectations.push(
      `expected to have ${row.stamps} stamps, but have ${result.stamps}`,
    );
  }
  if (result.fee !== row.fee) {
    unmetExpectations.push(`expected fee of ${row.fee}, but got ${result.fee}`);
  }
  if (result.dust !== row.dust) {
    unmetExpectations.push(
      `expected ${row.dust} unusable (dust) satoshis, but got ${result.dust}`,
    );
  }
  if (result.transactable !== row.transactable) {
    unmetExpectations.push(
      `expected transactable to be ${row.transactable}, but got ${result.transactable}`,
    );
  }
  if (result.stampsNeeded !== row.stampsNeeded) {
    unmetExpectations.push(
      `expected to need ${row.stampsNeeded} additional stamps, but ${result.stampsNeeded} are reported as needed`,
    );
  }

  if (unmetExpectations.length) {
    let msg = unmetExpectations.join("\n\t");
    throw new Error(`unmet expectations for ${row.amount}:\n\t${msg}`);
  }
}

test();
console.info("PASS");
