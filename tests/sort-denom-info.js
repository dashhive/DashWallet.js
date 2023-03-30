"use strict";

let Wallet = require("../dashwallet.js");

let STAMP = 200;
let MIN_DENOM = 100000;

function test() {
  let pocketA = [
    {
      amount: "0.004",
      satoshis: 400000,
      faceValue: 400000,
      denoms: [200000, 200000],
      stamps: 0,
      stampsPerCoin: 0,
      dust: 0,
      fee: 193,
      transactable: false,
      stampsNeeded: 4,
    },
    {
      amount: "0.007",
      satoshis: 700000,
      faceValue: 700000,
      denoms: [500000, 200000],
      stamps: 0,
      stampsPerCoin: 0,
      dust: 0,
      fee: 193,
      transactable: false,
      stampsNeeded: 4,
    },
    {
      amount: "0.002",
      satoshis: 200000,
      faceValue: 200000,
      denoms: [200000],
      stamps: 0,
      stampsPerCoin: 0,
      dust: 0,
      fee: 193,
      transactable: false,
      stampsNeeded: 2,
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
    {
      amount: "0.001",
      satoshis: 100000,
      faceValue: 100000,
      denoms: [100000],
      stamps: 0,
      stampsPerCoin: 0,
      dust: 0,
      fee: 193,
      transactable: false,
      stampsNeeded: 2,
    },
  ];

  let original = format(pocketA);
  let sorted = "8.37422585 (9), 0.004 (2), 0.007 (2), 0.001 (1), 0.002 (1)";
  pocketA.sort(Wallet._byNumberOfCoins);

  let result = format(pocketA);
  if (result !== sorted) {
    let msgs = [`    expected order: '${sorted}'`, `    got: '${result}'`];
    let msg = msgs.join("\n");
    throw new Error(msg);
  }

  console.info(`  Pre-Sort:  ${original}`);
  console.info(`  Post-Sort: ${result} ✅`);
}

function format(pocketA) {
  let results = [];
  for (let info of pocketA) {
    let desc = `${info.amount} (${info.denoms.length})`;
    results.push(desc);
  }

  let result = results.join(", ");
  return result;
}

test();
console.info("PASS");
