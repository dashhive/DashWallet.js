"use strict";

let Wallet = require("../dashwallet.js");

let STAMP = 200;
let MIN_DENOM = 100000;

// TODO
// - what's the fee to split as-is?
// - what's are the denoms and fees to self-split?
function test() {
  let table = [
    {
      amount: "0.00000001",
      satoshis: 1,
      force: true,
      faceValue: 0,
      denoms: [],
      stamps: 0,
      stampsPerCoin: 0,
      dust: 1,
      fee: 159,
      transactable: false,
      stampsNeeded: 0,
      error: "E_FORCE_DUST",
    },
    {
      amount: "0.00100000",
      satoshis: 100000,
      force: true,
      faceValue: 0,
      denoms: [],
      stamps: 500,
      stampsPerCoin: 0,
      dust: 0,
      fee: 159,
      transactable: false,
      stampsNeeded: 0,
      error: "E_FORCE_DUST",
    },
    {
      amount: "0.00100400",
      satoshis: 100400,
      force: true,
      faceValue: 0,
      denoms: [],
      stamps: 502,
      stampsPerCoin: 0,
      dust: 0,
      fee: 159,
      transactable: false,
      stampsNeeded: 0,
      error: "E_FORCE_DUST",
    },
    {
      amount: "0.00100500",
      satoshis: 100500,
      force: true,
      faceValue: 0,
      denoms: [],
      stamps: 502,
      stampsPerCoin: 0,
      dust: 100,
      fee: 193,
      transactable: false,
      stampsNeeded: 0,
      error: "E_FORCE_DUST",
    },
    {
      amount: "0.00100600",
      satoshis: 100600,
      force: true,
      faceValue: 100000,
      denoms: [100000],
      stamps: 3,
      stampsPerCoin: 2,
      dust: 0,
      fee: 193,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "0.00199800",
      satoshis: 199800,
      force: true,
      faceValue: 100000,
      denoms: [100000],
      stamps: 499,
      stampsPerCoin: 498,
      dust: 0,
      fee: 193,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "0.00200000",
      satoshis: 200000,
      force: true,
      faceValue: 100000,
      denoms: [100000],
      stamps: 500,
      stampsPerCoin: 499,
      dust: 0,
      fee: 193,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "0.00200500",
      satoshis: 200500,
      force: true,
      faceValue: 100000,
      denoms: [100000],
      stamps: 502,
      stampsPerCoin: 501,
      dust: 100,
      fee: 193,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "0.00200600",
      satoshis: 200600,
      force: true,
      faceValue: 200000,
      denoms: [200000],
      stamps: 3,
      stampsPerCoin: 2,
      dust: 0,
      fee: 193,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "0.00500000",
      satoshis: 500000,
      force: true,
      faceValue: 400000,
      denoms: [200000, 200000],
      stamps: 500,
      stampsPerCoin: 249,
      dust: 0,
      fee: 227,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "1.00000000",
      satoshis: 100000000,
      faceValue: 99900000,
      denoms: [
        50000000, 20000000, 20000000, 5000000, 2000000, 2000000, 500000, 200000,
        200000,
      ],
      stamps: 500,
      stampsPerCoin: 55,
      dust: 0,
      fee: 465,
      transactable: true,
      stampsNeeded: 0,
      force: true,
    },
    {
      amount: "1.00100000",
      satoshis: 100100000,
      faceValue: 100000000,
      denoms: [100000000],
      stamps: 500,
      stampsPerCoin: 499,
      dust: 0,
      fee: 193,
      transactable: true,
      stampsNeeded: 0,
      force: true,
    },
  ];

  console.info(`    Satoshis Value Fee Stamps | Coins`);
  for (let row of table) {
    let coinInfo = Wallet._parseCoinInfo(MIN_DENOM, STAMP, row.satoshis);

    let denomInfo;
    let code;
    try {
      denomInfo = Wallet._denominateCoin(
        Wallet.DENOM_SATS,
        STAMP,
        coinInfo,
        row.force,
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

    assertExpectedValues(row, denomInfo);

    let v = calcResult(row, denomInfo);
    console.info(
      `✅ ${v.satoshis} ${v.faceDash} ${v.fee} ${v.stampsPerCoin} | ${v.dashDenomsList}`,
    );
  }
}

function calcResult(row, denomInfo) {
  let faceDashVal = Wallet.toDash(row.faceValue);
  let faceDash = faceDashVal.toFixed(3);

  let stamps = row.stamps.toString();
  stamps = stamps.padStart(3, " ");

  let dashDenoms = [];
  for (let denom of denomInfo.denoms) {
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

  let fee = denomInfo.fee.toString();
  //fee = fee.padStart(4, "0");

  let stampsPerCoin = "-";
  if (row.stampsPerCoin >= 2) {
    stampsPerCoin = row.stampsPerCoin.toString();
  }
  stampsPerCoin = stampsPerCoin.padStart(6, " ");

  /*
    let transactable = "✔";
    if (!denomInfo.transactable) {
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
