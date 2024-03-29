"use strict";

let Wallet = require("../dashwallet.js");

let DENOM_INFO = null;

// TODO
// - what's the fee to split as-is?
// - what's are the denoms and fees to self-split?
function test() {
  let table = [
    {
      amount: "0.00010000",
      coins: [1000],
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
      amount: "1.00000000",
      coins: [100000000],
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
      coins: [100010000],
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
      amount: "1.00010000",
      coins: [100000000, 10000],
      faceValue: 100000000,
      denoms: [100000000],
      stamps: 50,
      stampsPerCoin: 48,
      dust: 0,
      fee: 342,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "1.00000150",
      coins: [100000000, 150],
      faceValue: 100000000,
      denoms: [100000000],
      stamps: 0,
      stampsPerCoin: -1,
      dust: 150,
      fee: 342,
      transactable: false,
      stampsNeeded: 2,
    },
    {
      amount: "1.00000200",
      coins: [100000000, 200],
      faceValue: 100000000,
      denoms: [100000000],
      stamps: 1,
      stampsPerCoin: -1,
      dust: 0,
      fee: 342,
      transactable: false,
      stampsNeeded: 1,
    },
    {
      amount: "1.01100000",
      coins: [1110000, 99990000],
      faceValue: 101100000,
      denoms: [100000000, 1000000, 100000],
      stamps: 0,
      stampsPerCoin: -1,
      dust: 0,
      fee: 410,
      transactable: false,
      stampsNeeded: 6,
    },
    {
      amount: "1.01111110",
      coins: [1111111, 99999999],
      faceValue: 101100000,
      denoms: [100000000, 1000000, 100000],
      stamps: 55,
      stampsPerCoin: 17,
      dust: 110,
      fee: 410,
      transactable: true,
      stampsNeeded: 0,
    },
    {
      amount: "8.37422585",
      coins: [63033063, 134216452, 5398913, 20834252, 613939905],
      faceValue: 837400000,
      denoms: [
        500000000, 200000000, 100000000, 20000000, 10000000, 5000000, 2000000,
        200000, 200000,
      ],
      stamps: 112,
      stampsPerCoin: 11,
      dust: 185,
      fee: 1061,
      transactable: true,
      stampsNeeded: 0,
    },
  ];

  console.info(`   # Value  Fee Stamps | Coins`);
  for (let row of table) {
    let coinInfos = [];
    for (let satoshis of row.coins) {
      let coinInfo = Wallet._parseCoinInfo(DENOM_INFO, satoshis);
      coinInfos.push(coinInfo);
    }
    let result = Wallet._denominateCoins(DENOM_INFO, coinInfos);
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
      unmetExpectations.push(
        `expected fee of ${row.fee}, but got ${result.fee}`,
      );
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

    let faceDash = Wallet.toDash(row.faceValue);
    let faceDashStr = faceDash.toFixed(3);

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
      dashDenomsList += start.padStart(25, " ");
      dashDenomsList += someDenoms.join(", ");
      dashDenomsList += "\n";
    }
    dashDenomsList = dashDenomsList.trim();

    let fee = result.fee.toString();
    fee = fee.padStart(4, "0");

    let stampsPerCoin = "-";
    if (row.stampsPerCoin > 2) {
      stampsPerCoin = row.stampsPerCoin.toString();
    }
    stampsPerCoin = stampsPerCoin.padStart(6, " ");

    /*
    let satoshis = row.coins.join();
    satoshis = satoshis.padStart(9, " ");
    */
    console.info(
      `✅ ${row.coins.length} ${faceDashStr} ${fee} ${stampsPerCoin} | ${dashDenomsList}`,
    );
  }
}

test();
console.info("PASS");
