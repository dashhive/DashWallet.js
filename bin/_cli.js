"use strict";

var Cli = module.exports;

let Fs = require("node:fs/promises");

/**
 * @param {Array<String>} arr
 * @param {Array<String>} aliases
 * @returns {String?}
 */
Cli.removeFlag = function (arr, aliases) {
  /** @type {String?} */
  let arg = null;
  aliases.forEach(function (item) {
    let index = arr.indexOf(item);
    if (-1 === index) {
      return null;
    }

    if (arg) {
      throw Error(`duplicate flag ${item}`);
    }

    arg = arr.splice(index, 1)[0];
  });

  return arg;
};

/**
 * @param {Array<String>} arr
 * @param {Array<String>} aliases
 * @returns {String?}
 */
Cli.removeOption = function (arr, aliases) {
  /** @type {String?} */
  let arg = null;
  aliases.forEach(function (item) {
    let index = arr.indexOf(item);
    if (-1 === index) {
      return null;
    }

    // flag
    let flag = arr.splice(index, 1);

    if (arg) {
      throw Error(`duplicate flag ${item}`);
    }

    // flag's arg
    arg = arr.splice(index, 1)[0];
    if ("undefined" === typeof arg) {
      throw Error(`'${flag}' requires an argument`);
    }
  });

  return arg;
};

/**
 * @param {Array<String>} args
 * @param {Array<String>} [aliases]
 */
Cli.removeArg = function (args, aliases) {
  if (aliases) {
    let arg = Cli.removeFlag(args, aliases);
    return arg;
  }
  let arg = args.shift();
  if (undefined === arg) {
    return null;
  }
  return arg;
};

/**
 * @param {String} valOrPath
 */
Cli.fromPathOrString = async function (valOrPath) {
  let isString = false;
  let text = await Fs.readFile(valOrPath, "ascii").catch(function (err) {
    if ("ENOENT" !== err.code) {
      throw err;
    }

    isString = true;
    return valOrPath;
  });
  text = text.trim();

  return {
    isString,
    value: text,
  };
};
