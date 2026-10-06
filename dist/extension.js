// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __require = import.meta.require;

// node_modules/logform/format.js
var require_format = __commonJS((exports, module) => {
  class InvalidFormatError extends Error {
    constructor(formatFn) {
      super(`Format functions must be synchronous taking a two arguments: (info, opts)
Found: ${formatFn.toString().split(`
`)[0]}
`);
      Error.captureStackTrace(this, InvalidFormatError);
    }
  }
  module.exports = (formatFn) => {
    if (formatFn.length > 2) {
      throw new InvalidFormatError(formatFn);
    }
    function Format(options = {}) {
      this.options = options;
    }
    Format.prototype.transform = formatFn;
    function createFormatWrap(opts) {
      return new Format(opts);
    }
    createFormatWrap.Format = Format;
    return createFormatWrap;
  };
});

// node_modules/@colors/colors/lib/styles.js
var require_styles = __commonJS((exports, module) => {
  var styles = {};
  module["exports"] = styles;
  var codes = {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29],
    black: [30, 39],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
    white: [37, 39],
    gray: [90, 39],
    grey: [90, 39],
    brightRed: [91, 39],
    brightGreen: [92, 39],
    brightYellow: [93, 39],
    brightBlue: [94, 39],
    brightMagenta: [95, 39],
    brightCyan: [96, 39],
    brightWhite: [97, 39],
    bgBlack: [40, 49],
    bgRed: [41, 49],
    bgGreen: [42, 49],
    bgYellow: [43, 49],
    bgBlue: [44, 49],
    bgMagenta: [45, 49],
    bgCyan: [46, 49],
    bgWhite: [47, 49],
    bgGray: [100, 49],
    bgGrey: [100, 49],
    bgBrightRed: [101, 49],
    bgBrightGreen: [102, 49],
    bgBrightYellow: [103, 49],
    bgBrightBlue: [104, 49],
    bgBrightMagenta: [105, 49],
    bgBrightCyan: [106, 49],
    bgBrightWhite: [107, 49],
    blackBG: [40, 49],
    redBG: [41, 49],
    greenBG: [42, 49],
    yellowBG: [43, 49],
    blueBG: [44, 49],
    magentaBG: [45, 49],
    cyanBG: [46, 49],
    whiteBG: [47, 49]
  };
  Object.keys(codes).forEach(function(key) {
    var val = codes[key];
    var style = styles[key] = [];
    style.open = "\x1B[" + val[0] + "m";
    style.close = "\x1B[" + val[1] + "m";
  });
});

// node_modules/@colors/colors/lib/system/has-flag.js
var require_has_flag = __commonJS((exports, module) => {
  module.exports = function(flag, argv) {
    argv = argv || process.argv || [];
    var terminatorPos = argv.indexOf("--");
    var prefix = /^-{1,2}/.test(flag) ? "" : "--";
    var pos = argv.indexOf(prefix + flag);
    return pos !== -1 && (terminatorPos === -1 ? true : pos < terminatorPos);
  };
});

// node_modules/@colors/colors/lib/system/supports-colors.js
var require_supports_colors = __commonJS((exports, module) => {
  var os4 = __require("os");
  var hasFlag = require_has_flag();
  var env = process.env;
  var forceColor = undefined;
  if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false")) {
    forceColor = false;
  } else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
    forceColor = true;
  }
  if ("FORCE_COLOR" in env) {
    forceColor = env.FORCE_COLOR.length === 0 || parseInt(env.FORCE_COLOR, 10) !== 0;
  }
  function translateLevel(level) {
    if (level === 0) {
      return false;
    }
    return {
      level,
      hasBasic: true,
      has256: level >= 2,
      has16m: level >= 3
    };
  }
  function supportsColor(stream) {
    if (forceColor === false) {
      return 0;
    }
    if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
      return 3;
    }
    if (hasFlag("color=256")) {
      return 2;
    }
    if (stream && !stream.isTTY && forceColor !== true) {
      return 0;
    }
    var min = forceColor ? 1 : 0;
    if (process.platform === "win32") {
      var osRelease = os4.release().split(".");
      if (Number(process.versions.node.split(".")[0]) >= 8 && Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
        return Number(osRelease[2]) >= 14931 ? 3 : 2;
      }
      return 1;
    }
    if ("CI" in env) {
      if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI"].some(function(sign) {
        return sign in env;
      }) || env.CI_NAME === "codeship") {
        return 1;
      }
      return min;
    }
    if ("TEAMCITY_VERSION" in env) {
      return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
    }
    if ("TERM_PROGRAM" in env) {
      var version2 = parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
      switch (env.TERM_PROGRAM) {
        case "iTerm.app":
          return version2 >= 3 ? 3 : 2;
        case "Hyper":
          return 3;
        case "Apple_Terminal":
          return 2;
      }
    }
    if (/-256(color)?$/i.test(env.TERM)) {
      return 2;
    }
    if (/^screen|^xterm|^vt100|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
      return 1;
    }
    if ("COLORTERM" in env) {
      return 1;
    }
    if (env.TERM === "dumb") {
      return min;
    }
    return min;
  }
  function getSupportLevel(stream) {
    var level = supportsColor(stream);
    return translateLevel(level);
  }
  module.exports = {
    supportsColor: getSupportLevel,
    stdout: getSupportLevel(process.stdout),
    stderr: getSupportLevel(process.stderr)
  };
});

// node_modules/@colors/colors/lib/custom/trap.js
var require_trap = __commonJS((exports, module) => {
  module["exports"] = function runTheTrap(text, options) {
    var result = "";
    text = text || "Run the trap, drop the bass";
    text = text.split("");
    var trap = {
      a: ["@", "\u0104", "\u023A", "\u0245", "\u0394", "\u039B", "\u0414"],
      b: ["\xDF", "\u0181", "\u0243", "\u026E", "\u03B2", "\u0E3F"],
      c: ["\xA9", "\u023B", "\u03FE"],
      d: ["\xD0", "\u018A", "\u0500", "\u0501", "\u0502", "\u0503"],
      e: [
        "\xCB",
        "\u0115",
        "\u018E",
        "\u0258",
        "\u03A3",
        "\u03BE",
        "\u04BC",
        "\u0A6C"
      ],
      f: ["\u04FA"],
      g: ["\u0262"],
      h: ["\u0126", "\u0195", "\u04A2", "\u04BA", "\u04C7", "\u050A"],
      i: ["\u0F0F"],
      j: ["\u0134"],
      k: ["\u0138", "\u04A0", "\u04C3", "\u051E"],
      l: ["\u0139"],
      m: ["\u028D", "\u04CD", "\u04CE", "\u0520", "\u0521", "\u0D69"],
      n: ["\xD1", "\u014B", "\u019D", "\u0376", "\u03A0", "\u048A"],
      o: [
        "\xD8",
        "\xF5",
        "\xF8",
        "\u01FE",
        "\u0298",
        "\u047A",
        "\u05DD",
        "\u06DD",
        "\u0E4F"
      ],
      p: ["\u01F7", "\u048E"],
      q: ["\u09CD"],
      r: ["\xAE", "\u01A6", "\u0210", "\u024C", "\u0280", "\u042F"],
      s: ["\xA7", "\u03DE", "\u03DF", "\u03E8"],
      t: ["\u0141", "\u0166", "\u0373"],
      u: ["\u01B1", "\u054D"],
      v: ["\u05D8"],
      w: ["\u0428", "\u0460", "\u047C", "\u0D70"],
      x: ["\u04B2", "\u04FE", "\u04FC", "\u04FD"],
      y: ["\xA5", "\u04B0", "\u04CB"],
      z: ["\u01B5", "\u0240"]
    };
    text.forEach(function(c) {
      c = c.toLowerCase();
      var chars = trap[c] || [" "];
      var rand = Math.floor(Math.random() * chars.length);
      if (typeof trap[c] !== "undefined") {
        result += trap[c][rand];
      } else {
        result += c;
      }
    });
    return result;
  };
});

// node_modules/@colors/colors/lib/custom/zalgo.js
var require_zalgo = __commonJS((exports, module) => {
  module["exports"] = function zalgo(text, options) {
    text = text || "   he is here   ";
    var soul = {
      up: [
        "\u030D",
        "\u030E",
        "\u0304",
        "\u0305",
        "\u033F",
        "\u0311",
        "\u0306",
        "\u0310",
        "\u0352",
        "\u0357",
        "\u0351",
        "\u0307",
        "\u0308",
        "\u030A",
        "\u0342",
        "\u0313",
        "\u0308",
        "\u034A",
        "\u034B",
        "\u034C",
        "\u0303",
        "\u0302",
        "\u030C",
        "\u0350",
        "\u0300",
        "\u0301",
        "\u030B",
        "\u030F",
        "\u0312",
        "\u0313",
        "\u0314",
        "\u033D",
        "\u0309",
        "\u0363",
        "\u0364",
        "\u0365",
        "\u0366",
        "\u0367",
        "\u0368",
        "\u0369",
        "\u036A",
        "\u036B",
        "\u036C",
        "\u036D",
        "\u036E",
        "\u036F",
        "\u033E",
        "\u035B",
        "\u0346",
        "\u031A"
      ],
      down: [
        "\u0316",
        "\u0317",
        "\u0318",
        "\u0319",
        "\u031C",
        "\u031D",
        "\u031E",
        "\u031F",
        "\u0320",
        "\u0324",
        "\u0325",
        "\u0326",
        "\u0329",
        "\u032A",
        "\u032B",
        "\u032C",
        "\u032D",
        "\u032E",
        "\u032F",
        "\u0330",
        "\u0331",
        "\u0332",
        "\u0333",
        "\u0339",
        "\u033A",
        "\u033B",
        "\u033C",
        "\u0345",
        "\u0347",
        "\u0348",
        "\u0349",
        "\u034D",
        "\u034E",
        "\u0353",
        "\u0354",
        "\u0355",
        "\u0356",
        "\u0359",
        "\u035A",
        "\u0323"
      ],
      mid: [
        "\u0315",
        "\u031B",
        "\u0300",
        "\u0301",
        "\u0358",
        "\u0321",
        "\u0322",
        "\u0327",
        "\u0328",
        "\u0334",
        "\u0335",
        "\u0336",
        "\u035C",
        "\u035D",
        "\u035E",
        "\u035F",
        "\u0360",
        "\u0362",
        "\u0338",
        "\u0337",
        "\u0361",
        " \u0489"
      ]
    };
    var all = [].concat(soul.up, soul.down, soul.mid);
    function randomNumber(range) {
      var r = Math.floor(Math.random() * range);
      return r;
    }
    function isChar(character) {
      var bool = false;
      all.filter(function(i) {
        bool = i === character;
      });
      return bool;
    }
    function heComes(text2, options2) {
      var result = "";
      var counts;
      var l;
      options2 = options2 || {};
      options2["up"] = typeof options2["up"] !== "undefined" ? options2["up"] : true;
      options2["mid"] = typeof options2["mid"] !== "undefined" ? options2["mid"] : true;
      options2["down"] = typeof options2["down"] !== "undefined" ? options2["down"] : true;
      options2["size"] = typeof options2["size"] !== "undefined" ? options2["size"] : "maxi";
      text2 = text2.split("");
      for (l in text2) {
        if (isChar(l)) {
          continue;
        }
        result = result + text2[l];
        counts = { up: 0, down: 0, mid: 0 };
        switch (options2.size) {
          case "mini":
            counts.up = randomNumber(8);
            counts.mid = randomNumber(2);
            counts.down = randomNumber(8);
            break;
          case "maxi":
            counts.up = randomNumber(16) + 3;
            counts.mid = randomNumber(4) + 1;
            counts.down = randomNumber(64) + 3;
            break;
          default:
            counts.up = randomNumber(8) + 1;
            counts.mid = randomNumber(6) / 2;
            counts.down = randomNumber(8) + 1;
            break;
        }
        var arr = ["up", "mid", "down"];
        for (var d in arr) {
          var index = arr[d];
          for (var i = 0;i <= counts[index]; i++) {
            if (options2[index]) {
              result = result + soul[index][randomNumber(soul[index].length)];
            }
          }
        }
      }
      return result;
    }
    return heComes(text, options);
  };
});

// node_modules/@colors/colors/lib/maps/america.js
var require_america = __commonJS((exports, module) => {
  module["exports"] = function(colors) {
    return function(letter, i, exploded) {
      if (letter === " ")
        return letter;
      switch (i % 3) {
        case 0:
          return colors.red(letter);
        case 1:
          return colors.white(letter);
        case 2:
          return colors.blue(letter);
      }
    };
  };
});

// node_modules/@colors/colors/lib/maps/zebra.js
var require_zebra = __commonJS((exports, module) => {
  module["exports"] = function(colors) {
    return function(letter, i, exploded) {
      return i % 2 === 0 ? letter : colors.inverse(letter);
    };
  };
});

// node_modules/@colors/colors/lib/maps/rainbow.js
var require_rainbow = __commonJS((exports, module) => {
  module["exports"] = function(colors) {
    var rainbowColors = ["red", "yellow", "green", "blue", "magenta"];
    return function(letter, i, exploded) {
      if (letter === " ") {
        return letter;
      } else {
        return colors[rainbowColors[i++ % rainbowColors.length]](letter);
      }
    };
  };
});

// node_modules/@colors/colors/lib/maps/random.js
var require_random = __commonJS((exports, module) => {
  module["exports"] = function(colors) {
    var available = [
      "underline",
      "inverse",
      "grey",
      "yellow",
      "red",
      "green",
      "blue",
      "white",
      "cyan",
      "magenta",
      "brightYellow",
      "brightRed",
      "brightGreen",
      "brightBlue",
      "brightWhite",
      "brightCyan",
      "brightMagenta"
    ];
    return function(letter, i, exploded) {
      return letter === " " ? letter : colors[available[Math.round(Math.random() * (available.length - 2))]](letter);
    };
  };
});

// node_modules/@colors/colors/lib/colors.js
var require_colors = __commonJS((exports, module) => {
  var colors = {};
  module["exports"] = colors;
  colors.themes = {};
  var util = __require("util");
  var ansiStyles = colors.styles = require_styles();
  var defineProps = Object.defineProperties;
  var newLineRegex = new RegExp(/[\r\n]+/g);
  colors.supportsColor = require_supports_colors().supportsColor;
  if (typeof colors.enabled === "undefined") {
    colors.enabled = colors.supportsColor() !== false;
  }
  colors.enable = function() {
    colors.enabled = true;
  };
  colors.disable = function() {
    colors.enabled = false;
  };
  colors.stripColors = colors.strip = function(str) {
    return ("" + str).replace(/\x1B\[\d+m/g, "");
  };
  var stylize = colors.stylize = function stylize2(str, style) {
    if (!colors.enabled) {
      return str + "";
    }
    var styleMap = ansiStyles[style];
    if (!styleMap && style in colors) {
      return colors[style](str);
    }
    return styleMap.open + str + styleMap.close;
  };
  var matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
  var escapeStringRegexp = function(str) {
    if (typeof str !== "string") {
      throw new TypeError("Expected a string");
    }
    return str.replace(matchOperatorsRe, "\\$&");
  };
  function build(_styles) {
    var builder = function builder2() {
      return applyStyle.apply(builder2, arguments);
    };
    builder._styles = _styles;
    builder.__proto__ = proto;
    return builder;
  }
  var styles = function() {
    var ret = {};
    ansiStyles.grey = ansiStyles.gray;
    Object.keys(ansiStyles).forEach(function(key) {
      ansiStyles[key].closeRe = new RegExp(escapeStringRegexp(ansiStyles[key].close), "g");
      ret[key] = {
        get: function() {
          return build(this._styles.concat(key));
        }
      };
    });
    return ret;
  }();
  var proto = defineProps(function colors2() {}, styles);
  function applyStyle() {
    var args = Array.prototype.slice.call(arguments);
    var str = args.map(function(arg) {
      if (arg != null && arg.constructor === String) {
        return arg;
      } else {
        return util.inspect(arg);
      }
    }).join(" ");
    if (!colors.enabled || !str) {
      return str;
    }
    var newLinesPresent = str.indexOf(`
`) != -1;
    var nestedStyles = this._styles;
    var i = nestedStyles.length;
    while (i--) {
      var code = ansiStyles[nestedStyles[i]];
      str = code.open + str.replace(code.closeRe, code.open) + code.close;
      if (newLinesPresent) {
        str = str.replace(newLineRegex, function(match) {
          return code.close + match + code.open;
        });
      }
    }
    return str;
  }
  colors.setTheme = function(theme) {
    if (typeof theme === "string") {
      console.log("colors.setTheme now only accepts an object, not a string.  " + "If you are trying to set a theme from a file, it is now your (the " + "caller's) responsibility to require the file.  The old syntax " + "looked like colors.setTheme(__dirname + " + "'/../themes/generic-logging.js'); The new syntax looks like " + "colors.setTheme(require(__dirname + " + "'/../themes/generic-logging.js'));");
      return;
    }
    for (var style in theme) {
      (function(style2) {
        colors[style2] = function(str) {
          if (typeof theme[style2] === "object") {
            var out = str;
            for (var i in theme[style2]) {
              out = colors[theme[style2][i]](out);
            }
            return out;
          }
          return colors[theme[style2]](str);
        };
      })(style);
    }
  };
  function init() {
    var ret = {};
    Object.keys(styles).forEach(function(name) {
      ret[name] = {
        get: function() {
          return build([name]);
        }
      };
    });
    return ret;
  }
  var sequencer = function sequencer2(map2, str) {
    var exploded = str.split("");
    exploded = exploded.map(map2);
    return exploded.join("");
  };
  colors.trap = require_trap();
  colors.zalgo = require_zalgo();
  colors.maps = {};
  colors.maps.america = require_america()(colors);
  colors.maps.zebra = require_zebra()(colors);
  colors.maps.rainbow = require_rainbow()(colors);
  colors.maps.random = require_random()(colors);
  for (map in colors.maps) {
    (function(map2) {
      colors[map2] = function(str) {
        return sequencer(colors.maps[map2], str);
      };
    })(map);
  }
  var map;
  defineProps(colors, init());
});

// node_modules/@colors/colors/safe.js
var require_safe = __commonJS((exports, module) => {
  var colors = require_colors();
  module["exports"] = colors;
});

// node_modules/triple-beam/config/cli.js
var require_cli = __commonJS((exports) => {
  exports.levels = {
    error: 0,
    warn: 1,
    help: 2,
    data: 3,
    info: 4,
    debug: 5,
    prompt: 6,
    verbose: 7,
    input: 8,
    silly: 9
  };
  exports.colors = {
    error: "red",
    warn: "yellow",
    help: "cyan",
    data: "grey",
    info: "green",
    debug: "blue",
    prompt: "grey",
    verbose: "cyan",
    input: "grey",
    silly: "magenta"
  };
});

// node_modules/triple-beam/config/npm.js
var require_npm = __commonJS((exports) => {
  exports.levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
  };
  exports.colors = {
    error: "red",
    warn: "yellow",
    info: "green",
    http: "green",
    verbose: "cyan",
    debug: "blue",
    silly: "magenta"
  };
});

// node_modules/triple-beam/config/syslog.js
var require_syslog = __commonJS((exports) => {
  exports.levels = {
    emerg: 0,
    alert: 1,
    crit: 2,
    error: 3,
    warning: 4,
    notice: 5,
    info: 6,
    debug: 7
  };
  exports.colors = {
    emerg: "red",
    alert: "yellow",
    crit: "red",
    error: "red",
    warning: "red",
    notice: "yellow",
    info: "green",
    debug: "blue"
  };
});

// node_modules/triple-beam/config/index.js
var require_config = __commonJS((exports) => {
  Object.defineProperty(exports, "cli", {
    value: require_cli()
  });
  Object.defineProperty(exports, "npm", {
    value: require_npm()
  });
  Object.defineProperty(exports, "syslog", {
    value: require_syslog()
  });
});

// node_modules/triple-beam/index.js
var require_triple_beam = __commonJS((exports) => {
  Object.defineProperty(exports, "LEVEL", {
    value: Symbol.for("level")
  });
  Object.defineProperty(exports, "MESSAGE", {
    value: Symbol.for("message")
  });
  Object.defineProperty(exports, "SPLAT", {
    value: Symbol.for("splat")
  });
  Object.defineProperty(exports, "configs", {
    value: require_config()
  });
});

// node_modules/logform/colorize.js
var require_colorize = __commonJS((exports, module) => {
  var colors = require_safe();
  var { LEVEL, MESSAGE } = require_triple_beam();
  colors.enabled = true;
  var hasSpace = /\s+/;

  class Colorizer {
    constructor(opts = {}) {
      if (opts.colors) {
        this.addColors(opts.colors);
      }
      this.options = opts;
    }
    static addColors(clrs) {
      const nextColors = Object.keys(clrs).reduce((acc, level) => {
        acc[level] = hasSpace.test(clrs[level]) ? clrs[level].split(hasSpace) : clrs[level];
        return acc;
      }, {});
      Colorizer.allColors = Object.assign({}, Colorizer.allColors || {}, nextColors);
      return Colorizer.allColors;
    }
    addColors(clrs) {
      return Colorizer.addColors(clrs);
    }
    colorize(lookup, level, message) {
      if (typeof message === "undefined") {
        message = level;
      }
      if (!Array.isArray(Colorizer.allColors[lookup])) {
        return colors[Colorizer.allColors[lookup]](message);
      }
      for (let i = 0, len = Colorizer.allColors[lookup].length;i < len; i++) {
        message = colors[Colorizer.allColors[lookup][i]](message);
      }
      return message;
    }
    transform(info, opts) {
      if (opts.all && typeof info[MESSAGE] === "string") {
        info[MESSAGE] = this.colorize(info[LEVEL], info.level, info[MESSAGE]);
      }
      if (opts.level || opts.all || !opts.message) {
        info.level = this.colorize(info[LEVEL], info.level);
      }
      if (opts.all || opts.message) {
        info.message = this.colorize(info[LEVEL], info.level, info.message);
      }
      return info;
    }
  }
  module.exports = (opts) => new Colorizer(opts);
  module.exports.Colorizer = module.exports.Format = Colorizer;
});

// node_modules/logform/levels.js
var require_levels = __commonJS((exports, module) => {
  var { Colorizer } = require_colorize();
  module.exports = (config) => {
    Colorizer.addColors(config.colors || config);
    return config;
  };
});

// node_modules/logform/align.js
var require_align = __commonJS((exports, module) => {
  var format = require_format();
  module.exports = format((info) => {
    info.message = `	${info.message}`;
    return info;
  });
});

// node_modules/logform/errors.js
var require_errors = __commonJS((exports, module) => {
  var format = require_format();
  var { LEVEL, MESSAGE } = require_triple_beam();
  module.exports = format((einfo, { stack, cause }) => {
    if (einfo instanceof Error) {
      const info = Object.assign({}, einfo, {
        level: einfo.level,
        [LEVEL]: einfo[LEVEL] || einfo.level,
        message: einfo.message,
        [MESSAGE]: einfo[MESSAGE] || einfo.message
      });
      if (stack)
        info.stack = einfo.stack;
      if (cause)
        info.cause = einfo.cause;
      return info;
    }
    if (!(einfo.message instanceof Error))
      return einfo;
    const err = einfo.message;
    Object.assign(einfo, err);
    einfo.message = err.message;
    einfo[MESSAGE] = err.message;
    if (stack)
      einfo.stack = err.stack;
    if (cause)
      einfo.cause = err.cause;
    return einfo;
  });
});

// node_modules/logform/pad-levels.js
var require_pad_levels = __commonJS((exports, module) => {
  var { configs, LEVEL, MESSAGE } = require_triple_beam();

  class Padder {
    constructor(opts = { levels: configs.npm.levels }) {
      this.paddings = Padder.paddingForLevels(opts.levels, opts.filler);
      this.options = opts;
    }
    static getLongestLevel(levels) {
      const lvls = Object.keys(levels).map((level) => level.length);
      return Math.max(...lvls);
    }
    static paddingForLevel(level, filler, maxLength) {
      const targetLen = maxLength + 1 - level.length;
      const rep = Math.floor(targetLen / filler.length);
      const padding = `${filler}${filler.repeat(rep)}`;
      return padding.slice(0, targetLen);
    }
    static paddingForLevels(levels, filler = " ") {
      const maxLength = Padder.getLongestLevel(levels);
      return Object.keys(levels).reduce((acc, level) => {
        acc[level] = Padder.paddingForLevel(level, filler, maxLength);
        return acc;
      }, {});
    }
    transform(info, opts) {
      info.message = `${this.paddings[info[LEVEL]]}${info.message}`;
      if (info[MESSAGE]) {
        info[MESSAGE] = `${this.paddings[info[LEVEL]]}${info[MESSAGE]}`;
      }
      return info;
    }
  }
  module.exports = (opts) => new Padder(opts);
  module.exports.Padder = module.exports.Format = Padder;
});

// node_modules/logform/cli.js
var require_cli2 = __commonJS((exports, module) => {
  var { Colorizer } = require_colorize();
  var { Padder } = require_pad_levels();
  var { configs, MESSAGE } = require_triple_beam();

  class CliFormat {
    constructor(opts = {}) {
      if (!opts.levels) {
        opts.levels = configs.cli.levels;
      }
      this.colorizer = new Colorizer(opts);
      this.padder = new Padder(opts);
      this.options = opts;
    }
    transform(info, opts) {
      this.colorizer.transform(this.padder.transform(info, opts), opts);
      info[MESSAGE] = `${info.level}:${info.message}`;
      return info;
    }
  }
  module.exports = (opts) => new CliFormat(opts);
  module.exports.Format = CliFormat;
});

// node_modules/logform/combine.js
var require_combine = __commonJS((exports, module) => {
  var format = require_format();
  function cascade(formats) {
    if (!formats.every(isValidFormat)) {
      return;
    }
    return (info) => {
      let obj = info;
      for (let i = 0;i < formats.length; i++) {
        obj = formats[i].transform(obj, formats[i].options);
        if (!obj) {
          return false;
        }
      }
      return obj;
    };
  }
  function isValidFormat(fmt) {
    if (typeof fmt.transform !== "function") {
      throw new Error([
        "No transform function found on format. Did you create a format instance?",
        "const myFormat = format(formatFn);",
        "const instance = myFormat();"
      ].join(`
`));
    }
    return true;
  }
  module.exports = (...formats) => {
    const combinedFormat = format(cascade(formats));
    const instance = combinedFormat();
    instance.Format = combinedFormat.Format;
    return instance;
  };
  module.exports.cascade = cascade;
});

// node_modules/safe-stable-stringify/index.js
var require_safe_stable_stringify = __commonJS((exports, module) => {
  var { hasOwnProperty } = Object.prototype;
  var stringify = configure();
  stringify.configure = configure;
  stringify.stringify = stringify;
  stringify.default = stringify;
  exports.stringify = stringify;
  exports.configure = configure;
  module.exports = stringify;
  var strEscapeSequencesRegExp = /[\u0000-\u001f\u0022\u005c\ud800-\udfff]/;
  function strEscape(str) {
    if (str.length < 5000 && !strEscapeSequencesRegExp.test(str)) {
      return `"${str}"`;
    }
    return JSON.stringify(str);
  }
  function sort(array, comparator) {
    if (array.length > 200 || comparator) {
      return array.sort(comparator);
    }
    for (let i = 1;i < array.length; i++) {
      const currentValue = array[i];
      let position = i;
      while (position !== 0 && array[position - 1] > currentValue) {
        array[position] = array[position - 1];
        position--;
      }
      array[position] = currentValue;
    }
    return array;
  }
  var typedArrayPrototypeGetSymbolToStringTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(new Int8Array)), Symbol.toStringTag).get;
  function isTypedArrayWithEntries(value) {
    return typedArrayPrototypeGetSymbolToStringTag.call(value) !== undefined && value.length !== 0;
  }
  function stringifyTypedArray(array, separator, maximumBreadth) {
    if (array.length < maximumBreadth) {
      maximumBreadth = array.length;
    }
    const whitespace = separator === "," ? "" : " ";
    let res = `"0":${whitespace}${array[0]}`;
    for (let i = 1;i < maximumBreadth; i++) {
      res += `${separator}"${i}":${whitespace}${array[i]}`;
    }
    return res;
  }
  function getCircularValueOption(options) {
    if (hasOwnProperty.call(options, "circularValue")) {
      const circularValue = options.circularValue;
      if (typeof circularValue === "string") {
        return `"${circularValue}"`;
      }
      if (circularValue == null) {
        return circularValue;
      }
      if (circularValue === Error || circularValue === TypeError) {
        return {
          toString() {
            throw new TypeError("Converting circular structure to JSON");
          }
        };
      }
      throw new TypeError('The "circularValue" argument must be of type string or the value null or undefined');
    }
    return '"[Circular]"';
  }
  function getDeterministicOption(options) {
    let value;
    if (hasOwnProperty.call(options, "deterministic")) {
      value = options.deterministic;
      if (typeof value !== "boolean" && typeof value !== "function") {
        throw new TypeError('The "deterministic" argument must be of type boolean or comparator function');
      }
    }
    return value === undefined ? true : value;
  }
  function getBooleanOption(options, key) {
    let value;
    if (hasOwnProperty.call(options, key)) {
      value = options[key];
      if (typeof value !== "boolean") {
        throw new TypeError(`The "${key}" argument must be of type boolean`);
      }
    }
    return value === undefined ? true : value;
  }
  function getPositiveIntegerOption(options, key) {
    let value;
    if (hasOwnProperty.call(options, key)) {
      value = options[key];
      if (typeof value !== "number") {
        throw new TypeError(`The "${key}" argument must be of type number`);
      }
      if (!Number.isInteger(value)) {
        throw new TypeError(`The "${key}" argument must be an integer`);
      }
      if (value < 1) {
        throw new RangeError(`The "${key}" argument must be >= 1`);
      }
    }
    return value === undefined ? Infinity : value;
  }
  function getItemCount(number) {
    if (number === 1) {
      return "1 item";
    }
    return `${number} items`;
  }
  function getUniqueReplacerSet(replacerArray) {
    const replacerSet = new Set;
    for (const value of replacerArray) {
      if (typeof value === "string" || typeof value === "number") {
        replacerSet.add(String(value));
      }
    }
    return replacerSet;
  }
  function getStrictOption(options) {
    if (hasOwnProperty.call(options, "strict")) {
      const value = options.strict;
      if (typeof value !== "boolean") {
        throw new TypeError('The "strict" argument must be of type boolean');
      }
      if (value) {
        return (value2) => {
          let message = `Object can not safely be stringified. Received type ${typeof value2}`;
          if (typeof value2 !== "function")
            message += ` (${value2.toString()})`;
          throw new Error(message);
        };
      }
    }
  }
  function configure(options) {
    options = { ...options };
    const fail = getStrictOption(options);
    if (fail) {
      if (options.bigint === undefined) {
        options.bigint = false;
      }
      if (!("circularValue" in options)) {
        options.circularValue = Error;
      }
    }
    const circularValue = getCircularValueOption(options);
    const bigint = getBooleanOption(options, "bigint");
    const deterministic = getDeterministicOption(options);
    const comparator = typeof deterministic === "function" ? deterministic : undefined;
    const maximumDepth = getPositiveIntegerOption(options, "maximumDepth");
    const maximumBreadth = getPositiveIntegerOption(options, "maximumBreadth");
    function stringifyFnReplacer(key, parent, stack, replacer, spacer, indentation) {
      let value = parent[key];
      if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
        value = value.toJSON(key);
      }
      value = replacer.call(parent, key, value);
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          let res = "";
          let join5 = ",";
          const originalIndentation = indentation;
          if (Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            if (spacer !== "") {
              indentation += spacer;
              res += `
${indentation}`;
              join5 = `,
${indentation}`;
            }
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (;i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
              res += tmp2 !== undefined ? tmp2 : "null";
              res += join5;
            }
            const tmp = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
            res += tmp !== undefined ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res += `${join5}"... ${getItemCount(removedKeys)} not stringified"`;
            }
            if (spacer !== "") {
              res += `
${originalIndentation}`;
            }
            stack.pop();
            return `[${res}]`;
          }
          let keys = Object.keys(value);
          const keyLength = keys.length;
          if (keyLength === 0) {
            return "{}";
          }
          if (maximumDepth < stack.length + 1) {
            return '"[Object]"';
          }
          let whitespace = "";
          let separator = "";
          if (spacer !== "") {
            indentation += spacer;
            join5 = `,
${indentation}`;
            whitespace = " ";
          }
          const maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
          if (deterministic && !isTypedArrayWithEntries(value)) {
            keys = sort(keys, comparator);
          }
          stack.push(value);
          for (let i = 0;i < maximumPropertiesToStringify; i++) {
            const key2 = keys[i];
            const tmp = stringifyFnReplacer(key2, value, stack, replacer, spacer, indentation);
            if (tmp !== undefined) {
              res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
              separator = join5;
            }
          }
          if (keyLength > maximumBreadth) {
            const removedKeys = keyLength - maximumBreadth;
            res += `${separator}"...":${whitespace}"${getItemCount(removedKeys)} not stringified"`;
            separator = join5;
          }
          if (spacer !== "" && separator.length > 1) {
            res = `
${indentation}${res}
${originalIndentation}`;
          }
          stack.pop();
          return `{${res}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : undefined;
      }
    }
    function stringifyArrayReplacer(key, value, stack, replacer, spacer, indentation) {
      if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
        value = value.toJSON(key);
      }
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          const originalIndentation = indentation;
          let res = "";
          let join5 = ",";
          if (Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            if (spacer !== "") {
              indentation += spacer;
              res += `
${indentation}`;
              join5 = `,
${indentation}`;
            }
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (;i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
              res += tmp2 !== undefined ? tmp2 : "null";
              res += join5;
            }
            const tmp = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
            res += tmp !== undefined ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res += `${join5}"... ${getItemCount(removedKeys)} not stringified"`;
            }
            if (spacer !== "") {
              res += `
${originalIndentation}`;
            }
            stack.pop();
            return `[${res}]`;
          }
          stack.push(value);
          let whitespace = "";
          if (spacer !== "") {
            indentation += spacer;
            join5 = `,
${indentation}`;
            whitespace = " ";
          }
          let separator = "";
          for (const key2 of replacer) {
            const tmp = stringifyArrayReplacer(key2, value[key2], stack, replacer, spacer, indentation);
            if (tmp !== undefined) {
              res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
              separator = join5;
            }
          }
          if (spacer !== "" && separator.length > 1) {
            res = `
${indentation}${res}
${originalIndentation}`;
          }
          stack.pop();
          return `{${res}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : undefined;
      }
    }
    function stringifyIndent(key, value, stack, spacer, indentation) {
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (typeof value.toJSON === "function") {
            value = value.toJSON(key);
            if (typeof value !== "object") {
              return stringifyIndent(key, value, stack, spacer, indentation);
            }
            if (value === null) {
              return "null";
            }
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          const originalIndentation = indentation;
          if (Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            indentation += spacer;
            let res2 = `
${indentation}`;
            const join6 = `,
${indentation}`;
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (;i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifyIndent(String(i), value[i], stack, spacer, indentation);
              res2 += tmp2 !== undefined ? tmp2 : "null";
              res2 += join6;
            }
            const tmp = stringifyIndent(String(i), value[i], stack, spacer, indentation);
            res2 += tmp !== undefined ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res2 += `${join6}"... ${getItemCount(removedKeys)} not stringified"`;
            }
            res2 += `
${originalIndentation}`;
            stack.pop();
            return `[${res2}]`;
          }
          let keys = Object.keys(value);
          const keyLength = keys.length;
          if (keyLength === 0) {
            return "{}";
          }
          if (maximumDepth < stack.length + 1) {
            return '"[Object]"';
          }
          indentation += spacer;
          const join5 = `,
${indentation}`;
          let res = "";
          let separator = "";
          let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
          if (isTypedArrayWithEntries(value)) {
            res += stringifyTypedArray(value, join5, maximumBreadth);
            keys = keys.slice(value.length);
            maximumPropertiesToStringify -= value.length;
            separator = join5;
          }
          if (deterministic) {
            keys = sort(keys, comparator);
          }
          stack.push(value);
          for (let i = 0;i < maximumPropertiesToStringify; i++) {
            const key2 = keys[i];
            const tmp = stringifyIndent(key2, value[key2], stack, spacer, indentation);
            if (tmp !== undefined) {
              res += `${separator}${strEscape(key2)}: ${tmp}`;
              separator = join5;
            }
          }
          if (keyLength > maximumBreadth) {
            const removedKeys = keyLength - maximumBreadth;
            res += `${separator}"...": "${getItemCount(removedKeys)} not stringified"`;
            separator = join5;
          }
          if (separator !== "") {
            res = `
${indentation}${res}
${originalIndentation}`;
          }
          stack.pop();
          return `{${res}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : undefined;
      }
    }
    function stringifySimple(key, value, stack) {
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (typeof value.toJSON === "function") {
            value = value.toJSON(key);
            if (typeof value !== "object") {
              return stringifySimple(key, value, stack);
            }
            if (value === null) {
              return "null";
            }
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          let res = "";
          const hasLength = value.length !== undefined;
          if (hasLength && Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (;i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifySimple(String(i), value[i], stack);
              res += tmp2 !== undefined ? tmp2 : "null";
              res += ",";
            }
            const tmp = stringifySimple(String(i), value[i], stack);
            res += tmp !== undefined ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res += `,"... ${getItemCount(removedKeys)} not stringified"`;
            }
            stack.pop();
            return `[${res}]`;
          }
          let keys = Object.keys(value);
          const keyLength = keys.length;
          if (keyLength === 0) {
            return "{}";
          }
          if (maximumDepth < stack.length + 1) {
            return '"[Object]"';
          }
          let separator = "";
          let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
          if (hasLength && isTypedArrayWithEntries(value)) {
            res += stringifyTypedArray(value, ",", maximumBreadth);
            keys = keys.slice(value.length);
            maximumPropertiesToStringify -= value.length;
            separator = ",";
          }
          if (deterministic) {
            keys = sort(keys, comparator);
          }
          stack.push(value);
          for (let i = 0;i < maximumPropertiesToStringify; i++) {
            const key2 = keys[i];
            const tmp = stringifySimple(key2, value[key2], stack);
            if (tmp !== undefined) {
              res += `${separator}${strEscape(key2)}:${tmp}`;
              separator = ",";
            }
          }
          if (keyLength > maximumBreadth) {
            const removedKeys = keyLength - maximumBreadth;
            res += `${separator}"...":"${getItemCount(removedKeys)} not stringified"`;
          }
          stack.pop();
          return `{${res}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : undefined;
      }
    }
    function stringify2(value, replacer, space) {
      if (arguments.length > 1) {
        let spacer = "";
        if (typeof space === "number") {
          spacer = " ".repeat(Math.min(space, 10));
        } else if (typeof space === "string") {
          spacer = space.slice(0, 10);
        }
        if (replacer != null) {
          if (typeof replacer === "function") {
            return stringifyFnReplacer("", { "": value }, [], replacer, spacer, "");
          }
          if (Array.isArray(replacer)) {
            return stringifyArrayReplacer("", value, [], getUniqueReplacerSet(replacer), spacer, "");
          }
        }
        if (spacer.length !== 0) {
          return stringifyIndent("", value, [], spacer, "");
        }
      }
      return stringifySimple("", value, []);
    }
    return stringify2;
  }
});

// node_modules/logform/json.js
var require_json = __commonJS((exports, module) => {
  var format = require_format();
  var { MESSAGE } = require_triple_beam();
  var stringify = require_safe_stable_stringify();
  function replacer(key, value) {
    if (typeof value === "bigint")
      return value.toString();
    return value;
  }
  module.exports = format((info, opts) => {
    const jsonStringify = stringify.configure(opts);
    info[MESSAGE] = jsonStringify(info, opts.replacer || replacer, opts.space);
    return info;
  });
});

// node_modules/logform/label.js
var require_label = __commonJS((exports, module) => {
  var format = require_format();
  module.exports = format((info, opts) => {
    if (opts.message) {
      info.message = `[${opts.label}] ${info.message}`;
      return info;
    }
    info.label = opts.label;
    return info;
  });
});

// node_modules/logform/logstash.js
var require_logstash = __commonJS((exports, module) => {
  var format = require_format();
  var { MESSAGE } = require_triple_beam();
  var jsonStringify = require_safe_stable_stringify();
  module.exports = format((info) => {
    const logstash = {};
    if (info.message) {
      logstash["@message"] = info.message;
      delete info.message;
    }
    if (info.timestamp) {
      logstash["@timestamp"] = info.timestamp;
      delete info.timestamp;
    }
    logstash["@fields"] = info;
    info[MESSAGE] = jsonStringify(logstash);
    return info;
  });
});

// node_modules/logform/metadata.js
var require_metadata = __commonJS((exports, module) => {
  var format = require_format();
  function fillExcept(info, fillExceptKeys, metadataKey) {
    const savedKeys = fillExceptKeys.reduce((acc, key) => {
      acc[key] = info[key];
      delete info[key];
      return acc;
    }, {});
    const metadata = Object.keys(info).reduce((acc, key) => {
      acc[key] = info[key];
      delete info[key];
      return acc;
    }, {});
    Object.assign(info, savedKeys, {
      [metadataKey]: metadata
    });
    return info;
  }
  function fillWith(info, fillWithKeys, metadataKey) {
    info[metadataKey] = fillWithKeys.reduce((acc, key) => {
      acc[key] = info[key];
      delete info[key];
      return acc;
    }, {});
    return info;
  }
  module.exports = format((info, opts = {}) => {
    let metadataKey = "metadata";
    if (opts.key) {
      metadataKey = opts.key;
    }
    let fillExceptKeys = [];
    if (!opts.fillExcept && !opts.fillWith) {
      fillExceptKeys.push("level");
      fillExceptKeys.push("message");
    }
    if (opts.fillExcept) {
      fillExceptKeys = opts.fillExcept;
    }
    if (fillExceptKeys.length > 0) {
      return fillExcept(info, fillExceptKeys, metadataKey);
    }
    if (opts.fillWith) {
      return fillWith(info, opts.fillWith, metadataKey);
    }
    return info;
  });
});

// node_modules/ms/index.js
var require_ms = __commonJS((exports, module) => {
  var s = 1000;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  module.exports = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse2(val);
    } else if (type === "number" && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
  };
  function parse2(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "weeks":
      case "week":
      case "w":
        return n * w;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return;
    }
  }
  function fmtShort(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return Math.round(ms / d) + "d";
    }
    if (msAbs >= h) {
      return Math.round(ms / h) + "h";
    }
    if (msAbs >= m) {
      return Math.round(ms / m) + "m";
    }
    if (msAbs >= s) {
      return Math.round(ms / s) + "s";
    }
    return ms + "ms";
  }
  function fmtLong(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return plural(ms, msAbs, d, "day");
    }
    if (msAbs >= h) {
      return plural(ms, msAbs, h, "hour");
    }
    if (msAbs >= m) {
      return plural(ms, msAbs, m, "minute");
    }
    if (msAbs >= s) {
      return plural(ms, msAbs, s, "second");
    }
    return ms + " ms";
  }
  function plural(ms, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
  }
});

// node_modules/logform/ms.js
var require_ms2 = __commonJS((exports, module) => {
  var format = require_format();
  var ms = require_ms();
  module.exports = format((info) => {
    const curr = +new Date;
    exports.diff = curr - (exports.prevTime || curr);
    exports.prevTime = curr;
    info.ms = `+${ms(exports.diff)}`;
    return info;
  });
});

// node_modules/logform/pretty-print.js
var require_pretty_print = __commonJS((exports, module) => {
  var inspect = __require("util").inspect;
  var format = require_format();
  var { LEVEL, MESSAGE, SPLAT } = require_triple_beam();
  module.exports = format((info, opts = {}) => {
    const stripped = Object.assign({}, info);
    delete stripped[LEVEL];
    delete stripped[MESSAGE];
    delete stripped[SPLAT];
    info[MESSAGE] = inspect(stripped, false, opts.depth || null, opts.colorize);
    return info;
  });
});

// node_modules/logform/printf.js
var require_printf = __commonJS((exports, module) => {
  var { MESSAGE } = require_triple_beam();

  class Printf {
    constructor(templateFn) {
      this.template = templateFn;
    }
    transform(info) {
      info[MESSAGE] = this.template(info);
      return info;
    }
  }
  module.exports = (opts) => new Printf(opts);
  module.exports.Printf = module.exports.Format = Printf;
});

// node_modules/logform/simple.js
var require_simple = __commonJS((exports, module) => {
  var format = require_format();
  var { MESSAGE } = require_triple_beam();
  var jsonStringify = require_safe_stable_stringify();
  module.exports = format((info) => {
    const stringifiedRest = jsonStringify(Object.assign({}, info, {
      level: undefined,
      message: undefined,
      splat: undefined
    }));
    const padding = info.padding && info.padding[info.level] || "";
    if (stringifiedRest !== "{}") {
      info[MESSAGE] = `${info.level}:${padding} ${info.message} ${stringifiedRest}`;
    } else {
      info[MESSAGE] = `${info.level}:${padding} ${info.message}`;
    }
    return info;
  });
});

// node_modules/logform/splat.js
var require_splat = __commonJS((exports, module) => {
  var util = __require("util");
  var { SPLAT } = require_triple_beam();
  var formatRegExp = /%[scdjifoO%]/g;
  var escapedPercent = /%%/g;

  class Splatter {
    constructor(opts) {
      this.options = opts;
    }
    _splat(info, tokens) {
      const msg = info.message;
      const splat = info[SPLAT] || info.splat || [];
      const percents = msg.match(escapedPercent);
      const escapes = percents && percents.length || 0;
      const expectedSplat = tokens.length - escapes;
      const extraSplat = expectedSplat - splat.length;
      const metas = extraSplat < 0 ? splat.splice(extraSplat, -1 * extraSplat) : [];
      const metalen = metas.length;
      if (metalen) {
        for (let i = 0;i < metalen; i++) {
          Object.assign(info, metas[i]);
        }
      }
      info.message = util.format(msg, ...splat);
      return info;
    }
    transform(info) {
      const msg = info.message;
      const splat = info[SPLAT] || info.splat;
      if (!splat || !splat.length) {
        return info;
      }
      const tokens = msg && msg.match && msg.match(formatRegExp);
      if (!tokens && (splat || splat.length)) {
        const metas = splat.length > 1 ? splat.splice(0) : splat;
        const metalen = metas.length;
        if (metalen) {
          for (let i = 0;i < metalen; i++) {
            Object.assign(info, metas[i]);
          }
        }
        return info;
      }
      if (tokens) {
        return this._splat(info, tokens);
      }
      return info;
    }
  }
  module.exports = (opts) => new Splatter(opts);
});

// node_modules/fecha/lib/fecha.umd.js
var require_fecha_umd = __commonJS((exports, module) => {
  (function(global2, factory) {
    typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : factory(global2.fecha = {});
  })(exports, function(exports2) {
    var token = /d{1,4}|M{1,4}|YY(?:YY)?|S{1,3}|Do|ZZ|Z|([HhMsDm])\1?|[aA]|"[^"]*"|'[^']*'/g;
    var twoDigitsOptional = "\\d\\d?";
    var twoDigits = "\\d\\d";
    var threeDigits = "\\d{3}";
    var fourDigits = "\\d{4}";
    var word = "[^\\s]+";
    var literal = /\[([^]*?)\]/gm;
    function shorten(arr, sLen) {
      var newArr = [];
      for (var i = 0, len = arr.length;i < len; i++) {
        newArr.push(arr[i].substr(0, sLen));
      }
      return newArr;
    }
    var monthUpdate = function(arrName) {
      return function(v, i18n) {
        var lowerCaseArr = i18n[arrName].map(function(v2) {
          return v2.toLowerCase();
        });
        var index = lowerCaseArr.indexOf(v.toLowerCase());
        if (index > -1) {
          return index;
        }
        return null;
      };
    };
    function assign(origObj) {
      var args = [];
      for (var _i = 1;_i < arguments.length; _i++) {
        args[_i - 1] = arguments[_i];
      }
      for (var _a = 0, args_1 = args;_a < args_1.length; _a++) {
        var obj = args_1[_a];
        for (var key in obj) {
          origObj[key] = obj[key];
        }
      }
      return origObj;
    }
    var dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday"
    ];
    var monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ];
    var monthNamesShort = shorten(monthNames, 3);
    var dayNamesShort = shorten(dayNames, 3);
    var defaultI18n = {
      dayNamesShort,
      dayNames,
      monthNamesShort,
      monthNames,
      amPm: ["am", "pm"],
      DoFn: function(dayOfMonth) {
        return dayOfMonth + ["th", "st", "nd", "rd"][dayOfMonth % 10 > 3 ? 0 : (dayOfMonth - dayOfMonth % 10 !== 10 ? 1 : 0) * dayOfMonth % 10];
      }
    };
    var globalI18n = assign({}, defaultI18n);
    var setGlobalDateI18n = function(i18n) {
      return globalI18n = assign(globalI18n, i18n);
    };
    var regexEscape = function(str) {
      return str.replace(/[|\\{()[^$+*?.-]/g, "\\$&");
    };
    var pad = function(val, len) {
      if (len === undefined) {
        len = 2;
      }
      val = String(val);
      while (val.length < len) {
        val = "0" + val;
      }
      return val;
    };
    var formatFlags = {
      D: function(dateObj) {
        return String(dateObj.getDate());
      },
      DD: function(dateObj) {
        return pad(dateObj.getDate());
      },
      Do: function(dateObj, i18n) {
        return i18n.DoFn(dateObj.getDate());
      },
      d: function(dateObj) {
        return String(dateObj.getDay());
      },
      dd: function(dateObj) {
        return pad(dateObj.getDay());
      },
      ddd: function(dateObj, i18n) {
        return i18n.dayNamesShort[dateObj.getDay()];
      },
      dddd: function(dateObj, i18n) {
        return i18n.dayNames[dateObj.getDay()];
      },
      M: function(dateObj) {
        return String(dateObj.getMonth() + 1);
      },
      MM: function(dateObj) {
        return pad(dateObj.getMonth() + 1);
      },
      MMM: function(dateObj, i18n) {
        return i18n.monthNamesShort[dateObj.getMonth()];
      },
      MMMM: function(dateObj, i18n) {
        return i18n.monthNames[dateObj.getMonth()];
      },
      YY: function(dateObj) {
        return pad(String(dateObj.getFullYear()), 4).substr(2);
      },
      YYYY: function(dateObj) {
        return pad(dateObj.getFullYear(), 4);
      },
      h: function(dateObj) {
        return String(dateObj.getHours() % 12 || 12);
      },
      hh: function(dateObj) {
        return pad(dateObj.getHours() % 12 || 12);
      },
      H: function(dateObj) {
        return String(dateObj.getHours());
      },
      HH: function(dateObj) {
        return pad(dateObj.getHours());
      },
      m: function(dateObj) {
        return String(dateObj.getMinutes());
      },
      mm: function(dateObj) {
        return pad(dateObj.getMinutes());
      },
      s: function(dateObj) {
        return String(dateObj.getSeconds());
      },
      ss: function(dateObj) {
        return pad(dateObj.getSeconds());
      },
      S: function(dateObj) {
        return String(Math.round(dateObj.getMilliseconds() / 100));
      },
      SS: function(dateObj) {
        return pad(Math.round(dateObj.getMilliseconds() / 10), 2);
      },
      SSS: function(dateObj) {
        return pad(dateObj.getMilliseconds(), 3);
      },
      a: function(dateObj, i18n) {
        return dateObj.getHours() < 12 ? i18n.amPm[0] : i18n.amPm[1];
      },
      A: function(dateObj, i18n) {
        return dateObj.getHours() < 12 ? i18n.amPm[0].toUpperCase() : i18n.amPm[1].toUpperCase();
      },
      ZZ: function(dateObj) {
        var offset = dateObj.getTimezoneOffset();
        return (offset > 0 ? "-" : "+") + pad(Math.floor(Math.abs(offset) / 60) * 100 + Math.abs(offset) % 60, 4);
      },
      Z: function(dateObj) {
        var offset = dateObj.getTimezoneOffset();
        return (offset > 0 ? "-" : "+") + pad(Math.floor(Math.abs(offset) / 60), 2) + ":" + pad(Math.abs(offset) % 60, 2);
      }
    };
    var monthParse = function(v) {
      return +v - 1;
    };
    var emptyDigits = [null, twoDigitsOptional];
    var emptyWord = [null, word];
    var amPm = [
      "isPm",
      word,
      function(v, i18n) {
        var val = v.toLowerCase();
        if (val === i18n.amPm[0]) {
          return 0;
        } else if (val === i18n.amPm[1]) {
          return 1;
        }
        return null;
      }
    ];
    var timezoneOffset = [
      "timezoneOffset",
      "[^\\s]*?[\\+\\-]\\d\\d:?\\d\\d|[^\\s]*?Z?",
      function(v) {
        var parts = (v + "").match(/([+-]|\d\d)/gi);
        if (parts) {
          var minutes = +parts[1] * 60 + parseInt(parts[2], 10);
          return parts[0] === "+" ? minutes : -minutes;
        }
        return 0;
      }
    ];
    var parseFlags = {
      D: ["day", twoDigitsOptional],
      DD: ["day", twoDigits],
      Do: ["day", twoDigitsOptional + word, function(v) {
        return parseInt(v, 10);
      }],
      M: ["month", twoDigitsOptional, monthParse],
      MM: ["month", twoDigits, monthParse],
      YY: [
        "year",
        twoDigits,
        function(v) {
          var now = new Date;
          var cent = +("" + now.getFullYear()).substr(0, 2);
          return +("" + (+v > 68 ? cent - 1 : cent) + v);
        }
      ],
      h: ["hour", twoDigitsOptional, undefined, "isPm"],
      hh: ["hour", twoDigits, undefined, "isPm"],
      H: ["hour", twoDigitsOptional],
      HH: ["hour", twoDigits],
      m: ["minute", twoDigitsOptional],
      mm: ["minute", twoDigits],
      s: ["second", twoDigitsOptional],
      ss: ["second", twoDigits],
      YYYY: ["year", fourDigits],
      S: ["millisecond", "\\d", function(v) {
        return +v * 100;
      }],
      SS: ["millisecond", twoDigits, function(v) {
        return +v * 10;
      }],
      SSS: ["millisecond", threeDigits],
      d: emptyDigits,
      dd: emptyDigits,
      ddd: emptyWord,
      dddd: emptyWord,
      MMM: ["month", word, monthUpdate("monthNamesShort")],
      MMMM: ["month", word, monthUpdate("monthNames")],
      a: amPm,
      A: amPm,
      ZZ: timezoneOffset,
      Z: timezoneOffset
    };
    var globalMasks = {
      default: "ddd MMM DD YYYY HH:mm:ss",
      shortDate: "M/D/YY",
      mediumDate: "MMM D, YYYY",
      longDate: "MMMM D, YYYY",
      fullDate: "dddd, MMMM D, YYYY",
      isoDate: "YYYY-MM-DD",
      isoDateTime: "YYYY-MM-DDTHH:mm:ssZ",
      shortTime: "HH:mm",
      mediumTime: "HH:mm:ss",
      longTime: "HH:mm:ss.SSS"
    };
    var setGlobalDateMasks = function(masks) {
      return assign(globalMasks, masks);
    };
    var format = function(dateObj, mask, i18n) {
      if (mask === undefined) {
        mask = globalMasks["default"];
      }
      if (i18n === undefined) {
        i18n = {};
      }
      if (typeof dateObj === "number") {
        dateObj = new Date(dateObj);
      }
      if (Object.prototype.toString.call(dateObj) !== "[object Date]" || isNaN(dateObj.getTime())) {
        throw new Error("Invalid Date pass to format");
      }
      mask = globalMasks[mask] || mask;
      var literals = [];
      mask = mask.replace(literal, function($0, $1) {
        literals.push($1);
        return "@@@";
      });
      var combinedI18nSettings = assign(assign({}, globalI18n), i18n);
      mask = mask.replace(token, function($0) {
        return formatFlags[$0](dateObj, combinedI18nSettings);
      });
      return mask.replace(/@@@/g, function() {
        return literals.shift();
      });
    };
    function parse2(dateStr, format2, i18n) {
      if (i18n === undefined) {
        i18n = {};
      }
      if (typeof format2 !== "string") {
        throw new Error("Invalid format in fecha parse");
      }
      format2 = globalMasks[format2] || format2;
      if (dateStr.length > 1000) {
        return null;
      }
      var today = new Date;
      var dateInfo = {
        year: today.getFullYear(),
        month: 0,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
        isPm: null,
        timezoneOffset: null
      };
      var parseInfo = [];
      var literals = [];
      var newFormat = format2.replace(literal, function($0, $1) {
        literals.push(regexEscape($1));
        return "@@@";
      });
      var specifiedFields = {};
      var requiredFields = {};
      newFormat = regexEscape(newFormat).replace(token, function($0) {
        var info = parseFlags[$0];
        var field2 = info[0], regex = info[1], requiredField = info[3];
        if (specifiedFields[field2]) {
          throw new Error("Invalid format. " + field2 + " specified twice in format");
        }
        specifiedFields[field2] = true;
        if (requiredField) {
          requiredFields[requiredField] = true;
        }
        parseInfo.push(info);
        return "(" + regex + ")";
      });
      Object.keys(requiredFields).forEach(function(field2) {
        if (!specifiedFields[field2]) {
          throw new Error("Invalid format. " + field2 + " is required in specified format");
        }
      });
      newFormat = newFormat.replace(/@@@/g, function() {
        return literals.shift();
      });
      var matches = dateStr.match(new RegExp(newFormat, "i"));
      if (!matches) {
        return null;
      }
      var combinedI18nSettings = assign(assign({}, globalI18n), i18n);
      for (var i = 1;i < matches.length; i++) {
        var _a = parseInfo[i - 1], field = _a[0], parser = _a[2];
        var value = parser ? parser(matches[i], combinedI18nSettings) : +matches[i];
        if (value == null) {
          return null;
        }
        dateInfo[field] = value;
      }
      if (dateInfo.isPm === 1 && dateInfo.hour != null && +dateInfo.hour !== 12) {
        dateInfo.hour = +dateInfo.hour + 12;
      } else if (dateInfo.isPm === 0 && +dateInfo.hour === 12) {
        dateInfo.hour = 0;
      }
      var dateTZ;
      if (dateInfo.timezoneOffset == null) {
        dateTZ = new Date(dateInfo.year, dateInfo.month, dateInfo.day, dateInfo.hour, dateInfo.minute, dateInfo.second, dateInfo.millisecond);
        var validateFields = [
          ["month", "getMonth"],
          ["day", "getDate"],
          ["hour", "getHours"],
          ["minute", "getMinutes"],
          ["second", "getSeconds"]
        ];
        for (var i = 0, len = validateFields.length;i < len; i++) {
          if (specifiedFields[validateFields[i][0]] && dateInfo[validateFields[i][0]] !== dateTZ[validateFields[i][1]]()) {
            return null;
          }
        }
      } else {
        dateTZ = new Date(Date.UTC(dateInfo.year, dateInfo.month, dateInfo.day, dateInfo.hour, dateInfo.minute - dateInfo.timezoneOffset, dateInfo.second, dateInfo.millisecond));
        if (dateInfo.month > 11 || dateInfo.month < 0 || dateInfo.day > 31 || dateInfo.day < 1 || dateInfo.hour > 23 || dateInfo.hour < 0 || dateInfo.minute > 59 || dateInfo.minute < 0 || dateInfo.second > 59 || dateInfo.second < 0) {
          return null;
        }
      }
      return dateTZ;
    }
    var fecha = {
      format,
      parse: parse2,
      defaultI18n,
      setGlobalDateI18n,
      setGlobalDateMasks
    };
    exports2.assign = assign;
    exports2.default = fecha;
    exports2.format = format;
    exports2.parse = parse2;
    exports2.defaultI18n = defaultI18n;
    exports2.setGlobalDateI18n = setGlobalDateI18n;
    exports2.setGlobalDateMasks = setGlobalDateMasks;
    Object.defineProperty(exports2, "__esModule", { value: true });
  });
});

// node_modules/logform/timestamp.js
var require_timestamp = __commonJS((exports, module) => {
  var fecha = require_fecha_umd();
  var format = require_format();
  module.exports = format((info, opts = {}) => {
    if (opts.format) {
      info.timestamp = typeof opts.format === "function" ? opts.format() : fecha.format(new Date, opts.format);
    }
    if (!info.timestamp) {
      info.timestamp = new Date().toISOString();
    }
    if (opts.alias) {
      info[opts.alias] = info.timestamp;
    }
    return info;
  });
});

// node_modules/logform/uncolorize.js
var require_uncolorize = __commonJS((exports, module) => {
  var colors = require_safe();
  var format = require_format();
  var { MESSAGE } = require_triple_beam();
  module.exports = format((info, opts) => {
    if (opts.level !== false) {
      info.level = colors.strip(info.level);
    }
    if (opts.message !== false) {
      info.message = colors.strip(String(info.message));
    }
    if (opts.raw !== false && info[MESSAGE]) {
      info[MESSAGE] = colors.strip(String(info[MESSAGE]));
    }
    return info;
  });
});

// node_modules/logform/index.js
var require_logform = __commonJS((exports) => {
  var format = exports.format = require_format();
  exports.levels = require_levels();
  function exposeFormat(name, requireFormat) {
    Object.defineProperty(format, name, {
      get() {
        return requireFormat();
      },
      configurable: true
    });
  }
  exposeFormat("align", function() {
    return require_align();
  });
  exposeFormat("errors", function() {
    return require_errors();
  });
  exposeFormat("cli", function() {
    return require_cli2();
  });
  exposeFormat("combine", function() {
    return require_combine();
  });
  exposeFormat("colorize", function() {
    return require_colorize();
  });
  exposeFormat("json", function() {
    return require_json();
  });
  exposeFormat("label", function() {
    return require_label();
  });
  exposeFormat("logstash", function() {
    return require_logstash();
  });
  exposeFormat("metadata", function() {
    return require_metadata();
  });
  exposeFormat("ms", function() {
    return require_ms2();
  });
  exposeFormat("padLevels", function() {
    return require_pad_levels();
  });
  exposeFormat("prettyPrint", function() {
    return require_pretty_print();
  });
  exposeFormat("printf", function() {
    return require_printf();
  });
  exposeFormat("simple", function() {
    return require_simple();
  });
  exposeFormat("splat", function() {
    return require_splat();
  });
  exposeFormat("timestamp", function() {
    return require_timestamp();
  });
  exposeFormat("uncolorize", function() {
    return require_uncolorize();
  });
});

// node_modules/winston/lib/winston/common.js
var require_common = __commonJS((exports) => {
  var { format } = __require("util");
  exports.warn = {
    deprecated(prop) {
      return () => {
        throw new Error(format("{ %s } was removed in winston@3.0.0.", prop));
      };
    },
    useFormat(prop) {
      return () => {
        throw new Error([
          format("{ %s } was removed in winston@3.0.0.", prop),
          "Use a custom winston.format = winston.format(function) instead."
        ].join(`
`));
      };
    },
    forFunctions(obj, type, props) {
      props.forEach((prop) => {
        obj[prop] = exports.warn[type](prop);
      });
    },
    forProperties(obj, type, props) {
      props.forEach((prop) => {
        const notice = exports.warn[type](prop);
        Object.defineProperty(obj, prop, {
          get: notice,
          set: notice
        });
      });
    }
  };
});

// node_modules/winston/package.json
var require_package = __commonJS((exports, module) => {
  module.exports = {
    name: "winston",
    description: "A logger for just about everything.",
    version: "3.19.0",
    author: "Charlie Robbins <charlie.robbins@gmail.com>",
    maintainers: [
      "David Hyde <dabh@alumni.stanford.edu>"
    ],
    repository: {
      type: "git",
      url: "https://github.com/winstonjs/winston.git"
    },
    keywords: [
      "winston",
      "logger",
      "logging",
      "logs",
      "sysadmin",
      "bunyan",
      "pino",
      "loglevel",
      "tools",
      "json",
      "stream"
    ],
    dependencies: {
      "@dabh/diagnostics": "^2.0.8",
      "@colors/colors": "^1.6.0",
      async: "^3.2.3",
      "is-stream": "^2.0.0",
      logform: "^2.7.0",
      "one-time": "^1.0.0",
      "readable-stream": "^3.4.0",
      "safe-stable-stringify": "^2.3.1",
      "stack-trace": "0.0.x",
      "triple-beam": "^1.3.0",
      "winston-transport": "^4.9.0"
    },
    devDependencies: {
      "@babel/cli": "^7.23.9",
      "@babel/core": "^7.24.0",
      "@babel/preset-env": "^7.24.0",
      "@dabh/eslint-config-populist": "^4.4.0",
      "@types/node": "^20.11.24",
      "abstract-winston-transport": "^0.5.1",
      assume: "^2.2.0",
      "cross-spawn-async": "^2.2.5",
      eslint: "^8.57.0",
      hock: "^1.4.1",
      jest: "^29.7.0",
      rimraf: "5.0.10",
      split2: "^4.1.0",
      "std-mocks": "^2.0.0",
      through2: "^4.0.2",
      "winston-compat": "^0.1.5"
    },
    main: "./lib/winston.js",
    browser: "./dist/winston",
    types: "./index.d.ts",
    scripts: {
      lint: "eslint lib/*.js lib/winston/*.js lib/winston/**/*.js --resolve-plugins-relative-to ./node_modules/@dabh/eslint-config-populist",
      test: "jest",
      "test:unit": "jest -c test/jest.config.unit.js",
      "test:integration": "jest -c test/jest.config.integration.js",
      "test:typescript": "npx --package typescript tsc --project test",
      build: "babel lib -d dist",
      prebuild: "rimraf dist",
      prepublishOnly: "npm run build"
    },
    engines: {
      node: ">= 12.0.0"
    },
    license: "MIT"
  };
});

// node_modules/util-deprecate/node.js
var require_node = __commonJS((exports, module) => {
  module.exports = __require("util").deprecate;
});

// node_modules/winston-transport/node_modules/readable-stream/lib/internal/streams/destroy.js
var require_destroy = __commonJS((exports, module) => {
  function destroy(err, cb) {
    var _this = this;
    var readableDestroyed = this._readableState && this._readableState.destroyed;
    var writableDestroyed = this._writableState && this._writableState.destroyed;
    if (readableDestroyed || writableDestroyed) {
      if (cb) {
        cb(err);
      } else if (err) {
        if (!this._writableState) {
          process.nextTick(emitErrorNT, this, err);
        } else if (!this._writableState.errorEmitted) {
          this._writableState.errorEmitted = true;
          process.nextTick(emitErrorNT, this, err);
        }
      }
      return this;
    }
    if (this._readableState) {
      this._readableState.destroyed = true;
    }
    if (this._writableState) {
      this._writableState.destroyed = true;
    }
    this._destroy(err || null, function(err2) {
      if (!cb && err2) {
        if (!_this._writableState) {
          process.nextTick(emitErrorAndCloseNT, _this, err2);
        } else if (!_this._writableState.errorEmitted) {
          _this._writableState.errorEmitted = true;
          process.nextTick(emitErrorAndCloseNT, _this, err2);
        } else {
          process.nextTick(emitCloseNT, _this);
        }
      } else if (cb) {
        process.nextTick(emitCloseNT, _this);
        cb(err2);
      } else {
        process.nextTick(emitCloseNT, _this);
      }
    });
    return this;
  }
  function emitErrorAndCloseNT(self2, err) {
    emitErrorNT(self2, err);
    emitCloseNT(self2);
  }
  function emitCloseNT(self2) {
    if (self2._writableState && !self2._writableState.emitClose)
      return;
    if (self2._readableState && !self2._readableState.emitClose)
      return;
    self2.emit("close");
  }
  function undestroy() {
    if (this._readableState) {
      this._readableState.destroyed = false;
      this._readableState.reading = false;
      this._readableState.ended = false;
      this._readableState.endEmitted = false;
    }
    if (this._writableState) {
      this._writableState.destroyed = false;
      this._writableState.ended = false;
      this._writableState.ending = false;
      this._writableState.finalCalled = false;
      this._writableState.prefinished = false;
      this._writableState.finished = false;
      this._writableState.errorEmitted = false;
    }
  }
  function emitErrorNT(self2, err) {
    self2.emit("error", err);
  }
  function errorOrDestroy(stream, err) {
    var rState = stream._readableState;
    var wState = stream._writableState;
    if (rState && rState.autoDestroy || wState && wState.autoDestroy)
      stream.destroy(err);
    else
      stream.emit("error", err);
  }
  module.exports = {
    destroy,
    undestroy,
    errorOrDestroy
  };
});

// node_modules/winston-transport/node_modules/readable-stream/errors.js
var require_errors2 = __commonJS((exports, module) => {
  var codes = {};
  function createErrorType(code, message, Base) {
    if (!Base) {
      Base = Error;
    }
    function getMessage(arg1, arg2, arg3) {
      if (typeof message === "string") {
        return message;
      } else {
        return message(arg1, arg2, arg3);
      }
    }

    class NodeError extends Base {
      constructor(arg1, arg2, arg3) {
        super(getMessage(arg1, arg2, arg3));
      }
    }
    NodeError.prototype.name = Base.name;
    NodeError.prototype.code = code;
    codes[code] = NodeError;
  }
  function oneOf(expected, thing) {
    if (Array.isArray(expected)) {
      const len = expected.length;
      expected = expected.map((i) => String(i));
      if (len > 2) {
        return `one of ${thing} ${expected.slice(0, len - 1).join(", ")}, or ` + expected[len - 1];
      } else if (len === 2) {
        return `one of ${thing} ${expected[0]} or ${expected[1]}`;
      } else {
        return `of ${thing} ${expected[0]}`;
      }
    } else {
      return `of ${thing} ${String(expected)}`;
    }
  }
  function startsWith(str, search, pos) {
    return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
  }
  function endsWith(str, search, this_len) {
    if (this_len === undefined || this_len > str.length) {
      this_len = str.length;
    }
    return str.substring(this_len - search.length, this_len) === search;
  }
  function includes(str, search, start) {
    if (typeof start !== "number") {
      start = 0;
    }
    if (start + search.length > str.length) {
      return false;
    } else {
      return str.indexOf(search, start) !== -1;
    }
  }
  createErrorType("ERR_INVALID_OPT_VALUE", function(name, value) {
    return 'The value "' + value + '" is invalid for option "' + name + '"';
  }, TypeError);
  createErrorType("ERR_INVALID_ARG_TYPE", function(name, expected, actual) {
    let determiner;
    if (typeof expected === "string" && startsWith(expected, "not ")) {
      determiner = "must not be";
      expected = expected.replace(/^not /, "");
    } else {
      determiner = "must be";
    }
    let msg;
    if (endsWith(name, " argument")) {
      msg = `The ${name} ${determiner} ${oneOf(expected, "type")}`;
    } else {
      const type = includes(name, ".") ? "property" : "argument";
      msg = `The "${name}" ${type} ${determiner} ${oneOf(expected, "type")}`;
    }
    msg += `. Received type ${typeof actual}`;
    return msg;
  }, TypeError);
  createErrorType("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF");
  createErrorType("ERR_METHOD_NOT_IMPLEMENTED", function(name) {
    return "The " + name + " method is not implemented";
  });
  createErrorType("ERR_STREAM_PREMATURE_CLOSE", "Premature close");
  createErrorType("ERR_STREAM_DESTROYED", function(name) {
    return "Cannot call " + name + " after a stream was destroyed";
  });
  createErrorType("ERR_MULTIPLE_CALLBACK", "Callback called multiple times");
  createErrorType("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable");
  createErrorType("ERR_STREAM_WRITE_AFTER_END", "write after end");
  createErrorType("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
  createErrorType("ERR_UNKNOWN_ENCODING", function(arg) {
    return "Unknown encoding: " + arg;
  }, TypeError);
  createErrorType("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event");
  exports.codes = codes;
});

// node_modules/winston-transport/node_modules/readable-stream/lib/internal/streams/state.js
var require_state = __commonJS((exports, module) => {
  var ERR_INVALID_OPT_VALUE = require_errors2().codes.ERR_INVALID_OPT_VALUE;
  function highWaterMarkFrom(options, isDuplex, duplexKey) {
    return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
  }
  function getHighWaterMark(state, options, duplexKey, isDuplex) {
    var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
    if (hwm != null) {
      if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
        var name = isDuplex ? duplexKey : "highWaterMark";
        throw new ERR_INVALID_OPT_VALUE(name, hwm);
      }
      return Math.floor(hwm);
    }
    return state.objectMode ? 16 : 16 * 1024;
  }
  module.exports = {
    getHighWaterMark
  };
});

// node_modules/inherits/inherits_browser.js
var require_inherits_browser = __commonJS((exports, module) => {
  if (typeof Object.create === "function") {
    module.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor;
        ctor.prototype = Object.create(superCtor.prototype, {
          constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
          }
        });
      }
    };
  } else {
    module.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor;
        var TempCtor = function() {};
        TempCtor.prototype = superCtor.prototype;
        ctor.prototype = new TempCtor;
        ctor.prototype.constructor = ctor;
      }
    };
  }
});

// node_modules/inherits/inherits.js
var require_inherits = __commonJS((exports, module) => {
  try {
    util = __require("util");
    if (typeof util.inherits !== "function")
      throw "";
    module.exports = util.inherits;
  } catch (e) {
    module.exports = require_inherits_browser();
  }
  var util;
});

// node_modules/winston-transport/node_modules/readable-stream/lib/internal/streams/buffer_list.js
var require_buffer_list = __commonJS((exports, module) => {
  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread(target) {
    for (var i = 1;i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }
  function _defineProperties(target, props) {
    for (var i = 0;i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor)
        descriptor.writable = true;
      Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
    }
  }
  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps)
      _defineProperties(Constructor.prototype, protoProps);
    if (staticProps)
      _defineProperties(Constructor, staticProps);
    Object.defineProperty(Constructor, "prototype", { writable: false });
    return Constructor;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null)
      return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object")
        return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var _require = __require("buffer");
  var Buffer2 = _require.Buffer;
  var _require2 = __require("util");
  var inspect = _require2.inspect;
  var custom = inspect && inspect.custom || "inspect";
  function copyBuffer(src, target, offset) {
    Buffer2.prototype.copy.call(src, target, offset);
  }
  module.exports = /* @__PURE__ */ function() {
    function BufferList() {
      _classCallCheck(this, BufferList);
      this.head = null;
      this.tail = null;
      this.length = 0;
    }
    _createClass(BufferList, [{
      key: "push",
      value: function push(v) {
        var entry = {
          data: v,
          next: null
        };
        if (this.length > 0)
          this.tail.next = entry;
        else
          this.head = entry;
        this.tail = entry;
        ++this.length;
      }
    }, {
      key: "unshift",
      value: function unshift(v) {
        var entry = {
          data: v,
          next: this.head
        };
        if (this.length === 0)
          this.tail = entry;
        this.head = entry;
        ++this.length;
      }
    }, {
      key: "shift",
      value: function shift() {
        if (this.length === 0)
          return;
        var ret = this.head.data;
        if (this.length === 1)
          this.head = this.tail = null;
        else
          this.head = this.head.next;
        --this.length;
        return ret;
      }
    }, {
      key: "clear",
      value: function clear() {
        this.head = this.tail = null;
        this.length = 0;
      }
    }, {
      key: "join",
      value: function join5(s) {
        if (this.length === 0)
          return "";
        var p = this.head;
        var ret = "" + p.data;
        while (p = p.next)
          ret += s + p.data;
        return ret;
      }
    }, {
      key: "concat",
      value: function concat(n) {
        if (this.length === 0)
          return Buffer2.alloc(0);
        var ret = Buffer2.allocUnsafe(n >>> 0);
        var p = this.head;
        var i = 0;
        while (p) {
          copyBuffer(p.data, ret, i);
          i += p.data.length;
          p = p.next;
        }
        return ret;
      }
    }, {
      key: "consume",
      value: function consume(n, hasStrings) {
        var ret;
        if (n < this.head.data.length) {
          ret = this.head.data.slice(0, n);
          this.head.data = this.head.data.slice(n);
        } else if (n === this.head.data.length) {
          ret = this.shift();
        } else {
          ret = hasStrings ? this._getString(n) : this._getBuffer(n);
        }
        return ret;
      }
    }, {
      key: "first",
      value: function first() {
        return this.head.data;
      }
    }, {
      key: "_getString",
      value: function _getString(n) {
        var p = this.head;
        var c = 1;
        var ret = p.data;
        n -= ret.length;
        while (p = p.next) {
          var str = p.data;
          var nb = n > str.length ? str.length : n;
          if (nb === str.length)
            ret += str;
          else
            ret += str.slice(0, n);
          n -= nb;
          if (n === 0) {
            if (nb === str.length) {
              ++c;
              if (p.next)
                this.head = p.next;
              else
                this.head = this.tail = null;
            } else {
              this.head = p;
              p.data = str.slice(nb);
            }
            break;
          }
          ++c;
        }
        this.length -= c;
        return ret;
      }
    }, {
      key: "_getBuffer",
      value: function _getBuffer(n) {
        var ret = Buffer2.allocUnsafe(n);
        var p = this.head;
        var c = 1;
        p.data.copy(ret);
        n -= p.data.length;
        while (p = p.next) {
          var buf = p.data;
          var nb = n > buf.length ? buf.length : n;
          buf.copy(ret, ret.length - n, 0, nb);
          n -= nb;
          if (n === 0) {
            if (nb === buf.length) {
              ++c;
              if (p.next)
                this.head = p.next;
              else
                this.head = this.tail = null;
            } else {
              this.head = p;
              p.data = buf.slice(nb);
            }
            break;
          }
          ++c;
        }
        this.length -= c;
        return ret;
      }
    }, {
      key: custom,
      value: function value(_, options) {
        return inspect(this, _objectSpread(_objectSpread({}, options), {}, {
          depth: 0,
          customInspect: false
        }));
      }
    }]);
    return BufferList;
  }();
});

// node_modules/safe-buffer/index.js
var require_safe_buffer = __commonJS((exports, module) => {
  var buffer = __require("buffer");
  var Buffer2 = buffer.Buffer;
  function copyProps(src, dst) {
    for (var key in src) {
      dst[key] = src[key];
    }
  }
  if (Buffer2.from && Buffer2.alloc && Buffer2.allocUnsafe && Buffer2.allocUnsafeSlow) {
    module.exports = buffer;
  } else {
    copyProps(buffer, exports);
    exports.Buffer = SafeBuffer;
  }
  function SafeBuffer(arg, encodingOrOffset, length) {
    return Buffer2(arg, encodingOrOffset, length);
  }
  copyProps(Buffer2, SafeBuffer);
  SafeBuffer.from = function(arg, encodingOrOffset, length) {
    if (typeof arg === "number") {
      throw new TypeError("Argument must not be a number");
    }
    return Buffer2(arg, encodingOrOffset, length);
  };
  SafeBuffer.alloc = function(size, fill, encoding) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    var buf = Buffer2(size);
    if (fill !== undefined) {
      if (typeof encoding === "string") {
        buf.fill(fill, encoding);
      } else {
        buf.fill(fill);
      }
    } else {
      buf.fill(0);
    }
    return buf;
  };
  SafeBuffer.allocUnsafe = function(size) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    return Buffer2(size);
  };
  SafeBuffer.allocUnsafeSlow = function(size) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    return buffer.SlowBuffer(size);
  };
});

// node_modules/string_decoder/lib/string_decoder.js
var require_string_decoder = __commonJS((exports) => {
  var Buffer2 = require_safe_buffer().Buffer;
  var isEncoding = Buffer2.isEncoding || function(encoding) {
    encoding = "" + encoding;
    switch (encoding && encoding.toLowerCase()) {
      case "hex":
      case "utf8":
      case "utf-8":
      case "ascii":
      case "binary":
      case "base64":
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
      case "raw":
        return true;
      default:
        return false;
    }
  };
  function _normalizeEncoding(enc) {
    if (!enc)
      return "utf8";
    var retried;
    while (true) {
      switch (enc) {
        case "utf8":
        case "utf-8":
          return "utf8";
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return "utf16le";
        case "latin1":
        case "binary":
          return "latin1";
        case "base64":
        case "ascii":
        case "hex":
          return enc;
        default:
          if (retried)
            return;
          enc = ("" + enc).toLowerCase();
          retried = true;
      }
    }
  }
  function normalizeEncoding(enc) {
    var nenc = _normalizeEncoding(enc);
    if (typeof nenc !== "string" && (Buffer2.isEncoding === isEncoding || !isEncoding(enc)))
      throw new Error("Unknown encoding: " + enc);
    return nenc || enc;
  }
  exports.StringDecoder = StringDecoder;
  function StringDecoder(encoding) {
    this.encoding = normalizeEncoding(encoding);
    var nb;
    switch (this.encoding) {
      case "utf16le":
        this.text = utf16Text;
        this.end = utf16End;
        nb = 4;
        break;
      case "utf8":
        this.fillLast = utf8FillLast;
        nb = 4;
        break;
      case "base64":
        this.text = base64Text;
        this.end = base64End;
        nb = 3;
        break;
      default:
        this.write = simpleWrite;
        this.end = simpleEnd;
        return;
    }
    this.lastNeed = 0;
    this.lastTotal = 0;
    this.lastChar = Buffer2.allocUnsafe(nb);
  }
  StringDecoder.prototype.write = function(buf) {
    if (buf.length === 0)
      return "";
    var r;
    var i;
    if (this.lastNeed) {
      r = this.fillLast(buf);
      if (r === undefined)
        return "";
      i = this.lastNeed;
      this.lastNeed = 0;
    } else {
      i = 0;
    }
    if (i < buf.length)
      return r ? r + this.text(buf, i) : this.text(buf, i);
    return r || "";
  };
  StringDecoder.prototype.end = utf8End;
  StringDecoder.prototype.text = utf8Text;
  StringDecoder.prototype.fillLast = function(buf) {
    if (this.lastNeed <= buf.length) {
      buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
      return this.lastChar.toString(this.encoding, 0, this.lastTotal);
    }
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
    this.lastNeed -= buf.length;
  };
  function utf8CheckByte(byte) {
    if (byte <= 127)
      return 0;
    else if (byte >> 5 === 6)
      return 2;
    else if (byte >> 4 === 14)
      return 3;
    else if (byte >> 3 === 30)
      return 4;
    return byte >> 6 === 2 ? -1 : -2;
  }
  function utf8CheckIncomplete(self2, buf, i) {
    var j = buf.length - 1;
    if (j < i)
      return 0;
    var nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0)
        self2.lastNeed = nb - 1;
      return nb;
    }
    if (--j < i || nb === -2)
      return 0;
    nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0)
        self2.lastNeed = nb - 2;
      return nb;
    }
    if (--j < i || nb === -2)
      return 0;
    nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0) {
        if (nb === 2)
          nb = 0;
        else
          self2.lastNeed = nb - 3;
      }
      return nb;
    }
    return 0;
  }
  function utf8CheckExtraBytes(self2, buf, p) {
    if ((buf[0] & 192) !== 128) {
      self2.lastNeed = 0;
      return "\uFFFD";
    }
    if (self2.lastNeed > 1 && buf.length > 1) {
      if ((buf[1] & 192) !== 128) {
        self2.lastNeed = 1;
        return "\uFFFD";
      }
      if (self2.lastNeed > 2 && buf.length > 2) {
        if ((buf[2] & 192) !== 128) {
          self2.lastNeed = 2;
          return "\uFFFD";
        }
      }
    }
  }
  function utf8FillLast(buf) {
    var p = this.lastTotal - this.lastNeed;
    var r = utf8CheckExtraBytes(this, buf, p);
    if (r !== undefined)
      return r;
    if (this.lastNeed <= buf.length) {
      buf.copy(this.lastChar, p, 0, this.lastNeed);
      return this.lastChar.toString(this.encoding, 0, this.lastTotal);
    }
    buf.copy(this.lastChar, p, 0, buf.length);
    this.lastNeed -= buf.length;
  }
  function utf8Text(buf, i) {
    var total = utf8CheckIncomplete(this, buf, i);
    if (!this.lastNeed)
      return buf.toString("utf8", i);
    this.lastTotal = total;
    var end = buf.length - (total - this.lastNeed);
    buf.copy(this.lastChar, 0, end);
    return buf.toString("utf8", i, end);
  }
  function utf8End(buf) {
    var r = buf && buf.length ? this.write(buf) : "";
    if (this.lastNeed)
      return r + "\uFFFD";
    return r;
  }
  function utf16Text(buf, i) {
    if ((buf.length - i) % 2 === 0) {
      var r = buf.toString("utf16le", i);
      if (r) {
        var c = r.charCodeAt(r.length - 1);
        if (c >= 55296 && c <= 56319) {
          this.lastNeed = 2;
          this.lastTotal = 4;
          this.lastChar[0] = buf[buf.length - 2];
          this.lastChar[1] = buf[buf.length - 1];
          return r.slice(0, -1);
        }
      }
      return r;
    }
    this.lastNeed = 1;
    this.lastTotal = 2;
    this.lastChar[0] = buf[buf.length - 1];
    return buf.toString("utf16le", i, buf.length - 1);
  }
  function utf16End(buf) {
    var r = buf && buf.length ? this.write(buf) : "";
    if (this.lastNeed) {
      var end = this.lastTotal - this.lastNeed;
      return r + this.lastChar.toString("utf16le", 0, end);
    }
    return r;
  }
  function base64Text(buf, i) {
    var n = (buf.length - i) % 3;
    if (n === 0)
      return buf.toString("base64", i);
    this.lastNeed = 3 - n;
    this.lastTotal = 3;
    if (n === 1) {
      this.lastChar[0] = buf[buf.length - 1];
    } else {
      this.lastChar[0] = buf[buf.length - 2];
      this.lastChar[1] = buf[buf.length - 1];
    }
    return buf.toString("base64", i, buf.length - n);
  }
  function base64End(buf) {
    var r = buf && buf.length ? this.write(buf) : "";
    if (this.lastNeed)
      return r + this.lastChar.toString("base64", 0, 3 - this.lastNeed);
    return r;
  }
  function simpleWrite(buf) {
    return buf.toString(this.encoding);
  }
  function simpleEnd(buf) {
    return buf && buf.length ? this.write(buf) : "";
  }
});

// node_modules/winston-transport/node_modules/readable-stream/lib/internal/streams/end-of-stream.js
var require_end_of_stream = __commonJS((exports, module) => {
  var ERR_STREAM_PREMATURE_CLOSE = require_errors2().codes.ERR_STREAM_PREMATURE_CLOSE;
  function once(callback) {
    var called = false;
    return function() {
      if (called)
        return;
      called = true;
      for (var _len = arguments.length, args = new Array(_len), _key = 0;_key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      callback.apply(this, args);
    };
  }
  function noop() {}
  function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === "function";
  }
  function eos(stream, opts, callback) {
    if (typeof opts === "function")
      return eos(stream, null, opts);
    if (!opts)
      opts = {};
    callback = once(callback || noop);
    var readable = opts.readable || opts.readable !== false && stream.readable;
    var writable = opts.writable || opts.writable !== false && stream.writable;
    var onlegacyfinish = function onlegacyfinish2() {
      if (!stream.writable)
        onfinish();
    };
    var writableEnded = stream._writableState && stream._writableState.finished;
    var onfinish = function onfinish2() {
      writable = false;
      writableEnded = true;
      if (!readable)
        callback.call(stream);
    };
    var readableEnded = stream._readableState && stream._readableState.endEmitted;
    var onend = function onend2() {
      readable = false;
      readableEnded = true;
      if (!writable)
        callback.call(stream);
    };
    var onerror = function onerror2(err) {
      callback.call(stream, err);
    };
    var onclose = function onclose2() {
      var err;
      if (readable && !readableEnded) {
        if (!stream._readableState || !stream._readableState.ended)
          err = new ERR_STREAM_PREMATURE_CLOSE;
        return callback.call(stream, err);
      }
      if (writable && !writableEnded) {
        if (!stream._writableState || !stream._writableState.ended)
          err = new ERR_STREAM_PREMATURE_CLOSE;
        return callback.call(stream, err);
      }
    };
    var onrequest = function onrequest2() {
      stream.req.on("finish", onfinish);
    };
    if (isRequest(stream)) {
      stream.on("complete", onfinish);
      stream.on("abort", onclose);
      if (stream.req)
        onrequest();
      else
        stream.on("request", onrequest);
    } else if (writable && !stream._writableState) {
      stream.on("end", onlegacyfinish);
      stream.on("close", onlegacyfinish);
    }
    stream.on("end", onend);
    stream.on("finish", onfinish);
    if (opts.error !== false)
      stream.on("error", onerror);
    stream.on("close", onclose);
    return function() {
      stream.removeListener("complete", onfinish);
      stream.removeListener("abort", onclose);
      stream.removeListener("request", onrequest);
      if (stream.req)
        stream.req.removeListener("finish", onfinish);
      stream.removeListener("end", onlegacyfinish);
      stream.removeListener("close", onlegacyfinish);
      stream.removeListener("finish", onfinish);
      stream.removeListener("end", onend);
      stream.removeListener("error", onerror);
      stream.removeListener("close", onclose);
    };
  }
  module.exports = eos;
});

// node_modules/winston-transport/node_modules/readable-stream/lib/internal/streams/async_iterator.js
var require_async_iterator = __commonJS((exports, module) => {
  var _Object$setPrototypeO;
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null)
      return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object")
        return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var finished = require_end_of_stream();
  var kLastResolve = Symbol("lastResolve");
  var kLastReject = Symbol("lastReject");
  var kError = Symbol("error");
  var kEnded = Symbol("ended");
  var kLastPromise = Symbol("lastPromise");
  var kHandlePromise = Symbol("handlePromise");
  var kStream = Symbol("stream");
  function createIterResult(value, done) {
    return {
      value,
      done
    };
  }
  function readAndResolve(iter) {
    var resolve4 = iter[kLastResolve];
    if (resolve4 !== null) {
      var data = iter[kStream].read();
      if (data !== null) {
        iter[kLastPromise] = null;
        iter[kLastResolve] = null;
        iter[kLastReject] = null;
        resolve4(createIterResult(data, false));
      }
    }
  }
  function onReadable(iter) {
    process.nextTick(readAndResolve, iter);
  }
  function wrapForNext(lastPromise, iter) {
    return function(resolve4, reject) {
      lastPromise.then(function() {
        if (iter[kEnded]) {
          resolve4(createIterResult(undefined, true));
          return;
        }
        iter[kHandlePromise](resolve4, reject);
      }, reject);
    };
  }
  var AsyncIteratorPrototype = Object.getPrototypeOf(function() {});
  var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf((_Object$setPrototypeO = {
    get stream() {
      return this[kStream];
    },
    next: function next() {
      var _this = this;
      var error = this[kError];
      if (error !== null) {
        return Promise.reject(error);
      }
      if (this[kEnded]) {
        return Promise.resolve(createIterResult(undefined, true));
      }
      if (this[kStream].destroyed) {
        return new Promise(function(resolve4, reject) {
          process.nextTick(function() {
            if (_this[kError]) {
              reject(_this[kError]);
            } else {
              resolve4(createIterResult(undefined, true));
            }
          });
        });
      }
      var lastPromise = this[kLastPromise];
      var promise;
      if (lastPromise) {
        promise = new Promise(wrapForNext(lastPromise, this));
      } else {
        var data = this[kStream].read();
        if (data !== null) {
          return Promise.resolve(createIterResult(data, false));
        }
        promise = new Promise(this[kHandlePromise]);
      }
      this[kLastPromise] = promise;
      return promise;
    }
  }, _defineProperty(_Object$setPrototypeO, Symbol.asyncIterator, function() {
    return this;
  }), _defineProperty(_Object$setPrototypeO, "return", function _return() {
    var _this2 = this;
    return new Promise(function(resolve4, reject) {
      _this2[kStream].destroy(null, function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve4(createIterResult(undefined, true));
      });
    });
  }), _Object$setPrototypeO), AsyncIteratorPrototype);
  var createReadableStreamAsyncIterator = function createReadableStreamAsyncIterator2(stream) {
    var _Object$create;
    var iterator = Object.create(ReadableStreamAsyncIteratorPrototype, (_Object$create = {}, _defineProperty(_Object$create, kStream, {
      value: stream,
      writable: true
    }), _defineProperty(_Object$create, kLastResolve, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kLastReject, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kError, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kEnded, {
      value: stream._readableState.endEmitted,
      writable: true
    }), _defineProperty(_Object$create, kHandlePromise, {
      value: function value(resolve4, reject) {
        var data = iterator[kStream].read();
        if (data) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          resolve4(createIterResult(data, false));
        } else {
          iterator[kLastResolve] = resolve4;
          iterator[kLastReject] = reject;
        }
      },
      writable: true
    }), _Object$create));
    iterator[kLastPromise] = null;
    finished(stream, function(err) {
      if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        var reject = iterator[kLastReject];
        if (reject !== null) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          reject(err);
        }
        iterator[kError] = err;
        return;
      }
      var resolve4 = iterator[kLastResolve];
      if (resolve4 !== null) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        resolve4(createIterResult(undefined, true));
      }
      iterator[kEnded] = true;
    });
    stream.on("readable", onReadable.bind(null, iterator));
    return iterator;
  };
  module.exports = createReadableStreamAsyncIterator;
});

// node_modules/winston-transport/node_modules/readable-stream/lib/internal/streams/from.js
var require_from = __commonJS((exports, module) => {
  function asyncGeneratorStep(gen, resolve4, reject, _next, _throw, key, arg) {
    try {
      var info = gen[key](arg);
      var value = info.value;
    } catch (error) {
      reject(error);
      return;
    }
    if (info.done) {
      resolve4(value);
    } else {
      Promise.resolve(value).then(_next, _throw);
    }
  }
  function _asyncToGenerator(fn) {
    return function() {
      var self2 = this, args = arguments;
      return new Promise(function(resolve4, reject) {
        var gen = fn.apply(self2, args);
        function _next(value) {
          asyncGeneratorStep(gen, resolve4, reject, _next, _throw, "next", value);
        }
        function _throw(err) {
          asyncGeneratorStep(gen, resolve4, reject, _next, _throw, "throw", err);
        }
        _next(undefined);
      });
    };
  }
  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread(target) {
    for (var i = 1;i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null)
      return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object")
        return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var ERR_INVALID_ARG_TYPE = require_errors2().codes.ERR_INVALID_ARG_TYPE;
  function from(Readable, iterable, opts) {
    var iterator;
    if (iterable && typeof iterable.next === "function") {
      iterator = iterable;
    } else if (iterable && iterable[Symbol.asyncIterator])
      iterator = iterable[Symbol.asyncIterator]();
    else if (iterable && iterable[Symbol.iterator])
      iterator = iterable[Symbol.iterator]();
    else
      throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
    var readable = new Readable(_objectSpread({
      objectMode: true
    }, opts));
    var reading = false;
    readable._read = function() {
      if (!reading) {
        reading = true;
        next();
      }
    };
    function next() {
      return _next2.apply(this, arguments);
    }
    function _next2() {
      _next2 = _asyncToGenerator(function* () {
        try {
          var _yield$iterator$next = yield iterator.next(), value = _yield$iterator$next.value, done = _yield$iterator$next.done;
          if (done) {
            readable.push(null);
          } else if (readable.push(yield value)) {
            next();
          } else {
            reading = false;
          }
        } catch (err) {
          readable.destroy(err);
        }
      });
      return _next2.apply(this, arguments);
    }
    return readable;
  }
  module.exports = from;
});

// node_modules/winston-transport/node_modules/readable-stream/lib/_stream_readable.js
var require__stream_readable = __commonJS((exports, module) => {
  module.exports = Readable;
  var Duplex;
  Readable.ReadableState = ReadableState;
  var EE = __require("events").EventEmitter;
  var EElistenerCount = function EElistenerCount2(emitter, type) {
    return emitter.listeners(type).length;
  };
  var Stream = __require("stream");
  var Buffer2 = __require("buffer").Buffer;
  var OurUint8Array = (typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {}).Uint8Array || function() {};
  function _uint8ArrayToBuffer(chunk) {
    return Buffer2.from(chunk);
  }
  function _isUint8Array(obj) {
    return Buffer2.isBuffer(obj) || obj instanceof OurUint8Array;
  }
  var debugUtil = __require("util");
  var debug;
  if (debugUtil && debugUtil.debuglog) {
    debug = debugUtil.debuglog("stream");
  } else {
    debug = function debug2() {};
  }
  var BufferList = require_buffer_list();
  var destroyImpl = require_destroy();
  var _require = require_state();
  var getHighWaterMark = _require.getHighWaterMark;
  var _require$codes = require_errors2().codes;
  var ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE;
  var ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF;
  var ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED;
  var ERR_STREAM_UNSHIFT_AFTER_END_EVENT = _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT;
  var StringDecoder;
  var createReadableStreamAsyncIterator;
  var from;
  require_inherits()(Readable, Stream);
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  var kProxyEvents = ["error", "close", "destroy", "pause", "resume"];
  function prependListener(emitter, event, fn) {
    if (typeof emitter.prependListener === "function")
      return emitter.prependListener(event, fn);
    if (!emitter._events || !emitter._events[event])
      emitter.on(event, fn);
    else if (Array.isArray(emitter._events[event]))
      emitter._events[event].unshift(fn);
    else
      emitter._events[event] = [fn, emitter._events[event]];
  }
  function ReadableState(options, stream, isDuplex) {
    Duplex = Duplex || require__stream_duplex();
    options = options || {};
    if (typeof isDuplex !== "boolean")
      isDuplex = stream instanceof Duplex;
    this.objectMode = !!options.objectMode;
    if (isDuplex)
      this.objectMode = this.objectMode || !!options.readableObjectMode;
    this.highWaterMark = getHighWaterMark(this, options, "readableHighWaterMark", isDuplex);
    this.buffer = new BufferList;
    this.length = 0;
    this.pipes = null;
    this.pipesCount = 0;
    this.flowing = null;
    this.ended = false;
    this.endEmitted = false;
    this.reading = false;
    this.sync = true;
    this.needReadable = false;
    this.emittedReadable = false;
    this.readableListening = false;
    this.resumeScheduled = false;
    this.paused = true;
    this.emitClose = options.emitClose !== false;
    this.autoDestroy = !!options.autoDestroy;
    this.destroyed = false;
    this.defaultEncoding = options.defaultEncoding || "utf8";
    this.awaitDrain = 0;
    this.readingMore = false;
    this.decoder = null;
    this.encoding = null;
    if (options.encoding) {
      if (!StringDecoder)
        StringDecoder = require_string_decoder().StringDecoder;
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }
  }
  function Readable(options) {
    Duplex = Duplex || require__stream_duplex();
    if (!(this instanceof Readable))
      return new Readable(options);
    var isDuplex = this instanceof Duplex;
    this._readableState = new ReadableState(options, this, isDuplex);
    this.readable = true;
    if (options) {
      if (typeof options.read === "function")
        this._read = options.read;
      if (typeof options.destroy === "function")
        this._destroy = options.destroy;
    }
    Stream.call(this);
  }
  Object.defineProperty(Readable.prototype, "destroyed", {
    enumerable: false,
    get: function get() {
      if (this._readableState === undefined) {
        return false;
      }
      return this._readableState.destroyed;
    },
    set: function set(value) {
      if (!this._readableState) {
        return;
      }
      this._readableState.destroyed = value;
    }
  });
  Readable.prototype.destroy = destroyImpl.destroy;
  Readable.prototype._undestroy = destroyImpl.undestroy;
  Readable.prototype._destroy = function(err, cb) {
    cb(err);
  };
  Readable.prototype.push = function(chunk, encoding) {
    var state = this._readableState;
    var skipChunkCheck;
    if (!state.objectMode) {
      if (typeof chunk === "string") {
        encoding = encoding || state.defaultEncoding;
        if (encoding !== state.encoding) {
          chunk = Buffer2.from(chunk, encoding);
          encoding = "";
        }
        skipChunkCheck = true;
      }
    } else {
      skipChunkCheck = true;
    }
    return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
  };
  Readable.prototype.unshift = function(chunk) {
    return readableAddChunk(this, chunk, null, true, false);
  };
  function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
    debug("readableAddChunk", chunk);
    var state = stream._readableState;
    if (chunk === null) {
      state.reading = false;
      onEofChunk(stream, state);
    } else {
      var er;
      if (!skipChunkCheck)
        er = chunkInvalid(state, chunk);
      if (er) {
        errorOrDestroy(stream, er);
      } else if (state.objectMode || chunk && chunk.length > 0) {
        if (typeof chunk !== "string" && !state.objectMode && Object.getPrototypeOf(chunk) !== Buffer2.prototype) {
          chunk = _uint8ArrayToBuffer(chunk);
        }
        if (addToFront) {
          if (state.endEmitted)
            errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT);
          else
            addChunk(stream, state, chunk, true);
        } else if (state.ended) {
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF);
        } else if (state.destroyed) {
          return false;
        } else {
          state.reading = false;
          if (state.decoder && !encoding) {
            chunk = state.decoder.write(chunk);
            if (state.objectMode || chunk.length !== 0)
              addChunk(stream, state, chunk, false);
            else
              maybeReadMore(stream, state);
          } else {
            addChunk(stream, state, chunk, false);
          }
        }
      } else if (!addToFront) {
        state.reading = false;
        maybeReadMore(stream, state);
      }
    }
    return !state.ended && (state.length < state.highWaterMark || state.length === 0);
  }
  function addChunk(stream, state, chunk, addToFront) {
    if (state.flowing && state.length === 0 && !state.sync) {
      state.awaitDrain = 0;
      stream.emit("data", chunk);
    } else {
      state.length += state.objectMode ? 1 : chunk.length;
      if (addToFront)
        state.buffer.unshift(chunk);
      else
        state.buffer.push(chunk);
      if (state.needReadable)
        emitReadable(stream);
    }
    maybeReadMore(stream, state);
  }
  function chunkInvalid(state, chunk) {
    var er;
    if (!_isUint8Array(chunk) && typeof chunk !== "string" && chunk !== undefined && !state.objectMode) {
      er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
    }
    return er;
  }
  Readable.prototype.isPaused = function() {
    return this._readableState.flowing === false;
  };
  Readable.prototype.setEncoding = function(enc) {
    if (!StringDecoder)
      StringDecoder = require_string_decoder().StringDecoder;
    var decoder = new StringDecoder(enc);
    this._readableState.decoder = decoder;
    this._readableState.encoding = this._readableState.decoder.encoding;
    var p = this._readableState.buffer.head;
    var content = "";
    while (p !== null) {
      content += decoder.write(p.data);
      p = p.next;
    }
    this._readableState.buffer.clear();
    if (content !== "")
      this._readableState.buffer.push(content);
    this._readableState.length = content.length;
    return this;
  };
  var MAX_HWM = 1073741824;
  function computeNewHighWaterMark(n) {
    if (n >= MAX_HWM) {
      n = MAX_HWM;
    } else {
      n--;
      n |= n >>> 1;
      n |= n >>> 2;
      n |= n >>> 4;
      n |= n >>> 8;
      n |= n >>> 16;
      n++;
    }
    return n;
  }
  function howMuchToRead(n, state) {
    if (n <= 0 || state.length === 0 && state.ended)
      return 0;
    if (state.objectMode)
      return 1;
    if (n !== n) {
      if (state.flowing && state.length)
        return state.buffer.head.data.length;
      else
        return state.length;
    }
    if (n > state.highWaterMark)
      state.highWaterMark = computeNewHighWaterMark(n);
    if (n <= state.length)
      return n;
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    }
    return state.length;
  }
  Readable.prototype.read = function(n) {
    debug("read", n);
    n = parseInt(n, 10);
    var state = this._readableState;
    var nOrig = n;
    if (n !== 0)
      state.emittedReadable = false;
    if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
      debug("read: emitReadable", state.length, state.ended);
      if (state.length === 0 && state.ended)
        endReadable(this);
      else
        emitReadable(this);
      return null;
    }
    n = howMuchToRead(n, state);
    if (n === 0 && state.ended) {
      if (state.length === 0)
        endReadable(this);
      return null;
    }
    var doRead = state.needReadable;
    debug("need readable", doRead);
    if (state.length === 0 || state.length - n < state.highWaterMark) {
      doRead = true;
      debug("length less than watermark", doRead);
    }
    if (state.ended || state.reading) {
      doRead = false;
      debug("reading or ended", doRead);
    } else if (doRead) {
      debug("do read");
      state.reading = true;
      state.sync = true;
      if (state.length === 0)
        state.needReadable = true;
      this._read(state.highWaterMark);
      state.sync = false;
      if (!state.reading)
        n = howMuchToRead(nOrig, state);
    }
    var ret;
    if (n > 0)
      ret = fromList(n, state);
    else
      ret = null;
    if (ret === null) {
      state.needReadable = state.length <= state.highWaterMark;
      n = 0;
    } else {
      state.length -= n;
      state.awaitDrain = 0;
    }
    if (state.length === 0) {
      if (!state.ended)
        state.needReadable = true;
      if (nOrig !== n && state.ended)
        endReadable(this);
    }
    if (ret !== null)
      this.emit("data", ret);
    return ret;
  };
  function onEofChunk(stream, state) {
    debug("onEofChunk");
    if (state.ended)
      return;
    if (state.decoder) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) {
        state.buffer.push(chunk);
        state.length += state.objectMode ? 1 : chunk.length;
      }
    }
    state.ended = true;
    if (state.sync) {
      emitReadable(stream);
    } else {
      state.needReadable = false;
      if (!state.emittedReadable) {
        state.emittedReadable = true;
        emitReadable_(stream);
      }
    }
  }
  function emitReadable(stream) {
    var state = stream._readableState;
    debug("emitReadable", state.needReadable, state.emittedReadable);
    state.needReadable = false;
    if (!state.emittedReadable) {
      debug("emitReadable", state.flowing);
      state.emittedReadable = true;
      process.nextTick(emitReadable_, stream);
    }
  }
  function emitReadable_(stream) {
    var state = stream._readableState;
    debug("emitReadable_", state.destroyed, state.length, state.ended);
    if (!state.destroyed && (state.length || state.ended)) {
      stream.emit("readable");
      state.emittedReadable = false;
    }
    state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
    flow(stream);
  }
  function maybeReadMore(stream, state) {
    if (!state.readingMore) {
      state.readingMore = true;
      process.nextTick(maybeReadMore_, stream, state);
    }
  }
  function maybeReadMore_(stream, state) {
    while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
      var len = state.length;
      debug("maybeReadMore read 0");
      stream.read(0);
      if (len === state.length)
        break;
    }
    state.readingMore = false;
  }
  Readable.prototype._read = function(n) {
    errorOrDestroy(this, new ERR_METHOD_NOT_IMPLEMENTED("_read()"));
  };
  Readable.prototype.pipe = function(dest, pipeOpts) {
    var src = this;
    var state = this._readableState;
    switch (state.pipesCount) {
      case 0:
        state.pipes = dest;
        break;
      case 1:
        state.pipes = [state.pipes, dest];
        break;
      default:
        state.pipes.push(dest);
        break;
    }
    state.pipesCount += 1;
    debug("pipe count=%d opts=%j", state.pipesCount, pipeOpts);
    var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
    var endFn = doEnd ? onend : unpipe;
    if (state.endEmitted)
      process.nextTick(endFn);
    else
      src.once("end", endFn);
    dest.on("unpipe", onunpipe);
    function onunpipe(readable, unpipeInfo) {
      debug("onunpipe");
      if (readable === src) {
        if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
          unpipeInfo.hasUnpiped = true;
          cleanup();
        }
      }
    }
    function onend() {
      debug("onend");
      dest.end();
    }
    var ondrain = pipeOnDrain(src);
    dest.on("drain", ondrain);
    var cleanedUp = false;
    function cleanup() {
      debug("cleanup");
      dest.removeListener("close", onclose);
      dest.removeListener("finish", onfinish);
      dest.removeListener("drain", ondrain);
      dest.removeListener("error", onerror);
      dest.removeListener("unpipe", onunpipe);
      src.removeListener("end", onend);
      src.removeListener("end", unpipe);
      src.removeListener("data", ondata);
      cleanedUp = true;
      if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain))
        ondrain();
    }
    src.on("data", ondata);
    function ondata(chunk) {
      debug("ondata");
      var ret = dest.write(chunk);
      debug("dest.write", ret);
      if (ret === false) {
        if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
          debug("false write response, pause", state.awaitDrain);
          state.awaitDrain++;
        }
        src.pause();
      }
    }
    function onerror(er) {
      debug("onerror", er);
      unpipe();
      dest.removeListener("error", onerror);
      if (EElistenerCount(dest, "error") === 0)
        errorOrDestroy(dest, er);
    }
    prependListener(dest, "error", onerror);
    function onclose() {
      dest.removeListener("finish", onfinish);
      unpipe();
    }
    dest.once("close", onclose);
    function onfinish() {
      debug("onfinish");
      dest.removeListener("close", onclose);
      unpipe();
    }
    dest.once("finish", onfinish);
    function unpipe() {
      debug("unpipe");
      src.unpipe(dest);
    }
    dest.emit("pipe", src);
    if (!state.flowing) {
      debug("pipe resume");
      src.resume();
    }
    return dest;
  };
  function pipeOnDrain(src) {
    return function pipeOnDrainFunctionResult() {
      var state = src._readableState;
      debug("pipeOnDrain", state.awaitDrain);
      if (state.awaitDrain)
        state.awaitDrain--;
      if (state.awaitDrain === 0 && EElistenerCount(src, "data")) {
        state.flowing = true;
        flow(src);
      }
    };
  }
  Readable.prototype.unpipe = function(dest) {
    var state = this._readableState;
    var unpipeInfo = {
      hasUnpiped: false
    };
    if (state.pipesCount === 0)
      return this;
    if (state.pipesCount === 1) {
      if (dest && dest !== state.pipes)
        return this;
      if (!dest)
        dest = state.pipes;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      if (dest)
        dest.emit("unpipe", this, unpipeInfo);
      return this;
    }
    if (!dest) {
      var dests = state.pipes;
      var len = state.pipesCount;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      for (var i = 0;i < len; i++)
        dests[i].emit("unpipe", this, {
          hasUnpiped: false
        });
      return this;
    }
    var index = indexOf(state.pipes, dest);
    if (index === -1)
      return this;
    state.pipes.splice(index, 1);
    state.pipesCount -= 1;
    if (state.pipesCount === 1)
      state.pipes = state.pipes[0];
    dest.emit("unpipe", this, unpipeInfo);
    return this;
  };
  Readable.prototype.on = function(ev, fn) {
    var res = Stream.prototype.on.call(this, ev, fn);
    var state = this._readableState;
    if (ev === "data") {
      state.readableListening = this.listenerCount("readable") > 0;
      if (state.flowing !== false)
        this.resume();
    } else if (ev === "readable") {
      if (!state.endEmitted && !state.readableListening) {
        state.readableListening = state.needReadable = true;
        state.flowing = false;
        state.emittedReadable = false;
        debug("on readable", state.length, state.reading);
        if (state.length) {
          emitReadable(this);
        } else if (!state.reading) {
          process.nextTick(nReadingNextTick, this);
        }
      }
    }
    return res;
  };
  Readable.prototype.addListener = Readable.prototype.on;
  Readable.prototype.removeListener = function(ev, fn) {
    var res = Stream.prototype.removeListener.call(this, ev, fn);
    if (ev === "readable") {
      process.nextTick(updateReadableListening, this);
    }
    return res;
  };
  Readable.prototype.removeAllListeners = function(ev) {
    var res = Stream.prototype.removeAllListeners.apply(this, arguments);
    if (ev === "readable" || ev === undefined) {
      process.nextTick(updateReadableListening, this);
    }
    return res;
  };
  function updateReadableListening(self2) {
    var state = self2._readableState;
    state.readableListening = self2.listenerCount("readable") > 0;
    if (state.resumeScheduled && !state.paused) {
      state.flowing = true;
    } else if (self2.listenerCount("data") > 0) {
      self2.resume();
    }
  }
  function nReadingNextTick(self2) {
    debug("readable nexttick read 0");
    self2.read(0);
  }
  Readable.prototype.resume = function() {
    var state = this._readableState;
    if (!state.flowing) {
      debug("resume");
      state.flowing = !state.readableListening;
      resume(this, state);
    }
    state.paused = false;
    return this;
  };
  function resume(stream, state) {
    if (!state.resumeScheduled) {
      state.resumeScheduled = true;
      process.nextTick(resume_, stream, state);
    }
  }
  function resume_(stream, state) {
    debug("resume", state.reading);
    if (!state.reading) {
      stream.read(0);
    }
    state.resumeScheduled = false;
    stream.emit("resume");
    flow(stream);
    if (state.flowing && !state.reading)
      stream.read(0);
  }
  Readable.prototype.pause = function() {
    debug("call pause flowing=%j", this._readableState.flowing);
    if (this._readableState.flowing !== false) {
      debug("pause");
      this._readableState.flowing = false;
      this.emit("pause");
    }
    this._readableState.paused = true;
    return this;
  };
  function flow(stream) {
    var state = stream._readableState;
    debug("flow", state.flowing);
    while (state.flowing && stream.read() !== null)
      ;
  }
  Readable.prototype.wrap = function(stream) {
    var _this = this;
    var state = this._readableState;
    var paused = false;
    stream.on("end", function() {
      debug("wrapped end");
      if (state.decoder && !state.ended) {
        var chunk = state.decoder.end();
        if (chunk && chunk.length)
          _this.push(chunk);
      }
      _this.push(null);
    });
    stream.on("data", function(chunk) {
      debug("wrapped data");
      if (state.decoder)
        chunk = state.decoder.write(chunk);
      if (state.objectMode && (chunk === null || chunk === undefined))
        return;
      else if (!state.objectMode && (!chunk || !chunk.length))
        return;
      var ret = _this.push(chunk);
      if (!ret) {
        paused = true;
        stream.pause();
      }
    });
    for (var i in stream) {
      if (this[i] === undefined && typeof stream[i] === "function") {
        this[i] = function methodWrap(method) {
          return function methodWrapReturnFunction() {
            return stream[method].apply(stream, arguments);
          };
        }(i);
      }
    }
    for (var n = 0;n < kProxyEvents.length; n++) {
      stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
    }
    this._read = function(n2) {
      debug("wrapped _read", n2);
      if (paused) {
        paused = false;
        stream.resume();
      }
    };
    return this;
  };
  if (typeof Symbol === "function") {
    Readable.prototype[Symbol.asyncIterator] = function() {
      if (createReadableStreamAsyncIterator === undefined) {
        createReadableStreamAsyncIterator = require_async_iterator();
      }
      return createReadableStreamAsyncIterator(this);
    };
  }
  Object.defineProperty(Readable.prototype, "readableHighWaterMark", {
    enumerable: false,
    get: function get() {
      return this._readableState.highWaterMark;
    }
  });
  Object.defineProperty(Readable.prototype, "readableBuffer", {
    enumerable: false,
    get: function get() {
      return this._readableState && this._readableState.buffer;
    }
  });
  Object.defineProperty(Readable.prototype, "readableFlowing", {
    enumerable: false,
    get: function get() {
      return this._readableState.flowing;
    },
    set: function set(state) {
      if (this._readableState) {
        this._readableState.flowing = state;
      }
    }
  });
  Readable._fromList = fromList;
  Object.defineProperty(Readable.prototype, "readableLength", {
    enumerable: false,
    get: function get() {
      return this._readableState.length;
    }
  });
  function fromList(n, state) {
    if (state.length === 0)
      return null;
    var ret;
    if (state.objectMode)
      ret = state.buffer.shift();
    else if (!n || n >= state.length) {
      if (state.decoder)
        ret = state.buffer.join("");
      else if (state.buffer.length === 1)
        ret = state.buffer.first();
      else
        ret = state.buffer.concat(state.length);
      state.buffer.clear();
    } else {
      ret = state.buffer.consume(n, state.decoder);
    }
    return ret;
  }
  function endReadable(stream) {
    var state = stream._readableState;
    debug("endReadable", state.endEmitted);
    if (!state.endEmitted) {
      state.ended = true;
      process.nextTick(endReadableNT, state, stream);
    }
  }
  function endReadableNT(state, stream) {
    debug("endReadableNT", state.endEmitted, state.length);
    if (!state.endEmitted && state.length === 0) {
      state.endEmitted = true;
      stream.readable = false;
      stream.emit("end");
      if (state.autoDestroy) {
        var wState = stream._writableState;
        if (!wState || wState.autoDestroy && wState.finished) {
          stream.destroy();
        }
      }
    }
  }
  if (typeof Symbol === "function") {
    Readable.from = function(iterable, opts) {
      if (from === undefined) {
        from = require_from();
      }
      return from(Readable, iterable, opts);
    };
  }
  function indexOf(xs, x) {
    for (var i = 0, l = xs.length;i < l; i++) {
      if (xs[i] === x)
        return i;
    }
    return -1;
  }
});

// node_modules/winston-transport/node_modules/readable-stream/lib/_stream_duplex.js
var require__stream_duplex = __commonJS((exports, module) => {
  var objectKeys = Object.keys || function(obj) {
    var keys2 = [];
    for (var key in obj)
      keys2.push(key);
    return keys2;
  };
  module.exports = Duplex;
  var Readable = require__stream_readable();
  var Writable = require__stream_writable();
  require_inherits()(Duplex, Readable);
  {
    keys = objectKeys(Writable.prototype);
    for (v = 0;v < keys.length; v++) {
      method = keys[v];
      if (!Duplex.prototype[method])
        Duplex.prototype[method] = Writable.prototype[method];
    }
  }
  var keys;
  var method;
  var v;
  function Duplex(options) {
    if (!(this instanceof Duplex))
      return new Duplex(options);
    Readable.call(this, options);
    Writable.call(this, options);
    this.allowHalfOpen = true;
    if (options) {
      if (options.readable === false)
        this.readable = false;
      if (options.writable === false)
        this.writable = false;
      if (options.allowHalfOpen === false) {
        this.allowHalfOpen = false;
        this.once("end", onend);
      }
    }
  }
  Object.defineProperty(Duplex.prototype, "writableHighWaterMark", {
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    }
  });
  Object.defineProperty(Duplex.prototype, "writableBuffer", {
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    }
  });
  Object.defineProperty(Duplex.prototype, "writableLength", {
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    }
  });
  function onend() {
    if (this._writableState.ended)
      return;
    process.nextTick(onEndNT, this);
  }
  function onEndNT(self2) {
    self2.end();
  }
  Object.defineProperty(Duplex.prototype, "destroyed", {
    enumerable: false,
    get: function get() {
      if (this._readableState === undefined || this._writableState === undefined) {
        return false;
      }
      return this._readableState.destroyed && this._writableState.destroyed;
    },
    set: function set(value) {
      if (this._readableState === undefined || this._writableState === undefined) {
        return;
      }
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    }
  });
});

// node_modules/winston-transport/node_modules/readable-stream/lib/_stream_writable.js
var require__stream_writable = __commonJS((exports, module) => {
  module.exports = Writable;
  function CorkedRequest(state) {
    var _this = this;
    this.next = null;
    this.entry = null;
    this.finish = function() {
      onCorkedFinish(_this, state);
    };
  }
  var Duplex;
  Writable.WritableState = WritableState;
  var internalUtil = {
    deprecate: require_node()
  };
  var Stream = __require("stream");
  var Buffer2 = __require("buffer").Buffer;
  var OurUint8Array = (typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {}).Uint8Array || function() {};
  function _uint8ArrayToBuffer(chunk) {
    return Buffer2.from(chunk);
  }
  function _isUint8Array(obj) {
    return Buffer2.isBuffer(obj) || obj instanceof OurUint8Array;
  }
  var destroyImpl = require_destroy();
  var _require = require_state();
  var getHighWaterMark = _require.getHighWaterMark;
  var _require$codes = require_errors2().codes;
  var ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE;
  var ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED;
  var ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK;
  var ERR_STREAM_CANNOT_PIPE = _require$codes.ERR_STREAM_CANNOT_PIPE;
  var ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;
  var ERR_STREAM_NULL_VALUES = _require$codes.ERR_STREAM_NULL_VALUES;
  var ERR_STREAM_WRITE_AFTER_END = _require$codes.ERR_STREAM_WRITE_AFTER_END;
  var ERR_UNKNOWN_ENCODING = _require$codes.ERR_UNKNOWN_ENCODING;
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  require_inherits()(Writable, Stream);
  function nop() {}
  function WritableState(options, stream, isDuplex) {
    Duplex = Duplex || require__stream_duplex();
    options = options || {};
    if (typeof isDuplex !== "boolean")
      isDuplex = stream instanceof Duplex;
    this.objectMode = !!options.objectMode;
    if (isDuplex)
      this.objectMode = this.objectMode || !!options.writableObjectMode;
    this.highWaterMark = getHighWaterMark(this, options, "writableHighWaterMark", isDuplex);
    this.finalCalled = false;
    this.needDrain = false;
    this.ending = false;
    this.ended = false;
    this.finished = false;
    this.destroyed = false;
    var noDecode = options.decodeStrings === false;
    this.decodeStrings = !noDecode;
    this.defaultEncoding = options.defaultEncoding || "utf8";
    this.length = 0;
    this.writing = false;
    this.corked = 0;
    this.sync = true;
    this.bufferProcessing = false;
    this.onwrite = function(er) {
      onwrite(stream, er);
    };
    this.writecb = null;
    this.writelen = 0;
    this.bufferedRequest = null;
    this.lastBufferedRequest = null;
    this.pendingcb = 0;
    this.prefinished = false;
    this.errorEmitted = false;
    this.emitClose = options.emitClose !== false;
    this.autoDestroy = !!options.autoDestroy;
    this.bufferedRequestCount = 0;
    this.corkedRequestsFree = new CorkedRequest(this);
  }
  WritableState.prototype.getBuffer = function getBuffer() {
    var current = this.bufferedRequest;
    var out = [];
    while (current) {
      out.push(current);
      current = current.next;
    }
    return out;
  };
  (function() {
    try {
      Object.defineProperty(WritableState.prototype, "buffer", {
        get: internalUtil.deprecate(function writableStateBufferGetter() {
          return this.getBuffer();
        }, "_writableState.buffer is deprecated. Use _writableState.getBuffer " + "instead.", "DEP0003")
      });
    } catch (_) {}
  })();
  var realHasInstance;
  if (typeof Symbol === "function" && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === "function") {
    realHasInstance = Function.prototype[Symbol.hasInstance];
    Object.defineProperty(Writable, Symbol.hasInstance, {
      value: function value(object) {
        if (realHasInstance.call(this, object))
          return true;
        if (this !== Writable)
          return false;
        return object && object._writableState instanceof WritableState;
      }
    });
  } else {
    realHasInstance = function realHasInstance2(object) {
      return object instanceof this;
    };
  }
  function Writable(options) {
    Duplex = Duplex || require__stream_duplex();
    var isDuplex = this instanceof Duplex;
    if (!isDuplex && !realHasInstance.call(Writable, this))
      return new Writable(options);
    this._writableState = new WritableState(options, this, isDuplex);
    this.writable = true;
    if (options) {
      if (typeof options.write === "function")
        this._write = options.write;
      if (typeof options.writev === "function")
        this._writev = options.writev;
      if (typeof options.destroy === "function")
        this._destroy = options.destroy;
      if (typeof options.final === "function")
        this._final = options.final;
    }
    Stream.call(this);
  }
  Writable.prototype.pipe = function() {
    errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE);
  };
  function writeAfterEnd(stream, cb) {
    var er = new ERR_STREAM_WRITE_AFTER_END;
    errorOrDestroy(stream, er);
    process.nextTick(cb, er);
  }
  function validChunk(stream, state, chunk, cb) {
    var er;
    if (chunk === null) {
      er = new ERR_STREAM_NULL_VALUES;
    } else if (typeof chunk !== "string" && !state.objectMode) {
      er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer"], chunk);
    }
    if (er) {
      errorOrDestroy(stream, er);
      process.nextTick(cb, er);
      return false;
    }
    return true;
  }
  Writable.prototype.write = function(chunk, encoding, cb) {
    var state = this._writableState;
    var ret = false;
    var isBuf = !state.objectMode && _isUint8Array(chunk);
    if (isBuf && !Buffer2.isBuffer(chunk)) {
      chunk = _uint8ArrayToBuffer(chunk);
    }
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (isBuf)
      encoding = "buffer";
    else if (!encoding)
      encoding = state.defaultEncoding;
    if (typeof cb !== "function")
      cb = nop;
    if (state.ending)
      writeAfterEnd(this, cb);
    else if (isBuf || validChunk(this, state, chunk, cb)) {
      state.pendingcb++;
      ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
    }
    return ret;
  };
  Writable.prototype.cork = function() {
    this._writableState.corked++;
  };
  Writable.prototype.uncork = function() {
    var state = this._writableState;
    if (state.corked) {
      state.corked--;
      if (!state.writing && !state.corked && !state.bufferProcessing && state.bufferedRequest)
        clearBuffer(this, state);
    }
  };
  Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
    if (typeof encoding === "string")
      encoding = encoding.toLowerCase();
    if (!(["hex", "utf8", "utf-8", "ascii", "binary", "base64", "ucs2", "ucs-2", "utf16le", "utf-16le", "raw"].indexOf((encoding + "").toLowerCase()) > -1))
      throw new ERR_UNKNOWN_ENCODING(encoding);
    this._writableState.defaultEncoding = encoding;
    return this;
  };
  Object.defineProperty(Writable.prototype, "writableBuffer", {
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    }
  });
  function decodeChunk(state, chunk, encoding) {
    if (!state.objectMode && state.decodeStrings !== false && typeof chunk === "string") {
      chunk = Buffer2.from(chunk, encoding);
    }
    return chunk;
  }
  Object.defineProperty(Writable.prototype, "writableHighWaterMark", {
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    }
  });
  function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
    if (!isBuf) {
      var newChunk = decodeChunk(state, chunk, encoding);
      if (chunk !== newChunk) {
        isBuf = true;
        encoding = "buffer";
        chunk = newChunk;
      }
    }
    var len = state.objectMode ? 1 : chunk.length;
    state.length += len;
    var ret = state.length < state.highWaterMark;
    if (!ret)
      state.needDrain = true;
    if (state.writing || state.corked) {
      var last = state.lastBufferedRequest;
      state.lastBufferedRequest = {
        chunk,
        encoding,
        isBuf,
        callback: cb,
        next: null
      };
      if (last) {
        last.next = state.lastBufferedRequest;
      } else {
        state.bufferedRequest = state.lastBufferedRequest;
      }
      state.bufferedRequestCount += 1;
    } else {
      doWrite(stream, state, false, len, chunk, encoding, cb);
    }
    return ret;
  }
  function doWrite(stream, state, writev, len, chunk, encoding, cb) {
    state.writelen = len;
    state.writecb = cb;
    state.writing = true;
    state.sync = true;
    if (state.destroyed)
      state.onwrite(new ERR_STREAM_DESTROYED("write"));
    else if (writev)
      stream._writev(chunk, state.onwrite);
    else
      stream._write(chunk, encoding, state.onwrite);
    state.sync = false;
  }
  function onwriteError(stream, state, sync, er, cb) {
    --state.pendingcb;
    if (sync) {
      process.nextTick(cb, er);
      process.nextTick(finishMaybe, stream, state);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er);
    } else {
      cb(er);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er);
      finishMaybe(stream, state);
    }
  }
  function onwriteStateUpdate(state) {
    state.writing = false;
    state.writecb = null;
    state.length -= state.writelen;
    state.writelen = 0;
  }
  function onwrite(stream, er) {
    var state = stream._writableState;
    var sync = state.sync;
    var cb = state.writecb;
    if (typeof cb !== "function")
      throw new ERR_MULTIPLE_CALLBACK;
    onwriteStateUpdate(state);
    if (er)
      onwriteError(stream, state, sync, er, cb);
    else {
      var finished = needFinish(state) || stream.destroyed;
      if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
        clearBuffer(stream, state);
      }
      if (sync) {
        process.nextTick(afterWrite, stream, state, finished, cb);
      } else {
        afterWrite(stream, state, finished, cb);
      }
    }
  }
  function afterWrite(stream, state, finished, cb) {
    if (!finished)
      onwriteDrain(stream, state);
    state.pendingcb--;
    cb();
    finishMaybe(stream, state);
  }
  function onwriteDrain(stream, state) {
    if (state.length === 0 && state.needDrain) {
      state.needDrain = false;
      stream.emit("drain");
    }
  }
  function clearBuffer(stream, state) {
    state.bufferProcessing = true;
    var entry = state.bufferedRequest;
    if (stream._writev && entry && entry.next) {
      var l = state.bufferedRequestCount;
      var buffer = new Array(l);
      var holder = state.corkedRequestsFree;
      holder.entry = entry;
      var count = 0;
      var allBuffers = true;
      while (entry) {
        buffer[count] = entry;
        if (!entry.isBuf)
          allBuffers = false;
        entry = entry.next;
        count += 1;
      }
      buffer.allBuffers = allBuffers;
      doWrite(stream, state, true, state.length, buffer, "", holder.finish);
      state.pendingcb++;
      state.lastBufferedRequest = null;
      if (holder.next) {
        state.corkedRequestsFree = holder.next;
        holder.next = null;
      } else {
        state.corkedRequestsFree = new CorkedRequest(state);
      }
      state.bufferedRequestCount = 0;
    } else {
      while (entry) {
        var chunk = entry.chunk;
        var encoding = entry.encoding;
        var cb = entry.callback;
        var len = state.objectMode ? 1 : chunk.length;
        doWrite(stream, state, false, len, chunk, encoding, cb);
        entry = entry.next;
        state.bufferedRequestCount--;
        if (state.writing) {
          break;
        }
      }
      if (entry === null)
        state.lastBufferedRequest = null;
    }
    state.bufferedRequest = entry;
    state.bufferProcessing = false;
  }
  Writable.prototype._write = function(chunk, encoding, cb) {
    cb(new ERR_METHOD_NOT_IMPLEMENTED("_write()"));
  };
  Writable.prototype._writev = null;
  Writable.prototype.end = function(chunk, encoding, cb) {
    var state = this._writableState;
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (chunk !== null && chunk !== undefined)
      this.write(chunk, encoding);
    if (state.corked) {
      state.corked = 1;
      this.uncork();
    }
    if (!state.ending)
      endWritable(this, state, cb);
    return this;
  };
  Object.defineProperty(Writable.prototype, "writableLength", {
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    }
  });
  function needFinish(state) {
    return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
  }
  function callFinal(stream, state) {
    stream._final(function(err) {
      state.pendingcb--;
      if (err) {
        errorOrDestroy(stream, err);
      }
      state.prefinished = true;
      stream.emit("prefinish");
      finishMaybe(stream, state);
    });
  }
  function prefinish(stream, state) {
    if (!state.prefinished && !state.finalCalled) {
      if (typeof stream._final === "function" && !state.destroyed) {
        state.pendingcb++;
        state.finalCalled = true;
        process.nextTick(callFinal, stream, state);
      } else {
        state.prefinished = true;
        stream.emit("prefinish");
      }
    }
  }
  function finishMaybe(stream, state) {
    var need = needFinish(state);
    if (need) {
      prefinish(stream, state);
      if (state.pendingcb === 0) {
        state.finished = true;
        stream.emit("finish");
        if (state.autoDestroy) {
          var rState = stream._readableState;
          if (!rState || rState.autoDestroy && rState.endEmitted) {
            stream.destroy();
          }
        }
      }
    }
    return need;
  }
  function endWritable(stream, state, cb) {
    state.ending = true;
    finishMaybe(stream, state);
    if (cb) {
      if (state.finished)
        process.nextTick(cb);
      else
        stream.once("finish", cb);
    }
    state.ended = true;
    stream.writable = false;
  }
  function onCorkedFinish(corkReq, state, err) {
    var entry = corkReq.entry;
    corkReq.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }
    state.corkedRequestsFree.next = corkReq;
  }
  Object.defineProperty(Writable.prototype, "destroyed", {
    enumerable: false,
    get: function get() {
      if (this._writableState === undefined) {
        return false;
      }
      return this._writableState.destroyed;
    },
    set: function set(value) {
      if (!this._writableState) {
        return;
      }
      this._writableState.destroyed = value;
    }
  });
  Writable.prototype.destroy = destroyImpl.destroy;
  Writable.prototype._undestroy = destroyImpl.undestroy;
  Writable.prototype._destroy = function(err, cb) {
    cb(err);
  };
});

// node_modules/winston-transport/modern.js
var require_modern = __commonJS((exports, module) => {
  var util = __require("util");
  var Writable = require__stream_writable();
  var { LEVEL } = require_triple_beam();
  var TransportStream = module.exports = function TransportStream2(options = {}) {
    Writable.call(this, { objectMode: true, highWaterMark: options.highWaterMark });
    this.format = options.format;
    this.level = options.level;
    this.handleExceptions = options.handleExceptions;
    this.handleRejections = options.handleRejections;
    this.silent = options.silent;
    if (options.log)
      this.log = options.log;
    if (options.logv)
      this.logv = options.logv;
    if (options.close)
      this.close = options.close;
    this.once("pipe", (logger) => {
      this.levels = logger.levels;
      this.parent = logger;
    });
    this.once("unpipe", (src) => {
      if (src === this.parent) {
        this.parent = null;
        if (this.close) {
          this.close();
        }
      }
    });
  };
  util.inherits(TransportStream, Writable);
  TransportStream.prototype._write = function _write(info, enc, callback) {
    if (this.silent || info.exception === true && !this.handleExceptions) {
      return callback(null);
    }
    const level = this.level || this.parent && this.parent.level;
    if (!level || this.levels[level] >= this.levels[info[LEVEL]]) {
      if (info && !this.format) {
        return this.log(info, callback);
      }
      let errState;
      let transformed;
      try {
        transformed = this.format.transform(Object.assign({}, info), this.format.options);
      } catch (err) {
        errState = err;
      }
      if (errState || !transformed) {
        callback();
        if (errState)
          throw errState;
        return;
      }
      return this.log(transformed, callback);
    }
    this._writableState.sync = false;
    return callback(null);
  };
  TransportStream.prototype._writev = function _writev(chunks, callback) {
    if (this.logv) {
      const infos = chunks.filter(this._accept, this);
      if (!infos.length) {
        return callback(null);
      }
      return this.logv(infos, callback);
    }
    for (let i = 0;i < chunks.length; i++) {
      if (!this._accept(chunks[i]))
        continue;
      if (chunks[i].chunk && !this.format) {
        this.log(chunks[i].chunk, chunks[i].callback);
        continue;
      }
      let errState;
      let transformed;
      try {
        transformed = this.format.transform(Object.assign({}, chunks[i].chunk), this.format.options);
      } catch (err) {
        errState = err;
      }
      if (errState || !transformed) {
        chunks[i].callback();
        if (errState) {
          callback(null);
          throw errState;
        }
      } else {
        this.log(transformed, chunks[i].callback);
      }
    }
    return callback(null);
  };
  TransportStream.prototype._accept = function _accept(write) {
    const info = write.chunk;
    if (this.silent) {
      return false;
    }
    const level = this.level || this.parent && this.parent.level;
    if (info.exception === true || !level || this.levels[level] >= this.levels[info[LEVEL]]) {
      if (this.handleExceptions || info.exception !== true) {
        return true;
      }
    }
    return false;
  };
  TransportStream.prototype._nop = function _nop() {
    return;
  };
});

// node_modules/winston-transport/legacy.js
var require_legacy = __commonJS((exports, module) => {
  var util = __require("util");
  var { LEVEL } = require_triple_beam();
  var TransportStream = require_modern();
  var LegacyTransportStream = module.exports = function LegacyTransportStream2(options = {}) {
    TransportStream.call(this, options);
    if (!options.transport || typeof options.transport.log !== "function") {
      throw new Error("Invalid transport, must be an object with a log method.");
    }
    this.transport = options.transport;
    this.level = this.level || options.transport.level;
    this.handleExceptions = this.handleExceptions || options.transport.handleExceptions;
    this._deprecated();
    function transportError(err) {
      this.emit("error", err, this.transport);
    }
    if (!this.transport.__winstonError) {
      this.transport.__winstonError = transportError.bind(this);
      this.transport.on("error", this.transport.__winstonError);
    }
  };
  util.inherits(LegacyTransportStream, TransportStream);
  LegacyTransportStream.prototype._write = function _write(info, enc, callback) {
    if (this.silent || info.exception === true && !this.handleExceptions) {
      return callback(null);
    }
    if (!this.level || this.levels[this.level] >= this.levels[info[LEVEL]]) {
      this.transport.log(info[LEVEL], info.message, info, this._nop);
    }
    callback(null);
  };
  LegacyTransportStream.prototype._writev = function _writev(chunks, callback) {
    for (let i = 0;i < chunks.length; i++) {
      if (this._accept(chunks[i])) {
        this.transport.log(chunks[i].chunk[LEVEL], chunks[i].chunk.message, chunks[i].chunk, this._nop);
        chunks[i].callback();
      }
    }
    return callback(null);
  };
  LegacyTransportStream.prototype._deprecated = function _deprecated() {
    console.error([
      `${this.transport.name} is a legacy winston transport. Consider upgrading: `,
      "- Upgrade docs: https://github.com/winstonjs/winston/blob/master/UPGRADE-3.0.md"
    ].join(`
`));
  };
  LegacyTransportStream.prototype.close = function close() {
    if (this.transport.close) {
      this.transport.close();
    }
    if (this.transport.__winstonError) {
      this.transport.removeListener("error", this.transport.__winstonError);
      this.transport.__winstonError = null;
    }
  };
});

// node_modules/winston-transport/index.js
var require_winston_transport = __commonJS((exports, module) => {
  module.exports = require_modern();
  module.exports.LegacyTransportStream = require_legacy();
});

// node_modules/winston/lib/winston/transports/console.js
var require_console = __commonJS((exports, module) => {
  var os4 = __require("os");
  var { LEVEL, MESSAGE } = require_triple_beam();
  var TransportStream = require_winston_transport();
  module.exports = class Console extends TransportStream {
    constructor(options = {}) {
      super(options);
      this.name = options.name || "console";
      this.stderrLevels = this._stringArrayToSet(options.stderrLevels);
      this.consoleWarnLevels = this._stringArrayToSet(options.consoleWarnLevels);
      this.eol = typeof options.eol === "string" ? options.eol : os4.EOL;
      this.forceConsole = options.forceConsole || false;
      this._consoleLog = console.log.bind(console);
      this._consoleWarn = console.warn.bind(console);
      this._consoleError = console.error.bind(console);
      this.setMaxListeners(30);
    }
    log(info, callback) {
      setImmediate(() => this.emit("logged", info));
      if (this.stderrLevels[info[LEVEL]]) {
        if (console._stderr && !this.forceConsole) {
          console._stderr.write(`${info[MESSAGE]}${this.eol}`);
        } else {
          this._consoleError(info[MESSAGE]);
        }
        if (callback) {
          callback();
        }
        return;
      } else if (this.consoleWarnLevels[info[LEVEL]]) {
        if (console._stderr && !this.forceConsole) {
          console._stderr.write(`${info[MESSAGE]}${this.eol}`);
        } else {
          this._consoleWarn(info[MESSAGE]);
        }
        if (callback) {
          callback();
        }
        return;
      }
      if (console._stdout && !this.forceConsole) {
        console._stdout.write(`${info[MESSAGE]}${this.eol}`);
      } else {
        this._consoleLog(info[MESSAGE]);
      }
      if (callback) {
        callback();
      }
    }
    _stringArrayToSet(strArray, errMsg) {
      if (!strArray)
        return {};
      errMsg = errMsg || "Cannot make set from type other than Array of string elements";
      if (!Array.isArray(strArray)) {
        throw new Error(errMsg);
      }
      return strArray.reduce((set, el) => {
        if (typeof el !== "string") {
          throw new Error(errMsg);
        }
        set[el] = true;
        return set;
      }, {});
    }
  };
});

// node_modules/async/internal/isArrayLike.js
var require_isArrayLike = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = isArrayLike;
  function isArrayLike(value) {
    return value && typeof value.length === "number" && value.length >= 0 && value.length % 1 === 0;
  }
  module.exports = exports.default;
});

// node_modules/async/internal/initialParams.js
var require_initialParams = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = function(fn) {
    return function(...args) {
      var callback = args.pop();
      return fn.call(this, args, callback);
    };
  };
  module.exports = exports.default;
});

// node_modules/async/internal/setImmediate.js
var require_setImmediate = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.fallback = fallback;
  exports.wrap = wrap;
  var hasQueueMicrotask = exports.hasQueueMicrotask = typeof queueMicrotask === "function" && queueMicrotask;
  var hasSetImmediate = exports.hasSetImmediate = typeof setImmediate === "function" && setImmediate;
  var hasNextTick = exports.hasNextTick = typeof process === "object" && typeof process.nextTick === "function";
  function fallback(fn) {
    setTimeout(fn, 0);
  }
  function wrap(defer) {
    return (fn, ...args) => defer(() => fn(...args));
  }
  var _defer;
  if (hasQueueMicrotask) {
    _defer = queueMicrotask;
  } else if (hasSetImmediate) {
    _defer = setImmediate;
  } else if (hasNextTick) {
    _defer = process.nextTick;
  } else {
    _defer = fallback;
  }
  exports.default = wrap(_defer);
});

// node_modules/async/asyncify.js
var require_asyncify = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = asyncify;
  var _initialParams = require_initialParams();
  var _initialParams2 = _interopRequireDefault(_initialParams);
  var _setImmediate = require_setImmediate();
  var _setImmediate2 = _interopRequireDefault(_setImmediate);
  var _wrapAsync = require_wrapAsync();
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function asyncify(func) {
    if ((0, _wrapAsync.isAsync)(func)) {
      return function(...args) {
        const callback = args.pop();
        const promise = func.apply(this, args);
        return handlePromise(promise, callback);
      };
    }
    return (0, _initialParams2.default)(function(args, callback) {
      var result;
      try {
        result = func.apply(this, args);
      } catch (e) {
        return callback(e);
      }
      if (result && typeof result.then === "function") {
        return handlePromise(result, callback);
      } else {
        callback(null, result);
      }
    });
  }
  function handlePromise(promise, callback) {
    return promise.then((value) => {
      invokeCallback(callback, null, value);
    }, (err) => {
      invokeCallback(callback, err && (err instanceof Error || err.message) ? err : new Error(err));
    });
  }
  function invokeCallback(callback, error, value) {
    try {
      callback(error, value);
    } catch (err) {
      (0, _setImmediate2.default)((e) => {
        throw e;
      }, err);
    }
  }
  module.exports = exports.default;
});

// node_modules/async/internal/wrapAsync.js
var require_wrapAsync = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.isAsyncIterable = exports.isAsyncGenerator = exports.isAsync = undefined;
  var _asyncify = require_asyncify();
  var _asyncify2 = _interopRequireDefault(_asyncify);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function isAsync(fn) {
    return fn[Symbol.toStringTag] === "AsyncFunction";
  }
  function isAsyncGenerator(fn) {
    return fn[Symbol.toStringTag] === "AsyncGenerator";
  }
  function isAsyncIterable(obj) {
    return typeof obj[Symbol.asyncIterator] === "function";
  }
  function wrapAsync(asyncFn) {
    if (typeof asyncFn !== "function")
      throw new Error("expected a function");
    return isAsync(asyncFn) ? (0, _asyncify2.default)(asyncFn) : asyncFn;
  }
  exports.default = wrapAsync;
  exports.isAsync = isAsync;
  exports.isAsyncGenerator = isAsyncGenerator;
  exports.isAsyncIterable = isAsyncIterable;
});

// node_modules/async/internal/awaitify.js
var require_awaitify = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = awaitify;
  function awaitify(asyncFn, arity) {
    if (!arity)
      arity = asyncFn.length;
    if (!arity)
      throw new Error("arity is undefined");
    function awaitable(...args) {
      if (typeof args[arity - 1] === "function") {
        return asyncFn.apply(this, args);
      }
      return new Promise((resolve4, reject) => {
        args[arity - 1] = (err, ...cbArgs) => {
          if (err)
            return reject(err);
          resolve4(cbArgs.length > 1 ? cbArgs : cbArgs[0]);
        };
        asyncFn.apply(this, args);
      });
    }
    return awaitable;
  }
  module.exports = exports.default;
});

// node_modules/async/internal/parallel.js
var require_parallel = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var _isArrayLike = require_isArrayLike();
  var _isArrayLike2 = _interopRequireDefault(_isArrayLike);
  var _wrapAsync = require_wrapAsync();
  var _wrapAsync2 = _interopRequireDefault(_wrapAsync);
  var _awaitify = require_awaitify();
  var _awaitify2 = _interopRequireDefault(_awaitify);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  exports.default = (0, _awaitify2.default)((eachfn, tasks, callback) => {
    var results = (0, _isArrayLike2.default)(tasks) ? [] : {};
    eachfn(tasks, (task, key, taskCb) => {
      (0, _wrapAsync2.default)(task)((err, ...result) => {
        if (result.length < 2) {
          [result] = result;
        }
        results[key] = result;
        taskCb(err);
      });
    }, (err) => callback(err, results));
  }, 3);
  module.exports = exports.default;
});

// node_modules/async/internal/once.js
var require_once = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = once;
  function once(fn) {
    function wrapper(...args) {
      if (fn === null)
        return;
      var callFn = fn;
      fn = null;
      callFn.apply(this, args);
    }
    Object.assign(wrapper, fn);
    return wrapper;
  }
  module.exports = exports.default;
});

// node_modules/async/internal/getIterator.js
var require_getIterator = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = function(coll) {
    return coll[Symbol.iterator] && coll[Symbol.iterator]();
  };
  module.exports = exports.default;
});

// node_modules/async/internal/iterator.js
var require_iterator = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = createIterator;
  var _isArrayLike = require_isArrayLike();
  var _isArrayLike2 = _interopRequireDefault(_isArrayLike);
  var _getIterator = require_getIterator();
  var _getIterator2 = _interopRequireDefault(_getIterator);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function createArrayIterator(coll) {
    var i = -1;
    var len = coll.length;
    return function next() {
      return ++i < len ? { value: coll[i], key: i } : null;
    };
  }
  function createES2015Iterator(iterator) {
    var i = -1;
    return function next() {
      var item = iterator.next();
      if (item.done)
        return null;
      i++;
      return { value: item.value, key: i };
    };
  }
  function createObjectIterator(obj) {
    var okeys = obj ? Object.keys(obj) : [];
    var i = -1;
    var len = okeys.length;
    return function next() {
      var key = okeys[++i];
      if (key === "__proto__") {
        return next();
      }
      return i < len ? { value: obj[key], key } : null;
    };
  }
  function createIterator(coll) {
    if ((0, _isArrayLike2.default)(coll)) {
      return createArrayIterator(coll);
    }
    var iterator = (0, _getIterator2.default)(coll);
    return iterator ? createES2015Iterator(iterator) : createObjectIterator(coll);
  }
  module.exports = exports.default;
});

// node_modules/async/internal/onlyOnce.js
var require_onlyOnce = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = onlyOnce;
  function onlyOnce(fn) {
    return function(...args) {
      if (fn === null)
        throw new Error("Callback was already called.");
      var callFn = fn;
      fn = null;
      callFn.apply(this, args);
    };
  }
  module.exports = exports.default;
});

// node_modules/async/internal/breakLoop.js
var require_breakLoop = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var breakLoop = {};
  exports.default = breakLoop;
  module.exports = exports.default;
});

// node_modules/async/internal/asyncEachOfLimit.js
var require_asyncEachOfLimit = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = asyncEachOfLimit;
  var _breakLoop = require_breakLoop();
  var _breakLoop2 = _interopRequireDefault(_breakLoop);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function asyncEachOfLimit(generator, limit, iteratee, callback) {
    let done = false;
    let canceled = false;
    let awaiting = false;
    let running = 0;
    let idx = 0;
    function replenish() {
      if (running >= limit || awaiting || done)
        return;
      awaiting = true;
      generator.next().then(({ value, done: iterDone }) => {
        if (canceled || done)
          return;
        awaiting = false;
        if (iterDone) {
          done = true;
          if (running <= 0) {
            callback(null);
          }
          return;
        }
        running++;
        iteratee(value, idx, iterateeCallback);
        idx++;
        replenish();
      }).catch(handleError);
    }
    function iterateeCallback(err, result) {
      running -= 1;
      if (canceled)
        return;
      if (err)
        return handleError(err);
      if (err === false) {
        done = true;
        canceled = true;
        return;
      }
      if (result === _breakLoop2.default || done && running <= 0) {
        done = true;
        return callback(null);
      }
      replenish();
    }
    function handleError(err) {
      if (canceled)
        return;
      awaiting = false;
      done = true;
      callback(err);
    }
    replenish();
  }
  module.exports = exports.default;
});

// node_modules/async/internal/eachOfLimit.js
var require_eachOfLimit = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var _once = require_once();
  var _once2 = _interopRequireDefault(_once);
  var _iterator = require_iterator();
  var _iterator2 = _interopRequireDefault(_iterator);
  var _onlyOnce = require_onlyOnce();
  var _onlyOnce2 = _interopRequireDefault(_onlyOnce);
  var _wrapAsync = require_wrapAsync();
  var _asyncEachOfLimit = require_asyncEachOfLimit();
  var _asyncEachOfLimit2 = _interopRequireDefault(_asyncEachOfLimit);
  var _breakLoop = require_breakLoop();
  var _breakLoop2 = _interopRequireDefault(_breakLoop);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  exports.default = (limit) => {
    return (obj, iteratee, callback) => {
      callback = (0, _once2.default)(callback);
      if (limit <= 0) {
        throw new RangeError("concurrency limit cannot be less than 1");
      }
      if (!obj) {
        return callback(null);
      }
      if ((0, _wrapAsync.isAsyncGenerator)(obj)) {
        return (0, _asyncEachOfLimit2.default)(obj, limit, iteratee, callback);
      }
      if ((0, _wrapAsync.isAsyncIterable)(obj)) {
        return (0, _asyncEachOfLimit2.default)(obj[Symbol.asyncIterator](), limit, iteratee, callback);
      }
      var nextElem = (0, _iterator2.default)(obj);
      var done = false;
      var canceled = false;
      var running = 0;
      var looping = false;
      function iterateeCallback(err, value) {
        if (canceled)
          return;
        running -= 1;
        if (err) {
          done = true;
          callback(err);
        } else if (err === false) {
          done = true;
          canceled = true;
        } else if (value === _breakLoop2.default || done && running <= 0) {
          done = true;
          return callback(null);
        } else if (!looping) {
          replenish();
        }
      }
      function replenish() {
        looping = true;
        while (running < limit && !done) {
          var elem = nextElem();
          if (elem === null) {
            done = true;
            if (running <= 0) {
              callback(null);
            }
            return;
          }
          running += 1;
          iteratee(elem.value, elem.key, (0, _onlyOnce2.default)(iterateeCallback));
        }
        looping = false;
      }
      replenish();
    };
  };
  module.exports = exports.default;
});

// node_modules/async/eachOfLimit.js
var require_eachOfLimit2 = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var _eachOfLimit2 = require_eachOfLimit();
  var _eachOfLimit3 = _interopRequireDefault(_eachOfLimit2);
  var _wrapAsync = require_wrapAsync();
  var _wrapAsync2 = _interopRequireDefault(_wrapAsync);
  var _awaitify = require_awaitify();
  var _awaitify2 = _interopRequireDefault(_awaitify);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function eachOfLimit(coll, limit, iteratee, callback) {
    return (0, _eachOfLimit3.default)(limit)(coll, (0, _wrapAsync2.default)(iteratee), callback);
  }
  exports.default = (0, _awaitify2.default)(eachOfLimit, 4);
  module.exports = exports.default;
});

// node_modules/async/eachOfSeries.js
var require_eachOfSeries = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var _eachOfLimit = require_eachOfLimit2();
  var _eachOfLimit2 = _interopRequireDefault(_eachOfLimit);
  var _awaitify = require_awaitify();
  var _awaitify2 = _interopRequireDefault(_awaitify);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function eachOfSeries(coll, iteratee, callback) {
    return (0, _eachOfLimit2.default)(coll, 1, iteratee, callback);
  }
  exports.default = (0, _awaitify2.default)(eachOfSeries, 3);
  module.exports = exports.default;
});

// node_modules/async/series.js
var require_series = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = series;
  var _parallel2 = require_parallel();
  var _parallel3 = _interopRequireDefault(_parallel2);
  var _eachOfSeries = require_eachOfSeries();
  var _eachOfSeries2 = _interopRequireDefault(_eachOfSeries);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function series(tasks, callback) {
    return (0, _parallel3.default)(_eachOfSeries2.default, tasks, callback);
  }
  module.exports = exports.default;
});

// node_modules/winston/node_modules/readable-stream/lib/internal/streams/buffer_list.js
var require_buffer_list2 = __commonJS((exports, module) => {
  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread(target) {
    for (var i = 1;i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }
  function _defineProperties(target, props) {
    for (var i = 0;i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor)
        descriptor.writable = true;
      Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
    }
  }
  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps)
      _defineProperties(Constructor.prototype, protoProps);
    if (staticProps)
      _defineProperties(Constructor, staticProps);
    Object.defineProperty(Constructor, "prototype", { writable: false });
    return Constructor;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null)
      return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object")
        return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var _require = __require("buffer");
  var Buffer2 = _require.Buffer;
  var _require2 = __require("util");
  var inspect = _require2.inspect;
  var custom = inspect && inspect.custom || "inspect";
  function copyBuffer(src, target, offset) {
    Buffer2.prototype.copy.call(src, target, offset);
  }
  module.exports = /* @__PURE__ */ function() {
    function BufferList() {
      _classCallCheck(this, BufferList);
      this.head = null;
      this.tail = null;
      this.length = 0;
    }
    _createClass(BufferList, [{
      key: "push",
      value: function push(v) {
        var entry = {
          data: v,
          next: null
        };
        if (this.length > 0)
          this.tail.next = entry;
        else
          this.head = entry;
        this.tail = entry;
        ++this.length;
      }
    }, {
      key: "unshift",
      value: function unshift(v) {
        var entry = {
          data: v,
          next: this.head
        };
        if (this.length === 0)
          this.tail = entry;
        this.head = entry;
        ++this.length;
      }
    }, {
      key: "shift",
      value: function shift() {
        if (this.length === 0)
          return;
        var ret = this.head.data;
        if (this.length === 1)
          this.head = this.tail = null;
        else
          this.head = this.head.next;
        --this.length;
        return ret;
      }
    }, {
      key: "clear",
      value: function clear() {
        this.head = this.tail = null;
        this.length = 0;
      }
    }, {
      key: "join",
      value: function join5(s) {
        if (this.length === 0)
          return "";
        var p = this.head;
        var ret = "" + p.data;
        while (p = p.next)
          ret += s + p.data;
        return ret;
      }
    }, {
      key: "concat",
      value: function concat(n) {
        if (this.length === 0)
          return Buffer2.alloc(0);
        var ret = Buffer2.allocUnsafe(n >>> 0);
        var p = this.head;
        var i = 0;
        while (p) {
          copyBuffer(p.data, ret, i);
          i += p.data.length;
          p = p.next;
        }
        return ret;
      }
    }, {
      key: "consume",
      value: function consume(n, hasStrings) {
        var ret;
        if (n < this.head.data.length) {
          ret = this.head.data.slice(0, n);
          this.head.data = this.head.data.slice(n);
        } else if (n === this.head.data.length) {
          ret = this.shift();
        } else {
          ret = hasStrings ? this._getString(n) : this._getBuffer(n);
        }
        return ret;
      }
    }, {
      key: "first",
      value: function first() {
        return this.head.data;
      }
    }, {
      key: "_getString",
      value: function _getString(n) {
        var p = this.head;
        var c = 1;
        var ret = p.data;
        n -= ret.length;
        while (p = p.next) {
          var str = p.data;
          var nb = n > str.length ? str.length : n;
          if (nb === str.length)
            ret += str;
          else
            ret += str.slice(0, n);
          n -= nb;
          if (n === 0) {
            if (nb === str.length) {
              ++c;
              if (p.next)
                this.head = p.next;
              else
                this.head = this.tail = null;
            } else {
              this.head = p;
              p.data = str.slice(nb);
            }
            break;
          }
          ++c;
        }
        this.length -= c;
        return ret;
      }
    }, {
      key: "_getBuffer",
      value: function _getBuffer(n) {
        var ret = Buffer2.allocUnsafe(n);
        var p = this.head;
        var c = 1;
        p.data.copy(ret);
        n -= p.data.length;
        while (p = p.next) {
          var buf = p.data;
          var nb = n > buf.length ? buf.length : n;
          buf.copy(ret, ret.length - n, 0, nb);
          n -= nb;
          if (n === 0) {
            if (nb === buf.length) {
              ++c;
              if (p.next)
                this.head = p.next;
              else
                this.head = this.tail = null;
            } else {
              this.head = p;
              p.data = buf.slice(nb);
            }
            break;
          }
          ++c;
        }
        this.length -= c;
        return ret;
      }
    }, {
      key: custom,
      value: function value(_, options) {
        return inspect(this, _objectSpread(_objectSpread({}, options), {}, {
          depth: 0,
          customInspect: false
        }));
      }
    }]);
    return BufferList;
  }();
});

// node_modules/winston/node_modules/readable-stream/lib/internal/streams/destroy.js
var require_destroy2 = __commonJS((exports, module) => {
  function destroy(err, cb) {
    var _this = this;
    var readableDestroyed = this._readableState && this._readableState.destroyed;
    var writableDestroyed = this._writableState && this._writableState.destroyed;
    if (readableDestroyed || writableDestroyed) {
      if (cb) {
        cb(err);
      } else if (err) {
        if (!this._writableState) {
          process.nextTick(emitErrorNT, this, err);
        } else if (!this._writableState.errorEmitted) {
          this._writableState.errorEmitted = true;
          process.nextTick(emitErrorNT, this, err);
        }
      }
      return this;
    }
    if (this._readableState) {
      this._readableState.destroyed = true;
    }
    if (this._writableState) {
      this._writableState.destroyed = true;
    }
    this._destroy(err || null, function(err2) {
      if (!cb && err2) {
        if (!_this._writableState) {
          process.nextTick(emitErrorAndCloseNT, _this, err2);
        } else if (!_this._writableState.errorEmitted) {
          _this._writableState.errorEmitted = true;
          process.nextTick(emitErrorAndCloseNT, _this, err2);
        } else {
          process.nextTick(emitCloseNT, _this);
        }
      } else if (cb) {
        process.nextTick(emitCloseNT, _this);
        cb(err2);
      } else {
        process.nextTick(emitCloseNT, _this);
      }
    });
    return this;
  }
  function emitErrorAndCloseNT(self2, err) {
    emitErrorNT(self2, err);
    emitCloseNT(self2);
  }
  function emitCloseNT(self2) {
    if (self2._writableState && !self2._writableState.emitClose)
      return;
    if (self2._readableState && !self2._readableState.emitClose)
      return;
    self2.emit("close");
  }
  function undestroy() {
    if (this._readableState) {
      this._readableState.destroyed = false;
      this._readableState.reading = false;
      this._readableState.ended = false;
      this._readableState.endEmitted = false;
    }
    if (this._writableState) {
      this._writableState.destroyed = false;
      this._writableState.ended = false;
      this._writableState.ending = false;
      this._writableState.finalCalled = false;
      this._writableState.prefinished = false;
      this._writableState.finished = false;
      this._writableState.errorEmitted = false;
    }
  }
  function emitErrorNT(self2, err) {
    self2.emit("error", err);
  }
  function errorOrDestroy(stream, err) {
    var rState = stream._readableState;
    var wState = stream._writableState;
    if (rState && rState.autoDestroy || wState && wState.autoDestroy)
      stream.destroy(err);
    else
      stream.emit("error", err);
  }
  module.exports = {
    destroy,
    undestroy,
    errorOrDestroy
  };
});

// node_modules/winston/node_modules/readable-stream/errors.js
var require_errors3 = __commonJS((exports, module) => {
  var codes = {};
  function createErrorType(code, message, Base) {
    if (!Base) {
      Base = Error;
    }
    function getMessage(arg1, arg2, arg3) {
      if (typeof message === "string") {
        return message;
      } else {
        return message(arg1, arg2, arg3);
      }
    }

    class NodeError extends Base {
      constructor(arg1, arg2, arg3) {
        super(getMessage(arg1, arg2, arg3));
      }
    }
    NodeError.prototype.name = Base.name;
    NodeError.prototype.code = code;
    codes[code] = NodeError;
  }
  function oneOf(expected, thing) {
    if (Array.isArray(expected)) {
      const len = expected.length;
      expected = expected.map((i) => String(i));
      if (len > 2) {
        return `one of ${thing} ${expected.slice(0, len - 1).join(", ")}, or ` + expected[len - 1];
      } else if (len === 2) {
        return `one of ${thing} ${expected[0]} or ${expected[1]}`;
      } else {
        return `of ${thing} ${expected[0]}`;
      }
    } else {
      return `of ${thing} ${String(expected)}`;
    }
  }
  function startsWith(str, search, pos) {
    return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
  }
  function endsWith(str, search, this_len) {
    if (this_len === undefined || this_len > str.length) {
      this_len = str.length;
    }
    return str.substring(this_len - search.length, this_len) === search;
  }
  function includes(str, search, start) {
    if (typeof start !== "number") {
      start = 0;
    }
    if (start + search.length > str.length) {
      return false;
    } else {
      return str.indexOf(search, start) !== -1;
    }
  }
  createErrorType("ERR_INVALID_OPT_VALUE", function(name, value) {
    return 'The value "' + value + '" is invalid for option "' + name + '"';
  }, TypeError);
  createErrorType("ERR_INVALID_ARG_TYPE", function(name, expected, actual) {
    let determiner;
    if (typeof expected === "string" && startsWith(expected, "not ")) {
      determiner = "must not be";
      expected = expected.replace(/^not /, "");
    } else {
      determiner = "must be";
    }
    let msg;
    if (endsWith(name, " argument")) {
      msg = `The ${name} ${determiner} ${oneOf(expected, "type")}`;
    } else {
      const type = includes(name, ".") ? "property" : "argument";
      msg = `The "${name}" ${type} ${determiner} ${oneOf(expected, "type")}`;
    }
    msg += `. Received type ${typeof actual}`;
    return msg;
  }, TypeError);
  createErrorType("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF");
  createErrorType("ERR_METHOD_NOT_IMPLEMENTED", function(name) {
    return "The " + name + " method is not implemented";
  });
  createErrorType("ERR_STREAM_PREMATURE_CLOSE", "Premature close");
  createErrorType("ERR_STREAM_DESTROYED", function(name) {
    return "Cannot call " + name + " after a stream was destroyed";
  });
  createErrorType("ERR_MULTIPLE_CALLBACK", "Callback called multiple times");
  createErrorType("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable");
  createErrorType("ERR_STREAM_WRITE_AFTER_END", "write after end");
  createErrorType("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
  createErrorType("ERR_UNKNOWN_ENCODING", function(arg) {
    return "Unknown encoding: " + arg;
  }, TypeError);
  createErrorType("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event");
  exports.codes = codes;
});

// node_modules/winston/node_modules/readable-stream/lib/internal/streams/state.js
var require_state2 = __commonJS((exports, module) => {
  var ERR_INVALID_OPT_VALUE = require_errors3().codes.ERR_INVALID_OPT_VALUE;
  function highWaterMarkFrom(options, isDuplex, duplexKey) {
    return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
  }
  function getHighWaterMark(state, options, duplexKey, isDuplex) {
    var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
    if (hwm != null) {
      if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
        var name = isDuplex ? duplexKey : "highWaterMark";
        throw new ERR_INVALID_OPT_VALUE(name, hwm);
      }
      return Math.floor(hwm);
    }
    return state.objectMode ? 16 : 16 * 1024;
  }
  module.exports = {
    getHighWaterMark
  };
});

// node_modules/winston/node_modules/readable-stream/lib/_stream_writable.js
var require__stream_writable2 = __commonJS((exports, module) => {
  module.exports = Writable;
  function CorkedRequest(state) {
    var _this = this;
    this.next = null;
    this.entry = null;
    this.finish = function() {
      onCorkedFinish(_this, state);
    };
  }
  var Duplex;
  Writable.WritableState = WritableState;
  var internalUtil = {
    deprecate: require_node()
  };
  var Stream = __require("stream");
  var Buffer2 = __require("buffer").Buffer;
  var OurUint8Array = (typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {}).Uint8Array || function() {};
  function _uint8ArrayToBuffer(chunk) {
    return Buffer2.from(chunk);
  }
  function _isUint8Array(obj) {
    return Buffer2.isBuffer(obj) || obj instanceof OurUint8Array;
  }
  var destroyImpl = require_destroy2();
  var _require = require_state2();
  var getHighWaterMark = _require.getHighWaterMark;
  var _require$codes = require_errors3().codes;
  var ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE;
  var ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED;
  var ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK;
  var ERR_STREAM_CANNOT_PIPE = _require$codes.ERR_STREAM_CANNOT_PIPE;
  var ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;
  var ERR_STREAM_NULL_VALUES = _require$codes.ERR_STREAM_NULL_VALUES;
  var ERR_STREAM_WRITE_AFTER_END = _require$codes.ERR_STREAM_WRITE_AFTER_END;
  var ERR_UNKNOWN_ENCODING = _require$codes.ERR_UNKNOWN_ENCODING;
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  require_inherits()(Writable, Stream);
  function nop() {}
  function WritableState(options, stream, isDuplex) {
    Duplex = Duplex || require__stream_duplex2();
    options = options || {};
    if (typeof isDuplex !== "boolean")
      isDuplex = stream instanceof Duplex;
    this.objectMode = !!options.objectMode;
    if (isDuplex)
      this.objectMode = this.objectMode || !!options.writableObjectMode;
    this.highWaterMark = getHighWaterMark(this, options, "writableHighWaterMark", isDuplex);
    this.finalCalled = false;
    this.needDrain = false;
    this.ending = false;
    this.ended = false;
    this.finished = false;
    this.destroyed = false;
    var noDecode = options.decodeStrings === false;
    this.decodeStrings = !noDecode;
    this.defaultEncoding = options.defaultEncoding || "utf8";
    this.length = 0;
    this.writing = false;
    this.corked = 0;
    this.sync = true;
    this.bufferProcessing = false;
    this.onwrite = function(er) {
      onwrite(stream, er);
    };
    this.writecb = null;
    this.writelen = 0;
    this.bufferedRequest = null;
    this.lastBufferedRequest = null;
    this.pendingcb = 0;
    this.prefinished = false;
    this.errorEmitted = false;
    this.emitClose = options.emitClose !== false;
    this.autoDestroy = !!options.autoDestroy;
    this.bufferedRequestCount = 0;
    this.corkedRequestsFree = new CorkedRequest(this);
  }
  WritableState.prototype.getBuffer = function getBuffer() {
    var current = this.bufferedRequest;
    var out = [];
    while (current) {
      out.push(current);
      current = current.next;
    }
    return out;
  };
  (function() {
    try {
      Object.defineProperty(WritableState.prototype, "buffer", {
        get: internalUtil.deprecate(function writableStateBufferGetter() {
          return this.getBuffer();
        }, "_writableState.buffer is deprecated. Use _writableState.getBuffer " + "instead.", "DEP0003")
      });
    } catch (_) {}
  })();
  var realHasInstance;
  if (typeof Symbol === "function" && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === "function") {
    realHasInstance = Function.prototype[Symbol.hasInstance];
    Object.defineProperty(Writable, Symbol.hasInstance, {
      value: function value(object) {
        if (realHasInstance.call(this, object))
          return true;
        if (this !== Writable)
          return false;
        return object && object._writableState instanceof WritableState;
      }
    });
  } else {
    realHasInstance = function realHasInstance2(object) {
      return object instanceof this;
    };
  }
  function Writable(options) {
    Duplex = Duplex || require__stream_duplex2();
    var isDuplex = this instanceof Duplex;
    if (!isDuplex && !realHasInstance.call(Writable, this))
      return new Writable(options);
    this._writableState = new WritableState(options, this, isDuplex);
    this.writable = true;
    if (options) {
      if (typeof options.write === "function")
        this._write = options.write;
      if (typeof options.writev === "function")
        this._writev = options.writev;
      if (typeof options.destroy === "function")
        this._destroy = options.destroy;
      if (typeof options.final === "function")
        this._final = options.final;
    }
    Stream.call(this);
  }
  Writable.prototype.pipe = function() {
    errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE);
  };
  function writeAfterEnd(stream, cb) {
    var er = new ERR_STREAM_WRITE_AFTER_END;
    errorOrDestroy(stream, er);
    process.nextTick(cb, er);
  }
  function validChunk(stream, state, chunk, cb) {
    var er;
    if (chunk === null) {
      er = new ERR_STREAM_NULL_VALUES;
    } else if (typeof chunk !== "string" && !state.objectMode) {
      er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer"], chunk);
    }
    if (er) {
      errorOrDestroy(stream, er);
      process.nextTick(cb, er);
      return false;
    }
    return true;
  }
  Writable.prototype.write = function(chunk, encoding, cb) {
    var state = this._writableState;
    var ret = false;
    var isBuf = !state.objectMode && _isUint8Array(chunk);
    if (isBuf && !Buffer2.isBuffer(chunk)) {
      chunk = _uint8ArrayToBuffer(chunk);
    }
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (isBuf)
      encoding = "buffer";
    else if (!encoding)
      encoding = state.defaultEncoding;
    if (typeof cb !== "function")
      cb = nop;
    if (state.ending)
      writeAfterEnd(this, cb);
    else if (isBuf || validChunk(this, state, chunk, cb)) {
      state.pendingcb++;
      ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
    }
    return ret;
  };
  Writable.prototype.cork = function() {
    this._writableState.corked++;
  };
  Writable.prototype.uncork = function() {
    var state = this._writableState;
    if (state.corked) {
      state.corked--;
      if (!state.writing && !state.corked && !state.bufferProcessing && state.bufferedRequest)
        clearBuffer(this, state);
    }
  };
  Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
    if (typeof encoding === "string")
      encoding = encoding.toLowerCase();
    if (!(["hex", "utf8", "utf-8", "ascii", "binary", "base64", "ucs2", "ucs-2", "utf16le", "utf-16le", "raw"].indexOf((encoding + "").toLowerCase()) > -1))
      throw new ERR_UNKNOWN_ENCODING(encoding);
    this._writableState.defaultEncoding = encoding;
    return this;
  };
  Object.defineProperty(Writable.prototype, "writableBuffer", {
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    }
  });
  function decodeChunk(state, chunk, encoding) {
    if (!state.objectMode && state.decodeStrings !== false && typeof chunk === "string") {
      chunk = Buffer2.from(chunk, encoding);
    }
    return chunk;
  }
  Object.defineProperty(Writable.prototype, "writableHighWaterMark", {
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    }
  });
  function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
    if (!isBuf) {
      var newChunk = decodeChunk(state, chunk, encoding);
      if (chunk !== newChunk) {
        isBuf = true;
        encoding = "buffer";
        chunk = newChunk;
      }
    }
    var len = state.objectMode ? 1 : chunk.length;
    state.length += len;
    var ret = state.length < state.highWaterMark;
    if (!ret)
      state.needDrain = true;
    if (state.writing || state.corked) {
      var last = state.lastBufferedRequest;
      state.lastBufferedRequest = {
        chunk,
        encoding,
        isBuf,
        callback: cb,
        next: null
      };
      if (last) {
        last.next = state.lastBufferedRequest;
      } else {
        state.bufferedRequest = state.lastBufferedRequest;
      }
      state.bufferedRequestCount += 1;
    } else {
      doWrite(stream, state, false, len, chunk, encoding, cb);
    }
    return ret;
  }
  function doWrite(stream, state, writev, len, chunk, encoding, cb) {
    state.writelen = len;
    state.writecb = cb;
    state.writing = true;
    state.sync = true;
    if (state.destroyed)
      state.onwrite(new ERR_STREAM_DESTROYED("write"));
    else if (writev)
      stream._writev(chunk, state.onwrite);
    else
      stream._write(chunk, encoding, state.onwrite);
    state.sync = false;
  }
  function onwriteError(stream, state, sync, er, cb) {
    --state.pendingcb;
    if (sync) {
      process.nextTick(cb, er);
      process.nextTick(finishMaybe, stream, state);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er);
    } else {
      cb(er);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er);
      finishMaybe(stream, state);
    }
  }
  function onwriteStateUpdate(state) {
    state.writing = false;
    state.writecb = null;
    state.length -= state.writelen;
    state.writelen = 0;
  }
  function onwrite(stream, er) {
    var state = stream._writableState;
    var sync = state.sync;
    var cb = state.writecb;
    if (typeof cb !== "function")
      throw new ERR_MULTIPLE_CALLBACK;
    onwriteStateUpdate(state);
    if (er)
      onwriteError(stream, state, sync, er, cb);
    else {
      var finished = needFinish(state) || stream.destroyed;
      if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
        clearBuffer(stream, state);
      }
      if (sync) {
        process.nextTick(afterWrite, stream, state, finished, cb);
      } else {
        afterWrite(stream, state, finished, cb);
      }
    }
  }
  function afterWrite(stream, state, finished, cb) {
    if (!finished)
      onwriteDrain(stream, state);
    state.pendingcb--;
    cb();
    finishMaybe(stream, state);
  }
  function onwriteDrain(stream, state) {
    if (state.length === 0 && state.needDrain) {
      state.needDrain = false;
      stream.emit("drain");
    }
  }
  function clearBuffer(stream, state) {
    state.bufferProcessing = true;
    var entry = state.bufferedRequest;
    if (stream._writev && entry && entry.next) {
      var l = state.bufferedRequestCount;
      var buffer = new Array(l);
      var holder = state.corkedRequestsFree;
      holder.entry = entry;
      var count = 0;
      var allBuffers = true;
      while (entry) {
        buffer[count] = entry;
        if (!entry.isBuf)
          allBuffers = false;
        entry = entry.next;
        count += 1;
      }
      buffer.allBuffers = allBuffers;
      doWrite(stream, state, true, state.length, buffer, "", holder.finish);
      state.pendingcb++;
      state.lastBufferedRequest = null;
      if (holder.next) {
        state.corkedRequestsFree = holder.next;
        holder.next = null;
      } else {
        state.corkedRequestsFree = new CorkedRequest(state);
      }
      state.bufferedRequestCount = 0;
    } else {
      while (entry) {
        var chunk = entry.chunk;
        var encoding = entry.encoding;
        var cb = entry.callback;
        var len = state.objectMode ? 1 : chunk.length;
        doWrite(stream, state, false, len, chunk, encoding, cb);
        entry = entry.next;
        state.bufferedRequestCount--;
        if (state.writing) {
          break;
        }
      }
      if (entry === null)
        state.lastBufferedRequest = null;
    }
    state.bufferedRequest = entry;
    state.bufferProcessing = false;
  }
  Writable.prototype._write = function(chunk, encoding, cb) {
    cb(new ERR_METHOD_NOT_IMPLEMENTED("_write()"));
  };
  Writable.prototype._writev = null;
  Writable.prototype.end = function(chunk, encoding, cb) {
    var state = this._writableState;
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (chunk !== null && chunk !== undefined)
      this.write(chunk, encoding);
    if (state.corked) {
      state.corked = 1;
      this.uncork();
    }
    if (!state.ending)
      endWritable(this, state, cb);
    return this;
  };
  Object.defineProperty(Writable.prototype, "writableLength", {
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    }
  });
  function needFinish(state) {
    return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
  }
  function callFinal(stream, state) {
    stream._final(function(err) {
      state.pendingcb--;
      if (err) {
        errorOrDestroy(stream, err);
      }
      state.prefinished = true;
      stream.emit("prefinish");
      finishMaybe(stream, state);
    });
  }
  function prefinish(stream, state) {
    if (!state.prefinished && !state.finalCalled) {
      if (typeof stream._final === "function" && !state.destroyed) {
        state.pendingcb++;
        state.finalCalled = true;
        process.nextTick(callFinal, stream, state);
      } else {
        state.prefinished = true;
        stream.emit("prefinish");
      }
    }
  }
  function finishMaybe(stream, state) {
    var need = needFinish(state);
    if (need) {
      prefinish(stream, state);
      if (state.pendingcb === 0) {
        state.finished = true;
        stream.emit("finish");
        if (state.autoDestroy) {
          var rState = stream._readableState;
          if (!rState || rState.autoDestroy && rState.endEmitted) {
            stream.destroy();
          }
        }
      }
    }
    return need;
  }
  function endWritable(stream, state, cb) {
    state.ending = true;
    finishMaybe(stream, state);
    if (cb) {
      if (state.finished)
        process.nextTick(cb);
      else
        stream.once("finish", cb);
    }
    state.ended = true;
    stream.writable = false;
  }
  function onCorkedFinish(corkReq, state, err) {
    var entry = corkReq.entry;
    corkReq.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }
    state.corkedRequestsFree.next = corkReq;
  }
  Object.defineProperty(Writable.prototype, "destroyed", {
    enumerable: false,
    get: function get() {
      if (this._writableState === undefined) {
        return false;
      }
      return this._writableState.destroyed;
    },
    set: function set(value) {
      if (!this._writableState) {
        return;
      }
      this._writableState.destroyed = value;
    }
  });
  Writable.prototype.destroy = destroyImpl.destroy;
  Writable.prototype._undestroy = destroyImpl.undestroy;
  Writable.prototype._destroy = function(err, cb) {
    cb(err);
  };
});

// node_modules/winston/node_modules/readable-stream/lib/_stream_duplex.js
var require__stream_duplex2 = __commonJS((exports, module) => {
  var objectKeys = Object.keys || function(obj) {
    var keys2 = [];
    for (var key in obj)
      keys2.push(key);
    return keys2;
  };
  module.exports = Duplex;
  var Readable = require__stream_readable2();
  var Writable = require__stream_writable2();
  require_inherits()(Duplex, Readable);
  {
    keys = objectKeys(Writable.prototype);
    for (v = 0;v < keys.length; v++) {
      method = keys[v];
      if (!Duplex.prototype[method])
        Duplex.prototype[method] = Writable.prototype[method];
    }
  }
  var keys;
  var method;
  var v;
  function Duplex(options) {
    if (!(this instanceof Duplex))
      return new Duplex(options);
    Readable.call(this, options);
    Writable.call(this, options);
    this.allowHalfOpen = true;
    if (options) {
      if (options.readable === false)
        this.readable = false;
      if (options.writable === false)
        this.writable = false;
      if (options.allowHalfOpen === false) {
        this.allowHalfOpen = false;
        this.once("end", onend);
      }
    }
  }
  Object.defineProperty(Duplex.prototype, "writableHighWaterMark", {
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    }
  });
  Object.defineProperty(Duplex.prototype, "writableBuffer", {
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    }
  });
  Object.defineProperty(Duplex.prototype, "writableLength", {
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    }
  });
  function onend() {
    if (this._writableState.ended)
      return;
    process.nextTick(onEndNT, this);
  }
  function onEndNT(self2) {
    self2.end();
  }
  Object.defineProperty(Duplex.prototype, "destroyed", {
    enumerable: false,
    get: function get() {
      if (this._readableState === undefined || this._writableState === undefined) {
        return false;
      }
      return this._readableState.destroyed && this._writableState.destroyed;
    },
    set: function set(value) {
      if (this._readableState === undefined || this._writableState === undefined) {
        return;
      }
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    }
  });
});

// node_modules/winston/node_modules/readable-stream/lib/internal/streams/end-of-stream.js
var require_end_of_stream2 = __commonJS((exports, module) => {
  var ERR_STREAM_PREMATURE_CLOSE = require_errors3().codes.ERR_STREAM_PREMATURE_CLOSE;
  function once(callback) {
    var called = false;
    return function() {
      if (called)
        return;
      called = true;
      for (var _len = arguments.length, args = new Array(_len), _key = 0;_key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      callback.apply(this, args);
    };
  }
  function noop() {}
  function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === "function";
  }
  function eos(stream, opts, callback) {
    if (typeof opts === "function")
      return eos(stream, null, opts);
    if (!opts)
      opts = {};
    callback = once(callback || noop);
    var readable = opts.readable || opts.readable !== false && stream.readable;
    var writable = opts.writable || opts.writable !== false && stream.writable;
    var onlegacyfinish = function onlegacyfinish2() {
      if (!stream.writable)
        onfinish();
    };
    var writableEnded = stream._writableState && stream._writableState.finished;
    var onfinish = function onfinish2() {
      writable = false;
      writableEnded = true;
      if (!readable)
        callback.call(stream);
    };
    var readableEnded = stream._readableState && stream._readableState.endEmitted;
    var onend = function onend2() {
      readable = false;
      readableEnded = true;
      if (!writable)
        callback.call(stream);
    };
    var onerror = function onerror2(err) {
      callback.call(stream, err);
    };
    var onclose = function onclose2() {
      var err;
      if (readable && !readableEnded) {
        if (!stream._readableState || !stream._readableState.ended)
          err = new ERR_STREAM_PREMATURE_CLOSE;
        return callback.call(stream, err);
      }
      if (writable && !writableEnded) {
        if (!stream._writableState || !stream._writableState.ended)
          err = new ERR_STREAM_PREMATURE_CLOSE;
        return callback.call(stream, err);
      }
    };
    var onrequest = function onrequest2() {
      stream.req.on("finish", onfinish);
    };
    if (isRequest(stream)) {
      stream.on("complete", onfinish);
      stream.on("abort", onclose);
      if (stream.req)
        onrequest();
      else
        stream.on("request", onrequest);
    } else if (writable && !stream._writableState) {
      stream.on("end", onlegacyfinish);
      stream.on("close", onlegacyfinish);
    }
    stream.on("end", onend);
    stream.on("finish", onfinish);
    if (opts.error !== false)
      stream.on("error", onerror);
    stream.on("close", onclose);
    return function() {
      stream.removeListener("complete", onfinish);
      stream.removeListener("abort", onclose);
      stream.removeListener("request", onrequest);
      if (stream.req)
        stream.req.removeListener("finish", onfinish);
      stream.removeListener("end", onlegacyfinish);
      stream.removeListener("close", onlegacyfinish);
      stream.removeListener("finish", onfinish);
      stream.removeListener("end", onend);
      stream.removeListener("error", onerror);
      stream.removeListener("close", onclose);
    };
  }
  module.exports = eos;
});

// node_modules/winston/node_modules/readable-stream/lib/internal/streams/async_iterator.js
var require_async_iterator2 = __commonJS((exports, module) => {
  var _Object$setPrototypeO;
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null)
      return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object")
        return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var finished = require_end_of_stream2();
  var kLastResolve = Symbol("lastResolve");
  var kLastReject = Symbol("lastReject");
  var kError = Symbol("error");
  var kEnded = Symbol("ended");
  var kLastPromise = Symbol("lastPromise");
  var kHandlePromise = Symbol("handlePromise");
  var kStream = Symbol("stream");
  function createIterResult(value, done) {
    return {
      value,
      done
    };
  }
  function readAndResolve(iter) {
    var resolve4 = iter[kLastResolve];
    if (resolve4 !== null) {
      var data = iter[kStream].read();
      if (data !== null) {
        iter[kLastPromise] = null;
        iter[kLastResolve] = null;
        iter[kLastReject] = null;
        resolve4(createIterResult(data, false));
      }
    }
  }
  function onReadable(iter) {
    process.nextTick(readAndResolve, iter);
  }
  function wrapForNext(lastPromise, iter) {
    return function(resolve4, reject) {
      lastPromise.then(function() {
        if (iter[kEnded]) {
          resolve4(createIterResult(undefined, true));
          return;
        }
        iter[kHandlePromise](resolve4, reject);
      }, reject);
    };
  }
  var AsyncIteratorPrototype = Object.getPrototypeOf(function() {});
  var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf((_Object$setPrototypeO = {
    get stream() {
      return this[kStream];
    },
    next: function next() {
      var _this = this;
      var error = this[kError];
      if (error !== null) {
        return Promise.reject(error);
      }
      if (this[kEnded]) {
        return Promise.resolve(createIterResult(undefined, true));
      }
      if (this[kStream].destroyed) {
        return new Promise(function(resolve4, reject) {
          process.nextTick(function() {
            if (_this[kError]) {
              reject(_this[kError]);
            } else {
              resolve4(createIterResult(undefined, true));
            }
          });
        });
      }
      var lastPromise = this[kLastPromise];
      var promise;
      if (lastPromise) {
        promise = new Promise(wrapForNext(lastPromise, this));
      } else {
        var data = this[kStream].read();
        if (data !== null) {
          return Promise.resolve(createIterResult(data, false));
        }
        promise = new Promise(this[kHandlePromise]);
      }
      this[kLastPromise] = promise;
      return promise;
    }
  }, _defineProperty(_Object$setPrototypeO, Symbol.asyncIterator, function() {
    return this;
  }), _defineProperty(_Object$setPrototypeO, "return", function _return() {
    var _this2 = this;
    return new Promise(function(resolve4, reject) {
      _this2[kStream].destroy(null, function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve4(createIterResult(undefined, true));
      });
    });
  }), _Object$setPrototypeO), AsyncIteratorPrototype);
  var createReadableStreamAsyncIterator = function createReadableStreamAsyncIterator2(stream) {
    var _Object$create;
    var iterator = Object.create(ReadableStreamAsyncIteratorPrototype, (_Object$create = {}, _defineProperty(_Object$create, kStream, {
      value: stream,
      writable: true
    }), _defineProperty(_Object$create, kLastResolve, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kLastReject, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kError, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kEnded, {
      value: stream._readableState.endEmitted,
      writable: true
    }), _defineProperty(_Object$create, kHandlePromise, {
      value: function value(resolve4, reject) {
        var data = iterator[kStream].read();
        if (data) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          resolve4(createIterResult(data, false));
        } else {
          iterator[kLastResolve] = resolve4;
          iterator[kLastReject] = reject;
        }
      },
      writable: true
    }), _Object$create));
    iterator[kLastPromise] = null;
    finished(stream, function(err) {
      if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        var reject = iterator[kLastReject];
        if (reject !== null) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          reject(err);
        }
        iterator[kError] = err;
        return;
      }
      var resolve4 = iterator[kLastResolve];
      if (resolve4 !== null) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        resolve4(createIterResult(undefined, true));
      }
      iterator[kEnded] = true;
    });
    stream.on("readable", onReadable.bind(null, iterator));
    return iterator;
  };
  module.exports = createReadableStreamAsyncIterator;
});

// node_modules/winston/node_modules/readable-stream/lib/internal/streams/from.js
var require_from2 = __commonJS((exports, module) => {
  function asyncGeneratorStep(gen, resolve4, reject, _next, _throw, key, arg) {
    try {
      var info = gen[key](arg);
      var value = info.value;
    } catch (error) {
      reject(error);
      return;
    }
    if (info.done) {
      resolve4(value);
    } else {
      Promise.resolve(value).then(_next, _throw);
    }
  }
  function _asyncToGenerator(fn) {
    return function() {
      var self2 = this, args = arguments;
      return new Promise(function(resolve4, reject) {
        var gen = fn.apply(self2, args);
        function _next(value) {
          asyncGeneratorStep(gen, resolve4, reject, _next, _throw, "next", value);
        }
        function _throw(err) {
          asyncGeneratorStep(gen, resolve4, reject, _next, _throw, "throw", err);
        }
        _next(undefined);
      });
    };
  }
  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread(target) {
    for (var i = 1;i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return typeof key === "symbol" ? key : String(key);
  }
  function _toPrimitive(input, hint) {
    if (typeof input !== "object" || input === null)
      return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== undefined) {
      var res = prim.call(input, hint || "default");
      if (typeof res !== "object")
        return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }
  var ERR_INVALID_ARG_TYPE = require_errors3().codes.ERR_INVALID_ARG_TYPE;
  function from(Readable, iterable, opts) {
    var iterator;
    if (iterable && typeof iterable.next === "function") {
      iterator = iterable;
    } else if (iterable && iterable[Symbol.asyncIterator])
      iterator = iterable[Symbol.asyncIterator]();
    else if (iterable && iterable[Symbol.iterator])
      iterator = iterable[Symbol.iterator]();
    else
      throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
    var readable = new Readable(_objectSpread({
      objectMode: true
    }, opts));
    var reading = false;
    readable._read = function() {
      if (!reading) {
        reading = true;
        next();
      }
    };
    function next() {
      return _next2.apply(this, arguments);
    }
    function _next2() {
      _next2 = _asyncToGenerator(function* () {
        try {
          var _yield$iterator$next = yield iterator.next(), value = _yield$iterator$next.value, done = _yield$iterator$next.done;
          if (done) {
            readable.push(null);
          } else if (readable.push(yield value)) {
            next();
          } else {
            reading = false;
          }
        } catch (err) {
          readable.destroy(err);
        }
      });
      return _next2.apply(this, arguments);
    }
    return readable;
  }
  module.exports = from;
});

// node_modules/winston/node_modules/readable-stream/lib/_stream_readable.js
var require__stream_readable2 = __commonJS((exports, module) => {
  module.exports = Readable;
  var Duplex;
  Readable.ReadableState = ReadableState;
  var EE = __require("events").EventEmitter;
  var EElistenerCount = function EElistenerCount2(emitter, type) {
    return emitter.listeners(type).length;
  };
  var Stream = __require("stream");
  var Buffer2 = __require("buffer").Buffer;
  var OurUint8Array = (typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {}).Uint8Array || function() {};
  function _uint8ArrayToBuffer(chunk) {
    return Buffer2.from(chunk);
  }
  function _isUint8Array(obj) {
    return Buffer2.isBuffer(obj) || obj instanceof OurUint8Array;
  }
  var debugUtil = __require("util");
  var debug;
  if (debugUtil && debugUtil.debuglog) {
    debug = debugUtil.debuglog("stream");
  } else {
    debug = function debug2() {};
  }
  var BufferList = require_buffer_list2();
  var destroyImpl = require_destroy2();
  var _require = require_state2();
  var getHighWaterMark = _require.getHighWaterMark;
  var _require$codes = require_errors3().codes;
  var ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE;
  var ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF;
  var ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED;
  var ERR_STREAM_UNSHIFT_AFTER_END_EVENT = _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT;
  var StringDecoder;
  var createReadableStreamAsyncIterator;
  var from;
  require_inherits()(Readable, Stream);
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  var kProxyEvents = ["error", "close", "destroy", "pause", "resume"];
  function prependListener(emitter, event, fn) {
    if (typeof emitter.prependListener === "function")
      return emitter.prependListener(event, fn);
    if (!emitter._events || !emitter._events[event])
      emitter.on(event, fn);
    else if (Array.isArray(emitter._events[event]))
      emitter._events[event].unshift(fn);
    else
      emitter._events[event] = [fn, emitter._events[event]];
  }
  function ReadableState(options, stream, isDuplex) {
    Duplex = Duplex || require__stream_duplex2();
    options = options || {};
    if (typeof isDuplex !== "boolean")
      isDuplex = stream instanceof Duplex;
    this.objectMode = !!options.objectMode;
    if (isDuplex)
      this.objectMode = this.objectMode || !!options.readableObjectMode;
    this.highWaterMark = getHighWaterMark(this, options, "readableHighWaterMark", isDuplex);
    this.buffer = new BufferList;
    this.length = 0;
    this.pipes = null;
    this.pipesCount = 0;
    this.flowing = null;
    this.ended = false;
    this.endEmitted = false;
    this.reading = false;
    this.sync = true;
    this.needReadable = false;
    this.emittedReadable = false;
    this.readableListening = false;
    this.resumeScheduled = false;
    this.paused = true;
    this.emitClose = options.emitClose !== false;
    this.autoDestroy = !!options.autoDestroy;
    this.destroyed = false;
    this.defaultEncoding = options.defaultEncoding || "utf8";
    this.awaitDrain = 0;
    this.readingMore = false;
    this.decoder = null;
    this.encoding = null;
    if (options.encoding) {
      if (!StringDecoder)
        StringDecoder = require_string_decoder().StringDecoder;
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }
  }
  function Readable(options) {
    Duplex = Duplex || require__stream_duplex2();
    if (!(this instanceof Readable))
      return new Readable(options);
    var isDuplex = this instanceof Duplex;
    this._readableState = new ReadableState(options, this, isDuplex);
    this.readable = true;
    if (options) {
      if (typeof options.read === "function")
        this._read = options.read;
      if (typeof options.destroy === "function")
        this._destroy = options.destroy;
    }
    Stream.call(this);
  }
  Object.defineProperty(Readable.prototype, "destroyed", {
    enumerable: false,
    get: function get() {
      if (this._readableState === undefined) {
        return false;
      }
      return this._readableState.destroyed;
    },
    set: function set(value) {
      if (!this._readableState) {
        return;
      }
      this._readableState.destroyed = value;
    }
  });
  Readable.prototype.destroy = destroyImpl.destroy;
  Readable.prototype._undestroy = destroyImpl.undestroy;
  Readable.prototype._destroy = function(err, cb) {
    cb(err);
  };
  Readable.prototype.push = function(chunk, encoding) {
    var state = this._readableState;
    var skipChunkCheck;
    if (!state.objectMode) {
      if (typeof chunk === "string") {
        encoding = encoding || state.defaultEncoding;
        if (encoding !== state.encoding) {
          chunk = Buffer2.from(chunk, encoding);
          encoding = "";
        }
        skipChunkCheck = true;
      }
    } else {
      skipChunkCheck = true;
    }
    return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
  };
  Readable.prototype.unshift = function(chunk) {
    return readableAddChunk(this, chunk, null, true, false);
  };
  function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
    debug("readableAddChunk", chunk);
    var state = stream._readableState;
    if (chunk === null) {
      state.reading = false;
      onEofChunk(stream, state);
    } else {
      var er;
      if (!skipChunkCheck)
        er = chunkInvalid(state, chunk);
      if (er) {
        errorOrDestroy(stream, er);
      } else if (state.objectMode || chunk && chunk.length > 0) {
        if (typeof chunk !== "string" && !state.objectMode && Object.getPrototypeOf(chunk) !== Buffer2.prototype) {
          chunk = _uint8ArrayToBuffer(chunk);
        }
        if (addToFront) {
          if (state.endEmitted)
            errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT);
          else
            addChunk(stream, state, chunk, true);
        } else if (state.ended) {
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF);
        } else if (state.destroyed) {
          return false;
        } else {
          state.reading = false;
          if (state.decoder && !encoding) {
            chunk = state.decoder.write(chunk);
            if (state.objectMode || chunk.length !== 0)
              addChunk(stream, state, chunk, false);
            else
              maybeReadMore(stream, state);
          } else {
            addChunk(stream, state, chunk, false);
          }
        }
      } else if (!addToFront) {
        state.reading = false;
        maybeReadMore(stream, state);
      }
    }
    return !state.ended && (state.length < state.highWaterMark || state.length === 0);
  }
  function addChunk(stream, state, chunk, addToFront) {
    if (state.flowing && state.length === 0 && !state.sync) {
      state.awaitDrain = 0;
      stream.emit("data", chunk);
    } else {
      state.length += state.objectMode ? 1 : chunk.length;
      if (addToFront)
        state.buffer.unshift(chunk);
      else
        state.buffer.push(chunk);
      if (state.needReadable)
        emitReadable(stream);
    }
    maybeReadMore(stream, state);
  }
  function chunkInvalid(state, chunk) {
    var er;
    if (!_isUint8Array(chunk) && typeof chunk !== "string" && chunk !== undefined && !state.objectMode) {
      er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
    }
    return er;
  }
  Readable.prototype.isPaused = function() {
    return this._readableState.flowing === false;
  };
  Readable.prototype.setEncoding = function(enc) {
    if (!StringDecoder)
      StringDecoder = require_string_decoder().StringDecoder;
    var decoder = new StringDecoder(enc);
    this._readableState.decoder = decoder;
    this._readableState.encoding = this._readableState.decoder.encoding;
    var p = this._readableState.buffer.head;
    var content = "";
    while (p !== null) {
      content += decoder.write(p.data);
      p = p.next;
    }
    this._readableState.buffer.clear();
    if (content !== "")
      this._readableState.buffer.push(content);
    this._readableState.length = content.length;
    return this;
  };
  var MAX_HWM = 1073741824;
  function computeNewHighWaterMark(n) {
    if (n >= MAX_HWM) {
      n = MAX_HWM;
    } else {
      n--;
      n |= n >>> 1;
      n |= n >>> 2;
      n |= n >>> 4;
      n |= n >>> 8;
      n |= n >>> 16;
      n++;
    }
    return n;
  }
  function howMuchToRead(n, state) {
    if (n <= 0 || state.length === 0 && state.ended)
      return 0;
    if (state.objectMode)
      return 1;
    if (n !== n) {
      if (state.flowing && state.length)
        return state.buffer.head.data.length;
      else
        return state.length;
    }
    if (n > state.highWaterMark)
      state.highWaterMark = computeNewHighWaterMark(n);
    if (n <= state.length)
      return n;
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    }
    return state.length;
  }
  Readable.prototype.read = function(n) {
    debug("read", n);
    n = parseInt(n, 10);
    var state = this._readableState;
    var nOrig = n;
    if (n !== 0)
      state.emittedReadable = false;
    if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
      debug("read: emitReadable", state.length, state.ended);
      if (state.length === 0 && state.ended)
        endReadable(this);
      else
        emitReadable(this);
      return null;
    }
    n = howMuchToRead(n, state);
    if (n === 0 && state.ended) {
      if (state.length === 0)
        endReadable(this);
      return null;
    }
    var doRead = state.needReadable;
    debug("need readable", doRead);
    if (state.length === 0 || state.length - n < state.highWaterMark) {
      doRead = true;
      debug("length less than watermark", doRead);
    }
    if (state.ended || state.reading) {
      doRead = false;
      debug("reading or ended", doRead);
    } else if (doRead) {
      debug("do read");
      state.reading = true;
      state.sync = true;
      if (state.length === 0)
        state.needReadable = true;
      this._read(state.highWaterMark);
      state.sync = false;
      if (!state.reading)
        n = howMuchToRead(nOrig, state);
    }
    var ret;
    if (n > 0)
      ret = fromList(n, state);
    else
      ret = null;
    if (ret === null) {
      state.needReadable = state.length <= state.highWaterMark;
      n = 0;
    } else {
      state.length -= n;
      state.awaitDrain = 0;
    }
    if (state.length === 0) {
      if (!state.ended)
        state.needReadable = true;
      if (nOrig !== n && state.ended)
        endReadable(this);
    }
    if (ret !== null)
      this.emit("data", ret);
    return ret;
  };
  function onEofChunk(stream, state) {
    debug("onEofChunk");
    if (state.ended)
      return;
    if (state.decoder) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) {
        state.buffer.push(chunk);
        state.length += state.objectMode ? 1 : chunk.length;
      }
    }
    state.ended = true;
    if (state.sync) {
      emitReadable(stream);
    } else {
      state.needReadable = false;
      if (!state.emittedReadable) {
        state.emittedReadable = true;
        emitReadable_(stream);
      }
    }
  }
  function emitReadable(stream) {
    var state = stream._readableState;
    debug("emitReadable", state.needReadable, state.emittedReadable);
    state.needReadable = false;
    if (!state.emittedReadable) {
      debug("emitReadable", state.flowing);
      state.emittedReadable = true;
      process.nextTick(emitReadable_, stream);
    }
  }
  function emitReadable_(stream) {
    var state = stream._readableState;
    debug("emitReadable_", state.destroyed, state.length, state.ended);
    if (!state.destroyed && (state.length || state.ended)) {
      stream.emit("readable");
      state.emittedReadable = false;
    }
    state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
    flow(stream);
  }
  function maybeReadMore(stream, state) {
    if (!state.readingMore) {
      state.readingMore = true;
      process.nextTick(maybeReadMore_, stream, state);
    }
  }
  function maybeReadMore_(stream, state) {
    while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
      var len = state.length;
      debug("maybeReadMore read 0");
      stream.read(0);
      if (len === state.length)
        break;
    }
    state.readingMore = false;
  }
  Readable.prototype._read = function(n) {
    errorOrDestroy(this, new ERR_METHOD_NOT_IMPLEMENTED("_read()"));
  };
  Readable.prototype.pipe = function(dest, pipeOpts) {
    var src = this;
    var state = this._readableState;
    switch (state.pipesCount) {
      case 0:
        state.pipes = dest;
        break;
      case 1:
        state.pipes = [state.pipes, dest];
        break;
      default:
        state.pipes.push(dest);
        break;
    }
    state.pipesCount += 1;
    debug("pipe count=%d opts=%j", state.pipesCount, pipeOpts);
    var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
    var endFn = doEnd ? onend : unpipe;
    if (state.endEmitted)
      process.nextTick(endFn);
    else
      src.once("end", endFn);
    dest.on("unpipe", onunpipe);
    function onunpipe(readable, unpipeInfo) {
      debug("onunpipe");
      if (readable === src) {
        if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
          unpipeInfo.hasUnpiped = true;
          cleanup();
        }
      }
    }
    function onend() {
      debug("onend");
      dest.end();
    }
    var ondrain = pipeOnDrain(src);
    dest.on("drain", ondrain);
    var cleanedUp = false;
    function cleanup() {
      debug("cleanup");
      dest.removeListener("close", onclose);
      dest.removeListener("finish", onfinish);
      dest.removeListener("drain", ondrain);
      dest.removeListener("error", onerror);
      dest.removeListener("unpipe", onunpipe);
      src.removeListener("end", onend);
      src.removeListener("end", unpipe);
      src.removeListener("data", ondata);
      cleanedUp = true;
      if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain))
        ondrain();
    }
    src.on("data", ondata);
    function ondata(chunk) {
      debug("ondata");
      var ret = dest.write(chunk);
      debug("dest.write", ret);
      if (ret === false) {
        if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
          debug("false write response, pause", state.awaitDrain);
          state.awaitDrain++;
        }
        src.pause();
      }
    }
    function onerror(er) {
      debug("onerror", er);
      unpipe();
      dest.removeListener("error", onerror);
      if (EElistenerCount(dest, "error") === 0)
        errorOrDestroy(dest, er);
    }
    prependListener(dest, "error", onerror);
    function onclose() {
      dest.removeListener("finish", onfinish);
      unpipe();
    }
    dest.once("close", onclose);
    function onfinish() {
      debug("onfinish");
      dest.removeListener("close", onclose);
      unpipe();
    }
    dest.once("finish", onfinish);
    function unpipe() {
      debug("unpipe");
      src.unpipe(dest);
    }
    dest.emit("pipe", src);
    if (!state.flowing) {
      debug("pipe resume");
      src.resume();
    }
    return dest;
  };
  function pipeOnDrain(src) {
    return function pipeOnDrainFunctionResult() {
      var state = src._readableState;
      debug("pipeOnDrain", state.awaitDrain);
      if (state.awaitDrain)
        state.awaitDrain--;
      if (state.awaitDrain === 0 && EElistenerCount(src, "data")) {
        state.flowing = true;
        flow(src);
      }
    };
  }
  Readable.prototype.unpipe = function(dest) {
    var state = this._readableState;
    var unpipeInfo = {
      hasUnpiped: false
    };
    if (state.pipesCount === 0)
      return this;
    if (state.pipesCount === 1) {
      if (dest && dest !== state.pipes)
        return this;
      if (!dest)
        dest = state.pipes;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      if (dest)
        dest.emit("unpipe", this, unpipeInfo);
      return this;
    }
    if (!dest) {
      var dests = state.pipes;
      var len = state.pipesCount;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      for (var i = 0;i < len; i++)
        dests[i].emit("unpipe", this, {
          hasUnpiped: false
        });
      return this;
    }
    var index = indexOf(state.pipes, dest);
    if (index === -1)
      return this;
    state.pipes.splice(index, 1);
    state.pipesCount -= 1;
    if (state.pipesCount === 1)
      state.pipes = state.pipes[0];
    dest.emit("unpipe", this, unpipeInfo);
    return this;
  };
  Readable.prototype.on = function(ev, fn) {
    var res = Stream.prototype.on.call(this, ev, fn);
    var state = this._readableState;
    if (ev === "data") {
      state.readableListening = this.listenerCount("readable") > 0;
      if (state.flowing !== false)
        this.resume();
    } else if (ev === "readable") {
      if (!state.endEmitted && !state.readableListening) {
        state.readableListening = state.needReadable = true;
        state.flowing = false;
        state.emittedReadable = false;
        debug("on readable", state.length, state.reading);
        if (state.length) {
          emitReadable(this);
        } else if (!state.reading) {
          process.nextTick(nReadingNextTick, this);
        }
      }
    }
    return res;
  };
  Readable.prototype.addListener = Readable.prototype.on;
  Readable.prototype.removeListener = function(ev, fn) {
    var res = Stream.prototype.removeListener.call(this, ev, fn);
    if (ev === "readable") {
      process.nextTick(updateReadableListening, this);
    }
    return res;
  };
  Readable.prototype.removeAllListeners = function(ev) {
    var res = Stream.prototype.removeAllListeners.apply(this, arguments);
    if (ev === "readable" || ev === undefined) {
      process.nextTick(updateReadableListening, this);
    }
    return res;
  };
  function updateReadableListening(self2) {
    var state = self2._readableState;
    state.readableListening = self2.listenerCount("readable") > 0;
    if (state.resumeScheduled && !state.paused) {
      state.flowing = true;
    } else if (self2.listenerCount("data") > 0) {
      self2.resume();
    }
  }
  function nReadingNextTick(self2) {
    debug("readable nexttick read 0");
    self2.read(0);
  }
  Readable.prototype.resume = function() {
    var state = this._readableState;
    if (!state.flowing) {
      debug("resume");
      state.flowing = !state.readableListening;
      resume(this, state);
    }
    state.paused = false;
    return this;
  };
  function resume(stream, state) {
    if (!state.resumeScheduled) {
      state.resumeScheduled = true;
      process.nextTick(resume_, stream, state);
    }
  }
  function resume_(stream, state) {
    debug("resume", state.reading);
    if (!state.reading) {
      stream.read(0);
    }
    state.resumeScheduled = false;
    stream.emit("resume");
    flow(stream);
    if (state.flowing && !state.reading)
      stream.read(0);
  }
  Readable.prototype.pause = function() {
    debug("call pause flowing=%j", this._readableState.flowing);
    if (this._readableState.flowing !== false) {
      debug("pause");
      this._readableState.flowing = false;
      this.emit("pause");
    }
    this._readableState.paused = true;
    return this;
  };
  function flow(stream) {
    var state = stream._readableState;
    debug("flow", state.flowing);
    while (state.flowing && stream.read() !== null)
      ;
  }
  Readable.prototype.wrap = function(stream) {
    var _this = this;
    var state = this._readableState;
    var paused = false;
    stream.on("end", function() {
      debug("wrapped end");
      if (state.decoder && !state.ended) {
        var chunk = state.decoder.end();
        if (chunk && chunk.length)
          _this.push(chunk);
      }
      _this.push(null);
    });
    stream.on("data", function(chunk) {
      debug("wrapped data");
      if (state.decoder)
        chunk = state.decoder.write(chunk);
      if (state.objectMode && (chunk === null || chunk === undefined))
        return;
      else if (!state.objectMode && (!chunk || !chunk.length))
        return;
      var ret = _this.push(chunk);
      if (!ret) {
        paused = true;
        stream.pause();
      }
    });
    for (var i in stream) {
      if (this[i] === undefined && typeof stream[i] === "function") {
        this[i] = function methodWrap(method) {
          return function methodWrapReturnFunction() {
            return stream[method].apply(stream, arguments);
          };
        }(i);
      }
    }
    for (var n = 0;n < kProxyEvents.length; n++) {
      stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
    }
    this._read = function(n2) {
      debug("wrapped _read", n2);
      if (paused) {
        paused = false;
        stream.resume();
      }
    };
    return this;
  };
  if (typeof Symbol === "function") {
    Readable.prototype[Symbol.asyncIterator] = function() {
      if (createReadableStreamAsyncIterator === undefined) {
        createReadableStreamAsyncIterator = require_async_iterator2();
      }
      return createReadableStreamAsyncIterator(this);
    };
  }
  Object.defineProperty(Readable.prototype, "readableHighWaterMark", {
    enumerable: false,
    get: function get() {
      return this._readableState.highWaterMark;
    }
  });
  Object.defineProperty(Readable.prototype, "readableBuffer", {
    enumerable: false,
    get: function get() {
      return this._readableState && this._readableState.buffer;
    }
  });
  Object.defineProperty(Readable.prototype, "readableFlowing", {
    enumerable: false,
    get: function get() {
      return this._readableState.flowing;
    },
    set: function set(state) {
      if (this._readableState) {
        this._readableState.flowing = state;
      }
    }
  });
  Readable._fromList = fromList;
  Object.defineProperty(Readable.prototype, "readableLength", {
    enumerable: false,
    get: function get() {
      return this._readableState.length;
    }
  });
  function fromList(n, state) {
    if (state.length === 0)
      return null;
    var ret;
    if (state.objectMode)
      ret = state.buffer.shift();
    else if (!n || n >= state.length) {
      if (state.decoder)
        ret = state.buffer.join("");
      else if (state.buffer.length === 1)
        ret = state.buffer.first();
      else
        ret = state.buffer.concat(state.length);
      state.buffer.clear();
    } else {
      ret = state.buffer.consume(n, state.decoder);
    }
    return ret;
  }
  function endReadable(stream) {
    var state = stream._readableState;
    debug("endReadable", state.endEmitted);
    if (!state.endEmitted) {
      state.ended = true;
      process.nextTick(endReadableNT, state, stream);
    }
  }
  function endReadableNT(state, stream) {
    debug("endReadableNT", state.endEmitted, state.length);
    if (!state.endEmitted && state.length === 0) {
      state.endEmitted = true;
      stream.readable = false;
      stream.emit("end");
      if (state.autoDestroy) {
        var wState = stream._writableState;
        if (!wState || wState.autoDestroy && wState.finished) {
          stream.destroy();
        }
      }
    }
  }
  if (typeof Symbol === "function") {
    Readable.from = function(iterable, opts) {
      if (from === undefined) {
        from = require_from2();
      }
      return from(Readable, iterable, opts);
    };
  }
  function indexOf(xs, x) {
    for (var i = 0, l = xs.length;i < l; i++) {
      if (xs[i] === x)
        return i;
    }
    return -1;
  }
});

// node_modules/winston/node_modules/readable-stream/lib/_stream_transform.js
var require__stream_transform = __commonJS((exports, module) => {
  module.exports = Transform;
  var _require$codes = require_errors3().codes;
  var ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED;
  var ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK;
  var ERR_TRANSFORM_ALREADY_TRANSFORMING = _require$codes.ERR_TRANSFORM_ALREADY_TRANSFORMING;
  var ERR_TRANSFORM_WITH_LENGTH_0 = _require$codes.ERR_TRANSFORM_WITH_LENGTH_0;
  var Duplex = require__stream_duplex2();
  require_inherits()(Transform, Duplex);
  function afterTransform(er, data) {
    var ts = this._transformState;
    ts.transforming = false;
    var cb = ts.writecb;
    if (cb === null) {
      return this.emit("error", new ERR_MULTIPLE_CALLBACK);
    }
    ts.writechunk = null;
    ts.writecb = null;
    if (data != null)
      this.push(data);
    cb(er);
    var rs = this._readableState;
    rs.reading = false;
    if (rs.needReadable || rs.length < rs.highWaterMark) {
      this._read(rs.highWaterMark);
    }
  }
  function Transform(options) {
    if (!(this instanceof Transform))
      return new Transform(options);
    Duplex.call(this, options);
    this._transformState = {
      afterTransform: afterTransform.bind(this),
      needTransform: false,
      transforming: false,
      writecb: null,
      writechunk: null,
      writeencoding: null
    };
    this._readableState.needReadable = true;
    this._readableState.sync = false;
    if (options) {
      if (typeof options.transform === "function")
        this._transform = options.transform;
      if (typeof options.flush === "function")
        this._flush = options.flush;
    }
    this.on("prefinish", prefinish);
  }
  function prefinish() {
    var _this = this;
    if (typeof this._flush === "function" && !this._readableState.destroyed) {
      this._flush(function(er, data) {
        done(_this, er, data);
      });
    } else {
      done(this, null, null);
    }
  }
  Transform.prototype.push = function(chunk, encoding) {
    this._transformState.needTransform = false;
    return Duplex.prototype.push.call(this, chunk, encoding);
  };
  Transform.prototype._transform = function(chunk, encoding, cb) {
    cb(new ERR_METHOD_NOT_IMPLEMENTED("_transform()"));
  };
  Transform.prototype._write = function(chunk, encoding, cb) {
    var ts = this._transformState;
    ts.writecb = cb;
    ts.writechunk = chunk;
    ts.writeencoding = encoding;
    if (!ts.transforming) {
      var rs = this._readableState;
      if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark)
        this._read(rs.highWaterMark);
    }
  };
  Transform.prototype._read = function(n) {
    var ts = this._transformState;
    if (ts.writechunk !== null && !ts.transforming) {
      ts.transforming = true;
      this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
    } else {
      ts.needTransform = true;
    }
  };
  Transform.prototype._destroy = function(err, cb) {
    Duplex.prototype._destroy.call(this, err, function(err2) {
      cb(err2);
    });
  };
  function done(stream, er, data) {
    if (er)
      return stream.emit("error", er);
    if (data != null)
      stream.push(data);
    if (stream._writableState.length)
      throw new ERR_TRANSFORM_WITH_LENGTH_0;
    if (stream._transformState.transforming)
      throw new ERR_TRANSFORM_ALREADY_TRANSFORMING;
    return stream.push(null);
  }
});

// node_modules/winston/node_modules/readable-stream/lib/_stream_passthrough.js
var require__stream_passthrough = __commonJS((exports, module) => {
  module.exports = PassThrough;
  var Transform = require__stream_transform();
  require_inherits()(PassThrough, Transform);
  function PassThrough(options) {
    if (!(this instanceof PassThrough))
      return new PassThrough(options);
    Transform.call(this, options);
  }
  PassThrough.prototype._transform = function(chunk, encoding, cb) {
    cb(null, chunk);
  };
});

// node_modules/winston/node_modules/readable-stream/lib/internal/streams/pipeline.js
var require_pipeline = __commonJS((exports, module) => {
  var eos;
  function once(callback) {
    var called = false;
    return function() {
      if (called)
        return;
      called = true;
      callback.apply(undefined, arguments);
    };
  }
  var _require$codes = require_errors3().codes;
  var ERR_MISSING_ARGS = _require$codes.ERR_MISSING_ARGS;
  var ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;
  function noop(err) {
    if (err)
      throw err;
  }
  function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === "function";
  }
  function destroyer(stream, reading, writing, callback) {
    callback = once(callback);
    var closed = false;
    stream.on("close", function() {
      closed = true;
    });
    if (eos === undefined)
      eos = require_end_of_stream2();
    eos(stream, {
      readable: reading,
      writable: writing
    }, function(err) {
      if (err)
        return callback(err);
      closed = true;
      callback();
    });
    var destroyed = false;
    return function(err) {
      if (closed)
        return;
      if (destroyed)
        return;
      destroyed = true;
      if (isRequest(stream))
        return stream.abort();
      if (typeof stream.destroy === "function")
        return stream.destroy();
      callback(err || new ERR_STREAM_DESTROYED("pipe"));
    };
  }
  function call(fn) {
    fn();
  }
  function pipe(from, to) {
    return from.pipe(to);
  }
  function popCallback(streams) {
    if (!streams.length)
      return noop;
    if (typeof streams[streams.length - 1] !== "function")
      return noop;
    return streams.pop();
  }
  function pipeline() {
    for (var _len = arguments.length, streams = new Array(_len), _key = 0;_key < _len; _key++) {
      streams[_key] = arguments[_key];
    }
    var callback = popCallback(streams);
    if (Array.isArray(streams[0]))
      streams = streams[0];
    if (streams.length < 2) {
      throw new ERR_MISSING_ARGS("streams");
    }
    var error;
    var destroys = streams.map(function(stream, i) {
      var reading = i < streams.length - 1;
      var writing = i > 0;
      return destroyer(stream, reading, writing, function(err) {
        if (!error)
          error = err;
        if (err)
          destroys.forEach(call);
        if (reading)
          return;
        destroys.forEach(call);
        callback(error);
      });
    });
    return streams.reduce(pipe);
  }
  module.exports = pipeline;
});

// node_modules/winston/node_modules/readable-stream/readable.js
var require_readable = __commonJS((exports, module) => {
  var Stream = __require("stream");
  if (process.env.READABLE_STREAM === "disable" && Stream) {
    module.exports = Stream.Readable;
    Object.assign(module.exports, Stream);
    module.exports.Stream = Stream;
  } else {
    exports = module.exports = require__stream_readable2();
    exports.Stream = Stream || exports;
    exports.Readable = exports;
    exports.Writable = require__stream_writable2();
    exports.Duplex = require__stream_duplex2();
    exports.Transform = require__stream_transform();
    exports.PassThrough = require__stream_passthrough();
    exports.finished = require_end_of_stream2();
    exports.pipeline = require_pipeline();
  }
});

// node_modules/@dabh/diagnostics/diagnostics.js
var require_diagnostics = __commonJS((exports, module) => {
  var adapters = [];
  var modifiers = [];
  var logger = function devnull() {};
  function use(adapter) {
    if (~adapters.indexOf(adapter))
      return false;
    adapters.push(adapter);
    return true;
  }
  function set(custom) {
    logger = custom;
  }
  function enabled(namespace) {
    var async = [];
    for (var i = 0;i < adapters.length; i++) {
      if (adapters[i].async) {
        async.push(adapters[i]);
        continue;
      }
      if (adapters[i](namespace))
        return true;
    }
    if (!async.length)
      return false;
    return new Promise(function pinky(resolve4) {
      Promise.all(async.map(function prebind(fn) {
        return fn(namespace);
      })).then(function resolved(values) {
        resolve4(values.some(Boolean));
      });
    });
  }
  function modify(fn) {
    if (~modifiers.indexOf(fn))
      return false;
    modifiers.push(fn);
    return true;
  }
  function write() {
    logger.apply(logger, arguments);
  }
  function process2(message) {
    for (var i = 0;i < modifiers.length; i++) {
      message = modifiers[i].apply(modifiers[i], arguments);
    }
    return message;
  }
  function introduce(fn, options) {
    var has = Object.prototype.hasOwnProperty;
    for (var key in options) {
      if (has.call(options, key)) {
        fn[key] = options[key];
      }
    }
    return fn;
  }
  function nope(options) {
    options.enabled = false;
    options.modify = modify;
    options.set = set;
    options.use = use;
    return introduce(function diagnopes() {
      return false;
    }, options);
  }
  function yep(options) {
    function diagnostics() {
      var args = Array.prototype.slice.call(arguments, 0);
      write.call(write, options, process2(args, options));
      return true;
    }
    options.enabled = true;
    options.modify = modify;
    options.set = set;
    options.use = use;
    return introduce(diagnostics, options);
  }
  module.exports = function create(diagnostics) {
    diagnostics.introduce = introduce;
    diagnostics.enabled = enabled;
    diagnostics.process = process2;
    diagnostics.modify = modify;
    diagnostics.write = write;
    diagnostics.nope = nope;
    diagnostics.yep = yep;
    diagnostics.set = set;
    diagnostics.use = use;
    return diagnostics;
  };
});

// node_modules/@so-ric/colorspace/dist/index.cjs.js
var require_index_cjs = __commonJS((exports, module) => {
  var cssKeywords = {
    aliceblue: [240, 248, 255],
    antiquewhite: [250, 235, 215],
    aqua: [0, 255, 255],
    aquamarine: [127, 255, 212],
    azure: [240, 255, 255],
    beige: [245, 245, 220],
    bisque: [255, 228, 196],
    black: [0, 0, 0],
    blanchedalmond: [255, 235, 205],
    blue: [0, 0, 255],
    blueviolet: [138, 43, 226],
    brown: [165, 42, 42],
    burlywood: [222, 184, 135],
    cadetblue: [95, 158, 160],
    chartreuse: [127, 255, 0],
    chocolate: [210, 105, 30],
    coral: [255, 127, 80],
    cornflowerblue: [100, 149, 237],
    cornsilk: [255, 248, 220],
    crimson: [220, 20, 60],
    cyan: [0, 255, 255],
    darkblue: [0, 0, 139],
    darkcyan: [0, 139, 139],
    darkgoldenrod: [184, 134, 11],
    darkgray: [169, 169, 169],
    darkgreen: [0, 100, 0],
    darkgrey: [169, 169, 169],
    darkkhaki: [189, 183, 107],
    darkmagenta: [139, 0, 139],
    darkolivegreen: [85, 107, 47],
    darkorange: [255, 140, 0],
    darkorchid: [153, 50, 204],
    darkred: [139, 0, 0],
    darksalmon: [233, 150, 122],
    darkseagreen: [143, 188, 143],
    darkslateblue: [72, 61, 139],
    darkslategray: [47, 79, 79],
    darkslategrey: [47, 79, 79],
    darkturquoise: [0, 206, 209],
    darkviolet: [148, 0, 211],
    deeppink: [255, 20, 147],
    deepskyblue: [0, 191, 255],
    dimgray: [105, 105, 105],
    dimgrey: [105, 105, 105],
    dodgerblue: [30, 144, 255],
    firebrick: [178, 34, 34],
    floralwhite: [255, 250, 240],
    forestgreen: [34, 139, 34],
    fuchsia: [255, 0, 255],
    gainsboro: [220, 220, 220],
    ghostwhite: [248, 248, 255],
    gold: [255, 215, 0],
    goldenrod: [218, 165, 32],
    gray: [128, 128, 128],
    green: [0, 128, 0],
    greenyellow: [173, 255, 47],
    grey: [128, 128, 128],
    honeydew: [240, 255, 240],
    hotpink: [255, 105, 180],
    indianred: [205, 92, 92],
    indigo: [75, 0, 130],
    ivory: [255, 255, 240],
    khaki: [240, 230, 140],
    lavender: [230, 230, 250],
    lavenderblush: [255, 240, 245],
    lawngreen: [124, 252, 0],
    lemonchiffon: [255, 250, 205],
    lightblue: [173, 216, 230],
    lightcoral: [240, 128, 128],
    lightcyan: [224, 255, 255],
    lightgoldenrodyellow: [250, 250, 210],
    lightgray: [211, 211, 211],
    lightgreen: [144, 238, 144],
    lightgrey: [211, 211, 211],
    lightpink: [255, 182, 193],
    lightsalmon: [255, 160, 122],
    lightseagreen: [32, 178, 170],
    lightskyblue: [135, 206, 250],
    lightslategray: [119, 136, 153],
    lightslategrey: [119, 136, 153],
    lightsteelblue: [176, 196, 222],
    lightyellow: [255, 255, 224],
    lime: [0, 255, 0],
    limegreen: [50, 205, 50],
    linen: [250, 240, 230],
    magenta: [255, 0, 255],
    maroon: [128, 0, 0],
    mediumaquamarine: [102, 205, 170],
    mediumblue: [0, 0, 205],
    mediumorchid: [186, 85, 211],
    mediumpurple: [147, 112, 219],
    mediumseagreen: [60, 179, 113],
    mediumslateblue: [123, 104, 238],
    mediumspringgreen: [0, 250, 154],
    mediumturquoise: [72, 209, 204],
    mediumvioletred: [199, 21, 133],
    midnightblue: [25, 25, 112],
    mintcream: [245, 255, 250],
    mistyrose: [255, 228, 225],
    moccasin: [255, 228, 181],
    navajowhite: [255, 222, 173],
    navy: [0, 0, 128],
    oldlace: [253, 245, 230],
    olive: [128, 128, 0],
    olivedrab: [107, 142, 35],
    orange: [255, 165, 0],
    orangered: [255, 69, 0],
    orchid: [218, 112, 214],
    palegoldenrod: [238, 232, 170],
    palegreen: [152, 251, 152],
    paleturquoise: [175, 238, 238],
    palevioletred: [219, 112, 147],
    papayawhip: [255, 239, 213],
    peachpuff: [255, 218, 185],
    peru: [205, 133, 63],
    pink: [255, 192, 203],
    plum: [221, 160, 221],
    powderblue: [176, 224, 230],
    purple: [128, 0, 128],
    rebeccapurple: [102, 51, 153],
    red: [255, 0, 0],
    rosybrown: [188, 143, 143],
    royalblue: [65, 105, 225],
    saddlebrown: [139, 69, 19],
    salmon: [250, 128, 114],
    sandybrown: [244, 164, 96],
    seagreen: [46, 139, 87],
    seashell: [255, 245, 238],
    sienna: [160, 82, 45],
    silver: [192, 192, 192],
    skyblue: [135, 206, 235],
    slateblue: [106, 90, 205],
    slategray: [112, 128, 144],
    slategrey: [112, 128, 144],
    snow: [255, 250, 250],
    springgreen: [0, 255, 127],
    steelblue: [70, 130, 180],
    tan: [210, 180, 140],
    teal: [0, 128, 128],
    thistle: [216, 191, 216],
    tomato: [255, 99, 71],
    turquoise: [64, 224, 208],
    violet: [238, 130, 238],
    wheat: [245, 222, 179],
    white: [255, 255, 255],
    whitesmoke: [245, 245, 245],
    yellow: [255, 255, 0],
    yellowgreen: [154, 205, 50]
  };
  var reverseNames = Object.create(null);
  for (const name in cssKeywords) {
    if (Object.hasOwn(cssKeywords, name)) {
      reverseNames[cssKeywords[name]] = name;
    }
  }
  var cs = {
    to: {},
    get: {}
  };
  cs.get = function(string) {
    const prefix = string.slice(0, 3).toLowerCase();
    let value;
    let model;
    switch (prefix) {
      case "hsl": {
        value = cs.get.hsl(string);
        model = "hsl";
        break;
      }
      case "hwb": {
        value = cs.get.hwb(string);
        model = "hwb";
        break;
      }
      default: {
        value = cs.get.rgb(string);
        model = "rgb";
        break;
      }
    }
    if (!value) {
      return null;
    }
    return { model, value };
  };
  cs.get.rgb = function(string) {
    if (!string) {
      return null;
    }
    const abbr = /^#([a-f\d]{3,4})$/i;
    const hex2 = /^#([a-f\d]{6})([a-f\d]{2})?$/i;
    const rgba = /^rgba?\(\s*([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)(?=[\s,])\s*(?:,\s*)?([+-]?\d+)\s*(?:[\s,|/]\s*([+-]?[\d.]+)(%?)\s*)?\)$/;
    const per = /^rgba?\(\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*(?:[\s,|/]\s*([+-]?[\d.]+)(%?)\s*)?\)$/;
    const keyword = /^(\w+)$/;
    let rgb = [0, 0, 0, 1];
    let match;
    let i;
    let hexAlpha;
    if (match = string.match(hex2)) {
      hexAlpha = match[2];
      match = match[1];
      for (i = 0;i < 3; i++) {
        const i2 = i * 2;
        rgb[i] = Number.parseInt(match.slice(i2, i2 + 2), 16);
      }
      if (hexAlpha) {
        rgb[3] = Number.parseInt(hexAlpha, 16) / 255;
      }
    } else if (match = string.match(abbr)) {
      match = match[1];
      hexAlpha = match[3];
      for (i = 0;i < 3; i++) {
        rgb[i] = Number.parseInt(match[i] + match[i], 16);
      }
      if (hexAlpha) {
        rgb[3] = Number.parseInt(hexAlpha + hexAlpha, 16) / 255;
      }
    } else if (match = string.match(rgba)) {
      for (i = 0;i < 3; i++) {
        rgb[i] = Number.parseInt(match[i + 1], 10);
      }
      if (match[4]) {
        rgb[3] = match[5] ? Number.parseFloat(match[4]) * 0.01 : Number.parseFloat(match[4]);
      }
    } else if (match = string.match(per)) {
      for (i = 0;i < 3; i++) {
        rgb[i] = Math.round(Number.parseFloat(match[i + 1]) * 2.55);
      }
      if (match[4]) {
        rgb[3] = match[5] ? Number.parseFloat(match[4]) * 0.01 : Number.parseFloat(match[4]);
      }
    } else if (match = string.match(keyword)) {
      if (match[1] === "transparent") {
        return [0, 0, 0, 0];
      }
      if (!Object.hasOwn(cssKeywords, match[1])) {
        return null;
      }
      rgb = cssKeywords[match[1]];
      rgb[3] = 1;
      return rgb;
    } else {
      return null;
    }
    for (i = 0;i < 3; i++) {
      rgb[i] = clamp(rgb[i], 0, 255);
    }
    rgb[3] = clamp(rgb[3], 0, 1);
    return rgb;
  };
  cs.get.hsl = function(string) {
    if (!string) {
      return null;
    }
    const hsl = /^hsla?\(\s*([+-]?(?:\d{0,3}\.)?\d+)(?:deg)?\s*,?\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*(?:[,|/]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*)?\)$/;
    const match = string.match(hsl);
    if (match) {
      const alpha = Number.parseFloat(match[4]);
      const h = (Number.parseFloat(match[1]) % 360 + 360) % 360;
      const s = clamp(Number.parseFloat(match[2]), 0, 100);
      const l = clamp(Number.parseFloat(match[3]), 0, 100);
      const a = clamp(Number.isNaN(alpha) ? 1 : alpha, 0, 1);
      return [h, s, l, a];
    }
    return null;
  };
  cs.get.hwb = function(string) {
    if (!string) {
      return null;
    }
    const hwb = /^hwb\(\s*([+-]?\d{0,3}(?:\.\d+)?)(?:deg)?\s*[\s,]\s*([+-]?[\d.]+)%\s*[\s,]\s*([+-]?[\d.]+)%\s*(?:[\s,]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*)?\)$/;
    const match = string.match(hwb);
    if (match) {
      const alpha = Number.parseFloat(match[4]);
      const h = (Number.parseFloat(match[1]) % 360 + 360) % 360;
      const w = clamp(Number.parseFloat(match[2]), 0, 100);
      const b = clamp(Number.parseFloat(match[3]), 0, 100);
      const a = clamp(Number.isNaN(alpha) ? 1 : alpha, 0, 1);
      return [h, w, b, a];
    }
    return null;
  };
  cs.to.hex = function(...rgba) {
    return "#" + hexDouble(rgba[0]) + hexDouble(rgba[1]) + hexDouble(rgba[2]) + (rgba[3] < 1 ? hexDouble(Math.round(rgba[3] * 255)) : "");
  };
  cs.to.rgb = function(...rgba) {
    return rgba.length < 4 || rgba[3] === 1 ? "rgb(" + Math.round(rgba[0]) + ", " + Math.round(rgba[1]) + ", " + Math.round(rgba[2]) + ")" : "rgba(" + Math.round(rgba[0]) + ", " + Math.round(rgba[1]) + ", " + Math.round(rgba[2]) + ", " + rgba[3] + ")";
  };
  cs.to.rgb.percent = function(...rgba) {
    const r = Math.round(rgba[0] / 255 * 100);
    const g = Math.round(rgba[1] / 255 * 100);
    const b = Math.round(rgba[2] / 255 * 100);
    return rgba.length < 4 || rgba[3] === 1 ? "rgb(" + r + "%, " + g + "%, " + b + "%)" : "rgba(" + r + "%, " + g + "%, " + b + "%, " + rgba[3] + ")";
  };
  cs.to.hsl = function(...hsla) {
    return hsla.length < 4 || hsla[3] === 1 ? "hsl(" + hsla[0] + ", " + hsla[1] + "%, " + hsla[2] + "%)" : "hsla(" + hsla[0] + ", " + hsla[1] + "%, " + hsla[2] + "%, " + hsla[3] + ")";
  };
  cs.to.hwb = function(...hwba) {
    let a = "";
    if (hwba.length >= 4 && hwba[3] !== 1) {
      a = ", " + hwba[3];
    }
    return "hwb(" + hwba[0] + ", " + hwba[1] + "%, " + hwba[2] + "%" + a + ")";
  };
  cs.to.keyword = function(...rgb) {
    return reverseNames[rgb.slice(0, 3)];
  };
  function clamp(number_, min, max) {
    return Math.min(Math.max(min, number_), max);
  }
  function hexDouble(number_) {
    const string_ = Math.round(number_).toString(16).toUpperCase();
    return string_.length < 2 ? "0" + string_ : string_;
  }
  var reverseKeywords = {};
  for (const key of Object.keys(cssKeywords)) {
    reverseKeywords[cssKeywords[key]] = key;
  }
  var convert$1 = {
    rgb: { channels: 3, labels: "rgb" },
    hsl: { channels: 3, labels: "hsl" },
    hsv: { channels: 3, labels: "hsv" },
    hwb: { channels: 3, labels: "hwb" },
    cmyk: { channels: 4, labels: "cmyk" },
    xyz: { channels: 3, labels: "xyz" },
    lab: { channels: 3, labels: "lab" },
    oklab: { channels: 3, labels: ["okl", "oka", "okb"] },
    lch: { channels: 3, labels: "lch" },
    oklch: { channels: 3, labels: ["okl", "okc", "okh"] },
    hex: { channels: 1, labels: ["hex"] },
    keyword: { channels: 1, labels: ["keyword"] },
    ansi16: { channels: 1, labels: ["ansi16"] },
    ansi256: { channels: 1, labels: ["ansi256"] },
    hcg: { channels: 3, labels: ["h", "c", "g"] },
    apple: { channels: 3, labels: ["r16", "g16", "b16"] },
    gray: { channels: 1, labels: ["gray"] }
  };
  var LAB_FT = (6 / 29) ** 3;
  function srgbNonlinearTransform(c) {
    const cc = c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : c * 12.92;
    return Math.min(Math.max(0, cc), 1);
  }
  function srgbNonlinearTransformInv(c) {
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  }
  for (const model of Object.keys(convert$1)) {
    if (!("channels" in convert$1[model])) {
      throw new Error("missing channels property: " + model);
    }
    if (!("labels" in convert$1[model])) {
      throw new Error("missing channel labels property: " + model);
    }
    if (convert$1[model].labels.length !== convert$1[model].channels) {
      throw new Error("channel and label counts mismatch: " + model);
    }
    const { channels, labels } = convert$1[model];
    delete convert$1[model].channels;
    delete convert$1[model].labels;
    Object.defineProperty(convert$1[model], "channels", { value: channels });
    Object.defineProperty(convert$1[model], "labels", { value: labels });
  }
  convert$1.rgb.hsl = function(rgb) {
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    const delta = max - min;
    let h;
    let s;
    switch (max) {
      case min: {
        h = 0;
        break;
      }
      case r: {
        h = (g - b) / delta;
        break;
      }
      case g: {
        h = 2 + (b - r) / delta;
        break;
      }
      case b: {
        h = 4 + (r - g) / delta;
        break;
      }
    }
    h = Math.min(h * 60, 360);
    if (h < 0) {
      h += 360;
    }
    const l = (min + max) / 2;
    if (max === min) {
      s = 0;
    } else if (l <= 0.5) {
      s = delta / (max + min);
    } else {
      s = delta / (2 - max - min);
    }
    return [h, s * 100, l * 100];
  };
  convert$1.rgb.hsv = function(rgb) {
    let rdif;
    let gdif;
    let bdif;
    let h;
    let s;
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    const v = Math.max(r, g, b);
    const diff = v - Math.min(r, g, b);
    const diffc = function(c) {
      return (v - c) / 6 / diff + 1 / 2;
    };
    if (diff === 0) {
      h = 0;
      s = 0;
    } else {
      s = diff / v;
      rdif = diffc(r);
      gdif = diffc(g);
      bdif = diffc(b);
      switch (v) {
        case r: {
          h = bdif - gdif;
          break;
        }
        case g: {
          h = 1 / 3 + rdif - bdif;
          break;
        }
        case b: {
          h = 2 / 3 + gdif - rdif;
          break;
        }
      }
      if (h < 0) {
        h += 1;
      } else if (h > 1) {
        h -= 1;
      }
    }
    return [
      h * 360,
      s * 100,
      v * 100
    ];
  };
  convert$1.rgb.hwb = function(rgb) {
    const r = rgb[0];
    const g = rgb[1];
    let b = rgb[2];
    const h = convert$1.rgb.hsl(rgb)[0];
    const w = 1 / 255 * Math.min(r, Math.min(g, b));
    b = 1 - 1 / 255 * Math.max(r, Math.max(g, b));
    return [h, w * 100, b * 100];
  };
  convert$1.rgb.oklab = function(rgb) {
    const r = srgbNonlinearTransformInv(rgb[0] / 255);
    const g = srgbNonlinearTransformInv(rgb[1] / 255);
    const b = srgbNonlinearTransformInv(rgb[2] / 255);
    const lp = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const mp = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const sp = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const l = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
    const aa = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
    const bb = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;
    return [l * 100, aa * 100, bb * 100];
  };
  convert$1.rgb.cmyk = function(rgb) {
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    const k = Math.min(1 - r, 1 - g, 1 - b);
    const c = (1 - r - k) / (1 - k) || 0;
    const m = (1 - g - k) / (1 - k) || 0;
    const y = (1 - b - k) / (1 - k) || 0;
    return [c * 100, m * 100, y * 100, k * 100];
  };
  function comparativeDistance(x, y) {
    return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2;
  }
  convert$1.rgb.keyword = function(rgb) {
    const reversed = reverseKeywords[rgb];
    if (reversed) {
      return reversed;
    }
    let currentClosestDistance = Number.POSITIVE_INFINITY;
    let currentClosestKeyword;
    for (const keyword of Object.keys(cssKeywords)) {
      const value = cssKeywords[keyword];
      const distance = comparativeDistance(rgb, value);
      if (distance < currentClosestDistance) {
        currentClosestDistance = distance;
        currentClosestKeyword = keyword;
      }
    }
    return currentClosestKeyword;
  };
  convert$1.keyword.rgb = function(keyword) {
    return cssKeywords[keyword];
  };
  convert$1.rgb.xyz = function(rgb) {
    const r = srgbNonlinearTransformInv(rgb[0] / 255);
    const g = srgbNonlinearTransformInv(rgb[1] / 255);
    const b = srgbNonlinearTransformInv(rgb[2] / 255);
    const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
    return [x * 100, y * 100, z * 100];
  };
  convert$1.rgb.lab = function(rgb) {
    const xyz = convert$1.rgb.xyz(rgb);
    let x = xyz[0];
    let y = xyz[1];
    let z = xyz[2];
    x /= 95.047;
    y /= 100;
    z /= 108.883;
    x = x > LAB_FT ? x ** (1 / 3) : 7.787 * x + 16 / 116;
    y = y > LAB_FT ? y ** (1 / 3) : 7.787 * y + 16 / 116;
    z = z > LAB_FT ? z ** (1 / 3) : 7.787 * z + 16 / 116;
    const l = 116 * y - 16;
    const a = 500 * (x - y);
    const b = 200 * (y - z);
    return [l, a, b];
  };
  convert$1.hsl.rgb = function(hsl) {
    const h = hsl[0] / 360;
    const s = hsl[1] / 100;
    const l = hsl[2] / 100;
    let t3;
    let value;
    if (s === 0) {
      value = l * 255;
      return [value, value, value];
    }
    const t2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const t1 = 2 * l - t2;
    const rgb = [0, 0, 0];
    for (let i = 0;i < 3; i++) {
      t3 = h + 1 / 3 * -(i - 1);
      if (t3 < 0) {
        t3++;
      }
      if (t3 > 1) {
        t3--;
      }
      if (6 * t3 < 1) {
        value = t1 + (t2 - t1) * 6 * t3;
      } else if (2 * t3 < 1) {
        value = t2;
      } else if (3 * t3 < 2) {
        value = t1 + (t2 - t1) * (2 / 3 - t3) * 6;
      } else {
        value = t1;
      }
      rgb[i] = value * 255;
    }
    return rgb;
  };
  convert$1.hsl.hsv = function(hsl) {
    const h = hsl[0];
    let s = hsl[1] / 100;
    let l = hsl[2] / 100;
    let smin = s;
    const lmin = Math.max(l, 0.01);
    l *= 2;
    s *= l <= 1 ? l : 2 - l;
    smin *= lmin <= 1 ? lmin : 2 - lmin;
    const v = (l + s) / 2;
    const sv = l === 0 ? 2 * smin / (lmin + smin) : 2 * s / (l + s);
    return [h, sv * 100, v * 100];
  };
  convert$1.hsv.rgb = function(hsv) {
    const h = hsv[0] / 60;
    const s = hsv[1] / 100;
    let v = hsv[2] / 100;
    const hi = Math.floor(h) % 6;
    const f = h - Math.floor(h);
    const p = 255 * v * (1 - s);
    const q = 255 * v * (1 - s * f);
    const t = 255 * v * (1 - s * (1 - f));
    v *= 255;
    switch (hi) {
      case 0: {
        return [v, t, p];
      }
      case 1: {
        return [q, v, p];
      }
      case 2: {
        return [p, v, t];
      }
      case 3: {
        return [p, q, v];
      }
      case 4: {
        return [t, p, v];
      }
      case 5: {
        return [v, p, q];
      }
    }
  };
  convert$1.hsv.hsl = function(hsv) {
    const h = hsv[0];
    const s = hsv[1] / 100;
    const v = hsv[2] / 100;
    const vmin = Math.max(v, 0.01);
    let sl;
    let l;
    l = (2 - s) * v;
    const lmin = (2 - s) * vmin;
    sl = s * vmin;
    sl /= lmin <= 1 ? lmin : 2 - lmin;
    sl = sl || 0;
    l /= 2;
    return [h, sl * 100, l * 100];
  };
  convert$1.hwb.rgb = function(hwb) {
    const h = hwb[0] / 360;
    let wh = hwb[1] / 100;
    let bl = hwb[2] / 100;
    const ratio = wh + bl;
    let f;
    if (ratio > 1) {
      wh /= ratio;
      bl /= ratio;
    }
    const i = Math.floor(6 * h);
    const v = 1 - bl;
    f = 6 * h - i;
    if ((i & 1) !== 0) {
      f = 1 - f;
    }
    const n = wh + f * (v - wh);
    let r;
    let g;
    let b;
    switch (i) {
      default:
      case 6:
      case 0: {
        r = v;
        g = n;
        b = wh;
        break;
      }
      case 1: {
        r = n;
        g = v;
        b = wh;
        break;
      }
      case 2: {
        r = wh;
        g = v;
        b = n;
        break;
      }
      case 3: {
        r = wh;
        g = n;
        b = v;
        break;
      }
      case 4: {
        r = n;
        g = wh;
        b = v;
        break;
      }
      case 5: {
        r = v;
        g = wh;
        b = n;
        break;
      }
    }
    return [r * 255, g * 255, b * 255];
  };
  convert$1.cmyk.rgb = function(cmyk) {
    const c = cmyk[0] / 100;
    const m = cmyk[1] / 100;
    const y = cmyk[2] / 100;
    const k = cmyk[3] / 100;
    const r = 1 - Math.min(1, c * (1 - k) + k);
    const g = 1 - Math.min(1, m * (1 - k) + k);
    const b = 1 - Math.min(1, y * (1 - k) + k);
    return [r * 255, g * 255, b * 255];
  };
  convert$1.xyz.rgb = function(xyz) {
    const x = xyz[0] / 100;
    const y = xyz[1] / 100;
    const z = xyz[2] / 100;
    let r;
    let g;
    let b;
    r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
    b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
    r = srgbNonlinearTransform(r);
    g = srgbNonlinearTransform(g);
    b = srgbNonlinearTransform(b);
    return [r * 255, g * 255, b * 255];
  };
  convert$1.xyz.lab = function(xyz) {
    let x = xyz[0];
    let y = xyz[1];
    let z = xyz[2];
    x /= 95.047;
    y /= 100;
    z /= 108.883;
    x = x > LAB_FT ? x ** (1 / 3) : 7.787 * x + 16 / 116;
    y = y > LAB_FT ? y ** (1 / 3) : 7.787 * y + 16 / 116;
    z = z > LAB_FT ? z ** (1 / 3) : 7.787 * z + 16 / 116;
    const l = 116 * y - 16;
    const a = 500 * (x - y);
    const b = 200 * (y - z);
    return [l, a, b];
  };
  convert$1.xyz.oklab = function(xyz) {
    const x = xyz[0] / 100;
    const y = xyz[1] / 100;
    const z = xyz[2] / 100;
    const lp = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z);
    const mp = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z);
    const sp = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z);
    const l = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
    const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
    const b = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;
    return [l * 100, a * 100, b * 100];
  };
  convert$1.oklab.oklch = function(oklab) {
    return convert$1.lab.lch(oklab);
  };
  convert$1.oklab.xyz = function(oklab) {
    const ll = oklab[0] / 100;
    const a = oklab[1] / 100;
    const b = oklab[2] / 100;
    const l = (0.999999998 * ll + 0.396337792 * a + 0.215803758 * b) ** 3;
    const m = (1.000000008 * ll - 0.105561342 * a - 0.063854175 * b) ** 3;
    const s = (1.000000055 * ll - 0.089484182 * a - 1.291485538 * b) ** 3;
    const x = 1.227013851 * l - 0.55779998 * m + 0.281256149 * s;
    const y = -0.040580178 * l + 1.11225687 * m - 0.071676679 * s;
    const z = -0.076381285 * l - 0.421481978 * m + 1.58616322 * s;
    return [x * 100, y * 100, z * 100];
  };
  convert$1.oklab.rgb = function(oklab) {
    const ll = oklab[0] / 100;
    const aa = oklab[1] / 100;
    const bb = oklab[2] / 100;
    const l = (ll + 0.3963377774 * aa + 0.2158037573 * bb) ** 3;
    const m = (ll - 0.1055613458 * aa - 0.0638541728 * bb) ** 3;
    const s = (ll - 0.0894841775 * aa - 1.291485548 * bb) ** 3;
    const r = srgbNonlinearTransform(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const g = srgbNonlinearTransform(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const b = srgbNonlinearTransform(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    return [r * 255, g * 255, b * 255];
  };
  convert$1.oklch.oklab = function(oklch) {
    return convert$1.lch.lab(oklch);
  };
  convert$1.lab.xyz = function(lab) {
    const l = lab[0];
    const a = lab[1];
    const b = lab[2];
    let x;
    let y;
    let z;
    y = (l + 16) / 116;
    x = a / 500 + y;
    z = y - b / 200;
    const y2 = y ** 3;
    const x2 = x ** 3;
    const z2 = z ** 3;
    y = y2 > LAB_FT ? y2 : (y - 16 / 116) / 7.787;
    x = x2 > LAB_FT ? x2 : (x - 16 / 116) / 7.787;
    z = z2 > LAB_FT ? z2 : (z - 16 / 116) / 7.787;
    x *= 95.047;
    y *= 100;
    z *= 108.883;
    return [x, y, z];
  };
  convert$1.lab.lch = function(lab) {
    const l = lab[0];
    const a = lab[1];
    const b = lab[2];
    let h;
    const hr = Math.atan2(b, a);
    h = hr * 360 / 2 / Math.PI;
    if (h < 0) {
      h += 360;
    }
    const c = Math.sqrt(a * a + b * b);
    return [l, c, h];
  };
  convert$1.lch.lab = function(lch) {
    const l = lch[0];
    const c = lch[1];
    const h = lch[2];
    const hr = h / 360 * 2 * Math.PI;
    const a = c * Math.cos(hr);
    const b = c * Math.sin(hr);
    return [l, a, b];
  };
  convert$1.rgb.ansi16 = function(args, saturation = null) {
    const [r, g, b] = args;
    let value = saturation === null ? convert$1.rgb.hsv(args)[2] : saturation;
    value = Math.round(value / 50);
    if (value === 0) {
      return 30;
    }
    let ansi = 30 + (Math.round(b / 255) << 2 | Math.round(g / 255) << 1 | Math.round(r / 255));
    if (value === 2) {
      ansi += 60;
    }
    return ansi;
  };
  convert$1.hsv.ansi16 = function(args) {
    return convert$1.rgb.ansi16(convert$1.hsv.rgb(args), args[2]);
  };
  convert$1.rgb.ansi256 = function(args) {
    const r = args[0];
    const g = args[1];
    const b = args[2];
    if (r >> 4 === g >> 4 && g >> 4 === b >> 4) {
      if (r < 8) {
        return 16;
      }
      if (r > 248) {
        return 231;
      }
      return Math.round((r - 8) / 247 * 24) + 232;
    }
    const ansi = 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
    return ansi;
  };
  convert$1.ansi16.rgb = function(args) {
    args = args[0];
    let color = args % 10;
    if (color === 0 || color === 7) {
      if (args > 50) {
        color += 3.5;
      }
      color = color / 10.5 * 255;
      return [color, color, color];
    }
    const mult = (Math.trunc(args > 50) + 1) * 0.5;
    const r = (color & 1) * mult * 255;
    const g = (color >> 1 & 1) * mult * 255;
    const b = (color >> 2 & 1) * mult * 255;
    return [r, g, b];
  };
  convert$1.ansi256.rgb = function(args) {
    args = args[0];
    if (args >= 232) {
      const c = (args - 232) * 10 + 8;
      return [c, c, c];
    }
    args -= 16;
    let rem;
    const r = Math.floor(args / 36) / 5 * 255;
    const g = Math.floor((rem = args % 36) / 6) / 5 * 255;
    const b = rem % 6 / 5 * 255;
    return [r, g, b];
  };
  convert$1.rgb.hex = function(args) {
    const integer = ((Math.round(args[0]) & 255) << 16) + ((Math.round(args[1]) & 255) << 8) + (Math.round(args[2]) & 255);
    const string = integer.toString(16).toUpperCase();
    return "000000".slice(string.length) + string;
  };
  convert$1.hex.rgb = function(args) {
    const match = args.toString(16).match(/[a-f\d]{6}|[a-f\d]{3}/i);
    if (!match) {
      return [0, 0, 0];
    }
    let colorString = match[0];
    if (match[0].length === 3) {
      colorString = [...colorString].map((char) => char + char).join("");
    }
    const integer = Number.parseInt(colorString, 16);
    const r = integer >> 16 & 255;
    const g = integer >> 8 & 255;
    const b = integer & 255;
    return [r, g, b];
  };
  convert$1.rgb.hcg = function(rgb) {
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    const max = Math.max(Math.max(r, g), b);
    const min = Math.min(Math.min(r, g), b);
    const chroma = max - min;
    let hue;
    const grayscale = chroma < 1 ? min / (1 - chroma) : 0;
    if (chroma <= 0) {
      hue = 0;
    } else if (max === r) {
      hue = (g - b) / chroma % 6;
    } else if (max === g) {
      hue = 2 + (b - r) / chroma;
    } else {
      hue = 4 + (r - g) / chroma;
    }
    hue /= 6;
    hue %= 1;
    return [hue * 360, chroma * 100, grayscale * 100];
  };
  convert$1.hsl.hcg = function(hsl) {
    const s = hsl[1] / 100;
    const l = hsl[2] / 100;
    const c = l < 0.5 ? 2 * s * l : 2 * s * (1 - l);
    let f = 0;
    if (c < 1) {
      f = (l - 0.5 * c) / (1 - c);
    }
    return [hsl[0], c * 100, f * 100];
  };
  convert$1.hsv.hcg = function(hsv) {
    const s = hsv[1] / 100;
    const v = hsv[2] / 100;
    const c = s * v;
    let f = 0;
    if (c < 1) {
      f = (v - c) / (1 - c);
    }
    return [hsv[0], c * 100, f * 100];
  };
  convert$1.hcg.rgb = function(hcg) {
    const h = hcg[0] / 360;
    const c = hcg[1] / 100;
    const g = hcg[2] / 100;
    if (c === 0) {
      return [g * 255, g * 255, g * 255];
    }
    const pure = [0, 0, 0];
    const hi = h % 1 * 6;
    const v = hi % 1;
    const w = 1 - v;
    let mg = 0;
    switch (Math.floor(hi)) {
      case 0: {
        pure[0] = 1;
        pure[1] = v;
        pure[2] = 0;
        break;
      }
      case 1: {
        pure[0] = w;
        pure[1] = 1;
        pure[2] = 0;
        break;
      }
      case 2: {
        pure[0] = 0;
        pure[1] = 1;
        pure[2] = v;
        break;
      }
      case 3: {
        pure[0] = 0;
        pure[1] = w;
        pure[2] = 1;
        break;
      }
      case 4: {
        pure[0] = v;
        pure[1] = 0;
        pure[2] = 1;
        break;
      }
      default: {
        pure[0] = 1;
        pure[1] = 0;
        pure[2] = w;
      }
    }
    mg = (1 - c) * g;
    return [
      (c * pure[0] + mg) * 255,
      (c * pure[1] + mg) * 255,
      (c * pure[2] + mg) * 255
    ];
  };
  convert$1.hcg.hsv = function(hcg) {
    const c = hcg[1] / 100;
    const g = hcg[2] / 100;
    const v = c + g * (1 - c);
    let f = 0;
    if (v > 0) {
      f = c / v;
    }
    return [hcg[0], f * 100, v * 100];
  };
  convert$1.hcg.hsl = function(hcg) {
    const c = hcg[1] / 100;
    const g = hcg[2] / 100;
    const l = g * (1 - c) + 0.5 * c;
    let s = 0;
    if (l > 0 && l < 0.5) {
      s = c / (2 * l);
    } else if (l >= 0.5 && l < 1) {
      s = c / (2 * (1 - l));
    }
    return [hcg[0], s * 100, l * 100];
  };
  convert$1.hcg.hwb = function(hcg) {
    const c = hcg[1] / 100;
    const g = hcg[2] / 100;
    const v = c + g * (1 - c);
    return [hcg[0], (v - c) * 100, (1 - v) * 100];
  };
  convert$1.hwb.hcg = function(hwb) {
    const w = hwb[1] / 100;
    const b = hwb[2] / 100;
    const v = 1 - b;
    const c = v - w;
    let g = 0;
    if (c < 1) {
      g = (v - c) / (1 - c);
    }
    return [hwb[0], c * 100, g * 100];
  };
  convert$1.apple.rgb = function(apple) {
    return [apple[0] / 65535 * 255, apple[1] / 65535 * 255, apple[2] / 65535 * 255];
  };
  convert$1.rgb.apple = function(rgb) {
    return [rgb[0] / 255 * 65535, rgb[1] / 255 * 65535, rgb[2] / 255 * 65535];
  };
  convert$1.gray.rgb = function(args) {
    return [args[0] / 100 * 255, args[0] / 100 * 255, args[0] / 100 * 255];
  };
  convert$1.gray.hsl = function(args) {
    return [0, 0, args[0]];
  };
  convert$1.gray.hsv = convert$1.gray.hsl;
  convert$1.gray.hwb = function(gray) {
    return [0, 100, gray[0]];
  };
  convert$1.gray.cmyk = function(gray) {
    return [0, 0, 0, gray[0]];
  };
  convert$1.gray.lab = function(gray) {
    return [gray[0], 0, 0];
  };
  convert$1.gray.hex = function(gray) {
    const value = Math.round(gray[0] / 100 * 255) & 255;
    const integer = (value << 16) + (value << 8) + value;
    const string = integer.toString(16).toUpperCase();
    return "000000".slice(string.length) + string;
  };
  convert$1.rgb.gray = function(rgb) {
    const value = (rgb[0] + rgb[1] + rgb[2]) / 3;
    return [value / 255 * 100];
  };
  function buildGraph() {
    const graph = {};
    const models2 = Object.keys(convert$1);
    for (let { length } = models2, i = 0;i < length; i++) {
      graph[models2[i]] = {
        distance: -1,
        parent: null
      };
    }
    return graph;
  }
  function deriveBFS(fromModel) {
    const graph = buildGraph();
    const queue = [fromModel];
    graph[fromModel].distance = 0;
    while (queue.length > 0) {
      const current = queue.pop();
      const adjacents = Object.keys(convert$1[current]);
      for (let { length } = adjacents, i = 0;i < length; i++) {
        const adjacent = adjacents[i];
        const node = graph[adjacent];
        if (node.distance === -1) {
          node.distance = graph[current].distance + 1;
          node.parent = current;
          queue.unshift(adjacent);
        }
      }
    }
    return graph;
  }
  function link(from, to) {
    return function(args) {
      return to(from(args));
    };
  }
  function wrapConversion(toModel, graph) {
    const path7 = [graph[toModel].parent, toModel];
    let fn = convert$1[graph[toModel].parent][toModel];
    let cur = graph[toModel].parent;
    while (graph[cur].parent) {
      path7.unshift(graph[cur].parent);
      fn = link(convert$1[graph[cur].parent][cur], fn);
      cur = graph[cur].parent;
    }
    fn.conversion = path7;
    return fn;
  }
  function route(fromModel) {
    const graph = deriveBFS(fromModel);
    const conversion = {};
    const models2 = Object.keys(graph);
    for (let { length } = models2, i = 0;i < length; i++) {
      const toModel = models2[i];
      const node = graph[toModel];
      if (node.parent === null) {
        continue;
      }
      conversion[toModel] = wrapConversion(toModel, graph);
    }
    return conversion;
  }
  var convert = {};
  var models = Object.keys(convert$1);
  function wrapRaw(fn) {
    const wrappedFn = function(...args) {
      const arg0 = args[0];
      if (arg0 === undefined || arg0 === null) {
        return arg0;
      }
      if (arg0.length > 1) {
        args = arg0;
      }
      return fn(args);
    };
    if ("conversion" in fn) {
      wrappedFn.conversion = fn.conversion;
    }
    return wrappedFn;
  }
  function wrapRounded(fn) {
    const wrappedFn = function(...args) {
      const arg0 = args[0];
      if (arg0 === undefined || arg0 === null) {
        return arg0;
      }
      if (arg0.length > 1) {
        args = arg0;
      }
      const result = fn(args);
      if (typeof result === "object") {
        for (let { length } = result, i = 0;i < length; i++) {
          result[i] = Math.round(result[i]);
        }
      }
      return result;
    };
    if ("conversion" in fn) {
      wrappedFn.conversion = fn.conversion;
    }
    return wrappedFn;
  }
  for (const fromModel of models) {
    convert[fromModel] = {};
    Object.defineProperty(convert[fromModel], "channels", { value: convert$1[fromModel].channels });
    Object.defineProperty(convert[fromModel], "labels", { value: convert$1[fromModel].labels });
    const routes = route(fromModel);
    const routeModels = Object.keys(routes);
    for (const toModel of routeModels) {
      const fn = routes[toModel];
      convert[fromModel][toModel] = wrapRounded(fn);
      convert[fromModel][toModel].raw = wrapRaw(fn);
    }
  }
  var skippedModels = [
    "keyword",
    "gray",
    "hex"
  ];
  var hashedModelKeys = {};
  for (const model of Object.keys(convert)) {
    hashedModelKeys[[...convert[model].labels].sort().join("")] = model;
  }
  var limiters = {};
  function Color(object, model) {
    if (!(this instanceof Color)) {
      return new Color(object, model);
    }
    if (model && model in skippedModels) {
      model = null;
    }
    if (model && !(model in convert)) {
      throw new Error("Unknown model: " + model);
    }
    let i;
    let channels;
    if (object == null) {
      this.model = "rgb";
      this.color = [0, 0, 0];
      this.valpha = 1;
    } else if (object instanceof Color) {
      this.model = object.model;
      this.color = [...object.color];
      this.valpha = object.valpha;
    } else if (typeof object === "string") {
      const result = cs.get(object);
      if (result === null) {
        throw new Error("Unable to parse color from string: " + object);
      }
      this.model = result.model;
      channels = convert[this.model].channels;
      this.color = result.value.slice(0, channels);
      this.valpha = typeof result.value[channels] === "number" ? result.value[channels] : 1;
    } else if (object.length > 0) {
      this.model = model || "rgb";
      channels = convert[this.model].channels;
      const newArray = Array.prototype.slice.call(object, 0, channels);
      this.color = zeroArray(newArray, channels);
      this.valpha = typeof object[channels] === "number" ? object[channels] : 1;
    } else if (typeof object === "number") {
      this.model = "rgb";
      this.color = [
        object >> 16 & 255,
        object >> 8 & 255,
        object & 255
      ];
      this.valpha = 1;
    } else {
      this.valpha = 1;
      const keys = Object.keys(object);
      if ("alpha" in object) {
        keys.splice(keys.indexOf("alpha"), 1);
        this.valpha = typeof object.alpha === "number" ? object.alpha : 0;
      }
      const hashedKeys = keys.sort().join("");
      if (!(hashedKeys in hashedModelKeys)) {
        throw new Error("Unable to parse color from object: " + JSON.stringify(object));
      }
      this.model = hashedModelKeys[hashedKeys];
      const { labels } = convert[this.model];
      const color = [];
      for (i = 0;i < labels.length; i++) {
        color.push(object[labels[i]]);
      }
      this.color = zeroArray(color);
    }
    if (limiters[this.model]) {
      channels = convert[this.model].channels;
      for (i = 0;i < channels; i++) {
        const limit = limiters[this.model][i];
        if (limit) {
          this.color[i] = limit(this.color[i]);
        }
      }
    }
    this.valpha = Math.max(0, Math.min(1, this.valpha));
    if (Object.freeze) {
      Object.freeze(this);
    }
  }
  Color.prototype = {
    toString() {
      return this.string();
    },
    toJSON() {
      return this[this.model]();
    },
    string(places) {
      let self2 = this.model in cs.to ? this : this.rgb();
      self2 = self2.round(typeof places === "number" ? places : 1);
      const arguments_ = self2.valpha === 1 ? self2.color : [...self2.color, this.valpha];
      return cs.to[self2.model](...arguments_);
    },
    percentString(places) {
      const self2 = this.rgb().round(typeof places === "number" ? places : 1);
      const arguments_ = self2.valpha === 1 ? self2.color : [...self2.color, this.valpha];
      return cs.to.rgb.percent(...arguments_);
    },
    array() {
      return this.valpha === 1 ? [...this.color] : [...this.color, this.valpha];
    },
    object() {
      const result = {};
      const { channels } = convert[this.model];
      const { labels } = convert[this.model];
      for (let i = 0;i < channels; i++) {
        result[labels[i]] = this.color[i];
      }
      if (this.valpha !== 1) {
        result.alpha = this.valpha;
      }
      return result;
    },
    unitArray() {
      const rgb = this.rgb().color;
      rgb[0] /= 255;
      rgb[1] /= 255;
      rgb[2] /= 255;
      if (this.valpha !== 1) {
        rgb.push(this.valpha);
      }
      return rgb;
    },
    unitObject() {
      const rgb = this.rgb().object();
      rgb.r /= 255;
      rgb.g /= 255;
      rgb.b /= 255;
      if (this.valpha !== 1) {
        rgb.alpha = this.valpha;
      }
      return rgb;
    },
    round(places) {
      places = Math.max(places || 0, 0);
      return new Color([...this.color.map(roundToPlace(places)), this.valpha], this.model);
    },
    alpha(value) {
      if (value !== undefined) {
        return new Color([...this.color, Math.max(0, Math.min(1, value))], this.model);
      }
      return this.valpha;
    },
    red: getset("rgb", 0, maxfn(255)),
    green: getset("rgb", 1, maxfn(255)),
    blue: getset("rgb", 2, maxfn(255)),
    hue: getset(["hsl", "hsv", "hsl", "hwb", "hcg"], 0, (value) => (value % 360 + 360) % 360),
    saturationl: getset("hsl", 1, maxfn(100)),
    lightness: getset("hsl", 2, maxfn(100)),
    saturationv: getset("hsv", 1, maxfn(100)),
    value: getset("hsv", 2, maxfn(100)),
    chroma: getset("hcg", 1, maxfn(100)),
    gray: getset("hcg", 2, maxfn(100)),
    white: getset("hwb", 1, maxfn(100)),
    wblack: getset("hwb", 2, maxfn(100)),
    cyan: getset("cmyk", 0, maxfn(100)),
    magenta: getset("cmyk", 1, maxfn(100)),
    yellow: getset("cmyk", 2, maxfn(100)),
    black: getset("cmyk", 3, maxfn(100)),
    x: getset("xyz", 0, maxfn(95.047)),
    y: getset("xyz", 1, maxfn(100)),
    z: getset("xyz", 2, maxfn(108.833)),
    l: getset("lab", 0, maxfn(100)),
    a: getset("lab", 1),
    b: getset("lab", 2),
    keyword(value) {
      if (value !== undefined) {
        return new Color(value);
      }
      return convert[this.model].keyword(this.color);
    },
    hex(value) {
      if (value !== undefined) {
        return new Color(value);
      }
      return cs.to.hex(...this.rgb().round().color);
    },
    hexa(value) {
      if (value !== undefined) {
        return new Color(value);
      }
      const rgbArray = this.rgb().round().color;
      let alphaHex = Math.round(this.valpha * 255).toString(16).toUpperCase();
      if (alphaHex.length === 1) {
        alphaHex = "0" + alphaHex;
      }
      return cs.to.hex(...rgbArray) + alphaHex;
    },
    rgbNumber() {
      const rgb = this.rgb().color;
      return (rgb[0] & 255) << 16 | (rgb[1] & 255) << 8 | rgb[2] & 255;
    },
    luminosity() {
      const rgb = this.rgb().color;
      const lum = [];
      for (const [i, element] of rgb.entries()) {
        const chan = element / 255;
        lum[i] = chan <= 0.04045 ? chan / 12.92 : ((chan + 0.055) / 1.055) ** 2.4;
      }
      return 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    },
    contrast(color2) {
      const lum1 = this.luminosity();
      const lum2 = color2.luminosity();
      if (lum1 > lum2) {
        return (lum1 + 0.05) / (lum2 + 0.05);
      }
      return (lum2 + 0.05) / (lum1 + 0.05);
    },
    level(color2) {
      const contrastRatio = this.contrast(color2);
      if (contrastRatio >= 7) {
        return "AAA";
      }
      return contrastRatio >= 4.5 ? "AA" : "";
    },
    isDark() {
      const rgb = this.rgb().color;
      const yiq = (rgb[0] * 2126 + rgb[1] * 7152 + rgb[2] * 722) / 1e4;
      return yiq < 128;
    },
    isLight() {
      return !this.isDark();
    },
    negate() {
      const rgb = this.rgb();
      for (let i = 0;i < 3; i++) {
        rgb.color[i] = 255 - rgb.color[i];
      }
      return rgb;
    },
    lighten(ratio) {
      const hsl = this.hsl();
      hsl.color[2] += hsl.color[2] * ratio;
      return hsl;
    },
    darken(ratio) {
      const hsl = this.hsl();
      hsl.color[2] -= hsl.color[2] * ratio;
      return hsl;
    },
    saturate(ratio) {
      const hsl = this.hsl();
      hsl.color[1] += hsl.color[1] * ratio;
      return hsl;
    },
    desaturate(ratio) {
      const hsl = this.hsl();
      hsl.color[1] -= hsl.color[1] * ratio;
      return hsl;
    },
    whiten(ratio) {
      const hwb = this.hwb();
      hwb.color[1] += hwb.color[1] * ratio;
      return hwb;
    },
    blacken(ratio) {
      const hwb = this.hwb();
      hwb.color[2] += hwb.color[2] * ratio;
      return hwb;
    },
    grayscale() {
      const rgb = this.rgb().color;
      const value = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
      return Color.rgb(value, value, value);
    },
    fade(ratio) {
      return this.alpha(this.valpha - this.valpha * ratio);
    },
    opaquer(ratio) {
      return this.alpha(this.valpha + this.valpha * ratio);
    },
    rotate(degrees) {
      const hsl = this.hsl();
      let hue = hsl.color[0];
      hue = (hue + degrees) % 360;
      hue = hue < 0 ? 360 + hue : hue;
      hsl.color[0] = hue;
      return hsl;
    },
    mix(mixinColor, weight) {
      if (!mixinColor || !mixinColor.rgb) {
        throw new Error('Argument to "mix" was not a Color instance, but rather an instance of ' + typeof mixinColor);
      }
      const color1 = mixinColor.rgb();
      const color2 = this.rgb();
      const p = weight === undefined ? 0.5 : weight;
      const w = 2 * p - 1;
      const a = color1.alpha() - color2.alpha();
      const w1 = ((w * a === -1 ? w : (w + a) / (1 + w * a)) + 1) / 2;
      const w2 = 1 - w1;
      return Color.rgb(w1 * color1.red() + w2 * color2.red(), w1 * color1.green() + w2 * color2.green(), w1 * color1.blue() + w2 * color2.blue(), color1.alpha() * p + color2.alpha() * (1 - p));
    }
  };
  for (const model of Object.keys(convert)) {
    if (skippedModels.includes(model)) {
      continue;
    }
    const { channels } = convert[model];
    Color.prototype[model] = function(...arguments_) {
      if (this.model === model) {
        return new Color(this);
      }
      if (arguments_.length > 0) {
        return new Color(arguments_, model);
      }
      return new Color([...assertArray(convert[this.model][model].raw(this.color)), this.valpha], model);
    };
    Color[model] = function(...arguments_) {
      let color = arguments_[0];
      if (typeof color === "number") {
        color = zeroArray(arguments_, channels);
      }
      return new Color(color, model);
    };
  }
  function roundTo(number, places) {
    return Number(number.toFixed(places));
  }
  function roundToPlace(places) {
    return function(number) {
      return roundTo(number, places);
    };
  }
  function getset(model, channel, modifier) {
    model = Array.isArray(model) ? model : [model];
    for (const m of model) {
      (limiters[m] ||= [])[channel] = modifier;
    }
    model = model[0];
    return function(value) {
      let result;
      if (value !== undefined) {
        if (modifier) {
          value = modifier(value);
        }
        result = this[model]();
        result.color[channel] = value;
        return result;
      }
      result = this[model]().color[channel];
      if (modifier) {
        result = modifier(result);
      }
      return result;
    };
  }
  function maxfn(max) {
    return function(v) {
      return Math.max(0, Math.min(max, v));
    };
  }
  function assertArray(value) {
    return Array.isArray(value) ? value : [value];
  }
  function zeroArray(array, length) {
    for (let i = 0;i < length; i++) {
      if (typeof array[i] !== "number") {
        array[i] = 0;
      }
    }
    return array;
  }
  function getDefaultExportFromCjs(x) {
    return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
  }
  var textHex = function hex2(str) {
    for (var i = 0, hash = 0;i < str.length; hash = str.charCodeAt(i++) + ((hash << 5) - hash))
      ;
    var color = Math.floor(Math.abs(Math.sin(hash) * 1e4 % 1 * 16777216)).toString(16);
    return "#" + Array(6 - color.length + 1).join("0") + color;
  };
  var hex = /* @__PURE__ */ getDefaultExportFromCjs(textHex);
  function colorspace(namespace, delimiter) {
    const split = namespace.split(delimiter || ":");
    let base = hex(split[0]);
    if (!split.length)
      return base;
    for (let i = 0, l = split.length - 1;i < l; i++) {
      base = Color(base).mix(Color(hex(split[i + 1]))).saturate(1).hex();
    }
    return base;
  }
  module.exports = colorspace;
});

// node_modules/kuler/index.js
var require_kuler = __commonJS((exports, module) => {
  function Kuler(text, color) {
    if (color)
      return new Kuler(text).style(color);
    if (!(this instanceof Kuler))
      return new Kuler(text);
    this.text = text;
  }
  Kuler.prototype.prefix = "\x1B[";
  Kuler.prototype.suffix = "m";
  Kuler.prototype.hex = function hex(color) {
    color = color[0] === "#" ? color.substring(1) : color;
    if (color.length === 3) {
      color = color.split("");
      color[5] = color[2];
      color[4] = color[2];
      color[3] = color[1];
      color[2] = color[1];
      color[1] = color[0];
      color = color.join("");
    }
    var r = color.substring(0, 2), g = color.substring(2, 4), b = color.substring(4, 6);
    return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16)];
  };
  Kuler.prototype.rgb = function rgb(r, g, b) {
    var red = r / 255 * 5, green = g / 255 * 5, blue = b / 255 * 5;
    return this.ansi(red, green, blue);
  };
  Kuler.prototype.ansi = function ansi(r, g, b) {
    var red = Math.round(r), green = Math.round(g), blue = Math.round(b);
    return 16 + red * 36 + green * 6 + blue;
  };
  Kuler.prototype.reset = function reset() {
    return this.prefix + "39;49" + this.suffix;
  };
  Kuler.prototype.style = function style(color) {
    return this.prefix + "38;5;" + this.rgb.apply(this, this.hex(color)) + this.suffix + this.text + this.reset();
  };
  module.exports = Kuler;
});

// node_modules/@dabh/diagnostics/modifiers/namespace-ansi.js
var require_namespace_ansi = __commonJS((exports, module) => {
  var colorspace = require_index_cjs();
  var kuler = require_kuler();
  module.exports = function ansiModifier(args, options) {
    var namespace = options.namespace;
    var ansi = options.colors !== false ? kuler(namespace + ":", colorspace(namespace)) : namespace + ":";
    args[0] = ansi + " " + args[0];
    return args;
  };
});

// node_modules/enabled/index.js
var require_enabled = __commonJS((exports, module) => {
  module.exports = function enabled(name, variable) {
    if (!variable)
      return false;
    var variables = variable.split(/[\s,]+/), i = 0;
    for (;i < variables.length; i++) {
      variable = variables[i].replace("*", ".*?");
      if (variable.charAt(0) === "-") {
        if (new RegExp("^" + variable.substr(1) + "$").test(name)) {
          return false;
        }
        continue;
      }
      if (new RegExp("^" + variable + "$").test(name)) {
        return true;
      }
    }
    return false;
  };
});

// node_modules/@dabh/diagnostics/adapters/index.js
var require_adapters = __commonJS((exports, module) => {
  var enabled = require_enabled();
  module.exports = function create(fn) {
    return function adapter(namespace) {
      try {
        return enabled(namespace, fn());
      } catch (e) {}
      return false;
    };
  };
});

// node_modules/@dabh/diagnostics/adapters/process.env.js
var require_process_env = __commonJS((exports, module) => {
  var adapter = require_adapters();
  module.exports = adapter(function processenv() {
    return process.env.DEBUG || process.env.DIAGNOSTICS;
  });
});

// node_modules/@dabh/diagnostics/logger/console.js
var require_console2 = __commonJS((exports, module) => {
  module.exports = function(meta, messages) {
    try {
      Function.prototype.apply.call(console.log, console, messages);
    } catch (e) {}
  };
});

// node_modules/@dabh/diagnostics/node/development.js
var require_development = __commonJS((exports, module) => {
  var create = require_diagnostics();
  var tty = __require("tty").isatty(1);
  var diagnostics = create(function dev(namespace, options) {
    options = options || {};
    options.colors = "colors" in options ? options.colors : tty;
    options.namespace = namespace;
    options.prod = false;
    options.dev = true;
    if (!dev.enabled(namespace) && !(options.force || dev.force)) {
      return dev.nope(options);
    }
    return dev.yep(options);
  });
  diagnostics.modify(require_namespace_ansi());
  diagnostics.use(require_process_env());
  diagnostics.set(require_console2());
  module.exports = diagnostics;
});

// node_modules/@dabh/diagnostics/node/index.js
var require_node2 = __commonJS((exports, module) => {
  if (false) {} else {
    module.exports = require_development();
  }
});

// node_modules/winston/lib/winston/tail-file.js
var require_tail_file = __commonJS((exports, module) => {
  var fs6 = __require("fs");
  var { StringDecoder } = __require("string_decoder");
  var { Stream } = require_readable();
  function noop() {}
  module.exports = (options, iter) => {
    const buffer = Buffer.alloc(64 * 1024);
    const decode = new StringDecoder("utf8");
    const stream = new Stream;
    let buff = "";
    let pos = 0;
    let row = 0;
    if (options.start === -1) {
      delete options.start;
    }
    stream.readable = true;
    stream.destroy = () => {
      stream.destroyed = true;
      stream.emit("end");
      stream.emit("close");
    };
    fs6.open(options.file, "a+", "0644", (err, fd) => {
      if (err) {
        if (!iter) {
          stream.emit("error", err);
        } else {
          iter(err);
        }
        stream.destroy();
        return;
      }
      (function read() {
        if (stream.destroyed) {
          fs6.close(fd, noop);
          return;
        }
        return fs6.read(fd, buffer, 0, buffer.length, pos, (error, bytes) => {
          if (error) {
            if (!iter) {
              stream.emit("error", error);
            } else {
              iter(error);
            }
            stream.destroy();
            return;
          }
          if (!bytes) {
            if (buff) {
              if (options.start == null || row > options.start) {
                if (!iter) {
                  stream.emit("line", buff);
                } else {
                  iter(null, buff);
                }
              }
              row++;
              buff = "";
            }
            return setTimeout(read, 1000);
          }
          let data = decode.write(buffer.slice(0, bytes));
          if (!iter) {
            stream.emit("data", data);
          }
          data = (buff + data).split(/\n+/);
          const l = data.length - 1;
          let i = 0;
          for (;i < l; i++) {
            if (options.start == null || row > options.start) {
              if (!iter) {
                stream.emit("line", data[i]);
              } else {
                iter(null, data[i]);
              }
            }
            row++;
          }
          buff = data[l];
          pos += bytes;
          return read();
        });
      })();
    });
    if (!iter) {
      return stream;
    }
    return stream.destroy;
  };
});

// node_modules/winston/lib/winston/transports/file.js
var require_file = __commonJS((exports, module) => {
  var fs6 = __require("fs");
  var path7 = __require("path");
  var asyncSeries = require_series();
  var zlib = __require("zlib");
  var { MESSAGE } = require_triple_beam();
  var { Stream, PassThrough } = require_readable();
  var TransportStream = require_winston_transport();
  var debug = require_node2()("winston:file");
  var os4 = __require("os");
  var tailFile = require_tail_file();
  module.exports = class File extends TransportStream {
    constructor(options = {}) {
      super(options);
      this.name = options.name || "file";
      function throwIf(target, ...args) {
        args.slice(1).forEach((name) => {
          if (options[name]) {
            throw new Error(`Cannot set ${name} and ${target} together`);
          }
        });
      }
      this._stream = new PassThrough;
      this._stream.setMaxListeners(30);
      this._onError = this._onError.bind(this);
      if (options.filename || options.dirname) {
        throwIf("filename or dirname", "stream");
        this._basename = this.filename = options.filename ? path7.basename(options.filename) : "winston.log";
        this.dirname = options.dirname || path7.dirname(options.filename);
        this.options = options.options || { flags: "a" };
      } else if (options.stream) {
        console.warn("options.stream will be removed in winston@4. Use winston.transports.Stream");
        throwIf("stream", "filename", "maxsize");
        this._dest = this._stream.pipe(this._setupStream(options.stream));
        this.dirname = path7.dirname(this._dest.path);
      } else {
        throw new Error("Cannot log to file without filename or stream.");
      }
      this.maxsize = options.maxsize || null;
      this.rotationFormat = options.rotationFormat || false;
      this.zippedArchive = options.zippedArchive || false;
      this.maxFiles = options.maxFiles || null;
      this.eol = typeof options.eol === "string" ? options.eol : os4.EOL;
      this.tailable = options.tailable || false;
      this.lazy = options.lazy || false;
      this._size = 0;
      this._pendingSize = 0;
      this._created = 0;
      this._drain = false;
      this._opening = false;
      this._ending = false;
      this._fileExist = false;
      if (this.dirname)
        this._createLogDirIfNotExist(this.dirname);
      if (!this.lazy)
        this.open();
    }
    finishIfEnding() {
      if (this._ending) {
        if (this._opening) {
          this.once("open", () => {
            this._stream.once("finish", () => this.emit("finish"));
            setImmediate(() => this._stream.end());
          });
        } else {
          this._stream.once("finish", () => this.emit("finish"));
          setImmediate(() => this._stream.end());
        }
      }
    }
    _final(callback) {
      if (this._opening) {
        this.once("open", () => this._final(callback));
        return;
      }
      this._stream.end();
      if (!this._dest) {
        return callback();
      }
      if (this._dest.writableFinished) {
        return callback();
      }
      this._dest.once("finish", callback);
      this._dest.once("error", callback);
    }
    log(info, callback = () => {}) {
      if (this.silent) {
        callback();
        return true;
      }
      if (this._drain) {
        this._stream.once("drain", () => {
          this._drain = false;
          this.log(info, callback);
        });
        return;
      }
      if (this._rotate) {
        this._stream.once("rotate", () => {
          this._rotate = false;
          this.log(info, callback);
        });
        return;
      }
      if (this.lazy) {
        if (!this._fileExist) {
          if (!this._opening) {
            this.open();
          }
          this.once("open", () => {
            this._fileExist = true;
            this.log(info, callback);
            return;
          });
          return;
        }
        if (this._needsNewFile(this._pendingSize)) {
          this._dest.once("close", () => {
            if (!this._opening) {
              this.open();
            }
            this.once("open", () => {
              this.log(info, callback);
              return;
            });
            return;
          });
          return;
        }
      }
      const output = `${info[MESSAGE]}${this.eol}`;
      const bytes = Buffer.byteLength(output);
      function logged() {
        this._size += bytes;
        this._pendingSize -= bytes;
        debug("logged %s %s", this._size, output);
        this.emit("logged", info);
        if (this._rotate) {
          return;
        }
        if (this._opening) {
          return;
        }
        if (!this._needsNewFile()) {
          return;
        }
        if (this.lazy) {
          this._endStream(() => {
            this.emit("fileclosed");
          });
          return;
        }
        this._rotate = true;
        this._endStream(() => this._rotateFile());
      }
      this._pendingSize += bytes;
      if (this._opening && !this.rotatedWhileOpening && this._needsNewFile(this._size + this._pendingSize)) {
        this.rotatedWhileOpening = true;
      }
      const written = this._stream.write(output, logged.bind(this));
      if (!written) {
        this._drain = true;
        this._stream.once("drain", () => {
          this._drain = false;
          callback();
        });
      } else {
        callback();
      }
      debug("written", written, this._drain);
      this.finishIfEnding();
      return written;
    }
    query(options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      options = normalizeQuery(options);
      const file = path7.join(this.dirname, this.filename);
      let buff = "";
      let results = [];
      let row = 0;
      const stream = fs6.createReadStream(file, {
        encoding: "utf8"
      });
      stream.on("error", (err) => {
        if (stream.readable) {
          stream.destroy();
        }
        if (!callback) {
          return;
        }
        return err.code !== "ENOENT" ? callback(err) : callback(null, results);
      });
      stream.on("data", (data) => {
        data = (buff + data).split(/\n+/);
        const l = data.length - 1;
        let i = 0;
        for (;i < l; i++) {
          if (!options.start || row >= options.start) {
            add(data[i]);
          }
          row++;
        }
        buff = data[l];
      });
      stream.on("close", () => {
        if (buff) {
          add(buff, true);
        }
        if (options.order === "desc") {
          results = results.reverse();
        }
        if (callback)
          callback(null, results);
      });
      function add(buff2, attempt) {
        try {
          const log = JSON.parse(buff2);
          if (check(log)) {
            push(log);
          }
        } catch (e) {
          if (!attempt) {
            stream.emit("error", e);
          }
        }
      }
      function push(log) {
        if (options.rows && results.length >= options.rows && options.order !== "desc") {
          if (stream.readable) {
            stream.destroy();
          }
          return;
        }
        if (options.fields) {
          log = options.fields.reduce((obj, key) => {
            obj[key] = log[key];
            return obj;
          }, {});
        }
        if (options.order === "desc") {
          if (results.length >= options.rows) {
            results.shift();
          }
        }
        results.push(log);
      }
      function check(log) {
        if (!log) {
          return;
        }
        if (typeof log !== "object") {
          return;
        }
        const time = new Date(log.timestamp);
        if (options.from && time < options.from || options.until && time > options.until || options.level && options.level !== log.level) {
          return;
        }
        return true;
      }
      function normalizeQuery(options2) {
        options2 = options2 || {};
        options2.rows = options2.rows || options2.limit || 10;
        options2.start = options2.start || 0;
        options2.until = options2.until || new Date;
        if (typeof options2.until !== "object") {
          options2.until = new Date(options2.until);
        }
        options2.from = options2.from || options2.until - 24 * 60 * 60 * 1000;
        if (typeof options2.from !== "object") {
          options2.from = new Date(options2.from);
        }
        options2.order = options2.order || "desc";
        return options2;
      }
    }
    stream(options = {}) {
      const file = path7.join(this.dirname, this.filename);
      const stream = new Stream;
      const tail = {
        file,
        start: options.start
      };
      stream.destroy = tailFile(tail, (err, line) => {
        if (err) {
          return stream.emit("error", err);
        }
        try {
          stream.emit("data", line);
          line = JSON.parse(line);
          stream.emit("log", line);
        } catch (e) {
          stream.emit("error", e);
        }
      });
      return stream;
    }
    open() {
      if (!this.filename)
        return;
      if (this._opening)
        return;
      this._opening = true;
      this.stat((err, size) => {
        if (err) {
          return this.emit("error", err);
        }
        debug("stat done: %s { size: %s }", this.filename, size);
        this._size = size;
        this._dest = this._createStream(this._stream);
        this._opening = false;
        this.once("open", () => {
          if (!this._stream.emit("rotate")) {
            this._rotate = false;
          }
        });
      });
    }
    stat(callback) {
      const target = this._getFile();
      const fullpath = path7.join(this.dirname, target);
      fs6.stat(fullpath, (err, stat) => {
        if (err && err.code === "ENOENT") {
          debug("ENOENT\xA0ok", fullpath);
          this.filename = target;
          return callback(null, 0);
        }
        if (err) {
          debug(`err ${err.code} ${fullpath}`);
          return callback(err);
        }
        if (!stat || this._needsNewFile(stat.size)) {
          return this._incFile(() => this.stat(callback));
        }
        this.filename = target;
        callback(null, stat.size);
      });
    }
    close(cb) {
      if (!this._stream) {
        return;
      }
      this._stream.end(() => {
        if (cb) {
          cb();
        }
        this.emit("flush");
        this.emit("closed");
      });
    }
    _needsNewFile(size) {
      size = size || this._size;
      return this.maxsize && size >= this.maxsize;
    }
    _onError(err) {
      this.emit("error", err);
    }
    _setupStream(stream) {
      stream.on("error", this._onError);
      return stream;
    }
    _cleanupStream(stream) {
      stream.removeListener("error", this._onError);
      stream.destroy();
      return stream;
    }
    _rotateFile() {
      this._incFile(() => this.open());
    }
    _endStream(callback = () => {}) {
      if (this._dest) {
        this._stream.unpipe(this._dest);
        this._dest.end(() => {
          this._cleanupStream(this._dest);
          callback();
        });
      } else {
        callback();
      }
    }
    _createStream(source) {
      const fullpath = path7.join(this.dirname, this.filename);
      debug("create stream start", fullpath, this.options);
      const dest = fs6.createWriteStream(fullpath, this.options).on("error", (err) => debug(err)).on("close", () => debug("close", dest.path, dest.bytesWritten)).on("open", () => {
        debug("file open ok", fullpath);
        this.emit("open", fullpath);
        source.pipe(dest);
        if (this.rotatedWhileOpening) {
          this._stream = new PassThrough;
          this._stream.setMaxListeners(30);
          this._rotateFile();
          this.rotatedWhileOpening = false;
          this._cleanupStream(dest);
          source.end();
        }
      });
      debug("create stream ok", fullpath);
      return dest;
    }
    _incFile(callback) {
      debug("_incFile", this.filename);
      const ext = path7.extname(this._basename);
      const basename = path7.basename(this._basename, ext);
      const tasks = [];
      if (this.zippedArchive) {
        tasks.push(function(cb) {
          const num = this._created > 0 && !this.tailable ? this._created : "";
          this._compressFile(path7.join(this.dirname, `${basename}${num}${ext}`), path7.join(this.dirname, `${basename}${num}${ext}.gz`), cb);
        }.bind(this));
      }
      tasks.push(function(cb) {
        if (!this.tailable) {
          this._created += 1;
          this._checkMaxFilesIncrementing(ext, basename, cb);
        } else {
          this._checkMaxFilesTailable(ext, basename, cb);
        }
      }.bind(this));
      asyncSeries(tasks, callback);
    }
    _getFile() {
      const ext = path7.extname(this._basename);
      const basename = path7.basename(this._basename, ext);
      const isRotation = this.rotationFormat ? this.rotationFormat() : this._created;
      return !this.tailable && this._created ? `${basename}${isRotation}${ext}` : `${basename}${ext}`;
    }
    _checkMaxFilesIncrementing(ext, basename, callback) {
      if (!this.maxFiles || this._created < this.maxFiles) {
        return setImmediate(callback);
      }
      const oldest = this._created - this.maxFiles;
      const isOldest = oldest !== 0 ? oldest : "";
      const isZipped = this.zippedArchive ? ".gz" : "";
      const filePath = `${basename}${isOldest}${ext}${isZipped}`;
      const target = path7.join(this.dirname, filePath);
      fs6.unlink(target, callback);
    }
    _checkMaxFilesTailable(ext, basename, callback) {
      const tasks = [];
      if (!this.maxFiles) {
        return;
      }
      const isZipped = this.zippedArchive ? ".gz" : "";
      for (let x = this.maxFiles - 1;x > 1; x--) {
        tasks.push(function(i, cb) {
          let fileName = `${basename}${i - 1}${ext}${isZipped}`;
          const tmppath = path7.join(this.dirname, fileName);
          fs6.exists(tmppath, (exists) => {
            if (!exists) {
              return cb(null);
            }
            fileName = `${basename}${i}${ext}${isZipped}`;
            fs6.rename(tmppath, path7.join(this.dirname, fileName), cb);
          });
        }.bind(this, x));
      }
      asyncSeries(tasks, () => {
        fs6.rename(path7.join(this.dirname, `${basename}${ext}${isZipped}`), path7.join(this.dirname, `${basename}1${ext}${isZipped}`), callback);
      });
    }
    _compressFile(src, dest, callback) {
      fs6.access(src, fs6.F_OK, (err) => {
        if (err) {
          return callback();
        }
        var gzip = zlib.createGzip();
        var inp = fs6.createReadStream(src);
        var out = fs6.createWriteStream(dest);
        out.on("finish", () => {
          fs6.unlink(src, callback);
        });
        inp.pipe(gzip).pipe(out);
      });
    }
    _createLogDirIfNotExist(dirPath) {
      if (!fs6.existsSync(dirPath)) {
        fs6.mkdirSync(dirPath, { recursive: true });
      }
    }
  };
});

// node_modules/winston/lib/winston/transports/http.js
var require_http = __commonJS((exports, module) => {
  var http = __require("http");
  var https = __require("https");
  var { Stream } = require_readable();
  var TransportStream = require_winston_transport();
  var { configure } = require_safe_stable_stringify();
  module.exports = class Http extends TransportStream {
    constructor(options = {}) {
      super(options);
      this.options = options;
      this.name = options.name || "http";
      this.ssl = !!options.ssl;
      this.host = options.host || "localhost";
      this.port = options.port;
      this.auth = options.auth;
      this.path = options.path || "";
      this.maximumDepth = options.maximumDepth;
      this.agent = options.agent;
      this.headers = options.headers || {};
      this.headers["content-type"] = "application/json";
      this.batch = options.batch || false;
      this.batchInterval = options.batchInterval || 5000;
      this.batchCount = options.batchCount || 10;
      this.batchOptions = [];
      this.batchTimeoutID = -1;
      this.batchCallback = {};
      if (!this.port) {
        this.port = this.ssl ? 443 : 80;
      }
    }
    log(info, callback) {
      this._request(info, null, null, (err, res) => {
        if (res && res.statusCode !== 200) {
          err = new Error(`Invalid HTTP Status Code: ${res.statusCode}`);
        }
        if (err) {
          this.emit("warn", err);
        } else {
          this.emit("logged", info);
        }
      });
      if (callback) {
        setImmediate(callback);
      }
    }
    query(options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      options = {
        method: "query",
        params: this.normalizeQuery(options)
      };
      const auth = options.params.auth || null;
      delete options.params.auth;
      const path7 = options.params.path || null;
      delete options.params.path;
      this._request(options, auth, path7, (err, res, body) => {
        if (res && res.statusCode !== 200) {
          err = new Error(`Invalid HTTP Status Code: ${res.statusCode}`);
        }
        if (err) {
          return callback(err);
        }
        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch (e) {
            return callback(e);
          }
        }
        callback(null, body);
      });
    }
    stream(options = {}) {
      const stream = new Stream;
      options = {
        method: "stream",
        params: options
      };
      const path7 = options.params.path || null;
      delete options.params.path;
      const auth = options.params.auth || null;
      delete options.params.auth;
      let buff = "";
      const req = this._request(options, auth, path7);
      stream.destroy = () => req.destroy();
      req.on("data", (data) => {
        data = (buff + data).split(/\n+/);
        const l = data.length - 1;
        let i = 0;
        for (;i < l; i++) {
          try {
            stream.emit("log", JSON.parse(data[i]));
          } catch (e) {
            stream.emit("error", e);
          }
        }
        buff = data[l];
      });
      req.on("error", (err) => stream.emit("error", err));
      return stream;
    }
    _request(options, auth, path7, callback) {
      options = options || {};
      auth = auth || this.auth;
      path7 = path7 || this.path || "";
      if (this.batch) {
        this._doBatch(options, callback, auth, path7);
      } else {
        this._doRequest(options, callback, auth, path7);
      }
    }
    _doBatch(options, callback, auth, path7) {
      this.batchOptions.push(options);
      if (this.batchOptions.length === 1) {
        const me = this;
        this.batchCallback = callback;
        this.batchTimeoutID = setTimeout(function() {
          me.batchTimeoutID = -1;
          me._doBatchRequest(me.batchCallback, auth, path7);
        }, this.batchInterval);
      }
      if (this.batchOptions.length === this.batchCount) {
        this._doBatchRequest(this.batchCallback, auth, path7);
      }
    }
    _doBatchRequest(callback, auth, path7) {
      if (this.batchTimeoutID > 0) {
        clearTimeout(this.batchTimeoutID);
        this.batchTimeoutID = -1;
      }
      const batchOptionsCopy = this.batchOptions.slice();
      this.batchOptions = [];
      this._doRequest(batchOptionsCopy, callback, auth, path7);
    }
    _doRequest(options, callback, auth, path7) {
      const headers = Object.assign({}, this.headers);
      if (auth && auth.bearer) {
        headers.Authorization = `Bearer ${auth.bearer}`;
      }
      const req = (this.ssl ? https : http).request({
        ...this.options,
        method: "POST",
        host: this.host,
        port: this.port,
        path: `/${path7.replace(/^\//, "")}`,
        headers,
        auth: auth && auth.username && auth.password ? `${auth.username}:${auth.password}` : "",
        agent: this.agent
      });
      req.on("error", callback);
      req.on("response", (res) => res.on("end", () => callback(null, res)).resume());
      const jsonStringify = configure({
        ...this.maximumDepth && { maximumDepth: this.maximumDepth }
      });
      req.end(Buffer.from(jsonStringify(options, this.options.replacer), "utf8"));
    }
  };
});

// node_modules/is-stream/index.js
var require_is_stream = __commonJS((exports, module) => {
  var isStream = (stream) => stream !== null && typeof stream === "object" && typeof stream.pipe === "function";
  isStream.writable = (stream) => isStream(stream) && stream.writable !== false && typeof stream._write === "function" && typeof stream._writableState === "object";
  isStream.readable = (stream) => isStream(stream) && stream.readable !== false && typeof stream._read === "function" && typeof stream._readableState === "object";
  isStream.duplex = (stream) => isStream.writable(stream) && isStream.readable(stream);
  isStream.transform = (stream) => isStream.duplex(stream) && typeof stream._transform === "function";
  module.exports = isStream;
});

// node_modules/winston/lib/winston/transports/stream.js
var require_stream = __commonJS((exports, module) => {
  var isStream = require_is_stream();
  var { MESSAGE } = require_triple_beam();
  var os4 = __require("os");
  var TransportStream = require_winston_transport();
  module.exports = class Stream extends TransportStream {
    constructor(options = {}) {
      super(options);
      if (!options.stream || !isStream(options.stream)) {
        throw new Error("options.stream is required.");
      }
      this._stream = options.stream;
      this._stream.setMaxListeners(Infinity);
      this.isObjectMode = options.stream._writableState.objectMode;
      this.eol = typeof options.eol === "string" ? options.eol : os4.EOL;
    }
    log(info, callback) {
      setImmediate(() => this.emit("logged", info));
      if (this.isObjectMode) {
        this._stream.write(info);
        if (callback) {
          callback();
        }
        return;
      }
      this._stream.write(`${info[MESSAGE]}${this.eol}`);
      if (callback) {
        callback();
      }
      return;
    }
  };
});

// node_modules/winston/lib/winston/transports/index.js
var require_transports = __commonJS((exports) => {
  Object.defineProperty(exports, "Console", {
    configurable: true,
    enumerable: true,
    get() {
      return require_console();
    }
  });
  Object.defineProperty(exports, "File", {
    configurable: true,
    enumerable: true,
    get() {
      return require_file();
    }
  });
  Object.defineProperty(exports, "Http", {
    configurable: true,
    enumerable: true,
    get() {
      return require_http();
    }
  });
  Object.defineProperty(exports, "Stream", {
    configurable: true,
    enumerable: true,
    get() {
      return require_stream();
    }
  });
});

// node_modules/winston/lib/winston/config/index.js
var require_config2 = __commonJS((exports) => {
  var logform = require_logform();
  var { configs } = require_triple_beam();
  exports.cli = logform.levels(configs.cli);
  exports.npm = logform.levels(configs.npm);
  exports.syslog = logform.levels(configs.syslog);
  exports.addColors = logform.levels;
});

// node_modules/async/eachOf.js
var require_eachOf = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var _isArrayLike = require_isArrayLike();
  var _isArrayLike2 = _interopRequireDefault(_isArrayLike);
  var _breakLoop = require_breakLoop();
  var _breakLoop2 = _interopRequireDefault(_breakLoop);
  var _eachOfLimit = require_eachOfLimit2();
  var _eachOfLimit2 = _interopRequireDefault(_eachOfLimit);
  var _once = require_once();
  var _once2 = _interopRequireDefault(_once);
  var _onlyOnce = require_onlyOnce();
  var _onlyOnce2 = _interopRequireDefault(_onlyOnce);
  var _wrapAsync = require_wrapAsync();
  var _wrapAsync2 = _interopRequireDefault(_wrapAsync);
  var _awaitify = require_awaitify();
  var _awaitify2 = _interopRequireDefault(_awaitify);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function eachOfArrayLike(coll, iteratee, callback) {
    callback = (0, _once2.default)(callback);
    var index = 0, completed = 0, { length } = coll, canceled = false;
    if (length === 0) {
      callback(null);
    }
    function iteratorCallback(err, value) {
      if (err === false) {
        canceled = true;
      }
      if (canceled === true)
        return;
      if (err) {
        callback(err);
      } else if (++completed === length || value === _breakLoop2.default) {
        callback(null);
      }
    }
    for (;index < length; index++) {
      iteratee(coll[index], index, (0, _onlyOnce2.default)(iteratorCallback));
    }
  }
  function eachOfGeneric(coll, iteratee, callback) {
    return (0, _eachOfLimit2.default)(coll, Infinity, iteratee, callback);
  }
  function eachOf(coll, iteratee, callback) {
    var eachOfImplementation = (0, _isArrayLike2.default)(coll) ? eachOfArrayLike : eachOfGeneric;
    return eachOfImplementation(coll, (0, _wrapAsync2.default)(iteratee), callback);
  }
  exports.default = (0, _awaitify2.default)(eachOf, 3);
  module.exports = exports.default;
});

// node_modules/async/internal/withoutIndex.js
var require_withoutIndex = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.default = _withoutIndex;
  function _withoutIndex(iteratee) {
    return (value, index, callback) => iteratee(value, callback);
  }
  module.exports = exports.default;
});

// node_modules/async/forEach.js
var require_forEach = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  var _eachOf = require_eachOf();
  var _eachOf2 = _interopRequireDefault(_eachOf);
  var _withoutIndex = require_withoutIndex();
  var _withoutIndex2 = _interopRequireDefault(_withoutIndex);
  var _wrapAsync = require_wrapAsync();
  var _wrapAsync2 = _interopRequireDefault(_wrapAsync);
  var _awaitify = require_awaitify();
  var _awaitify2 = _interopRequireDefault(_awaitify);
  function _interopRequireDefault(obj) {
    return obj && obj.__esModule ? obj : { default: obj };
  }
  function eachLimit(coll, iteratee, callback) {
    return (0, _eachOf2.default)(coll, (0, _withoutIndex2.default)((0, _wrapAsync2.default)(iteratee)), callback);
  }
  exports.default = (0, _awaitify2.default)(eachLimit, 3);
  module.exports = exports.default;
});

// node_modules/fn.name/index.js
var require_fn = __commonJS((exports, module) => {
  var toString = Object.prototype.toString;
  module.exports = function name(fn) {
    if (typeof fn.displayName === "string" && fn.constructor.name) {
      return fn.displayName;
    } else if (typeof fn.name === "string" && fn.name) {
      return fn.name;
    }
    if (typeof fn === "object" && fn.constructor && typeof fn.constructor.name === "string")
      return fn.constructor.name;
    var named = fn.toString(), type = toString.call(fn).slice(8, -1);
    if (type === "Function") {
      named = named.substring(named.indexOf("(") + 1, named.indexOf(")"));
    } else {
      named = type;
    }
    return named || "anonymous";
  };
});

// node_modules/one-time/index.js
var require_one_time = __commonJS((exports, module) => {
  var name = require_fn();
  module.exports = function one(fn) {
    var called = 0, value;
    function onetime() {
      if (called)
        return value;
      called = 1;
      value = fn.apply(this, arguments);
      fn = null;
      return value;
    }
    onetime.displayName = name(fn);
    return onetime;
  };
});

// node_modules/stack-trace/lib/stack-trace.js
var require_stack_trace = __commonJS((exports) => {
  exports.get = function(belowFn) {
    var oldLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;
    var dummyObject = {};
    var v8Handler = Error.prepareStackTrace;
    Error.prepareStackTrace = function(dummyObject2, v8StackTrace2) {
      return v8StackTrace2;
    };
    Error.captureStackTrace(dummyObject, belowFn || exports.get);
    var v8StackTrace = dummyObject.stack;
    Error.prepareStackTrace = v8Handler;
    Error.stackTraceLimit = oldLimit;
    return v8StackTrace;
  };
  exports.parse = function(err) {
    if (!err.stack) {
      return [];
    }
    var self2 = this;
    var lines = err.stack.split(`
`).slice(1);
    return lines.map(function(line) {
      if (line.match(/^\s*[-]{4,}$/)) {
        return self2._createParsedCallSite({
          fileName: line,
          lineNumber: null,
          functionName: null,
          typeName: null,
          methodName: null,
          columnNumber: null,
          native: null
        });
      }
      var lineMatch = line.match(/at (?:(.+)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?/);
      if (!lineMatch) {
        return;
      }
      var object = null;
      var method = null;
      var functionName = null;
      var typeName = null;
      var methodName = null;
      var isNative = lineMatch[5] === "native";
      if (lineMatch[1]) {
        functionName = lineMatch[1];
        var methodStart = functionName.lastIndexOf(".");
        if (functionName[methodStart - 1] == ".")
          methodStart--;
        if (methodStart > 0) {
          object = functionName.substr(0, methodStart);
          method = functionName.substr(methodStart + 1);
          var objectEnd = object.indexOf(".Module");
          if (objectEnd > 0) {
            functionName = functionName.substr(objectEnd + 1);
            object = object.substr(0, objectEnd);
          }
        }
        typeName = null;
      }
      if (method) {
        typeName = object;
        methodName = method;
      }
      if (method === "<anonymous>") {
        methodName = null;
        functionName = null;
      }
      var properties = {
        fileName: lineMatch[2] || null,
        lineNumber: parseInt(lineMatch[3], 10) || null,
        functionName,
        typeName,
        methodName,
        columnNumber: parseInt(lineMatch[4], 10) || null,
        native: isNative
      };
      return self2._createParsedCallSite(properties);
    }).filter(function(callSite) {
      return !!callSite;
    });
  };
  function CallSite(properties) {
    for (var property in properties) {
      this[property] = properties[property];
    }
  }
  var strProperties = [
    "this",
    "typeName",
    "functionName",
    "methodName",
    "fileName",
    "lineNumber",
    "columnNumber",
    "function",
    "evalOrigin"
  ];
  var boolProperties = [
    "topLevel",
    "eval",
    "native",
    "constructor"
  ];
  strProperties.forEach(function(property) {
    CallSite.prototype[property] = null;
    CallSite.prototype["get" + property[0].toUpperCase() + property.substr(1)] = function() {
      return this[property];
    };
  });
  boolProperties.forEach(function(property) {
    CallSite.prototype[property] = false;
    CallSite.prototype["is" + property[0].toUpperCase() + property.substr(1)] = function() {
      return this[property];
    };
  });
  exports._createParsedCallSite = function(properties) {
    return new CallSite(properties);
  };
});

// node_modules/winston/lib/winston/exception-stream.js
var require_exception_stream = __commonJS((exports, module) => {
  var { Writable } = require_readable();
  module.exports = class ExceptionStream extends Writable {
    constructor(transport) {
      super({ objectMode: true });
      if (!transport) {
        throw new Error("ExceptionStream requires a TransportStream instance.");
      }
      this.handleExceptions = true;
      this.transport = transport;
    }
    _write(info, enc, callback) {
      if (info.exception) {
        return this.transport.log(info, callback);
      }
      callback();
      return true;
    }
  };
});

// node_modules/winston/lib/winston/exception-handler.js
var require_exception_handler = __commonJS((exports, module) => {
  var os4 = __require("os");
  var asyncForEach = require_forEach();
  var debug = require_node2()("winston:exception");
  var once = require_one_time();
  var stackTrace = require_stack_trace();
  var ExceptionStream = require_exception_stream();
  module.exports = class ExceptionHandler {
    constructor(logger) {
      if (!logger) {
        throw new Error("Logger is required to handle exceptions");
      }
      this.logger = logger;
      this.handlers = new Map;
    }
    handle(...args) {
      args.forEach((arg) => {
        if (Array.isArray(arg)) {
          return arg.forEach((handler) => this._addHandler(handler));
        }
        this._addHandler(arg);
      });
      if (!this.catcher) {
        this.catcher = this._uncaughtException.bind(this);
        process.on("uncaughtException", this.catcher);
      }
    }
    unhandle() {
      if (this.catcher) {
        process.removeListener("uncaughtException", this.catcher);
        this.catcher = false;
        Array.from(this.handlers.values()).forEach((wrapper) => this.logger.unpipe(wrapper));
      }
    }
    getAllInfo(err) {
      let message = null;
      if (err) {
        message = typeof err === "string" ? err : err.message;
      }
      return {
        error: err,
        level: "error",
        message: [
          `uncaughtException: ${message || "(no error message)"}`,
          err && err.stack || "  No stack trace"
        ].join(`
`),
        stack: err && err.stack,
        exception: true,
        date: new Date().toString(),
        process: this.getProcessInfo(),
        os: this.getOsInfo(),
        trace: this.getTrace(err)
      };
    }
    getProcessInfo() {
      return {
        pid: process.pid,
        uid: process.getuid ? process.getuid() : null,
        gid: process.getgid ? process.getgid() : null,
        cwd: process.cwd(),
        execPath: process.execPath,
        version: process.version,
        argv: process.argv,
        memoryUsage: process.memoryUsage()
      };
    }
    getOsInfo() {
      return {
        loadavg: os4.loadavg(),
        uptime: os4.uptime()
      };
    }
    getTrace(err) {
      const trace = err ? stackTrace.parse(err) : stackTrace.get();
      return trace.map((site) => {
        return {
          column: site.getColumnNumber(),
          file: site.getFileName(),
          function: site.getFunctionName(),
          line: site.getLineNumber(),
          method: site.getMethodName(),
          native: site.isNative()
        };
      });
    }
    _addHandler(handler) {
      if (!this.handlers.has(handler)) {
        handler.handleExceptions = true;
        const wrapper = new ExceptionStream(handler);
        this.handlers.set(handler, wrapper);
        this.logger.pipe(wrapper);
      }
    }
    _uncaughtException(err) {
      const info = this.getAllInfo(err);
      const handlers = this._getExceptionHandlers();
      let doExit = typeof this.logger.exitOnError === "function" ? this.logger.exitOnError(err) : this.logger.exitOnError;
      let timeout;
      if (!handlers.length && doExit) {
        console.warn("winston: exitOnError cannot be true with no exception handlers.");
        console.warn("winston: not exiting process.");
        doExit = false;
      }
      function gracefulExit() {
        debug("doExit", doExit);
        debug("process._exiting", process._exiting);
        if (doExit && !process._exiting) {
          if (timeout) {
            clearTimeout(timeout);
          }
          process.exit(1);
        }
      }
      if (!handlers || handlers.length === 0) {
        return process.nextTick(gracefulExit);
      }
      asyncForEach(handlers, (handler, next) => {
        const done = once(next);
        const transport = handler.transport || handler;
        function onDone(event) {
          return () => {
            debug(event);
            done();
          };
        }
        transport._ending = true;
        transport.once("finish", onDone("finished"));
        transport.once("error", onDone("error"));
      }, () => doExit && gracefulExit());
      this.logger.log(info);
      if (doExit) {
        timeout = setTimeout(gracefulExit, 3000);
      }
    }
    _getExceptionHandlers() {
      return this.logger.transports.filter((wrap) => {
        const transport = wrap.transport || wrap;
        return transport.handleExceptions;
      });
    }
  };
});

// node_modules/winston/lib/winston/rejection-stream.js
var require_rejection_stream = __commonJS((exports, module) => {
  var { Writable } = require_readable();
  module.exports = class RejectionStream extends Writable {
    constructor(transport) {
      super({ objectMode: true });
      if (!transport) {
        throw new Error("RejectionStream requires a TransportStream instance.");
      }
      this.handleRejections = true;
      this.transport = transport;
    }
    _write(info, enc, callback) {
      if (info.rejection) {
        return this.transport.log(info, callback);
      }
      callback();
      return true;
    }
  };
});

// node_modules/winston/lib/winston/rejection-handler.js
var require_rejection_handler = __commonJS((exports, module) => {
  var os4 = __require("os");
  var asyncForEach = require_forEach();
  var debug = require_node2()("winston:rejection");
  var once = require_one_time();
  var stackTrace = require_stack_trace();
  var RejectionStream = require_rejection_stream();
  module.exports = class RejectionHandler {
    constructor(logger) {
      if (!logger) {
        throw new Error("Logger is required to handle rejections");
      }
      this.logger = logger;
      this.handlers = new Map;
    }
    handle(...args) {
      args.forEach((arg) => {
        if (Array.isArray(arg)) {
          return arg.forEach((handler) => this._addHandler(handler));
        }
        this._addHandler(arg);
      });
      if (!this.catcher) {
        this.catcher = this._unhandledRejection.bind(this);
        process.on("unhandledRejection", this.catcher);
      }
    }
    unhandle() {
      if (this.catcher) {
        process.removeListener("unhandledRejection", this.catcher);
        this.catcher = false;
        Array.from(this.handlers.values()).forEach((wrapper) => this.logger.unpipe(wrapper));
      }
    }
    getAllInfo(err) {
      let message = null;
      if (err) {
        message = typeof err === "string" ? err : err.message;
      }
      return {
        error: err,
        level: "error",
        message: [
          `unhandledRejection: ${message || "(no error message)"}`,
          err && err.stack || "  No stack trace"
        ].join(`
`),
        stack: err && err.stack,
        rejection: true,
        date: new Date().toString(),
        process: this.getProcessInfo(),
        os: this.getOsInfo(),
        trace: this.getTrace(err)
      };
    }
    getProcessInfo() {
      return {
        pid: process.pid,
        uid: process.getuid ? process.getuid() : null,
        gid: process.getgid ? process.getgid() : null,
        cwd: process.cwd(),
        execPath: process.execPath,
        version: process.version,
        argv: process.argv,
        memoryUsage: process.memoryUsage()
      };
    }
    getOsInfo() {
      return {
        loadavg: os4.loadavg(),
        uptime: os4.uptime()
      };
    }
    getTrace(err) {
      const trace = err ? stackTrace.parse(err) : stackTrace.get();
      return trace.map((site) => {
        return {
          column: site.getColumnNumber(),
          file: site.getFileName(),
          function: site.getFunctionName(),
          line: site.getLineNumber(),
          method: site.getMethodName(),
          native: site.isNative()
        };
      });
    }
    _addHandler(handler) {
      if (!this.handlers.has(handler)) {
        handler.handleRejections = true;
        const wrapper = new RejectionStream(handler);
        this.handlers.set(handler, wrapper);
        this.logger.pipe(wrapper);
      }
    }
    _unhandledRejection(err) {
      const info = this.getAllInfo(err);
      const handlers = this._getRejectionHandlers();
      let doExit = typeof this.logger.exitOnError === "function" ? this.logger.exitOnError(err) : this.logger.exitOnError;
      let timeout;
      if (!handlers.length && doExit) {
        console.warn("winston: exitOnError cannot be true with no rejection handlers.");
        console.warn("winston: not exiting process.");
        doExit = false;
      }
      function gracefulExit() {
        debug("doExit", doExit);
        debug("process._exiting", process._exiting);
        if (doExit && !process._exiting) {
          if (timeout) {
            clearTimeout(timeout);
          }
          process.exit(1);
        }
      }
      if (!handlers || handlers.length === 0) {
        return process.nextTick(gracefulExit);
      }
      asyncForEach(handlers, (handler, next) => {
        const done = once(next);
        const transport = handler.transport || handler;
        function onDone(event) {
          return () => {
            debug(event);
            done();
          };
        }
        transport._ending = true;
        transport.once("finish", onDone("finished"));
        transport.once("error", onDone("error"));
      }, () => doExit && gracefulExit());
      this.logger.log(info);
      if (doExit) {
        timeout = setTimeout(gracefulExit, 3000);
      }
    }
    _getRejectionHandlers() {
      return this.logger.transports.filter((wrap) => {
        const transport = wrap.transport || wrap;
        return transport.handleRejections;
      });
    }
  };
});

// node_modules/winston/lib/winston/profiler.js
var require_profiler = __commonJS((exports, module) => {
  class Profiler {
    constructor(logger) {
      const Logger = require_logger();
      if (typeof logger !== "object" || Array.isArray(logger) || !(logger instanceof Logger)) {
        throw new Error("Logger is required for profiling");
      } else {
        this.logger = logger;
        this.start = Date.now();
      }
    }
    done(...args) {
      if (typeof args[args.length - 1] === "function") {
        console.warn("Callback function no longer supported as of winston@3.0.0");
        args.pop();
      }
      const info = typeof args[args.length - 1] === "object" ? args.pop() : {};
      info.level = info.level || "info";
      info.durationMs = Date.now() - this.start;
      return this.logger.write(info);
    }
  }
  module.exports = Profiler;
});

// node_modules/winston/lib/winston/logger.js
var require_logger = __commonJS((exports, module) => {
  var { Stream, Transform } = require_readable();
  var asyncForEach = require_forEach();
  var { LEVEL, SPLAT } = require_triple_beam();
  var isStream = require_is_stream();
  var ExceptionHandler = require_exception_handler();
  var RejectionHandler = require_rejection_handler();
  var LegacyTransportStream = require_legacy();
  var Profiler = require_profiler();
  var { warn } = require_common();
  var config = require_config2();
  var formatRegExp = /%[scdjifoO%]/g;

  class Logger extends Transform {
    constructor(options) {
      super({ objectMode: true });
      this.configure(options);
    }
    child(defaultRequestMetadata) {
      const logger = this;
      return Object.create(logger, {
        write: {
          value: function(info) {
            const infoClone = Object.assign({}, defaultRequestMetadata, info);
            if (info instanceof Error) {
              infoClone.stack = info.stack;
              infoClone.message = info.message;
              infoClone.cause = info.cause;
            }
            logger.write(infoClone);
          }
        }
      });
    }
    configure({
      silent,
      format,
      defaultMeta,
      levels,
      level = "info",
      exitOnError = true,
      transports,
      colors,
      emitErrs,
      formatters,
      padLevels,
      rewriters,
      stripColors,
      exceptionHandlers,
      rejectionHandlers
    } = {}) {
      if (this.transports.length) {
        this.clear();
      }
      this.silent = silent;
      this.format = format || this.format || require_json()();
      this.defaultMeta = defaultMeta || null;
      this.levels = levels || this.levels || config.npm.levels;
      this.level = level;
      if (this.exceptions) {
        this.exceptions.unhandle();
      }
      if (this.rejections) {
        this.rejections.unhandle();
      }
      this.exceptions = new ExceptionHandler(this);
      this.rejections = new RejectionHandler(this);
      this.profilers = {};
      this.exitOnError = exitOnError;
      if (transports) {
        transports = Array.isArray(transports) ? transports : [transports];
        transports.forEach((transport) => this.add(transport));
      }
      if (colors || emitErrs || formatters || padLevels || rewriters || stripColors) {
        throw new Error([
          "{ colors, emitErrs, formatters, padLevels, rewriters, stripColors } were removed in winston@3.0.0.",
          "Use a custom winston.format(function) instead.",
          "See: https://github.com/winstonjs/winston/tree/master/UPGRADE-3.0.md"
        ].join(`
`));
      }
      if (exceptionHandlers) {
        this.exceptions.handle(exceptionHandlers);
      }
      if (rejectionHandlers) {
        this.rejections.handle(rejectionHandlers);
      }
    }
    getHighestLogLevel() {
      const configuredLevelValue = getLevelValue(this.levels, this.level);
      if (!this.transports || this.transports.length === 0) {
        return configuredLevelValue;
      }
      return this.transports.reduce((max, transport) => {
        const levelValue = getLevelValue(this.levels, transport.level);
        return levelValue !== null && levelValue > max ? levelValue : max;
      }, configuredLevelValue);
    }
    isLevelEnabled(level) {
      const givenLevelValue = getLevelValue(this.levels, level);
      if (givenLevelValue === null) {
        return false;
      }
      const configuredLevelValue = getLevelValue(this.levels, this.level);
      if (configuredLevelValue === null) {
        return false;
      }
      if (!this.transports || this.transports.length === 0) {
        return configuredLevelValue >= givenLevelValue;
      }
      const index = this.transports.findIndex((transport) => {
        let transportLevelValue = getLevelValue(this.levels, transport.level);
        if (transportLevelValue === null) {
          transportLevelValue = configuredLevelValue;
        }
        return transportLevelValue >= givenLevelValue;
      });
      return index !== -1;
    }
    log(level, msg, ...splat) {
      if (arguments.length === 1) {
        level[LEVEL] = level.level;
        this._addDefaultMeta(level);
        this.write(level);
        return this;
      }
      if (arguments.length === 2) {
        if (msg && typeof msg === "object") {
          msg[LEVEL] = msg.level = level;
          this._addDefaultMeta(msg);
          this.write(msg);
          return this;
        }
        msg = { [LEVEL]: level, level, message: msg };
        this._addDefaultMeta(msg);
        this.write(msg);
        return this;
      }
      const [meta] = splat;
      if (typeof meta === "object" && meta !== null) {
        const tokens = msg && msg.match && msg.match(formatRegExp);
        if (!tokens) {
          const info = Object.assign({}, this.defaultMeta, meta, {
            [LEVEL]: level,
            [SPLAT]: splat,
            level,
            message: msg
          });
          if (meta.message)
            info.message = `${info.message} ${meta.message}`;
          if (meta.stack)
            info.stack = meta.stack;
          if (meta.cause)
            info.cause = meta.cause;
          this.write(info);
          return this;
        }
      }
      this.write(Object.assign({}, this.defaultMeta, {
        [LEVEL]: level,
        [SPLAT]: splat,
        level,
        message: msg
      }));
      return this;
    }
    _transform(info, enc, callback) {
      if (this.silent) {
        return callback();
      }
      if (!info[LEVEL]) {
        info[LEVEL] = info.level;
      }
      if (!this.levels[info[LEVEL]] && this.levels[info[LEVEL]] !== 0) {
        console.error("[winston] Unknown logger level: %s", info[LEVEL]);
      }
      if (!this._readableState.pipes) {
        console.error("[winston] Attempt to write logs with no transports, which can increase memory usage: %j", info);
      }
      try {
        this.push(this.format.transform(info, this.format.options));
      } finally {
        this._writableState.sync = false;
        callback();
      }
    }
    _final(callback) {
      const transports = this.transports.slice();
      asyncForEach(transports, (transport, next) => {
        if (!transport || transport.finished)
          return setImmediate(next);
        transport.once("finish", next);
        transport.end();
      }, callback);
    }
    add(transport) {
      const target = !isStream(transport) || transport.log.length > 2 ? new LegacyTransportStream({ transport }) : transport;
      if (!target._writableState || !target._writableState.objectMode) {
        throw new Error("Transports must WritableStreams in objectMode. Set { objectMode: true }.");
      }
      this._onEvent("error", target);
      this._onEvent("warn", target);
      this.pipe(target);
      if (transport.handleExceptions) {
        this.exceptions.handle();
      }
      if (transport.handleRejections) {
        this.rejections.handle();
      }
      return this;
    }
    remove(transport) {
      if (!transport)
        return this;
      let target = transport;
      if (!isStream(transport) || transport.log.length > 2) {
        target = this.transports.filter((match) => match.transport === transport)[0];
      }
      if (target) {
        this.unpipe(target);
      }
      return this;
    }
    clear() {
      this.unpipe();
      return this;
    }
    close() {
      this.exceptions.unhandle();
      this.rejections.unhandle();
      this.clear();
      this.emit("close");
      return this;
    }
    setLevels() {
      warn.deprecated("setLevels");
    }
    query(options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      options = options || {};
      const results = {};
      const queryObject = Object.assign({}, options.query || {});
      function queryTransport(transport, next) {
        if (options.query && typeof transport.formatQuery === "function") {
          options.query = transport.formatQuery(queryObject);
        }
        transport.query(options, (err, res) => {
          if (err) {
            return next(err);
          }
          if (typeof transport.formatResults === "function") {
            res = transport.formatResults(res, options.format);
          }
          next(null, res);
        });
      }
      function addResults(transport, next) {
        queryTransport(transport, (err, result) => {
          if (next) {
            result = err || result;
            if (result) {
              results[transport.name] = result;
            }
            next();
          }
          next = null;
        });
      }
      asyncForEach(this.transports.filter((transport) => !!transport.query), addResults, () => callback(null, results));
    }
    stream(options = {}) {
      const out = new Stream;
      const streams = [];
      out._streams = streams;
      out.destroy = () => {
        let i = streams.length;
        while (i--) {
          streams[i].destroy();
        }
      };
      this.transports.filter((transport) => !!transport.stream).forEach((transport) => {
        const str = transport.stream(options);
        if (!str) {
          return;
        }
        streams.push(str);
        str.on("log", (log) => {
          log.transport = log.transport || [];
          log.transport.push(transport.name);
          out.emit("log", log);
        });
        str.on("error", (err) => {
          err.transport = err.transport || [];
          err.transport.push(transport.name);
          out.emit("error", err);
        });
      });
      return out;
    }
    startTimer() {
      return new Profiler(this);
    }
    profile(id, ...args) {
      const time = Date.now();
      if (this.profilers[id]) {
        const timeEnd = this.profilers[id];
        delete this.profilers[id];
        if (typeof args[args.length - 2] === "function") {
          console.warn("Callback function no longer supported as of winston@3.0.0");
          args.pop();
        }
        const info = typeof args[args.length - 1] === "object" ? args.pop() : {};
        info.level = info.level || "info";
        info.durationMs = time - timeEnd;
        info.message = info.message || id;
        return this.write(info);
      }
      this.profilers[id] = time;
      return this;
    }
    handleExceptions(...args) {
      console.warn("Deprecated: .handleExceptions() will be removed in winston@4. Use .exceptions.handle()");
      this.exceptions.handle(...args);
    }
    unhandleExceptions(...args) {
      console.warn("Deprecated: .unhandleExceptions() will be removed in winston@4. Use .exceptions.unhandle()");
      this.exceptions.unhandle(...args);
    }
    cli() {
      throw new Error([
        "Logger.cli() was removed in winston@3.0.0",
        "Use a custom winston.formats.cli() instead.",
        "See: https://github.com/winstonjs/winston/tree/master/UPGRADE-3.0.md"
      ].join(`
`));
    }
    _onEvent(event, transport) {
      function transportEvent(err) {
        if (event === "error" && !this.transports.includes(transport)) {
          this.add(transport);
        }
        this.emit(event, err, transport);
      }
      if (!transport["__winston" + event]) {
        transport["__winston" + event] = transportEvent.bind(this);
        transport.on(event, transport["__winston" + event]);
      }
    }
    _addDefaultMeta(msg) {
      if (this.defaultMeta) {
        Object.assign(msg, this.defaultMeta);
      }
    }
  }
  function getLevelValue(levels, level) {
    const value = levels[level];
    if (!value && value !== 0) {
      return null;
    }
    return value;
  }
  Object.defineProperty(Logger.prototype, "transports", {
    configurable: false,
    enumerable: true,
    get() {
      const { pipes } = this._readableState;
      return !Array.isArray(pipes) ? [pipes].filter(Boolean) : pipes;
    }
  });
  module.exports = Logger;
});

// node_modules/winston/lib/winston/create-logger.js
var require_create_logger = __commonJS((exports, module) => {
  var { LEVEL } = require_triple_beam();
  var config = require_config2();
  var Logger = require_logger();
  var debug = require_node2()("winston:create-logger");
  function isLevelEnabledFunctionName(level) {
    return "is" + level.charAt(0).toUpperCase() + level.slice(1) + "Enabled";
  }
  module.exports = function(opts = {}) {
    opts.levels = opts.levels || config.npm.levels;

    class DerivedLogger extends Logger {
      constructor(options) {
        super(options);
      }
    }
    const logger = new DerivedLogger(opts);
    Object.keys(opts.levels).forEach(function(level) {
      debug('Define prototype method for "%s"', level);
      if (level === "log") {
        console.warn('Level "log" not defined: conflicts with the method "log". Use a different level name.');
        return;
      }
      DerivedLogger.prototype[level] = function(...args) {
        const self2 = this || logger;
        if (args.length === 1) {
          const [msg] = args;
          const info = msg && msg.message && msg || { message: msg };
          info.level = info[LEVEL] = level;
          self2._addDefaultMeta(info);
          self2.write(info);
          return this || logger;
        }
        if (args.length === 0) {
          self2.log(level, "");
          return self2;
        }
        return self2.log(level, ...args);
      };
      DerivedLogger.prototype[isLevelEnabledFunctionName(level)] = function() {
        return (this || logger).isLevelEnabled(level);
      };
    });
    return logger;
  };
});

// node_modules/winston/lib/winston/container.js
var require_container = __commonJS((exports, module) => {
  var createLogger = require_create_logger();
  module.exports = class Container {
    constructor(options = {}) {
      this.loggers = new Map;
      this.options = options;
    }
    add(id, options) {
      if (!this.loggers.has(id)) {
        options = Object.assign({}, options || this.options);
        const existing = options.transports || this.options.transports;
        if (existing) {
          options.transports = Array.isArray(existing) ? existing.slice() : [existing];
        } else {
          options.transports = [];
        }
        const logger = createLogger(options);
        logger.on("close", () => this._delete(id));
        this.loggers.set(id, logger);
      }
      return this.loggers.get(id);
    }
    get(id, options) {
      return this.add(id, options);
    }
    has(id) {
      return !!this.loggers.has(id);
    }
    close(id) {
      if (id) {
        return this._removeLogger(id);
      }
      this.loggers.forEach((val, key) => this._removeLogger(key));
    }
    _removeLogger(id) {
      if (!this.loggers.has(id)) {
        return;
      }
      const logger = this.loggers.get(id);
      logger.close();
      this._delete(id);
    }
    _delete(id) {
      this.loggers.delete(id);
    }
  };
});

// node_modules/winston/lib/winston.js
var require_winston = __commonJS((exports) => {
  var logform = require_logform();
  var { warn } = require_common();
  exports.version = require_package().version;
  exports.transports = require_transports();
  exports.config = require_config2();
  exports.addColors = logform.levels;
  exports.format = logform.format;
  exports.createLogger = require_create_logger();
  exports.Logger = require_logger();
  exports.ExceptionHandler = require_exception_handler();
  exports.RejectionHandler = require_rejection_handler();
  exports.Container = require_container();
  exports.Transport = require_winston_transport();
  exports.loggers = new exports.Container;
  var defaultLogger = exports.createLogger();
  Object.keys(exports.config.npm.levels).concat([
    "log",
    "query",
    "stream",
    "add",
    "remove",
    "clear",
    "profile",
    "startTimer",
    "handleExceptions",
    "unhandleExceptions",
    "handleRejections",
    "unhandleRejections",
    "configure",
    "child"
  ]).forEach((method) => exports[method] = (...args) => defaultLogger[method](...args));
  Object.defineProperty(exports, "level", {
    get() {
      return defaultLogger.level;
    },
    set(val) {
      defaultLogger.level = val;
    }
  });
  Object.defineProperty(exports, "exceptions", {
    get() {
      return defaultLogger.exceptions;
    }
  });
  Object.defineProperty(exports, "rejections", {
    get() {
      return defaultLogger.rejections;
    }
  });
  ["exitOnError"].forEach((prop) => {
    Object.defineProperty(exports, prop, {
      get() {
        return defaultLogger[prop];
      },
      set(val) {
        defaultLogger[prop] = val;
      }
    });
  });
  Object.defineProperty(exports, "default", {
    get() {
      return {
        exceptionHandlers: defaultLogger.exceptionHandlers,
        rejectionHandlers: defaultLogger.rejectionHandlers,
        transports: defaultLogger.transports
      };
    }
  });
  warn.deprecated(exports, "setLevels");
  warn.forFunctions(exports, "useFormat", ["cli"]);
  warn.forProperties(exports, "useFormat", ["padLevels", "stripColors"]);
  warn.forFunctions(exports, "deprecated", [
    "addRewriter",
    "addFilter",
    "clone",
    "extend"
  ]);
  warn.forProperties(exports, "deprecated", ["emitErrs", "levelLength"]);
});

// node_modules/object-hash/index.js
var require_object_hash = __commonJS((exports, module) => {
  var crypto2 = __require("crypto");
  exports = module.exports = objectHash;
  function objectHash(object, options) {
    options = applyDefaults(object, options);
    return hash(object, options);
  }
  exports.sha1 = function(object) {
    return objectHash(object);
  };
  exports.keys = function(object) {
    return objectHash(object, { excludeValues: true, algorithm: "sha1", encoding: "hex" });
  };
  exports.MD5 = function(object) {
    return objectHash(object, { algorithm: "md5", encoding: "hex" });
  };
  exports.keysMD5 = function(object) {
    return objectHash(object, { algorithm: "md5", encoding: "hex", excludeValues: true });
  };
  var hashes = crypto2.getHashes ? crypto2.getHashes().slice() : ["sha1", "md5"];
  hashes.push("passthrough");
  var encodings = ["buffer", "hex", "binary", "base64"];
  function applyDefaults(object, sourceOptions) {
    sourceOptions = sourceOptions || {};
    var options = {};
    options.algorithm = sourceOptions.algorithm || "sha1";
    options.encoding = sourceOptions.encoding || "hex";
    options.excludeValues = sourceOptions.excludeValues ? true : false;
    options.algorithm = options.algorithm.toLowerCase();
    options.encoding = options.encoding.toLowerCase();
    options.ignoreUnknown = sourceOptions.ignoreUnknown !== true ? false : true;
    options.respectType = sourceOptions.respectType === false ? false : true;
    options.respectFunctionNames = sourceOptions.respectFunctionNames === false ? false : true;
    options.respectFunctionProperties = sourceOptions.respectFunctionProperties === false ? false : true;
    options.unorderedArrays = sourceOptions.unorderedArrays !== true ? false : true;
    options.unorderedSets = sourceOptions.unorderedSets === false ? false : true;
    options.unorderedObjects = sourceOptions.unorderedObjects === false ? false : true;
    options.replacer = sourceOptions.replacer || undefined;
    options.excludeKeys = sourceOptions.excludeKeys || undefined;
    if (typeof object === "undefined") {
      throw new Error("Object argument required.");
    }
    for (var i = 0;i < hashes.length; ++i) {
      if (hashes[i].toLowerCase() === options.algorithm.toLowerCase()) {
        options.algorithm = hashes[i];
      }
    }
    if (hashes.indexOf(options.algorithm) === -1) {
      throw new Error('Algorithm "' + options.algorithm + '"  not supported. ' + "supported values: " + hashes.join(", "));
    }
    if (encodings.indexOf(options.encoding) === -1 && options.algorithm !== "passthrough") {
      throw new Error('Encoding "' + options.encoding + '"  not supported. ' + "supported values: " + encodings.join(", "));
    }
    return options;
  }
  function isNativeFunction(f) {
    if (typeof f !== "function") {
      return false;
    }
    var exp = /^function\s+\w*\s*\(\s*\)\s*{\s+\[native code\]\s+}$/i;
    return exp.exec(Function.prototype.toString.call(f)) != null;
  }
  function hash(object, options) {
    var hashingStream;
    if (options.algorithm !== "passthrough") {
      hashingStream = crypto2.createHash(options.algorithm);
    } else {
      hashingStream = new PassThrough;
    }
    if (typeof hashingStream.write === "undefined") {
      hashingStream.write = hashingStream.update;
      hashingStream.end = hashingStream.update;
    }
    var hasher = typeHasher(options, hashingStream);
    hasher.dispatch(object);
    if (!hashingStream.update) {
      hashingStream.end("");
    }
    if (hashingStream.digest) {
      return hashingStream.digest(options.encoding === "buffer" ? undefined : options.encoding);
    }
    var buf = hashingStream.read();
    if (options.encoding === "buffer") {
      return buf;
    }
    return buf.toString(options.encoding);
  }
  exports.writeToStream = function(object, options, stream) {
    if (typeof stream === "undefined") {
      stream = options;
      options = {};
    }
    options = applyDefaults(object, options);
    return typeHasher(options, stream).dispatch(object);
  };
  function typeHasher(options, writeTo, context) {
    context = context || [];
    var write = function(str) {
      if (writeTo.update) {
        return writeTo.update(str, "utf8");
      } else {
        return writeTo.write(str, "utf8");
      }
    };
    return {
      dispatch: function(value) {
        if (options.replacer) {
          value = options.replacer(value);
        }
        var type = typeof value;
        if (value === null) {
          type = "null";
        }
        return this["_" + type](value);
      },
      _object: function(object) {
        var pattern = /\[object (.*)\]/i;
        var objString = Object.prototype.toString.call(object);
        var objType = pattern.exec(objString);
        if (!objType) {
          objType = "unknown:[" + objString + "]";
        } else {
          objType = objType[1];
        }
        objType = objType.toLowerCase();
        var objectNumber = null;
        if ((objectNumber = context.indexOf(object)) >= 0) {
          return this.dispatch("[CIRCULAR:" + objectNumber + "]");
        } else {
          context.push(object);
        }
        if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(object)) {
          write("buffer:");
          return write(object);
        }
        if (objType !== "object" && objType !== "function" && objType !== "asyncfunction") {
          if (this["_" + objType]) {
            this["_" + objType](object);
          } else if (options.ignoreUnknown) {
            return write("[" + objType + "]");
          } else {
            throw new Error('Unknown object type "' + objType + '"');
          }
        } else {
          var keys = Object.keys(object);
          if (options.unorderedObjects) {
            keys = keys.sort();
          }
          if (options.respectType !== false && !isNativeFunction(object)) {
            keys.splice(0, 0, "prototype", "__proto__", "constructor");
          }
          if (options.excludeKeys) {
            keys = keys.filter(function(key) {
              return !options.excludeKeys(key);
            });
          }
          write("object:" + keys.length + ":");
          var self2 = this;
          return keys.forEach(function(key) {
            self2.dispatch(key);
            write(":");
            if (!options.excludeValues) {
              self2.dispatch(object[key]);
            }
            write(",");
          });
        }
      },
      _array: function(arr, unordered) {
        unordered = typeof unordered !== "undefined" ? unordered : options.unorderedArrays !== false;
        var self2 = this;
        write("array:" + arr.length + ":");
        if (!unordered || arr.length <= 1) {
          return arr.forEach(function(entry) {
            return self2.dispatch(entry);
          });
        }
        var contextAdditions = [];
        var entries = arr.map(function(entry) {
          var strm = new PassThrough;
          var localContext = context.slice();
          var hasher = typeHasher(options, strm, localContext);
          hasher.dispatch(entry);
          contextAdditions = contextAdditions.concat(localContext.slice(context.length));
          return strm.read().toString();
        });
        context = context.concat(contextAdditions);
        entries.sort();
        return this._array(entries, false);
      },
      _date: function(date) {
        return write("date:" + date.toJSON());
      },
      _symbol: function(sym) {
        return write("symbol:" + sym.toString());
      },
      _error: function(err) {
        return write("error:" + err.toString());
      },
      _boolean: function(bool) {
        return write("bool:" + bool.toString());
      },
      _string: function(string) {
        write("string:" + string.length + ":");
        write(string.toString());
      },
      _function: function(fn) {
        write("fn:");
        if (isNativeFunction(fn)) {
          this.dispatch("[native]");
        } else {
          this.dispatch(fn.toString());
        }
        if (options.respectFunctionNames !== false) {
          this.dispatch("function-name:" + String(fn.name));
        }
        if (options.respectFunctionProperties) {
          this._object(fn);
        }
      },
      _number: function(number) {
        return write("number:" + number.toString());
      },
      _xml: function(xml) {
        return write("xml:" + xml.toString());
      },
      _null: function() {
        return write("Null");
      },
      _undefined: function() {
        return write("Undefined");
      },
      _regexp: function(regex) {
        return write("regex:" + regex.toString());
      },
      _uint8array: function(arr) {
        write("uint8array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _uint8clampedarray: function(arr) {
        write("uint8clampedarray:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _int8array: function(arr) {
        write("int8array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _uint16array: function(arr) {
        write("uint16array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _int16array: function(arr) {
        write("int16array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _uint32array: function(arr) {
        write("uint32array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _int32array: function(arr) {
        write("int32array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _float32array: function(arr) {
        write("float32array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _float64array: function(arr) {
        write("float64array:");
        return this.dispatch(Array.prototype.slice.call(arr));
      },
      _arraybuffer: function(arr) {
        write("arraybuffer:");
        return this.dispatch(new Uint8Array(arr));
      },
      _url: function(url) {
        return write("url:" + url.toString(), "utf8");
      },
      _map: function(map) {
        write("map:");
        var arr = Array.from(map);
        return this._array(arr, options.unorderedSets !== false);
      },
      _set: function(set) {
        write("set:");
        var arr = Array.from(set);
        return this._array(arr, options.unorderedSets !== false);
      },
      _file: function(file) {
        write("file:");
        return this.dispatch([file.name, file.size, file.type, file.lastModfied]);
      },
      _blob: function() {
        if (options.ignoreUnknown) {
          return write("[blob]");
        }
        throw Error(`Hashing Blob objects is currently not supported
` + `(see https://github.com/puleos/object-hash/issues/26)
` + `Use "options.replacer" or "options.ignoreUnknown"
`);
      },
      _domwindow: function() {
        return write("domwindow");
      },
      _bigint: function(number) {
        return write("bigint:" + number.toString());
      },
      _process: function() {
        return write("process");
      },
      _timer: function() {
        return write("timer");
      },
      _pipe: function() {
        return write("pipe");
      },
      _tcp: function() {
        return write("tcp");
      },
      _udp: function() {
        return write("udp");
      },
      _tty: function() {
        return write("tty");
      },
      _statwatcher: function() {
        return write("statwatcher");
      },
      _securecontext: function() {
        return write("securecontext");
      },
      _connection: function() {
        return write("connection");
      },
      _zlib: function() {
        return write("zlib");
      },
      _context: function() {
        return write("context");
      },
      _nodescript: function() {
        return write("nodescript");
      },
      _httpparser: function() {
        return write("httpparser");
      },
      _dataview: function() {
        return write("dataview");
      },
      _signal: function() {
        return write("signal");
      },
      _fsevent: function() {
        return write("fsevent");
      },
      _tlswrap: function() {
        return write("tlswrap");
      }
    };
  }
  function PassThrough() {
    return {
      buf: "",
      write: function(b) {
        this.buf += b;
      },
      end: function(b) {
        this.buf += b;
      },
      read: function() {
        return this.buf;
      }
    };
  }
});

// node_modules/moment/moment.js
var require_moment = __commonJS((exports, module) => {
  //! moment.js
  //! version : 2.31.0
  //! authors : Tim Wood, Iskren Chernev, Moment.js contributors
  //! license : MIT
  //! momentjs.com
  (function(global2, factory) {
    typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define(factory) : global2.moment = factory();
  })(exports, function() {
    var hookCallback;
    function hooks() {
      return hookCallback.apply(null, arguments);
    }
    function setHookCallback(callback) {
      hookCallback = callback;
    }
    function isArray(input) {
      return input instanceof Array || Object.prototype.toString.call(input) === "[object Array]";
    }
    function isObject(input) {
      return input != null && Object.prototype.toString.call(input) === "[object Object]";
    }
    function hasOwnProp(a, b) {
      return Object.prototype.hasOwnProperty.call(a, b);
    }
    function isObjectEmpty(obj) {
      if (Object.getOwnPropertyNames) {
        return Object.getOwnPropertyNames(obj).length === 0;
      } else {
        var k;
        for (k in obj) {
          if (hasOwnProp(obj, k)) {
            return false;
          }
        }
        return true;
      }
    }
    function isUndefined(input) {
      return input === undefined;
    }
    function isNumber(input) {
      return typeof input === "number" || Object.prototype.toString.call(input) === "[object Number]";
    }
    function isDate(input) {
      return input instanceof Date || Object.prototype.toString.call(input) === "[object Date]";
    }
    function map(arr, fn) {
      var res = [], i, arrLen = arr.length;
      for (i = 0;i < arrLen; ++i) {
        res.push(fn(arr[i], i));
      }
      return res;
    }
    function extend(a, b) {
      for (var i in b) {
        if (hasOwnProp(b, i)) {
          a[i] = b[i];
        }
      }
      if (hasOwnProp(b, "toString")) {
        a.toString = b.toString;
      }
      if (hasOwnProp(b, "valueOf")) {
        a.valueOf = b.valueOf;
      }
      return a;
    }
    function createUTC(input, format2, locale2, strict) {
      return createLocalOrUTC(input, format2, locale2, strict, true).utc();
    }
    function defaultParsingFlags() {
      return {
        empty: false,
        unusedTokens: [],
        unusedInput: [],
        overflow: -2,
        charsLeftOver: 0,
        nullInput: false,
        invalidEra: null,
        invalidMonth: null,
        invalidOffset: null,
        invalidFormat: false,
        userInvalidated: false,
        iso: false,
        parsedDateParts: [],
        era: null,
        meridiem: null,
        rfc2822: false,
        weekdayMismatch: false
      };
    }
    function getParsingFlags(m) {
      if (m._pf == null) {
        m._pf = defaultParsingFlags();
      }
      return m._pf;
    }
    var some;
    if (Array.prototype.some) {
      some = Array.prototype.some;
    } else {
      some = function(fun) {
        var t = Object(this), len = t.length >>> 0, i;
        for (i = 0;i < len; i++) {
          if (i in t && fun.call(this, t[i], i, t)) {
            return true;
          }
        }
        return false;
      };
    }
    function isValid$2(m) {
      var flags = null, parsedParts = false, isNowValid = m._d && !isNaN(m._d.getTime());
      if (isNowValid) {
        flags = getParsingFlags(m);
        parsedParts = some.call(flags.parsedDateParts, function(i) {
          return i != null;
        });
        isNowValid = flags.overflow < 0 && !flags.empty && !flags.invalidEra && !flags.invalidMonth && !flags.invalidOffset && !flags.invalidWeekday && !flags.weekdayMismatch && !flags.nullInput && !flags.invalidFormat && !flags.userInvalidated && (!flags.meridiem || flags.meridiem && parsedParts);
        if (m._strict) {
          isNowValid = isNowValid && flags.charsLeftOver === 0 && flags.unusedTokens.length === 0 && flags.bigHour === undefined;
        }
      }
      if (Object.isFrozen == null || !Object.isFrozen(m)) {
        m._isValid = isNowValid;
      } else {
        return isNowValid;
      }
      return m._isValid;
    }
    function createInvalid$1(flags) {
      var m = createUTC(NaN);
      if (flags != null) {
        extend(getParsingFlags(m), flags);
      } else {
        getParsingFlags(m).userInvalidated = true;
      }
      return m;
    }
    var momentProperties = hooks.momentProperties = [], updateInProgress = false;
    function copyConfig(to2, from2) {
      var i, prop, val, momentPropertiesLen = momentProperties.length;
      if (!isUndefined(from2._isAMomentObject)) {
        to2._isAMomentObject = from2._isAMomentObject;
      }
      if (!isUndefined(from2._i)) {
        to2._i = from2._i;
      }
      if (!isUndefined(from2._f)) {
        to2._f = from2._f;
      }
      if (!isUndefined(from2._l)) {
        to2._l = from2._l;
      }
      if (!isUndefined(from2._strict)) {
        to2._strict = from2._strict;
      }
      if (!isUndefined(from2._tzm)) {
        to2._tzm = from2._tzm;
      }
      if (!isUndefined(from2._isUTC)) {
        to2._isUTC = from2._isUTC;
      }
      if (!isUndefined(from2._offset)) {
        to2._offset = from2._offset;
      }
      if (!isUndefined(from2._pf)) {
        to2._pf = getParsingFlags(from2);
      }
      if (!isUndefined(from2._locale)) {
        to2._locale = from2._locale;
      }
      if (momentPropertiesLen > 0) {
        for (i = 0;i < momentPropertiesLen; i++) {
          prop = momentProperties[i];
          val = from2[prop];
          if (!isUndefined(val)) {
            to2[prop] = val;
          }
        }
      }
      return to2;
    }
    function Moment(config) {
      copyConfig(this, config);
      this._d = new Date(config._d != null ? config._d.getTime() : NaN);
      if (!this.isValid()) {
        this._d = new Date(NaN);
      }
      if (updateInProgress === false) {
        updateInProgress = true;
        hooks.updateOffset(this);
        updateInProgress = false;
      }
    }
    function isMoment(obj) {
      return obj instanceof Moment || obj != null && obj._isAMomentObject != null;
    }
    function warn(msg) {
      if (hooks.suppressDeprecationWarnings === false && typeof console !== "undefined" && console.warn) {
        console.warn("Deprecation warning: " + msg);
      }
    }
    function deprecate(msg, fn) {
      var firstTime = true;
      return extend(function() {
        if (hooks.deprecationHandler != null) {
          hooks.deprecationHandler(null, msg);
        }
        if (firstTime) {
          var args = [], arg, i, key, argLen = arguments.length;
          for (i = 0;i < argLen; i++) {
            arg = "";
            if (typeof arguments[i] === "object") {
              arg += `
[` + i + "] ";
              for (key in arguments[0]) {
                if (hasOwnProp(arguments[0], key)) {
                  arg += key + ": " + arguments[0][key] + ", ";
                }
              }
              arg = arg.slice(0, -2);
            } else {
              arg = arguments[i];
            }
            args.push(arg);
          }
          warn(msg + `
Arguments: ` + Array.prototype.slice.call(args).join("") + `
` + new Error().stack);
          firstTime = false;
        }
        return fn.apply(this, arguments);
      }, fn);
    }
    var deprecations = {};
    function deprecateSimple(name, msg) {
      if (hooks.deprecationHandler != null) {
        hooks.deprecationHandler(name, msg);
      }
      if (!deprecations[name]) {
        warn(msg + `
` + new Error().stack);
        deprecations[name] = true;
      }
    }
    hooks.suppressDeprecationWarnings = false;
    hooks.deprecationHandler = null;
    function isFunction(input) {
      return typeof Function !== "undefined" && input instanceof Function || Object.prototype.toString.call(input) === "[object Function]";
    }
    var aliases = {
      D: "date",
      dates: "date",
      date: "date",
      d: "day",
      days: "day",
      day: "day",
      e: "weekday",
      weekdays: "weekday",
      weekday: "weekday",
      E: "isoWeekday",
      isoweekdays: "isoWeekday",
      isoweekday: "isoWeekday",
      DDD: "dayOfYear",
      dayofyears: "dayOfYear",
      dayofyear: "dayOfYear",
      h: "hour",
      hours: "hour",
      hour: "hour",
      ms: "millisecond",
      milliseconds: "millisecond",
      millisecond: "millisecond",
      m: "minute",
      minutes: "minute",
      minute: "minute",
      M: "month",
      months: "month",
      month: "month",
      Q: "quarter",
      quarters: "quarter",
      quarter: "quarter",
      s: "second",
      seconds: "second",
      second: "second",
      gg: "weekYear",
      weekyears: "weekYear",
      weekyear: "weekYear",
      GG: "isoWeekYear",
      isoweekyears: "isoWeekYear",
      isoweekyear: "isoWeekYear",
      w: "week",
      weeks: "week",
      week: "week",
      W: "isoWeek",
      isoweeks: "isoWeek",
      isoweek: "isoWeek",
      y: "year",
      years: "year",
      year: "year"
    };
    function normalizeUnits(units) {
      return typeof units === "string" ? aliases[units] || aliases[units.toLowerCase()] : undefined;
    }
    function normalizeObjectUnits(inputObject) {
      var normalizedInput = {}, normalizedProp, prop;
      for (prop in inputObject) {
        if (hasOwnProp(inputObject, prop)) {
          normalizedProp = normalizeUnits(prop);
          if (normalizedProp) {
            normalizedInput[normalizedProp] = inputObject[prop];
          }
        }
      }
      return normalizedInput;
    }
    var priorities = {
      date: 9,
      day: 11,
      weekday: 11,
      isoWeekday: 11,
      dayOfYear: 4,
      hour: 13,
      millisecond: 16,
      minute: 14,
      month: 8,
      quarter: 7,
      second: 15,
      weekYear: 1,
      isoWeekYear: 1,
      week: 5,
      isoWeek: 5,
      year: 1
    };
    function getPrioritizedUnits(unitsObj) {
      var units = [], u;
      for (u in unitsObj) {
        if (hasOwnProp(unitsObj, u)) {
          units.push({ unit: u, priority: priorities[u] });
        }
      }
      units.sort(function(a, b) {
        return a.priority - b.priority;
      });
      return units;
    }
    function zeroFill(number, targetLength, forceSign) {
      var absNumber = "" + Math.abs(number), zerosToFill = targetLength - absNumber.length, sign2 = number >= 0;
      return (sign2 ? forceSign ? "+" : "" : "-") + Math.pow(10, Math.max(0, zerosToFill)).toString().substr(1) + absNumber;
    }
    var formattingTokens = /(\[[^\[]*\])|(\\e)|(\\)?(eHHmm|[Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g, localFormattingTokens = /(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g, formatFunctions = {}, formatTokenFunctions = {};
    function addFormatToken(token2, padded, ordinal2, callback) {
      var func = callback;
      if (typeof callback === "string") {
        func = function() {
          return this[callback]();
        };
      }
      if (token2) {
        formatTokenFunctions[token2] = func;
      }
      if (padded) {
        formatTokenFunctions[padded[0]] = function() {
          return zeroFill(func.apply(this, arguments), padded[1], padded[2]);
        };
      }
      if (ordinal2) {
        formatTokenFunctions[ordinal2] = function() {
          return this.localeData().ordinal(func.apply(this, arguments), token2);
        };
      }
    }
    function removeFormattingTokens(input) {
      if (input.match(/\[[\s\S]/)) {
        return input.replace(/^\[|\]$/g, "");
      }
      return input.replace(/\\/g, "");
    }
    function makeFormatFunction(format2) {
      var array = format2.match(formattingTokens), i, length;
      for (i = 0, length = array.length;i < length; i++) {
        if (formatTokenFunctions[array[i]]) {
          array[i] = formatTokenFunctions[array[i]];
        } else {
          array[i] = removeFormattingTokens(array[i]);
        }
      }
      return function(mom) {
        var output = "", i2;
        for (i2 = 0;i2 < length; i2++) {
          output += isFunction(array[i2]) ? array[i2].call(mom, format2) : array[i2];
        }
        return output;
      };
    }
    function formatMoment(m, format2) {
      if (!m.isValid()) {
        return m.localeData().invalidDate();
      }
      format2 = expandFormat(format2, m.localeData());
      var cacheKey = "$" + format2;
      if (!hasOwnProp(formatFunctions, cacheKey)) {
        formatFunctions[cacheKey] = makeFormatFunction(format2);
      }
      return formatFunctions[cacheKey](m);
    }
    function expandFormat(format2, locale2) {
      var i = 5;
      function replaceLongDateFormatTokens(input) {
        return locale2.longDateFormat(input) || input;
      }
      localFormattingTokens.lastIndex = 0;
      while (i >= 0 && localFormattingTokens.test(format2)) {
        format2 = format2.replace(localFormattingTokens, replaceLongDateFormatTokens);
        localFormattingTokens.lastIndex = 0;
        i -= 1;
      }
      return format2;
    }
    var match1 = /\d/, match2 = /\d\d/, match3 = /\d{3}/, match4 = /\d{4}/, match6 = /[+-]?\d{6}/, match1to2 = /\d\d?/, match3to4 = /\d\d\d\d?/, match5to6 = /\d\d\d\d\d\d?/, match1to3 = /\d{1,3}/, match1to4 = /\d{1,4}/, match1to6 = /[+-]?\d{1,6}/, matchUnsigned = /\d+/, matchSigned = /[+-]?\d+/, matchOffset = /Z|[+-]\d\d:?\d\d/gi, matchShortOffset = /Z|[+-]\d\d(?::?\d\d)?/gi, matchTimestamp = /[+-]?\d+(\.\d{1,3})?/, matchWord = /[0-9]{0,256}['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFF07\uFF10-\uFFEF]{1,256}|[\u0600-\u06FF\/]{1,256}(\s*?[\u0600-\u06FF]{1,256}){1,2}/i, match1to2NoLeadingZero = /^[1-9]\d?/, match1to2HasZero = /^([1-9]\d|\d)/, regexes;
    regexes = {};
    function addRegexToken(token2, regex, strictRegex) {
      regexes[token2] = isFunction(regex) ? regex : function(isStrict, localeData2) {
        return isStrict && strictRegex ? strictRegex : regex;
      };
    }
    function getParseRegexForToken(token2, config) {
      if (!hasOwnProp(regexes, token2)) {
        return new RegExp(unescapeFormat(token2));
      }
      return regexes[token2](config._strict, config._locale);
    }
    function unescapeFormat(s) {
      return regexEscape(s.replace("\\", "").replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g, function(matched, p1, p2, p3, p4) {
        return p1 || p2 || p3 || p4;
      }));
    }
    function regexEscape(s) {
      return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    }
    function absFloor(number) {
      if (number < 0) {
        return Math.ceil(number) || 0;
      } else {
        return Math.floor(number);
      }
    }
    function toInt(argumentForCoercion) {
      var coercedNumber = +argumentForCoercion, value = 0;
      if (coercedNumber !== 0 && isFinite(coercedNumber)) {
        value = absFloor(coercedNumber);
      }
      return value;
    }
    var tokens = {};
    function addParseToken(token2, callback) {
      var i, func = callback, tokenLen;
      if (typeof token2 === "string") {
        token2 = [token2];
      }
      if (isNumber(callback)) {
        func = function(input, array) {
          array[callback] = toInt(input);
        };
      }
      tokenLen = token2.length;
      for (i = 0;i < tokenLen; i++) {
        tokens[token2[i]] = func;
      }
    }
    function addWeekParseToken(token2, callback) {
      addParseToken(token2, function(input, array, config, token3) {
        config._w = config._w || {};
        callback(input, config._w, config, token3);
      });
    }
    function addTimeToArrayFromToken(token2, input, config) {
      if (input != null && hasOwnProp(tokens, token2)) {
        tokens[token2](input, config._a, config, token2);
      }
    }
    function isLeapYear(year) {
      return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
    }
    var YEAR = 0, MONTH = 1, DATE = 2, HOUR2 = 3, MINUTE = 4, SECOND = 5, MILLISECOND = 6, WEEK = 7, WEEKDAY = 8;
    addFormatToken("Y", 0, 0, function() {
      var y = this.year();
      return y <= 9999 ? zeroFill(y, 4) : "+" + y;
    });
    addFormatToken(0, ["YY", 2], 0, function() {
      return this.year() % 100;
    });
    addFormatToken(0, ["YYYY", 4], 0, "year");
    addFormatToken(0, ["YYYYY", 5], 0, "year");
    addFormatToken(0, ["YYYYYY", 6, true], 0, "year");
    addRegexToken("Y", matchSigned);
    addRegexToken("YY", match1to2, match2);
    addRegexToken("YYYY", match1to4, match4);
    addRegexToken("YYYYY", match1to6, match6);
    addRegexToken("YYYYYY", match1to6, match6);
    addParseToken(["YYYYY", "YYYYYY"], YEAR);
    addParseToken("YYYY", function(input, array) {
      array[YEAR] = input.length === 2 ? hooks.parseTwoDigitYear(input) : toInt(input);
    });
    addParseToken("YY", function(input, array) {
      array[YEAR] = hooks.parseTwoDigitYear(input);
    });
    addParseToken("Y", function(input, array) {
      array[YEAR] = parseInt(input, 10);
    });
    function daysInYear(year) {
      return isLeapYear(year) ? 366 : 365;
    }
    hooks.parseTwoDigitYear = function(input) {
      return toInt(input) + (toInt(input) > 68 ? 1900 : 2000);
    };
    var getSetYear = makeGetSet("FullYear", true);
    function getIsLeapYear() {
      return isLeapYear(this.year());
    }
    function makeGetSet(unit, keepTime) {
      return function(value) {
        if (value != null) {
          set$1(this, unit, value);
          hooks.updateOffset(this, keepTime);
          return this;
        } else {
          return get$2(this, unit);
        }
      };
    }
    function get$2(mom, unit) {
      if (!mom.isValid()) {
        return NaN;
      }
      var { _d: d, _isUTC: isUTC } = mom;
      switch (unit) {
        case "Milliseconds":
          return isUTC ? d.getUTCMilliseconds() : d.getMilliseconds();
        case "Seconds":
          return isUTC ? d.getUTCSeconds() : d.getSeconds();
        case "Minutes":
          return isUTC ? d.getUTCMinutes() : d.getMinutes();
        case "Hours":
          return isUTC ? d.getUTCHours() : d.getHours();
        case "Date":
          return isUTC ? d.getUTCDate() : d.getDate();
        case "Day":
          return isUTC ? d.getUTCDay() : d.getDay();
        case "Month":
          return isUTC ? d.getUTCMonth() : d.getMonth();
        case "FullYear":
          return isUTC ? d.getUTCFullYear() : d.getFullYear();
        default:
          return NaN;
      }
    }
    function set$1(mom, unit, value) {
      var d, isUTC, year, month, date;
      if (!mom.isValid() || isNaN(value)) {
        return;
      }
      d = mom._d;
      isUTC = mom._isUTC;
      switch (unit) {
        case "Milliseconds":
          return void (isUTC ? d.setUTCMilliseconds(value) : d.setMilliseconds(value));
        case "Seconds":
          return void (isUTC ? d.setUTCSeconds(value) : d.setSeconds(value));
        case "Minutes":
          return void (isUTC ? d.setUTCMinutes(value) : d.setMinutes(value));
        case "Hours":
          return void (isUTC ? d.setUTCHours(value) : d.setHours(value));
        case "Date":
          return void (isUTC ? d.setUTCDate(value) : d.setDate(value));
        case "FullYear":
          break;
        default:
          return;
      }
      year = value;
      month = mom.month();
      date = mom.date();
      date = date === 29 && month === 1 && !isLeapYear(year) ? 28 : date;
      isUTC ? d.setUTCFullYear(year, month, date) : d.setFullYear(year, month, date);
    }
    function stringGet(units) {
      units = normalizeUnits(units);
      if (isFunction(this[units])) {
        return this[units]();
      }
      return this;
    }
    function stringSet(units, value) {
      if (typeof units === "object") {
        units = normalizeObjectUnits(units);
        var prioritized = getPrioritizedUnits(units), i, prioritizedLen = prioritized.length;
        for (i = 0;i < prioritizedLen; i++) {
          this[prioritized[i].unit](units[prioritized[i].unit]);
        }
      } else {
        units = normalizeUnits(units);
        if (isFunction(this[units])) {
          return this[units](value);
        }
      }
      return this;
    }
    function mod$1(n, x) {
      return (n % x + x) % x;
    }
    var indexOf;
    if (Array.prototype.indexOf) {
      indexOf = Array.prototype.indexOf;
    } else {
      indexOf = function(o) {
        var i;
        for (i = 0;i < this.length; ++i) {
          if (this[i] === o) {
            return i;
          }
        }
        return -1;
      };
    }
    function daysInMonth(year, month) {
      if (isNaN(year) || isNaN(month)) {
        return NaN;
      }
      var modMonth = mod$1(month, 12);
      year += (month - modMonth) / 12;
      return modMonth === 1 ? isLeapYear(year) ? 29 : 28 : 31 - modMonth % 7 % 2;
    }
    addFormatToken("M", ["MM", 2], "Mo", function() {
      return this.month() + 1;
    });
    addFormatToken("MMM", 0, 0, function(format2) {
      return this.localeData().monthsShort(this, format2);
    });
    addFormatToken("MMMM", 0, 0, function(format2) {
      return this.localeData().months(this, format2);
    });
    addRegexToken("M", match1to2, match1to2NoLeadingZero);
    addRegexToken("MM", match1to2, match2);
    addRegexToken("MMM", function(isStrict, locale2) {
      return locale2.monthsShortRegex(isStrict);
    });
    addRegexToken("MMMM", function(isStrict, locale2) {
      return locale2.monthsRegex(isStrict);
    });
    addParseToken(["M", "MM"], function(input, array) {
      array[MONTH] = toInt(input) - 1;
    });
    addParseToken(["MMM", "MMMM"], function(input, array, config, token2) {
      var month = config._locale.monthsParse(input, token2, config._strict);
      if (month != null) {
        array[MONTH] = month;
      } else {
        getParsingFlags(config).invalidMonth = input;
      }
    });
    var defaultLocaleMonths = "January_February_March_April_May_June_July_August_September_October_November_December".split("_"), defaultLocaleMonthsShort = "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"), MONTHS_IN_FORMAT = /D[oD]?(\[[^\[\]]*\]|\s)+MMMM?/, defaultMonthsShortRegex = matchWord, defaultMonthsRegex = matchWord, monthsParseProperties = [
      "monthsParse",
      "longMonthsParse",
      "shortMonthsParse",
      "monthsRegex",
      "monthsShortRegex",
      "monthsStrictRegex",
      "monthsShortStrictRegex"
    ];
    function clearMonthsParseCache(locale2, config) {
      var i, prop;
      for (i = 0;i < monthsParseProperties.length; i++) {
        prop = monthsParseProperties[i];
        if (!hasOwnProp(config, prop)) {
          delete locale2["_" + prop];
        }
      }
    }
    function localeMonths(m, format2) {
      if (!m) {
        return isArray(this._months) ? this._months : this._months["standalone"];
      }
      return isArray(this._months) ? this._months[m.month()] : this._months[(this._months.isFormat || MONTHS_IN_FORMAT).test(format2) ? "format" : "standalone"][m.month()];
    }
    function localeMonthsShort(m, format2) {
      if (!m) {
        return isArray(this._monthsShort) ? this._monthsShort : this._monthsShort["standalone"];
      }
      return isArray(this._monthsShort) ? this._monthsShort[m.month()] : this._monthsShort[MONTHS_IN_FORMAT.test(format2) ? "format" : "standalone"][m.month()];
    }
    function handleStrictParse$1(monthName, format2, strict) {
      var i, ii, mom, llc = monthName.toLocaleLowerCase();
      if (!this._monthsParse) {
        this._monthsParse = [];
        this._longMonthsParse = [];
        this._shortMonthsParse = [];
        for (i = 0;i < 12; ++i) {
          mom = createUTC([2000, i]);
          this._shortMonthsParse[i] = this.monthsShort(mom, "").toLocaleLowerCase();
          this._longMonthsParse[i] = this.months(mom, "").toLocaleLowerCase();
        }
      }
      if (strict) {
        if (format2 === "MMM") {
          ii = indexOf.call(this._shortMonthsParse, llc);
          return ii !== -1 ? ii : null;
        } else {
          ii = indexOf.call(this._longMonthsParse, llc);
          return ii !== -1 ? ii : null;
        }
      } else {
        if (format2 === "MMM") {
          ii = indexOf.call(this._shortMonthsParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._longMonthsParse, llc);
          return ii !== -1 ? ii : null;
        } else {
          ii = indexOf.call(this._longMonthsParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._shortMonthsParse, llc);
          return ii !== -1 ? ii : null;
        }
      }
    }
    function localeMonthsParse(monthName, format2, strict) {
      var i, mom, regex;
      if (this._monthsParseExact) {
        return handleStrictParse$1.call(this, monthName, format2, strict);
      }
      if (!this._monthsParse) {
        this._monthsParse = [];
        this._longMonthsParse = [];
        this._shortMonthsParse = [];
      }
      for (i = 0;i < 12; i++) {
        mom = createUTC([2000, i]);
        if (strict && !this._longMonthsParse[i]) {
          this._longMonthsParse[i] = new RegExp("^" + this.months(mom, "").replace(".", "") + "$", "i");
          this._shortMonthsParse[i] = new RegExp("^" + this.monthsShort(mom, "").replace(".", "") + "$", "i");
        }
        if (!strict && !this._monthsParse[i]) {
          regex = "^" + this.months(mom, "") + "|^" + this.monthsShort(mom, "");
          this._monthsParse[i] = new RegExp(regex.replace(".", ""), "i");
        }
        if (strict && format2 === "MMMM" && this._longMonthsParse[i].test(monthName)) {
          return i;
        } else if (strict && format2 === "MMM" && this._shortMonthsParse[i].test(monthName)) {
          return i;
        } else if (!strict && this._monthsParse[i].test(monthName)) {
          return i;
        }
      }
    }
    function setMonth(mom, value) {
      if (!mom.isValid()) {
        return mom;
      }
      if (typeof value === "string") {
        if (/^\d+$/.test(value)) {
          value = toInt(value);
        } else {
          value = mom.localeData().monthsParse(value);
          if (!isNumber(value)) {
            return mom;
          }
        }
      }
      var month = value, date = mom.date();
      date = date < 29 ? date : Math.min(date, daysInMonth(mom.year(), month));
      mom._isUTC ? mom._d.setUTCMonth(month, date) : mom._d.setMonth(month, date);
      return mom;
    }
    function getSetMonth(value) {
      if (value != null) {
        setMonth(this, value);
        hooks.updateOffset(this, true);
        return this;
      } else {
        return get$2(this, "Month");
      }
    }
    function getDaysInMonth() {
      return daysInMonth(this.year(), this.month());
    }
    function monthsShortRegex(isStrict) {
      if (this._monthsParseExact) {
        if (!hasOwnProp(this, "_monthsRegex")) {
          computeMonthsParse.call(this);
        }
        if (isStrict) {
          return this._monthsShortStrictRegex;
        } else {
          return this._monthsShortRegex;
        }
      } else {
        if (!hasOwnProp(this, "_monthsShortRegex")) {
          this._monthsShortRegex = defaultMonthsShortRegex;
        }
        return this._monthsShortStrictRegex && isStrict ? this._monthsShortStrictRegex : this._monthsShortRegex;
      }
    }
    function monthsRegex(isStrict) {
      if (this._monthsParseExact) {
        if (!hasOwnProp(this, "_monthsRegex")) {
          computeMonthsParse.call(this);
        }
        if (isStrict) {
          return this._monthsStrictRegex;
        } else {
          return this._monthsRegex;
        }
      } else {
        if (!hasOwnProp(this, "_monthsRegex")) {
          this._monthsRegex = defaultMonthsRegex;
        }
        return this._monthsStrictRegex && isStrict ? this._monthsStrictRegex : this._monthsRegex;
      }
    }
    function computeMonthsParse() {
      function cmpLenRev(a, b) {
        return b.length - a.length;
      }
      var shortPieces = [], longPieces = [], mixedPieces = [], i, mom, shortP, longP;
      for (i = 0;i < 12; i++) {
        mom = createUTC([2000, i]);
        shortP = regexEscape(this.monthsShort(mom, ""));
        longP = regexEscape(this.months(mom, ""));
        shortPieces.push(shortP);
        longPieces.push(longP);
        mixedPieces.push(longP);
        mixedPieces.push(shortP);
      }
      shortPieces.sort(cmpLenRev);
      longPieces.sort(cmpLenRev);
      mixedPieces.sort(cmpLenRev);
      this._monthsRegex = new RegExp("^(" + mixedPieces.join("|") + ")", "i");
      this._monthsShortRegex = this._monthsRegex;
      this._monthsStrictRegex = new RegExp("^(" + longPieces.join("|") + ")", "i");
      this._monthsShortStrictRegex = new RegExp("^(" + shortPieces.join("|") + ")", "i");
    }
    addFormatToken("d", 0, "do", "day");
    addFormatToken("dd", 0, 0, function(format2) {
      return this.localeData().weekdaysMin(this, format2);
    });
    addFormatToken("ddd", 0, 0, function(format2) {
      return this.localeData().weekdaysShort(this, format2);
    });
    addFormatToken("dddd", 0, 0, function(format2) {
      return this.localeData().weekdays(this, format2);
    });
    addFormatToken("e", 0, 0, "weekday");
    addFormatToken("E", 0, 0, "isoWeekday");
    addFormatToken("eHHmm", 0, 0, function() {
      return "" + this.weekday() + zeroFill(this.hours(), 2) + zeroFill(this.minutes(), 2);
    });
    addRegexToken("d", match1to2);
    addRegexToken("e", match1to2);
    addRegexToken("E", match1to2);
    addRegexToken("eHHmm", match5to6);
    addRegexToken("dd", function(isStrict, locale2) {
      return locale2.weekdaysMinRegex(isStrict);
    });
    addRegexToken("ddd", function(isStrict, locale2) {
      return locale2.weekdaysShortRegex(isStrict);
    });
    addRegexToken("dddd", function(isStrict, locale2) {
      return locale2.weekdaysRegex(isStrict);
    });
    addWeekParseToken(["dd", "ddd", "dddd"], function(input, week, config, token2) {
      var weekday = config._locale.weekdaysParse(input, token2, config._strict);
      if (weekday != null) {
        week.d = weekday;
      } else {
        getParsingFlags(config).invalidWeekday = input;
      }
    });
    addWeekParseToken(["d", "e", "E"], function(input, week, config, token2) {
      week[token2] = toInt(input);
    });
    addWeekParseToken("eHHmm", function(input, week, config) {
      var weekdayEnd = input.length - 4;
      week.e = toInt(input.substr(0, weekdayEnd));
      config._a[HOUR2] = toInt(input.substr(weekdayEnd, 2));
      config._a[MINUTE] = toInt(input.substr(weekdayEnd + 2));
    });
    function parseWeekday(input, locale2) {
      if (typeof input !== "string") {
        return input;
      }
      if (!isNaN(input)) {
        return parseInt(input, 10);
      }
      input = locale2.weekdaysParse(input);
      if (typeof input === "number") {
        return input;
      }
      return null;
    }
    function parseIsoWeekday(input, locale2) {
      if (typeof input === "string") {
        return locale2.weekdaysParse(input) % 7 || 7;
      }
      return isNaN(input) ? null : input;
    }
    function shiftWeekdays(ws, n) {
      return ws.slice(n, 7).concat(ws.slice(0, n));
    }
    var defaultLocaleWeekdays = "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"), defaultLocaleWeekdaysShort = "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"), defaultLocaleWeekdaysMin = "Su_Mo_Tu_We_Th_Fr_Sa".split("_"), defaultWeekdaysRegex = matchWord, defaultWeekdaysShortRegex = matchWord, defaultWeekdaysMinRegex = matchWord, weekdaysParseProperties = [
      "weekdaysParse",
      "fullWeekdaysParse",
      "shortWeekdaysParse",
      "minWeekdaysParse",
      "weekdaysRegex",
      "weekdaysShortRegex",
      "weekdaysMinRegex",
      "weekdaysStrictRegex",
      "weekdaysShortStrictRegex",
      "weekdaysMinStrictRegex"
    ];
    function clearWeekdaysParseCache(locale2, config) {
      var i, prop;
      for (i = 0;i < weekdaysParseProperties.length; i++) {
        prop = weekdaysParseProperties[i];
        if (!hasOwnProp(config, prop)) {
          delete locale2["_" + prop];
        }
      }
    }
    function localeWeekdays(m, format2) {
      var weekdays = isArray(this._weekdays) ? this._weekdays : this._weekdays[m && m !== true && this._weekdays.isFormat.test(format2) ? "format" : "standalone"];
      return m === true ? shiftWeekdays(weekdays, this._week.dow) : m ? weekdays[m.day()] : weekdays;
    }
    function localeWeekdaysShort(m) {
      return m === true ? shiftWeekdays(this._weekdaysShort, this._week.dow) : m ? this._weekdaysShort[m.day()] : this._weekdaysShort;
    }
    function localeWeekdaysMin(m) {
      return m === true ? shiftWeekdays(this._weekdaysMin, this._week.dow) : m ? this._weekdaysMin[m.day()] : this._weekdaysMin;
    }
    function handleStrictParse(weekdayName, format2, strict) {
      var i, ii, mom, llc = weekdayName.toLocaleLowerCase();
      if (!this._weekdaysParse) {
        this._weekdaysParse = [];
        this._shortWeekdaysParse = [];
        this._minWeekdaysParse = [];
        for (i = 0;i < 7; ++i) {
          mom = createUTC([2000, 1]).day(i);
          this._minWeekdaysParse[i] = this.weekdaysMin(mom, "").toLocaleLowerCase();
          this._shortWeekdaysParse[i] = this.weekdaysShort(mom, "").toLocaleLowerCase();
          this._weekdaysParse[i] = this.weekdays(mom, "").toLocaleLowerCase();
        }
      }
      if (strict) {
        if (format2 === "dddd") {
          ii = indexOf.call(this._weekdaysParse, llc);
          return ii !== -1 ? ii : null;
        } else if (format2 === "ddd") {
          ii = indexOf.call(this._shortWeekdaysParse, llc);
          return ii !== -1 ? ii : null;
        } else {
          ii = indexOf.call(this._minWeekdaysParse, llc);
          return ii !== -1 ? ii : null;
        }
      } else {
        if (format2 === "dddd") {
          ii = indexOf.call(this._weekdaysParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._shortWeekdaysParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._minWeekdaysParse, llc);
          return ii !== -1 ? ii : null;
        } else if (format2 === "ddd") {
          ii = indexOf.call(this._shortWeekdaysParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._weekdaysParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._minWeekdaysParse, llc);
          return ii !== -1 ? ii : null;
        } else {
          ii = indexOf.call(this._minWeekdaysParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._weekdaysParse, llc);
          if (ii !== -1) {
            return ii;
          }
          ii = indexOf.call(this._shortWeekdaysParse, llc);
          return ii !== -1 ? ii : null;
        }
      }
    }
    function localeWeekdaysParse(weekdayName, format2, strict) {
      var i, mom, regex;
      if (this._weekdaysParseExact) {
        return handleStrictParse.call(this, weekdayName, format2, strict);
      }
      if (!this._weekdaysParse) {
        this._weekdaysParse = [];
        this._minWeekdaysParse = [];
        this._shortWeekdaysParse = [];
        this._fullWeekdaysParse = [];
      }
      for (i = 0;i < 7; i++) {
        mom = createUTC([2000, 1]).day(i);
        if (strict && !this._fullWeekdaysParse[i]) {
          this._fullWeekdaysParse[i] = new RegExp("^" + this.weekdays(mom, "").replace(".", "\\.?") + "$", "i");
          this._shortWeekdaysParse[i] = new RegExp("^" + this.weekdaysShort(mom, "").replace(".", "\\.?") + "$", "i");
          this._minWeekdaysParse[i] = new RegExp("^" + this.weekdaysMin(mom, "").replace(".", "\\.?") + "$", "i");
        }
        if (!this._weekdaysParse[i]) {
          regex = "^" + this.weekdays(mom, "") + "|^" + this.weekdaysShort(mom, "") + "|^" + this.weekdaysMin(mom, "");
          this._weekdaysParse[i] = new RegExp(regex.replace(".", ""), "i");
        }
        if (strict && format2 === "dddd" && this._fullWeekdaysParse[i].test(weekdayName)) {
          return i;
        } else if (strict && format2 === "ddd" && this._shortWeekdaysParse[i].test(weekdayName)) {
          return i;
        } else if (strict && format2 === "dd" && this._minWeekdaysParse[i].test(weekdayName)) {
          return i;
        } else if (!strict && this._weekdaysParse[i].test(weekdayName)) {
          return i;
        }
      }
    }
    function getSetDayOfWeek(input) {
      if (!this.isValid()) {
        return input != null ? this : NaN;
      }
      var day = get$2(this, "Day");
      if (input != null) {
        input = parseWeekday(input, this.localeData());
        return this.add(input - day, "d");
      } else {
        return day;
      }
    }
    function getSetLocaleDayOfWeek(input) {
      if (!this.isValid()) {
        return input != null ? this : NaN;
      }
      var weekday = (this.day() + 7 - this.localeData()._week.dow) % 7;
      return input == null ? weekday : this.add(input - weekday, "d");
    }
    function getSetISODayOfWeek(input) {
      if (!this.isValid()) {
        return input != null ? this : NaN;
      }
      if (input != null) {
        var weekday = parseIsoWeekday(input, this.localeData());
        return this.day(this.day() % 7 ? weekday : weekday - 7);
      } else {
        return this.day() || 7;
      }
    }
    function weekdaysRegex(isStrict) {
      if (this._weekdaysParseExact) {
        if (!hasOwnProp(this, "_weekdaysRegex")) {
          computeWeekdaysParse.call(this);
        }
        if (isStrict) {
          return this._weekdaysStrictRegex;
        } else {
          return this._weekdaysRegex;
        }
      } else {
        if (!hasOwnProp(this, "_weekdaysRegex")) {
          this._weekdaysRegex = defaultWeekdaysRegex;
        }
        return this._weekdaysStrictRegex && isStrict ? this._weekdaysStrictRegex : this._weekdaysRegex;
      }
    }
    function weekdaysShortRegex(isStrict) {
      if (this._weekdaysParseExact) {
        if (!hasOwnProp(this, "_weekdaysRegex")) {
          computeWeekdaysParse.call(this);
        }
        if (isStrict) {
          return this._weekdaysShortStrictRegex;
        } else {
          return this._weekdaysShortRegex;
        }
      } else {
        if (!hasOwnProp(this, "_weekdaysShortRegex")) {
          this._weekdaysShortRegex = defaultWeekdaysShortRegex;
        }
        return this._weekdaysShortStrictRegex && isStrict ? this._weekdaysShortStrictRegex : this._weekdaysShortRegex;
      }
    }
    function weekdaysMinRegex(isStrict) {
      if (this._weekdaysParseExact) {
        if (!hasOwnProp(this, "_weekdaysRegex")) {
          computeWeekdaysParse.call(this);
        }
        if (isStrict) {
          return this._weekdaysMinStrictRegex;
        } else {
          return this._weekdaysMinRegex;
        }
      } else {
        if (!hasOwnProp(this, "_weekdaysMinRegex")) {
          this._weekdaysMinRegex = defaultWeekdaysMinRegex;
        }
        return this._weekdaysMinStrictRegex && isStrict ? this._weekdaysMinStrictRegex : this._weekdaysMinRegex;
      }
    }
    function computeWeekdaysParse() {
      function cmpLenRev(a, b) {
        return b.length - a.length;
      }
      var minPieces = [], shortPieces = [], longPieces = [], mixedPieces = [], i, mom, minp, shortp, longp;
      for (i = 0;i < 7; i++) {
        mom = createUTC([2000, 1]).day(i);
        minp = regexEscape(this.weekdaysMin(mom, ""));
        shortp = regexEscape(this.weekdaysShort(mom, ""));
        longp = regexEscape(this.weekdays(mom, ""));
        minPieces.push(minp);
        shortPieces.push(shortp);
        longPieces.push(longp);
        mixedPieces.push(minp);
        mixedPieces.push(shortp);
        mixedPieces.push(longp);
      }
      minPieces.sort(cmpLenRev);
      shortPieces.sort(cmpLenRev);
      longPieces.sort(cmpLenRev);
      mixedPieces.sort(cmpLenRev);
      this._weekdaysRegex = new RegExp("^(" + mixedPieces.join("|") + ")", "i");
      this._weekdaysShortRegex = this._weekdaysRegex;
      this._weekdaysMinRegex = this._weekdaysRegex;
      this._weekdaysStrictRegex = new RegExp("^(" + longPieces.join("|") + ")", "i");
      this._weekdaysShortStrictRegex = new RegExp("^(" + shortPieces.join("|") + ")", "i");
      this._weekdaysMinStrictRegex = new RegExp("^(" + minPieces.join("|") + ")", "i");
    }
    function set(config) {
      var prop, i;
      clearMonthsParseCache(this, config);
      clearWeekdaysParseCache(this, config);
      for (i in config) {
        if (hasOwnProp(config, i)) {
          prop = config[i];
          if (isFunction(prop)) {
            this[i] = prop;
          } else {
            this["_" + i] = prop;
          }
        }
      }
      this._config = config;
      this._dayOfMonthOrdinalParseLenient = new RegExp((this._dayOfMonthOrdinalParse.source || this._ordinalParse.source) + "|" + /\d{1,2}/.source);
    }
    function mergeConfigs(parentConfig, childConfig) {
      var res = extend({}, parentConfig), prop;
      for (prop in childConfig) {
        if (hasOwnProp(childConfig, prop)) {
          if (isObject(parentConfig[prop]) && isObject(childConfig[prop])) {
            res[prop] = {};
            extend(res[prop], parentConfig[prop]);
            extend(res[prop], childConfig[prop]);
          } else if (childConfig[prop] != null) {
            res[prop] = childConfig[prop];
          } else {
            delete res[prop];
          }
        }
      }
      for (prop in parentConfig) {
        if (hasOwnProp(parentConfig, prop) && !hasOwnProp(childConfig, prop) && isObject(parentConfig[prop])) {
          res[prop] = extend({}, res[prop]);
        }
      }
      return res;
    }
    function Locale(config) {
      if (config != null) {
        this.set(config);
      }
    }
    var keys;
    if (Object.keys) {
      keys = Object.keys;
    } else {
      keys = function(obj) {
        var i, res = [];
        for (i in obj) {
          if (hasOwnProp(obj, i)) {
            res.push(i);
          }
        }
        return res;
      };
    }
    var defaultCalendar = {
      sameDay: "[Today at] LT",
      nextDay: "[Tomorrow at] LT",
      nextWeek: "dddd [at] LT",
      lastDay: "[Yesterday at] LT",
      lastWeek: "[Last] dddd [at] LT",
      sameElse: "L"
    };
    function calendar$1(key, mom, now2) {
      var output = this._calendar[key] || this._calendar["sameElse"];
      return isFunction(output) ? output.call(mom, now2) : output;
    }
    var defaultLongDateFormat = {
      LTS: "h:mm:ss A",
      LT: "h:mm A",
      L: "MM/DD/YYYY",
      LL: "MMMM D, YYYY",
      LLL: "MMMM D, YYYY h:mm A",
      LLLL: "dddd, MMMM D, YYYY h:mm A"
    };
    function longDateFormat(key) {
      var format2 = this._longDateFormat[key], formatUpper = this._longDateFormat[key.toUpperCase()], formatCache = this._longDateFormatCache;
      if (format2 || !formatUpper) {
        return format2;
      }
      if (formatCache && formatCache[key] && formatCache[key].formatUpper === formatUpper) {
        return formatCache[key].format;
      }
      format2 = formatUpper.match(formattingTokens).map(function(tok) {
        if (tok === "MMMM" || tok === "MM" || tok === "DD" || tok === "dddd") {
          return tok.slice(1);
        }
        return tok;
      }).join("");
      if (!formatCache) {
        formatCache = this._longDateFormatCache = {};
      }
      formatCache[key] = {
        formatUpper,
        format: format2
      };
      return format2;
    }
    var defaultInvalidDate = "Invalid date";
    function invalidDate() {
      return this._invalidDate;
    }
    var defaultOrdinal = "%d", defaultDayOfMonthOrdinalParse = /\d{1,2}/;
    function ordinal(number) {
      return this._ordinal.replace("%d", number);
    }
    var defaultRelativeTime = {
      future: "in %s",
      past: "%s ago",
      s: "a few seconds",
      ss: "%d seconds",
      m: "a minute",
      mm: "%d minutes",
      h: "an hour",
      hh: "%d hours",
      d: "a day",
      dd: "%d days",
      w: "a week",
      ww: "%d weeks",
      M: "a month",
      MM: "%d months",
      y: "a year",
      yy: "%d years"
    };
    function relativeTimeWithoutPostformat(number, withoutSuffix, string, isFuture) {
      var output = this._relativeTime[string];
      return isFunction(output) ? output(number, withoutSuffix, string, isFuture) : output.replace(/%d/i, number);
    }
    function relativeTime$1(number, withoutSuffix, string, isFuture) {
      return this.postformat(relativeTimeWithoutPostformat.call(this, number, withoutSuffix, string, isFuture));
    }
    function pastFutureWithoutPostformat(diff2, output) {
      var format2 = this._relativeTime[diff2 > 0 ? "future" : "past"];
      return isFunction(format2) ? format2(output) : format2.replace(/%s/i, output);
    }
    function pastFuture(diff2, output) {
      return this.postformat(pastFutureWithoutPostformat.call(this, diff2, output));
    }
    function createDate(y, m, d, h, M, s, ms) {
      var date;
      if (y < 100 && y >= 0) {
        date = new Date(y + 400, m, d, h, M, s, ms);
        if (isFinite(date.getFullYear())) {
          date.setFullYear(y);
        }
      } else {
        date = new Date(y, m, d, h, M, s, ms);
      }
      return date;
    }
    function createUTCDate(y) {
      var date, args;
      if (y < 100 && y >= 0) {
        args = Array.prototype.slice.call(arguments);
        args[0] = y + 400;
        date = new Date(Date.UTC.apply(null, args));
        if (isFinite(date.getUTCFullYear())) {
          date.setUTCFullYear(y);
        }
      } else {
        date = new Date(Date.UTC.apply(null, arguments));
      }
      return date;
    }
    function firstWeekOffset(year, dow, doy) {
      var fwd = 7 + dow - doy, fwdlw = (7 + createUTCDate(year, 0, fwd).getUTCDay() - dow) % 7;
      return -fwdlw + fwd - 1;
    }
    function dayOfYearFromWeeks(year, week, weekday, dow, doy) {
      var localWeekday = (7 + weekday - dow) % 7, weekOffset = firstWeekOffset(year, dow, doy), dayOfYear = 1 + 7 * (week - 1) + localWeekday + weekOffset, resYear, resDayOfYear;
      if (dayOfYear <= 0) {
        resYear = year - 1;
        resDayOfYear = daysInYear(resYear) + dayOfYear;
      } else if (dayOfYear > daysInYear(year)) {
        resYear = year + 1;
        resDayOfYear = dayOfYear - daysInYear(year);
      } else {
        resYear = year;
        resDayOfYear = dayOfYear;
      }
      return {
        year: resYear,
        dayOfYear: resDayOfYear
      };
    }
    function weekOfYearFromDayOfYear(year, dayOfYear, dow, doy) {
      var weekOffset = firstWeekOffset(year, dow, doy), week = Math.floor((dayOfYear - weekOffset - 1) / 7) + 1, resWeek, resYear;
      if (week < 1) {
        resYear = year - 1;
        resWeek = week + weeksInYear(resYear, dow, doy);
      } else if (week > weeksInYear(year, dow, doy)) {
        resWeek = week - weeksInYear(year, dow, doy);
        resYear = year + 1;
      } else {
        resYear = year;
        resWeek = week;
      }
      return {
        week: resWeek,
        year: resYear
      };
    }
    function weekOfYear(mom, dow, doy) {
      return weekOfYearFromDayOfYear(mom.year(), mom.dayOfYear(), dow, doy);
    }
    function weekOfYearFromDate(year, month, date, dow, doy) {
      var dayOfYear = Math.round((createUTCDate(year, month, date) - createUTCDate(year, 0, 1)) / 86400000) + 1;
      return weekOfYearFromDayOfYear(year, dayOfYear, dow, doy);
    }
    function weeksInYear(year, dow, doy) {
      var weekOffset = firstWeekOffset(year, dow, doy), weekOffsetNext = firstWeekOffset(year + 1, dow, doy);
      return (daysInYear(year) - weekOffset + weekOffsetNext) / 7;
    }
    addFormatToken("w", ["ww", 2], "wo", "week");
    addFormatToken("W", ["WW", 2], "Wo", "isoWeek");
    addRegexToken("w", match1to2, match1to2NoLeadingZero);
    addRegexToken("ww", match1to2, match2);
    addRegexToken("W", match1to2, match1to2NoLeadingZero);
    addRegexToken("WW", match1to2, match2);
    addWeekParseToken(["w", "ww", "W", "WW"], function(input, week, config, token2) {
      week[token2.substr(0, 1)] = toInt(input);
    });
    function localeWeek(mom) {
      return weekOfYear(mom, this._week.dow, this._week.doy).week;
    }
    var defaultLocaleWeek = {
      dow: 0,
      doy: 6
    };
    function localeFirstDayOfWeek() {
      return this._week.dow;
    }
    function localeFirstDayOfYear() {
      return this._week.doy;
    }
    function getSetWeek(input) {
      var week = this.localeData().week(this);
      return input == null ? week : this.add((input - week) * 7, "d");
    }
    function getSetISOWeek(input) {
      var week = weekOfYear(this, 1, 4).week;
      return input == null ? week : this.add((input - week) * 7, "d");
    }
    function hFormat() {
      return this.hours() % 12 || 12;
    }
    function kFormat() {
      return this.hours() || 24;
    }
    addFormatToken("H", ["HH", 2], 0, "hour");
    addFormatToken("h", ["hh", 2], 0, hFormat);
    addFormatToken("k", ["kk", 2], 0, kFormat);
    addFormatToken("hmm", 0, 0, function() {
      return "" + hFormat.apply(this) + zeroFill(this.minutes(), 2);
    });
    addFormatToken("hmmss", 0, 0, function() {
      return "" + hFormat.apply(this) + zeroFill(this.minutes(), 2) + zeroFill(this.seconds(), 2);
    });
    addFormatToken("Hmm", 0, 0, function() {
      return "" + this.hours() + zeroFill(this.minutes(), 2);
    });
    addFormatToken("Hmmss", 0, 0, function() {
      return "" + this.hours() + zeroFill(this.minutes(), 2) + zeroFill(this.seconds(), 2);
    });
    function meridiem(token2, lowercase) {
      addFormatToken(token2, 0, 0, function() {
        return this.localeData().meridiem(this.hours(), this.minutes(), lowercase);
      });
    }
    meridiem("a", true);
    meridiem("A", false);
    function matchMeridiem(isStrict, locale2) {
      return locale2._meridiemParse;
    }
    addRegexToken("a", matchMeridiem);
    addRegexToken("A", matchMeridiem);
    addRegexToken("H", match1to2, match1to2HasZero);
    addRegexToken("h", match1to2, match1to2NoLeadingZero);
    addRegexToken("k", match1to2, match1to2NoLeadingZero);
    addRegexToken("HH", match1to2, match2);
    addRegexToken("hh", match1to2, match2);
    addRegexToken("kk", match1to2, match2);
    addRegexToken("hmm", match3to4);
    addRegexToken("hmmss", match5to6);
    addRegexToken("Hmm", match3to4);
    addRegexToken("Hmmss", match5to6);
    addParseToken(["H", "HH"], HOUR2);
    addParseToken(["k", "kk"], function(input, array, config) {
      var kInput = toInt(input);
      array[HOUR2] = kInput === 24 ? 0 : kInput;
    });
    addParseToken(["a", "A"], function(input, array, config) {
      config._isPm = config._locale.isPM(input);
      config._meridiem = input;
    });
    addParseToken(["h", "hh"], function(input, array, config) {
      array[HOUR2] = toInt(input);
      getParsingFlags(config).bigHour = true;
    });
    addParseToken("hmm", function(input, array, config) {
      var pos = input.length - 2;
      array[HOUR2] = toInt(input.substr(0, pos));
      array[MINUTE] = toInt(input.substr(pos));
      getParsingFlags(config).bigHour = true;
    });
    addParseToken("hmmss", function(input, array, config) {
      var pos1 = input.length - 4, pos2 = input.length - 2;
      array[HOUR2] = toInt(input.substr(0, pos1));
      array[MINUTE] = toInt(input.substr(pos1, 2));
      array[SECOND] = toInt(input.substr(pos2));
      getParsingFlags(config).bigHour = true;
    });
    addParseToken("Hmm", function(input, array, config) {
      var pos = input.length - 2;
      array[HOUR2] = toInt(input.substr(0, pos));
      array[MINUTE] = toInt(input.substr(pos));
    });
    addParseToken("Hmmss", function(input, array, config) {
      var pos1 = input.length - 4, pos2 = input.length - 2;
      array[HOUR2] = toInt(input.substr(0, pos1));
      array[MINUTE] = toInt(input.substr(pos1, 2));
      array[SECOND] = toInt(input.substr(pos2));
    });
    function localeIsPM(input) {
      return (input + "").toLowerCase().charAt(0) === "p";
    }
    var defaultLocaleMeridiemParse = /[ap]\.?m?\.?/i, getSetHour = makeGetSet("Hours", true);
    function localeMeridiem(hours2, minutes2, isLower) {
      if (hours2 > 11) {
        return isLower ? "pm" : "PM";
      } else {
        return isLower ? "am" : "AM";
      }
    }
    var baseConfig = {
      calendar: defaultCalendar,
      longDateFormat: defaultLongDateFormat,
      invalidDate: defaultInvalidDate,
      ordinal: defaultOrdinal,
      dayOfMonthOrdinalParse: defaultDayOfMonthOrdinalParse,
      relativeTime: defaultRelativeTime,
      months: defaultLocaleMonths,
      monthsShort: defaultLocaleMonthsShort,
      week: defaultLocaleWeek,
      weekdays: defaultLocaleWeekdays,
      weekdaysMin: defaultLocaleWeekdaysMin,
      weekdaysShort: defaultLocaleWeekdaysShort,
      meridiemParse: defaultLocaleMeridiemParse
    };
    var locales = {}, localeFamilies = {}, globalLocale;
    function commonPrefix(arr1, arr2) {
      var i, minl = Math.min(arr1.length, arr2.length);
      for (i = 0;i < minl; i += 1) {
        if (arr1[i] !== arr2[i]) {
          return i;
        }
      }
      return minl;
    }
    function normalizeLocale(key) {
      return key ? key.toLowerCase().replace("_", "-") : key;
    }
    function chooseLocale(names) {
      var i = 0, j, next, locale2, split;
      while (i < names.length) {
        split = normalizeLocale(names[i]).split("-");
        j = split.length;
        next = normalizeLocale(names[i + 1]);
        next = next ? next.split("-") : null;
        while (j > 0) {
          locale2 = loadLocale(split.slice(0, j).join("-"));
          if (locale2) {
            return locale2;
          }
          if (next && next.length >= j && commonPrefix(split, next) >= j - 1) {
            break;
          }
          j--;
        }
        i++;
      }
      return globalLocale;
    }
    function isLocaleNameSane(name) {
      return typeof name === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
    }
    function loadLocale(name) {
      var oldLocale = null, aliasedRequire, normalizedName;
      if (hasOwnProp(locales, name)) {
        return locales[name];
      }
      normalizedName = normalizeLocale(name);
      if (hasOwnProp(locales, normalizedName)) {
        return locales[normalizedName];
      }
      if (typeof module !== "undefined" && module && module.exports && isLocaleNameSane(normalizedName)) {
        try {
          oldLocale = globalLocale._abbr;
          aliasedRequire = __require;
          aliasedRequire("./locale/" + normalizedName);
          getSetGlobalLocale(oldLocale);
        } catch (e) {
          locales[normalizedName] = null;
        }
      }
      if (hasOwnProp(locales, normalizedName)) {
        return locales[normalizedName];
      }
    }
    function getSetGlobalLocale(key, values) {
      var data;
      if (key) {
        if (isUndefined(values)) {
          data = getLocale(key);
        } else {
          data = defineLocale(key, values);
        }
        if (data) {
          globalLocale = data;
        } else {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("Locale " + key + " not found. Did you forget to load it?");
          }
        }
      }
      return globalLocale._abbr;
    }
    function defineLocale(name, config) {
      if (config !== null) {
        var locale2, parentConfig = baseConfig;
        config.abbr = name;
        if (locales[name] != null) {
          deprecateSimple("defineLocaleOverride", "use moment.updateLocale(localeName, config) to change " + "an existing locale. moment.defineLocale(localeName, " + "config) should only be used for creating a new locale " + "See http://momentjs.com/guides/#/warnings/define-locale/ for more info.");
          parentConfig = locales[name]._config;
        } else if (config.parentLocale != null) {
          if (locales[config.parentLocale] != null) {
            parentConfig = locales[config.parentLocale]._config;
          } else {
            locale2 = loadLocale(config.parentLocale);
            if (locale2 != null) {
              parentConfig = locale2._config;
            } else {
              if (!localeFamilies[config.parentLocale]) {
                localeFamilies[config.parentLocale] = [];
              }
              localeFamilies[config.parentLocale].push({
                name,
                config
              });
              return null;
            }
          }
        }
        locales[name] = new Locale(mergeConfigs(parentConfig, config));
        if (localeFamilies[name]) {
          localeFamilies[name].forEach(function(x) {
            defineLocale(x.name, x.config);
          });
        }
        getSetGlobalLocale(name);
        return locales[name];
      } else {
        delete locales[name];
        return null;
      }
    }
    function updateLocale(name, config) {
      var locale2, tmpLocale = loadLocale(name), parentConfig = baseConfig;
      if (tmpLocale != null) {
        name = tmpLocale._abbr;
      }
      if (config != null) {
        if (locales[name] != null && locales[name].parentLocale != null) {
          locales[name].set(mergeConfigs(locales[name]._config, config));
        } else {
          if (tmpLocale != null) {
            parentConfig = tmpLocale._config;
          }
          config = mergeConfigs(parentConfig, config);
          if (tmpLocale == null) {
            config.abbr = name;
          }
          locale2 = new Locale(config);
          locale2.parentLocale = locales[name];
          locales[name] = locale2;
        }
        getSetGlobalLocale(name);
      } else {
        if (locales[name] != null) {
          if (locales[name].parentLocale != null) {
            locales[name] = locales[name].parentLocale;
            if (name === getSetGlobalLocale()) {
              getSetGlobalLocale(name);
            }
          } else if (locales[name] != null) {
            delete locales[name];
          }
        }
      }
      return locales[name];
    }
    function getLocale(key) {
      var locale2;
      if (key && key._locale && key._locale._abbr) {
        key = key._locale._abbr;
      }
      if (!key) {
        return globalLocale;
      }
      if (!isArray(key)) {
        locale2 = loadLocale(key);
        if (locale2) {
          return locale2;
        }
        key = [key];
      }
      return chooseLocale(key);
    }
    function listLocales() {
      return keys(locales);
    }
    function checkOverflow(m) {
      var overflow, a = m._a;
      if (a && getParsingFlags(m).overflow === -2) {
        overflow = a[MONTH] < 0 || a[MONTH] > 11 ? MONTH : a[DATE] < 1 || a[DATE] > daysInMonth(a[YEAR], a[MONTH]) ? DATE : a[HOUR2] < 0 || a[HOUR2] > 24 || a[HOUR2] === 24 && (a[MINUTE] !== 0 || a[SECOND] !== 0 || a[MILLISECOND] !== 0) ? HOUR2 : a[MINUTE] < 0 || a[MINUTE] > 59 ? MINUTE : a[SECOND] < 0 || a[SECOND] > 59 ? SECOND : a[MILLISECOND] < 0 || a[MILLISECOND] > 999 ? MILLISECOND : -1;
        if (getParsingFlags(m)._overflowDayOfYear && (overflow < YEAR || overflow > DATE)) {
          overflow = DATE;
        }
        if (getParsingFlags(m)._overflowWeeks && overflow === -1) {
          overflow = WEEK;
        }
        if (getParsingFlags(m)._overflowWeekday && overflow === -1) {
          overflow = WEEKDAY;
        }
        getParsingFlags(m).overflow = overflow;
      }
      return m;
    }
    var extendedIsoRegex = /^\s*((?:[+-]\d{6}|\d{4})-(?:\d\d-\d\d|W\d\d-\d|W\d\d|\d\d\d|\d\d))(?:(T| )(\d\d(?::\d\d(?::\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/, basicIsoRegex = /^\s*((?:[+-]\d{6}|\d{4})(?:\d\d\d\d|W\d\d\d|W\d\d|\d\d\d|\d\d|))(?:(T| )(\d\d(?:\d\d(?:\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/, tzRegex = /Z|[+-]\d\d(?::?\d\d)?/, isoDates = [
      ["YYYYYY-MM-DD", /[+-]\d{6}-\d\d-\d\d/],
      ["YYYY-MM-DD", /\d{4}-\d\d-\d\d/],
      ["GGGG-[W]WW-E", /\d{4}-W\d\d-\d/],
      ["GGGG-[W]WW", /\d{4}-W\d\d/, false],
      ["YYYY-DDD", /\d{4}-\d{3}/],
      ["YYYY-MM", /\d{4}-\d\d/, false],
      ["YYYYYYMMDD", /[+-]\d{10}/],
      ["YYYYMMDD", /\d{8}/],
      ["GGGG[W]WWE", /\d{4}W\d{3}/],
      ["GGGG[W]WW", /\d{4}W\d{2}/, false],
      ["YYYYDDD", /\d{7}/],
      ["YYYYMM", /\d{6}/, false],
      ["YYYY", /\d{4}/, false]
    ], isoTimes = [
      ["HH:mm:ss.SSSS", /\d\d:\d\d:\d\d\.\d+/],
      ["HH:mm:ss,SSSS", /\d\d:\d\d:\d\d,\d+/],
      ["HH:mm:ss", /\d\d:\d\d:\d\d/],
      ["HH:mm", /\d\d:\d\d/],
      ["HHmmss.SSSS", /\d\d\d\d\d\d\.\d+/],
      ["HHmmss,SSSS", /\d\d\d\d\d\d,\d+/],
      ["HHmmss", /\d\d\d\d\d\d/],
      ["HHmm", /\d\d\d\d/],
      ["HH", /\d\d/]
    ], aspNetJsonRegex = /^\/?Date\((-?\d+)/i, rfc2822 = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/, obsOffsets = {
      UT: 0,
      GMT: 0,
      EDT: -4 * 60,
      EST: -5 * 60,
      CDT: -5 * 60,
      CST: -6 * 60,
      MDT: -6 * 60,
      MST: -7 * 60,
      PDT: -7 * 60,
      PST: -8 * 60
    };
    function configFromISO(config) {
      var i, l, string = config._i, match = extendedIsoRegex.exec(string) || basicIsoRegex.exec(string), allowTime, dateFormat, timeFormat, tzFormat, isoDatesLen = isoDates.length, isoTimesLen = isoTimes.length;
      if (match) {
        getParsingFlags(config).iso = true;
        for (i = 0, l = isoDatesLen;i < l; i++) {
          if (isoDates[i][1].exec(match[1])) {
            dateFormat = isoDates[i][0];
            allowTime = isoDates[i][2] !== false;
            break;
          }
        }
        if (dateFormat == null) {
          config._isValid = false;
          return;
        }
        if (match[3]) {
          for (i = 0, l = isoTimesLen;i < l; i++) {
            if (isoTimes[i][1].exec(match[3])) {
              timeFormat = (match[2] || " ") + isoTimes[i][0];
              break;
            }
          }
          if (timeFormat == null) {
            config._isValid = false;
            return;
          }
        }
        if (!allowTime && timeFormat != null) {
          config._isValid = false;
          return;
        }
        if (match[4]) {
          if (tzRegex.exec(match[4])) {
            tzFormat = "Z";
          } else {
            config._isValid = false;
            return;
          }
        }
        config._f = dateFormat + (timeFormat || "") + (tzFormat || "");
        configFromStringAndFormat(config);
      } else {
        config._isValid = false;
      }
    }
    function extractFromRFC2822Strings(yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr) {
      var result = [
        untruncateYear(yearStr),
        defaultLocaleMonthsShort.indexOf(monthStr),
        parseInt(dayStr, 10),
        parseInt(hourStr, 10),
        parseInt(minuteStr, 10)
      ];
      if (secondStr) {
        result.push(parseInt(secondStr, 10));
      }
      return result;
    }
    function untruncateYear(yearStr) {
      var year = parseInt(yearStr, 10);
      if (year <= 49) {
        return 2000 + year;
      } else if (year <= 999) {
        return 1900 + year;
      }
      return year;
    }
    function preprocessRFC2822(s) {
      return s.replace(/\([^()]*\)|[\n\t]/g, " ").replace(/(\s\s+)/g, " ").replace(/^\s\s*/, "").replace(/\s\s*$/, "");
    }
    function checkWeekday(weekdayStr, parsedInput, config) {
      if (weekdayStr) {
        var weekdayProvided = defaultLocaleWeekdaysShort.indexOf(weekdayStr), weekdayActual = new Date(parsedInput[0], parsedInput[1], parsedInput[2]).getDay();
        if (weekdayProvided !== weekdayActual) {
          getParsingFlags(config).weekdayMismatch = true;
          config._isValid = false;
          return false;
        }
      }
      return true;
    }
    function calculateOffset(obsOffset, militaryOffset, numOffset) {
      if (obsOffset) {
        return obsOffsets[obsOffset];
      } else if (militaryOffset) {
        return 0;
      } else {
        var hm = parseInt(numOffset, 10), m = hm % 100, h = (hm - m) / 100;
        return h * 60 + m;
      }
    }
    function configFromRFC2822(config) {
      var match = rfc2822.exec(preprocessRFC2822(config._i)), parsedArray;
      if (match) {
        parsedArray = extractFromRFC2822Strings(match[4], match[3], match[2], match[5], match[6], match[7]);
        if (!checkWeekday(match[1], parsedArray, config)) {
          return;
        }
        config._a = parsedArray;
        config._tzm = calculateOffset(match[8], match[9], match[10]);
        config._d = createUTCDate.apply(null, config._a);
        config._d.setUTCMinutes(config._d.getUTCMinutes() - config._tzm);
        getParsingFlags(config).rfc2822 = true;
      } else {
        config._isValid = false;
      }
    }
    function configFromString(config) {
      var matched = aspNetJsonRegex.exec(config._i);
      if (matched !== null) {
        config._d = new Date(+matched[1]);
        return;
      }
      configFromISO(config);
      if (config._isValid === false) {
        delete config._isValid;
      } else {
        return;
      }
      configFromRFC2822(config);
      if (config._isValid === false) {
        delete config._isValid;
      } else {
        return;
      }
      if (config._strict) {
        config._isValid = false;
      } else {
        hooks.createFromInputFallback(config);
      }
    }
    hooks.createFromInputFallback = deprecate("value provided is not in a recognized RFC2822 or ISO format. moment construction falls back to js Date(), " + "which is not reliable across all browsers and versions. Non RFC2822/ISO date formats are " + "discouraged. Please refer to http://momentjs.com/guides/#/warnings/js-date/ for more info.", function(config) {
      config._d = new Date(config._i + (config._useUTC ? " UTC" : ""));
    });
    function defaults(a, b, c) {
      if (a != null) {
        return a;
      }
      if (b != null) {
        return b;
      }
      return c;
    }
    function currentDateArray(config, now2, forWeek) {
      var hadWeekContext = Object.prototype.hasOwnProperty.call(config, "_isDefaultDatePartsForWeek"), weekContext = config._isDefaultDatePartsForWeek;
      config._isDefaultDatePartsForWeek = !!forWeek;
      try {
        return hooks._getDefaultDateParts(config, now2, forWeek);
      } finally {
        if (hadWeekContext) {
          config._isDefaultDatePartsForWeek = weekContext;
        } else {
          delete config._isDefaultDatePartsForWeek;
        }
      }
    }
    function currentDateNow(config) {
      var now2 = config._defaultDatePartsNow;
      if (!now2) {
        return hooks.now();
      }
      if (!now2.hasValue) {
        now2.value = hooks.now();
        now2.hasValue = true;
      }
      return now2.value;
    }
    function getDefaultDateParts(config, now2, forWeek) {
      var useWeekDefaults = forWeek || config._isDefaultDatePartsForWeek, nowValue = useWeekDefaults ? createLocal(now2) : new Date(now2);
      if (useWeekDefaults) {
        return [nowValue.year(), nowValue.month(), nowValue.date()];
      }
      if (config._useUTC) {
        return [
          nowValue.getUTCFullYear(),
          nowValue.getUTCMonth(),
          nowValue.getUTCDate()
        ];
      }
      return [nowValue.getFullYear(), nowValue.getMonth(), nowValue.getDate()];
    }
    hooks._getDefaultDateParts = getDefaultDateParts;
    function configFromArray(config) {
      var i, date, input = [], now2, currentDate, expectedWeekday, yearToUse, dateIsDefaulted;
      if (config._d) {
        return;
      }
      if (config._a[YEAR] == null || config._a[MONTH] == null || config._a[DATE] == null) {
        now2 = currentDateNow(config);
        currentDate = currentDateArray(config, now2);
      }
      if (config._w && config._a[DATE] == null && config._a[MONTH] == null) {
        dayOfYearFromWeekInfo(config, currentDateArray(config, now2, true));
      }
      if (config._dayOfYear != null) {
        yearToUse = config._a[YEAR] != null ? config._a[YEAR] : currentDate[YEAR];
        if (config._dayOfYear > daysInYear(yearToUse) || config._dayOfYear === 0) {
          getParsingFlags(config)._overflowDayOfYear = true;
        }
        date = createUTCDate(yearToUse, 0, config._dayOfYear);
        config._a[MONTH] = date.getUTCMonth();
        config._a[DATE] = date.getUTCDate();
      }
      dateIsDefaulted = config._a[YEAR] == null || config._a[MONTH] == null || config._a[DATE] == null;
      for (i = 0;i < 3 && config._a[i] == null; ++i) {
        config._a[i] = input[i] = currentDate[i];
      }
      for (;i < 7; i++) {
        config._a[i] = input[i] = config._a[i] == null ? i === 2 ? 1 : 0 : config._a[i];
      }
      if (config._a[HOUR2] === 24 && config._a[MINUTE] === 0 && config._a[SECOND] === 0 && config._a[MILLISECOND] === 0) {
        config._nextDay = true;
        config._a[HOUR2] = 0;
      }
      config._d = (config._useUTC ? createUTCDate : createDate).apply(null, input);
      expectedWeekday = config._useUTC ? config._d.getUTCDay() : config._d.getDay();
      if (config._tzm != null) {
        config._d.setUTCMinutes(config._d.getUTCMinutes() - config._tzm);
      }
      if (config._nextDay) {
        config._a[HOUR2] = 24;
      }
      if (config._w && typeof config._w.d !== "undefined" && !dateIsDefaulted && config._w.d !== expectedWeekday) {
        getParsingFlags(config).weekdayMismatch = true;
      }
    }
    function dayOfYearFromWeekInfo(config, currentDate) {
      var w, weekYear, week, weekday, dow, doy, temp, weekdayOverflow, curWeek;
      w = config._w;
      if (w.GG != null || w.W != null || w.E != null) {
        dow = 1;
        doy = 4;
        weekYear = defaults(w.GG, config._a[YEAR], weekOfYearFromDate(currentDate[YEAR], currentDate[MONTH], currentDate[DATE], 1, 4).year);
        week = defaults(w.W, 1);
        weekday = defaults(w.E, 1);
        if (weekday < 1 || weekday > 7) {
          weekdayOverflow = true;
        }
      } else {
        dow = config._locale._week.dow;
        doy = config._locale._week.doy;
        curWeek = weekOfYearFromDate(currentDate[YEAR], currentDate[MONTH], currentDate[DATE], dow, doy);
        weekYear = defaults(w.gg, config._a[YEAR], curWeek.year);
        week = defaults(w.w, curWeek.week);
        if (w.d != null) {
          weekday = w.d;
          if (weekday < 0 || weekday > 6) {
            weekdayOverflow = true;
          }
        } else if (w.e != null) {
          weekday = w.e + dow;
          if (w.e < 0 || w.e > 6) {
            weekdayOverflow = true;
          }
        } else {
          weekday = dow;
        }
      }
      if (week < 1 || week > weeksInYear(weekYear, dow, doy)) {
        getParsingFlags(config)._overflowWeeks = true;
      } else if (weekdayOverflow != null) {
        getParsingFlags(config)._overflowWeekday = true;
      } else {
        temp = dayOfYearFromWeeks(weekYear, week, weekday, dow, doy);
        config._a[YEAR] = temp.year;
        config._dayOfYear = temp.dayOfYear;
      }
    }
    hooks.ISO_8601 = function() {};
    hooks.RFC_2822 = function() {};
    function configFromStringAndFormat(config) {
      if (config._f === hooks.ISO_8601) {
        configFromISO(config);
        return;
      }
      if (config._f === hooks.RFC_2822) {
        configFromRFC2822(config);
        return;
      }
      config._a = [];
      getParsingFlags(config).empty = true;
      var string = "" + config._i, i, parsedInput, tokens2, token2, skipped, stringLength = string.length, totalParsedInputLength = 0, era, tokenLen;
      tokens2 = expandFormat(config._f, config._locale).match(formattingTokens) || [];
      tokenLen = tokens2.length;
      for (i = 0;i < tokenLen; i++) {
        token2 = tokens2[i];
        parsedInput = (string.match(getParseRegexForToken(token2, config)) || [])[0];
        if (parsedInput) {
          skipped = string.substr(0, string.indexOf(parsedInput));
          if (skipped.length > 0) {
            getParsingFlags(config).unusedInput.push(skipped);
          }
          string = string.slice(string.indexOf(parsedInput) + parsedInput.length);
          totalParsedInputLength += parsedInput.length;
        }
        if (formatTokenFunctions[token2]) {
          if (parsedInput) {
            getParsingFlags(config).empty = false;
          } else {
            getParsingFlags(config).unusedTokens.push(token2);
          }
          addTimeToArrayFromToken(token2, parsedInput, config);
        } else if (config._strict && !parsedInput) {
          getParsingFlags(config).unusedTokens.push(token2);
        }
      }
      getParsingFlags(config).charsLeftOver = stringLength - totalParsedInputLength;
      if (string.length > 0) {
        getParsingFlags(config).unusedInput.push(string);
      }
      if (config._a[HOUR2] <= 12 && getParsingFlags(config).bigHour === true && config._a[HOUR2] > 0) {
        getParsingFlags(config).bigHour = undefined;
      }
      getParsingFlags(config).parsedDateParts = config._a.slice(0);
      getParsingFlags(config).meridiem = config._meridiem;
      config._a[HOUR2] = meridiemFixWrap(config._locale, config._a[HOUR2], config._meridiem);
      era = getParsingFlags(config).era;
      if (era !== null) {
        config._a[YEAR] = config._locale.erasConvertYear(era, config._a[YEAR]);
      }
      configFromArray(config);
      checkOverflow(config);
    }
    function meridiemFixWrap(locale2, hour, meridiem2) {
      var isPm;
      if (meridiem2 == null) {
        return hour;
      }
      if (locale2.meridiemHour != null) {
        return locale2.meridiemHour(hour, meridiem2);
      } else if (locale2.isPM != null) {
        isPm = locale2.isPM(meridiem2);
        if (isPm && hour < 12) {
          hour += 12;
        }
        if (!isPm && hour === 12) {
          hour = 0;
        }
        return hour;
      } else {
        return hour;
      }
    }
    function configFromStringAndArray(config) {
      var tempConfig, bestMoment, scoreToBeat, i, currentScore, validFormatFound, bestFormatIsValid = false, defaultDatePartsNow = {}, configfLen = config._f.length;
      if (configfLen === 0) {
        getParsingFlags(config).invalidFormat = true;
        config._d = new Date(NaN);
        return;
      }
      for (i = 0;i < configfLen; i++) {
        currentScore = 0;
        validFormatFound = false;
        tempConfig = copyConfig({}, config);
        if (config._useUTC != null) {
          tempConfig._useUTC = config._useUTC;
        }
        tempConfig._defaultDatePartsNow = defaultDatePartsNow;
        tempConfig._f = config._f[i];
        configFromStringAndFormat(tempConfig);
        if (isValid$2(tempConfig)) {
          validFormatFound = true;
        }
        currentScore += getParsingFlags(tempConfig).charsLeftOver;
        currentScore += getParsingFlags(tempConfig).unusedTokens.length * 10;
        getParsingFlags(tempConfig).score = currentScore;
        if (!bestFormatIsValid) {
          if (scoreToBeat == null || currentScore < scoreToBeat || validFormatFound) {
            scoreToBeat = currentScore;
            bestMoment = tempConfig;
            if (validFormatFound) {
              bestFormatIsValid = true;
            }
          }
        } else {
          if (currentScore < scoreToBeat) {
            scoreToBeat = currentScore;
            bestMoment = tempConfig;
          }
        }
      }
      extend(config, bestMoment || tempConfig);
    }
    function configFromObject(config) {
      if (config._d) {
        return;
      }
      var i = normalizeObjectUnits(config._i), dayOrDate = i.day === undefined ? i.date : i.day;
      config._a = map([i.year, i.month, dayOrDate, i.hour, i.minute, i.second, i.millisecond], function(obj) {
        return obj && parseInt(obj, 10);
      });
      configFromArray(config);
    }
    function createFromConfig(config) {
      var res = new Moment(checkOverflow(prepareConfig(config)));
      if (res._nextDay) {
        res.add(1, "d");
        res._nextDay = undefined;
      }
      return res;
    }
    function prepareConfig(config) {
      var { _i: input, _f: format2 } = config;
      config._locale = config._locale || getLocale(config._l);
      if (input === null || format2 === undefined && input === "") {
        return createInvalid$1({ nullInput: true });
      }
      if (typeof input === "string") {
        config._i = input = config._locale.preparse(input);
      }
      if (isMoment(input)) {
        return new Moment(checkOverflow(input));
      } else if (isDate(input)) {
        config._d = input;
      } else if (isArray(format2)) {
        configFromStringAndArray(config);
      } else if (format2) {
        configFromStringAndFormat(config);
      } else {
        configFromInput(config);
      }
      if (!isValid$2(config)) {
        config._d = null;
      }
      return config;
    }
    function configFromInput(config) {
      var input = config._i;
      if (isUndefined(input)) {
        config._d = new Date(hooks.now());
      } else if (isDate(input)) {
        config._d = new Date(input.valueOf());
      } else if (typeof input === "string") {
        configFromString(config);
      } else if (isArray(input)) {
        config._a = map(input.slice(0), function(obj) {
          return parseInt(obj, 10);
        });
        configFromArray(config);
      } else if (isObject(input)) {
        configFromObject(config);
      } else if (isNumber(input)) {
        config._d = new Date(input);
      } else {
        hooks.createFromInputFallback(config);
      }
    }
    function createLocalOrUTC(input, format2, locale2, strict, isUTC) {
      var c = {};
      if (format2 === true || format2 === false) {
        strict = format2;
        format2 = undefined;
      }
      if (locale2 === true || locale2 === false) {
        strict = locale2;
        locale2 = undefined;
      }
      if (isObject(input) && isObjectEmpty(input) || isArray(input) && input.length === 0) {
        input = undefined;
      }
      c._isAMomentObject = true;
      c._useUTC = c._isUTC = isUTC;
      c._l = locale2;
      c._i = input;
      c._f = format2;
      c._strict = strict;
      return createFromConfig(c);
    }
    function createLocal(input, format2, locale2, strict) {
      return createLocalOrUTC(input, format2, locale2, strict, false);
    }
    var prototypeMin = deprecate("moment().min is deprecated, use moment.max instead. http://momentjs.com/guides/#/warnings/min-max/", function() {
      var other = createLocal.apply(null, arguments);
      if (this.isValid() && other.isValid()) {
        return other < this ? this : other;
      } else {
        return createInvalid$1();
      }
    }), prototypeMax = deprecate("moment().max is deprecated, use moment.min instead. http://momentjs.com/guides/#/warnings/min-max/", function() {
      var other = createLocal.apply(null, arguments);
      if (this.isValid() && other.isValid()) {
        return other > this ? this : other;
      } else {
        return createInvalid$1();
      }
    });
    function pickBy(fn, moments) {
      var res, i;
      if (moments.length === 1 && isArray(moments[0])) {
        moments = moments[0];
      }
      if (!moments.length) {
        return createLocal();
      }
      for (i = 0;i < moments.length; ++i) {
        if (isMoment(moments[i])) {
          res = moments[i];
          break;
        }
      }
      if (!res) {
        return createInvalid$1();
      }
      for (++i;i < moments.length; ++i) {
        if (isMoment(moments[i]) && (!moments[i].isValid() || moments[i][fn](res))) {
          res = moments[i];
        }
      }
      return res;
    }
    function min() {
      var args = [].slice.call(arguments, 0);
      return pickBy("isBefore", args);
    }
    function max() {
      var args = [].slice.call(arguments, 0);
      return pickBy("isAfter", args);
    }
    var now = function() {
      return Date.now ? Date.now() : +new Date;
    };
    var ordering = [
      "year",
      "quarter",
      "month",
      "week",
      "day",
      "hour",
      "minute",
      "second",
      "millisecond"
    ];
    function isDurationValid(m) {
      var key, unitHasDecimal = false, i, orderLen = ordering.length;
      for (key in m) {
        if (hasOwnProp(m, key) && !(indexOf.call(ordering, key) !== -1 && (m[key] == null || !isNaN(m[key])))) {
          return false;
        }
      }
      for (i = 0;i < orderLen; ++i) {
        if (m[ordering[i]]) {
          if (unitHasDecimal) {
            return false;
          }
          if (parseFloat(m[ordering[i]]) !== toInt(m[ordering[i]])) {
            unitHasDecimal = true;
          }
        }
      }
      return true;
    }
    function isValid$1() {
      return this._isValid;
    }
    function createInvalid() {
      return createDuration(NaN);
    }
    function Duration(duration) {
      var normalizedInput = normalizeObjectUnits(duration), years2 = normalizedInput.year || 0, quarters = normalizedInput.quarter || 0, months2 = normalizedInput.month || 0, weeks2 = normalizedInput.week || normalizedInput.isoWeek || 0, days2 = normalizedInput.day || 0, hours2 = normalizedInput.hour || 0, minutes2 = normalizedInput.minute || 0, seconds2 = normalizedInput.second || 0, milliseconds2 = normalizedInput.millisecond || 0;
      this._isValid = isDurationValid(normalizedInput);
      this._milliseconds = +milliseconds2 + seconds2 * 1000 + minutes2 * 60000 + hours2 * 1000 * 60 * 60;
      this._days = +days2 + weeks2 * 7;
      this._months = +months2 + quarters * 3 + years2 * 12;
      this._data = {};
      this._locale = getLocale();
      this._bubble();
    }
    function isDuration(obj) {
      return obj instanceof Duration;
    }
    function absRound(number) {
      if (number < 0) {
        return Math.round(-1 * number) * -1;
      } else {
        return Math.round(number);
      }
    }
    function compareArrays(array1, array2, dontConvert) {
      var len = Math.min(array1.length, array2.length), lengthDiff = Math.abs(array1.length - array2.length), diffs = 0, i;
      for (i = 0;i < len; i++) {
        if (toInt(array1[i]) !== toInt(array2[i])) {
          diffs++;
        }
      }
      return diffs + lengthDiff;
    }
    function offset(token2, separator) {
      addFormatToken(token2, 0, 0, function() {
        var offset2 = this.utcOffset(), sign2 = "+";
        if (offset2 < 0) {
          offset2 = -offset2;
          sign2 = "-";
        }
        return sign2 + zeroFill(~~(offset2 / 60), 2) + separator + zeroFill(~~offset2 % 60, 2);
      });
    }
    offset("Z", ":");
    offset("ZZ", "");
    addRegexToken("Z", matchShortOffset);
    addRegexToken("ZZ", matchShortOffset);
    addParseToken(["Z", "ZZ"], function(input, array, config) {
      var offset2 = offsetFromString(matchShortOffset, input);
      config._useUTC = true;
      config._tzm = offset2;
      if (offset2 === null) {
        getParsingFlags(config).invalidOffset = input;
      }
    });
    var chunkOffset = /([\+\-]|\d\d)/gi;
    function offsetFromString(matcher, string) {
      var matches = (string || "").match(matcher), chunk, parts, minutes2;
      if (matches === null) {
        return null;
      }
      chunk = matches[matches.length - 1] || [];
      parts = (chunk + "").match(chunkOffset) || ["-", 0, 0];
      minutes2 = +(parts[1] * 60) + toInt(parts[2]);
      if (toInt(parts[2]) > 59 || (parts[0] === "+" ? minutes2 > 14 * 60 : minutes2 > 12 * 60)) {
        return null;
      }
      return minutes2 === 0 ? 0 : parts[0] === "+" ? minutes2 : -minutes2;
    }
    function cloneWithOffset(input, model) {
      var res, diff2;
      if (model._isUTC) {
        res = model.clone();
        diff2 = (isMoment(input) || isDate(input) ? input.valueOf() : createLocal(input).valueOf()) - res.valueOf();
        res._d.setTime(res._d.valueOf() + diff2);
        hooks.updateOffset(res, false);
        return res;
      } else {
        return createLocal(input).local();
      }
    }
    function getDateOffset(m) {
      return -Math.round(m._d.getTimezoneOffset());
    }
    hooks.updateOffset = function() {};
    function getSetOffset(input, keepLocalTime, keepMinutes) {
      var offset2 = this._offset || 0, localAdjust;
      if (!this.isValid()) {
        return input != null ? this : NaN;
      }
      if (input != null) {
        if (typeof input === "string") {
          input = offsetFromString(matchShortOffset, input);
          if (input === null) {
            return this;
          }
        } else if (Math.abs(input) < 16 && !keepMinutes) {
          input = input * 60;
        }
        if (!this._isUTC && keepLocalTime) {
          localAdjust = getDateOffset(this);
        }
        this._offset = input;
        this._isUTC = true;
        if (localAdjust != null) {
          this.add(localAdjust, "m");
        }
        if (offset2 !== input) {
          if (!keepLocalTime || this._changeInProgress) {
            addSubtract$1(this, createDuration(input - offset2, "m"), 1, false);
          } else if (!this._changeInProgress) {
            this._changeInProgress = true;
            hooks.updateOffset(this, true);
            this._changeInProgress = null;
          }
        }
        return this;
      } else {
        return this._isUTC ? offset2 : getDateOffset(this);
      }
    }
    function getSetZone(input, keepLocalTime) {
      if (input != null) {
        if (typeof input !== "string") {
          input = -input;
        }
        this.utcOffset(input, keepLocalTime);
        return this;
      } else {
        return -this.utcOffset();
      }
    }
    function setOffsetToUTC(keepLocalTime) {
      return this.utcOffset(0, keepLocalTime);
    }
    function setOffsetToLocal(keepLocalTime) {
      if (this._isUTC) {
        this.utcOffset(0, keepLocalTime);
        this._isUTC = false;
        if (keepLocalTime) {
          this.subtract(getDateOffset(this), "m");
        }
      }
      return this;
    }
    function setOffsetToParsedOffset() {
      if (this._tzm != null) {
        this.utcOffset(this._tzm, false, true);
      } else if (typeof this._i === "string") {
        var tZone = offsetFromString(matchOffset, this._i);
        if (tZone != null) {
          this.utcOffset(tZone);
        } else {
          this.utcOffset(0, true);
        }
      }
      return this;
    }
    function hasAlignedHourOffset(input) {
      if (!this.isValid()) {
        return false;
      }
      input = input ? createLocal(input).utcOffset() : 0;
      return (this.utcOffset() - input) % 60 === 0;
    }
    function isDaylightSavingTime() {
      return this.utcOffset() > this.clone().month(0).utcOffset() || this.utcOffset() > this.clone().month(5).utcOffset();
    }
    function isDaylightSavingTimeShifted() {
      if (!isUndefined(this._isDSTShifted)) {
        return this._isDSTShifted;
      }
      var c = {}, other;
      copyConfig(c, this);
      c = prepareConfig(c);
      if (c._a) {
        other = c._isUTC ? createUTC(c._a) : createLocal(c._a);
        this._isDSTShifted = this.isValid() && compareArrays(c._a, other.toArray()) > 0;
      } else {
        this._isDSTShifted = false;
      }
      return this._isDSTShifted;
    }
    function isLocal() {
      return this.isValid() ? !this._isUTC : false;
    }
    function isUtcOffset() {
      return this.isValid() ? this._isUTC : false;
    }
    function isUtc() {
      return this.isValid() ? this._isUTC && this._offset === 0 : false;
    }
    var aspNetRegex = /^(-|\+)?(?:(\d*)[. ])?(\d+):(\d+)(?::(\d+)(\.\d*)?)?$/, isoRegex = /^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/;
    function createDuration(input, key) {
      var duration = input, match = null, sign2, ret, diffRes;
      if (isDuration(input)) {
        duration = {
          ms: input._milliseconds,
          d: input._days,
          M: input._months
        };
      } else if (isNumber(input) || !isNaN(+input)) {
        duration = {};
        if (key) {
          duration[key] = +input;
        } else {
          duration.milliseconds = +input;
        }
      } else if (match = aspNetRegex.exec(input)) {
        sign2 = match[1] === "-" ? -1 : 1;
        duration = {
          y: 0,
          d: toInt(match[DATE]) * sign2,
          h: toInt(match[HOUR2]) * sign2,
          m: toInt(match[MINUTE]) * sign2,
          s: toInt(match[SECOND]) * sign2,
          ms: toInt(absRound(match[MILLISECOND] * 1000)) * sign2
        };
      } else if (match = isoRegex.exec(input)) {
        sign2 = match[1] === "-" ? -1 : 1;
        duration = {
          y: parseIso(match[2], sign2),
          M: parseIso(match[3], sign2),
          w: parseIso(match[4], sign2),
          d: parseIso(match[5], sign2),
          h: parseIso(match[6], sign2),
          m: parseIso(match[7], sign2),
          s: parseIso(match[8], sign2)
        };
      } else if (duration == null) {
        duration = {};
      } else if (typeof duration === "object" && (("from" in duration) || ("to" in duration))) {
        diffRes = momentsDifference(createLocal(duration.from), createLocal(duration.to));
        duration = {};
        duration.ms = diffRes.milliseconds;
        duration.M = diffRes.months;
      }
      ret = new Duration(duration);
      if (isDuration(input) && hasOwnProp(input, "_locale")) {
        ret._locale = input._locale;
      }
      if (isDuration(input) && hasOwnProp(input, "_isValid")) {
        ret._isValid = input._isValid;
      }
      return ret;
    }
    createDuration.fn = Duration.prototype;
    createDuration.invalid = createInvalid;
    function parseIso(inp, sign2) {
      var res = inp && parseFloat(inp.replace(",", "."));
      return (isNaN(res) ? 0 : res) * sign2;
    }
    function positiveMomentsDifference(base, other) {
      var res = {};
      res.months = other.month() - base.month() + (other.year() - base.year()) * 12;
      if (base.clone().add(res.months, "M").isAfter(other)) {
        --res.months;
      }
      res.milliseconds = +other - +base.clone().add(res.months, "M");
      return res;
    }
    function momentsDifference(base, other) {
      var res;
      if (!(base.isValid() && other.isValid())) {
        return { milliseconds: 0, months: 0 };
      }
      other = cloneWithOffset(other, base);
      if (base.isBefore(other)) {
        res = positiveMomentsDifference(base, other);
      } else {
        res = positiveMomentsDifference(other, base);
        res.milliseconds = -res.milliseconds;
        res.months = -res.months;
      }
      return res;
    }
    function createAdder(direction, name) {
      return function(val, period) {
        var dur, tmp;
        if (period !== null && !isNaN(+period)) {
          deprecateSimple(name, "moment()." + name + "(period, number) is deprecated. Please use moment()." + name + "(number, period). " + "See http://momentjs.com/guides/#/warnings/add-inverted-param/ for more info.");
          tmp = val;
          val = period;
          period = tmp;
        }
        dur = createDuration(val, period);
        addSubtract$1(this, dur, direction);
        return this;
      };
    }
    function addSubtract$1(mom, duration, isAdding, updateOffset) {
      var milliseconds2 = duration._milliseconds, days2 = absRound(duration._days), months2 = absRound(duration._months);
      if (!mom.isValid()) {
        return;
      }
      updateOffset = updateOffset == null ? true : updateOffset;
      if (months2) {
        setMonth(mom, get$2(mom, "Month") + months2 * isAdding);
      }
      if (days2) {
        set$1(mom, "Date", get$2(mom, "Date") + days2 * isAdding);
      }
      if (milliseconds2) {
        mom._d.setTime(mom._d.valueOf() + milliseconds2 * isAdding);
      }
      if (updateOffset) {
        hooks.updateOffset(mom, days2 || months2);
      }
    }
    var add$1 = createAdder(1, "add"), subtract$1 = createAdder(-1, "subtract");
    function isString(input) {
      return typeof input === "string" || input instanceof String;
    }
    function isMomentInput(input) {
      return isMoment(input) || isDate(input) || isString(input) || isNumber(input) || isNumberOrStringArray(input) || isMomentInputObject(input) || input === null || input === undefined;
    }
    function isMomentInputObject(input) {
      var objectTest = isObject(input) && !isObjectEmpty(input), propertyTest = false, properties = [
        "years",
        "year",
        "y",
        "months",
        "month",
        "M",
        "days",
        "day",
        "d",
        "dates",
        "date",
        "D",
        "hours",
        "hour",
        "h",
        "minutes",
        "minute",
        "m",
        "seconds",
        "second",
        "s",
        "milliseconds",
        "millisecond",
        "ms"
      ], i, property, propertyLen = properties.length;
      for (i = 0;i < propertyLen; i += 1) {
        property = properties[i];
        propertyTest = propertyTest || hasOwnProp(input, property);
      }
      return objectTest && propertyTest;
    }
    function isNumberOrStringArray(input) {
      var arrayTest = isArray(input), dataTypeTest = false;
      if (arrayTest) {
        dataTypeTest = input.filter(function(item) {
          return !isNumber(item) && isString(input);
        }).length === 0;
      }
      return arrayTest && dataTypeTest;
    }
    function isCalendarSpec(input) {
      var objectTest = isObject(input) && !isObjectEmpty(input), propertyTest = false, properties = [
        "sameDay",
        "nextDay",
        "lastDay",
        "nextWeek",
        "lastWeek",
        "sameElse"
      ], i, property;
      for (i = 0;i < properties.length; i += 1) {
        property = properties[i];
        propertyTest = propertyTest || hasOwnProp(input, property);
      }
      return objectTest && propertyTest;
    }
    function getCalendarFormat(myMoment, now2) {
      var diff2 = myMoment.diff(now2, "days", true);
      return diff2 < -6 ? "sameElse" : diff2 < -1 ? "lastWeek" : diff2 < 0 ? "lastDay" : diff2 < 1 ? "sameDay" : diff2 < 2 ? "nextDay" : diff2 < 7 ? "nextWeek" : "sameElse";
    }
    function calendar(time, formats) {
      if (arguments.length === 1) {
        if (!arguments[0]) {
          time = undefined;
          formats = undefined;
        } else if (isMomentInput(arguments[0])) {
          time = arguments[0];
          formats = undefined;
        } else if (isCalendarSpec(arguments[0])) {
          formats = arguments[0];
          time = undefined;
        }
      }
      var now2 = time || createLocal(), sod = cloneWithOffset(now2, this).startOf("day"), format2 = hooks.calendarFormat(this, sod) || "sameElse", output = formats && (isFunction(formats[format2]) ? formats[format2].call(this, now2) : formats[format2]);
      return this.format(output || this.localeData().calendar(format2, this, createLocal(now2)));
    }
    function clone$1() {
      return new Moment(this);
    }
    function isAfter(input, units) {
      var localInput = isMoment(input) ? input : createLocal(input);
      if (!(this.isValid() && localInput.isValid())) {
        return false;
      }
      units = normalizeUnits(units) || "millisecond";
      if (units === "millisecond") {
        return this.valueOf() > localInput.valueOf();
      } else {
        return localInput.valueOf() < this.clone().startOf(units).valueOf();
      }
    }
    function isBefore(input, units) {
      var localInput = isMoment(input) ? input : createLocal(input);
      if (!(this.isValid() && localInput.isValid())) {
        return false;
      }
      units = normalizeUnits(units) || "millisecond";
      if (units === "millisecond") {
        return this.valueOf() < localInput.valueOf();
      } else {
        return this.clone().endOf(units).valueOf() < localInput.valueOf();
      }
    }
    function isBetween(from2, to2, units, inclusivity) {
      var localFrom = isMoment(from2) ? from2 : createLocal(from2), localTo = isMoment(to2) ? to2 : createLocal(to2);
      if (!(this.isValid() && localFrom.isValid() && localTo.isValid())) {
        return false;
      }
      inclusivity = inclusivity || "()";
      return (inclusivity[0] === "(" ? this.isAfter(localFrom, units) : !this.isBefore(localFrom, units)) && (inclusivity[1] === ")" ? this.isBefore(localTo, units) : !this.isAfter(localTo, units));
    }
    function isSame(input, units) {
      var localInput = isMoment(input) ? input : createLocal(input), inputMs;
      if (!(this.isValid() && localInput.isValid())) {
        return false;
      }
      units = normalizeUnits(units) || "millisecond";
      if (units === "millisecond") {
        return this.valueOf() === localInput.valueOf();
      } else {
        inputMs = localInput.valueOf();
        return this.clone().startOf(units).valueOf() <= inputMs && inputMs <= this.clone().endOf(units).valueOf();
      }
    }
    function isSameOrAfter(input, units) {
      return this.isSame(input, units) || this.isAfter(input, units);
    }
    function isSameOrBefore(input, units) {
      return this.isSame(input, units) || this.isBefore(input, units);
    }
    function diff(input, units, asFloat) {
      var that, zoneDelta, output;
      if (!this.isValid()) {
        return NaN;
      }
      that = cloneWithOffset(input, this);
      if (!that.isValid()) {
        return NaN;
      }
      zoneDelta = (that.utcOffset() - this.utcOffset()) * 60000;
      units = normalizeUnits(units);
      switch (units) {
        case "year":
          output = monthDiff(this, that) / 12;
          break;
        case "month":
          output = monthDiff(this, that);
          break;
        case "quarter":
          output = monthDiff(this, that) / 3;
          break;
        case "second":
          output = (this - that) / 1000;
          break;
        case "minute":
          output = (this - that) / 60000;
          break;
        case "hour":
          output = (this - that) / 3600000;
          break;
        case "day":
          output = (this - that - zoneDelta) / 86400000;
          break;
        case "week":
          output = (this - that - zoneDelta) / 604800000;
          break;
        default:
          output = this - that;
      }
      return asFloat ? output : absFloor(output);
    }
    function monthDiff(a, b) {
      if (a.date() < b.date()) {
        return -monthDiff(b, a);
      }
      var wholeMonthDiff = (b.year() - a.year()) * 12 + (b.month() - a.month()), anchor = a.clone().add(wholeMonthDiff, "months"), anchor2, adjust;
      if (b - anchor < 0) {
        anchor2 = a.clone().add(wholeMonthDiff - 1, "months");
        adjust = (b - anchor) / (anchor - anchor2);
      } else {
        anchor2 = a.clone().add(wholeMonthDiff + 1, "months");
        adjust = (b - anchor) / (anchor2 - anchor);
      }
      return -(wholeMonthDiff + adjust) || 0;
    }
    hooks.defaultFormat = "YYYY-MM-DDTHH:mm:ssZ";
    hooks.defaultFormatUtc = "YYYY-MM-DDTHH:mm:ss[Z]";
    function toString() {
      return this.clone().locale("en").format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ");
    }
    function toISOString$1(keepOffset) {
      if (!this.isValid()) {
        return null;
      }
      var utc = keepOffset !== true, m = utc ? this.clone().utc() : this;
      if (m.year() < 0 || m.year() > 9999) {
        return formatMoment(m, utc ? "YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]" : "YYYYYY-MM-DD[T]HH:mm:ss.SSSZ");
      }
      if (isFunction(Date.prototype.toISOString)) {
        if (utc) {
          return this.toDate().toISOString();
        } else {
          return new Date(this.valueOf() + this.utcOffset() * 60 * 1000).toISOString().replace("Z", formatMoment(m, "Z"));
        }
      }
      return formatMoment(m, utc ? "YYYY-MM-DD[T]HH:mm:ss.SSS[Z]" : "YYYY-MM-DD[T]HH:mm:ss.SSSZ");
    }
    function inspect() {
      if (!this.isValid()) {
        return "moment.invalid(/* " + this._i + " */)";
      }
      var func = "moment", zone = "", prefix, year, datetime, suffix;
      if (!this.isLocal()) {
        func = this.utcOffset() === 0 ? "moment.utc" : "moment.parseZone";
        zone = "Z";
      }
      prefix = "[" + func + '("]';
      year = 0 <= this.year() && this.year() <= 9999 ? "YYYY" : "YYYYYY";
      datetime = "-MM-DD[T]HH:mm:ss.SSS";
      suffix = zone + '[")]';
      return this.format(prefix + year + datetime + suffix);
    }
    function format(inputString) {
      if (!inputString) {
        inputString = this.isUtc() ? hooks.defaultFormatUtc : hooks.defaultFormat;
      }
      var output = formatMoment(this, inputString);
      return this.localeData().postformat(output);
    }
    function from(time, withoutSuffix) {
      if (this.isValid() && (isMoment(time) && time.isValid() || createLocal(time).isValid())) {
        return createDuration({ to: this, from: time }).locale(this.locale()).humanize(!withoutSuffix);
      } else {
        return this.localeData().invalidDate();
      }
    }
    function fromNow(withoutSuffix) {
      return this.from(createLocal(), withoutSuffix);
    }
    function to(time, withoutSuffix) {
      if (this.isValid() && (isMoment(time) && time.isValid() || createLocal(time).isValid())) {
        return createDuration({ from: this, to: time }).locale(this.locale()).humanize(!withoutSuffix);
      } else {
        return this.localeData().invalidDate();
      }
    }
    function toNow(withoutSuffix) {
      return this.to(createLocal(), withoutSuffix);
    }
    function locale(key) {
      var newLocaleData;
      if (key === undefined) {
        return this._locale._abbr;
      } else {
        newLocaleData = getLocale(key);
        if (newLocaleData != null) {
          this._locale = newLocaleData;
        }
        return this;
      }
    }
    var lang = deprecate("moment().lang() is deprecated. Instead, use moment().localeData() to get the language configuration. Use moment().locale() to change languages.", function(key) {
      if (key === undefined) {
        return this.localeData();
      } else {
        return this.locale(key);
      }
    });
    function localeData() {
      return this._locale;
    }
    var MS_PER_SECOND = 1000, MS_PER_MINUTE = 60 * MS_PER_SECOND, MS_PER_HOUR = 60 * MS_PER_MINUTE, MS_PER_400_YEARS = (365 * 400 + 97) * 24 * MS_PER_HOUR;
    function mod(dividend, divisor) {
      return (dividend % divisor + divisor) % divisor;
    }
    function localStartOfDate(y, m, d) {
      if (y < 100 && y >= 0) {
        return new Date(y + 400, m, d) - MS_PER_400_YEARS;
      } else {
        return new Date(y, m, d).valueOf();
      }
    }
    function utcStartOfDate(y, m, d) {
      if (y < 100 && y >= 0) {
        return Date.UTC(y + 400, m, d) - MS_PER_400_YEARS;
      } else {
        return Date.UTC(y, m, d);
      }
    }
    function startOf(units) {
      var time, startOfDate;
      units = normalizeUnits(units);
      if (units === undefined || units === "millisecond" || !this.isValid()) {
        return this;
      }
      startOfDate = this._isUTC ? utcStartOfDate : localStartOfDate;
      switch (units) {
        case "year":
          time = startOfDate(this.year(), 0, 1);
          break;
        case "quarter":
          time = startOfDate(this.year(), this.month() - this.month() % 3, 1);
          break;
        case "month":
          time = startOfDate(this.year(), this.month(), 1);
          break;
        case "week":
          time = startOfDate(this.year(), this.month(), this.date() - this.weekday());
          break;
        case "isoWeek":
          time = startOfDate(this.year(), this.month(), this.date() - (this.isoWeekday() - 1));
          break;
        case "day":
        case "date":
          time = startOfDate(this.year(), this.month(), this.date());
          break;
        case "hour":
          time = this._d.valueOf();
          time -= mod(time + (this._isUTC ? 0 : this.utcOffset() * MS_PER_MINUTE), MS_PER_HOUR);
          break;
        case "minute":
          time = this._d.valueOf();
          time -= mod(time, MS_PER_MINUTE);
          break;
        case "second":
          time = this._d.valueOf();
          time -= mod(time, MS_PER_SECOND);
          break;
      }
      this._d.setTime(time);
      hooks.updateOffset(this, true);
      return this;
    }
    function endOf(units) {
      var time, startOfDate;
      units = normalizeUnits(units);
      if (units === undefined || units === "millisecond" || !this.isValid()) {
        return this;
      }
      startOfDate = this._isUTC ? utcStartOfDate : localStartOfDate;
      switch (units) {
        case "year":
          time = startOfDate(this.year() + 1, 0, 1) - 1;
          break;
        case "quarter":
          time = startOfDate(this.year(), this.month() - this.month() % 3 + 3, 1) - 1;
          break;
        case "month":
          time = startOfDate(this.year(), this.month() + 1, 1) - 1;
          break;
        case "week":
          time = startOfDate(this.year(), this.month(), this.date() - this.weekday() + 7) - 1;
          break;
        case "isoWeek":
          time = startOfDate(this.year(), this.month(), this.date() - (this.isoWeekday() - 1) + 7) - 1;
          break;
        case "day":
        case "date":
          time = startOfDate(this.year(), this.month(), this.date() + 1) - 1;
          break;
        case "hour":
          time = this._d.valueOf();
          time += MS_PER_HOUR - mod(time + (this._isUTC ? 0 : this.utcOffset() * MS_PER_MINUTE), MS_PER_HOUR) - 1;
          break;
        case "minute":
          time = this._d.valueOf();
          time += MS_PER_MINUTE - mod(time, MS_PER_MINUTE) - 1;
          break;
        case "second":
          time = this._d.valueOf();
          time += MS_PER_SECOND - mod(time, MS_PER_SECOND) - 1;
          break;
      }
      this._d.setTime(time);
      hooks.updateOffset(this, true);
      return this;
    }
    function valueOf$1() {
      return this._d.valueOf() - (this._offset || 0) * 60000;
    }
    function unix() {
      return Math.floor(this.valueOf() / 1000);
    }
    function toDate() {
      return new Date(this.valueOf());
    }
    function toArray() {
      var m = this;
      return [
        m.year(),
        m.month(),
        m.date(),
        m.hour(),
        m.minute(),
        m.second(),
        m.millisecond()
      ];
    }
    function toObject() {
      var m = this;
      return {
        years: m.year(),
        months: m.month(),
        date: m.date(),
        hours: m.hours(),
        minutes: m.minutes(),
        seconds: m.seconds(),
        milliseconds: m.milliseconds()
      };
    }
    function toJSON() {
      return this.isValid() ? this.toISOString() : null;
    }
    function isValid() {
      return isValid$2(this);
    }
    function parsingFlags() {
      return extend({}, getParsingFlags(this));
    }
    function invalidAt() {
      return getParsingFlags(this).overflow;
    }
    function creationData() {
      return {
        input: this._i,
        format: this._f,
        locale: this._locale,
        isUTC: this._isUTC,
        strict: this._strict
      };
    }
    addFormatToken("N", 0, 0, "eraAbbr");
    addFormatToken("NN", 0, 0, "eraAbbr");
    addFormatToken("NNN", 0, 0, "eraAbbr");
    addFormatToken("NNNN", 0, 0, "eraName");
    addFormatToken("NNNNN", 0, 0, "eraNarrow");
    addFormatToken("y", ["y", 1], "yo", "eraYear");
    addFormatToken("y", ["yy", 2], 0, "eraYear");
    addFormatToken("y", ["yyy", 3], 0, "eraYear");
    addFormatToken("y", ["yyyy", 4], 0, "eraYear");
    addRegexToken("N", matchEraAbbr);
    addRegexToken("NN", matchEraAbbr);
    addRegexToken("NNN", matchEraAbbr);
    addRegexToken("NNNN", matchEraName);
    addRegexToken("NNNNN", matchEraNarrow);
    addParseToken(["N", "NN", "NNN", "NNNN", "NNNNN"], function(input, array, config, token2) {
      var era = config._locale.erasParse(input, token2, config._strict);
      if (era) {
        getParsingFlags(config).era = era;
      } else {
        getParsingFlags(config).invalidEra = input;
      }
    });
    addRegexToken("y", matchUnsigned);
    addRegexToken("yy", matchUnsigned);
    addRegexToken("yyy", matchUnsigned);
    addRegexToken("yyyy", matchUnsigned);
    addRegexToken("yo", matchEraYearOrdinal);
    addParseToken(["y", "yy", "yyy", "yyyy"], YEAR);
    addParseToken(["yo"], function(input, array, config, token2) {
      var match;
      if (config._locale._eraYearOrdinalRegex) {
        match = input.match(config._locale._eraYearOrdinalRegex);
      }
      if (config._locale.eraYearOrdinalParse) {
        array[YEAR] = config._locale.eraYearOrdinalParse(input, match);
      } else {
        array[YEAR] = parseInt(input, 10);
      }
    });
    function localeEras(m, format2) {
      var i, l, date, eras = this._eras || getLocale("en")._eras;
      for (i = 0, l = eras.length;i < l; ++i) {
        switch (typeof eras[i].since) {
          case "string":
            date = hooks(eras[i].since).startOf("day");
            eras[i].since = date.valueOf();
            break;
        }
        switch (typeof eras[i].until) {
          case "undefined":
            eras[i].until = Infinity;
            break;
          case "string":
            date = hooks(eras[i].until).startOf("day").valueOf();
            eras[i].until = date.valueOf();
            break;
        }
      }
      return eras;
    }
    function localeErasParse(eraName, format2, strict) {
      var i, l, eras = this.eras(), name, abbr, narrow;
      eraName = eraName.toUpperCase();
      for (i = 0, l = eras.length;i < l; ++i) {
        name = eras[i].name.toUpperCase();
        abbr = eras[i].abbr.toUpperCase();
        narrow = eras[i].narrow.toUpperCase();
        if (strict) {
          switch (format2) {
            case "N":
            case "NN":
            case "NNN":
              if (abbr === eraName) {
                return eras[i];
              }
              break;
            case "NNNN":
              if (name === eraName) {
                return eras[i];
              }
              break;
            case "NNNNN":
              if (narrow === eraName) {
                return eras[i];
              }
              break;
          }
        } else if ([name, abbr, narrow].indexOf(eraName) >= 0) {
          return eras[i];
        }
      }
    }
    function localeErasConvertYear(era, year) {
      var dir = era.since <= era.until ? 1 : -1;
      if (year === undefined) {
        return hooks(era.since).year();
      } else {
        return hooks(era.since).year() + (year - era.offset) * dir;
      }
    }
    function getEraName() {
      var i, l, val, eras = this.localeData().eras();
      for (i = 0, l = eras.length;i < l; ++i) {
        val = this.clone().startOf("day").valueOf();
        if (eras[i].since <= val && val <= eras[i].until) {
          return eras[i].name;
        }
        if (eras[i].until <= val && val <= eras[i].since) {
          return eras[i].name;
        }
      }
      return "";
    }
    function getEraNarrow() {
      var i, l, val, eras = this.localeData().eras();
      for (i = 0, l = eras.length;i < l; ++i) {
        val = this.clone().startOf("day").valueOf();
        if (eras[i].since <= val && val <= eras[i].until) {
          return eras[i].narrow;
        }
        if (eras[i].until <= val && val <= eras[i].since) {
          return eras[i].narrow;
        }
      }
      return "";
    }
    function getEraAbbr() {
      var i, l, val, eras = this.localeData().eras();
      for (i = 0, l = eras.length;i < l; ++i) {
        val = this.clone().startOf("day").valueOf();
        if (eras[i].since <= val && val <= eras[i].until) {
          return eras[i].abbr;
        }
        if (eras[i].until <= val && val <= eras[i].since) {
          return eras[i].abbr;
        }
      }
      return "";
    }
    function getEraYear() {
      var i, l, dir, val, eras = this.localeData().eras();
      for (i = 0, l = eras.length;i < l; ++i) {
        dir = eras[i].since <= eras[i].until ? 1 : -1;
        val = this.clone().startOf("day").valueOf();
        if (eras[i].since <= val && val <= eras[i].until || eras[i].until <= val && val <= eras[i].since) {
          return (this.year() - hooks(eras[i].since).year()) * dir + eras[i].offset;
        }
      }
      return this.year();
    }
    function erasNameRegex(isStrict) {
      if (!hasOwnProp(this, "_erasNameRegex")) {
        computeErasParse.call(this);
      }
      return isStrict ? this._erasNameRegex : this._erasRegex;
    }
    function erasAbbrRegex(isStrict) {
      if (!hasOwnProp(this, "_erasAbbrRegex")) {
        computeErasParse.call(this);
      }
      return isStrict ? this._erasAbbrRegex : this._erasRegex;
    }
    function erasNarrowRegex(isStrict) {
      if (!hasOwnProp(this, "_erasNarrowRegex")) {
        computeErasParse.call(this);
      }
      return isStrict ? this._erasNarrowRegex : this._erasRegex;
    }
    function matchEraAbbr(isStrict, locale2) {
      return locale2.erasAbbrRegex(isStrict);
    }
    function matchEraName(isStrict, locale2) {
      return locale2.erasNameRegex(isStrict);
    }
    function matchEraNarrow(isStrict, locale2) {
      return locale2.erasNarrowRegex(isStrict);
    }
    function matchEraYearOrdinal(isStrict, locale2) {
      return locale2._eraYearOrdinalRegex || matchUnsigned;
    }
    function computeErasParse() {
      var abbrPieces = [], namePieces = [], narrowPieces = [], mixedPieces = [], i, l, erasName, erasAbbr, erasNarrow, eras = this.eras();
      for (i = 0, l = eras.length;i < l; ++i) {
        erasName = regexEscape(eras[i].name);
        erasAbbr = regexEscape(eras[i].abbr);
        erasNarrow = regexEscape(eras[i].narrow);
        namePieces.push(erasName);
        abbrPieces.push(erasAbbr);
        narrowPieces.push(erasNarrow);
        mixedPieces.push(erasName);
        mixedPieces.push(erasAbbr);
        mixedPieces.push(erasNarrow);
      }
      this._erasRegex = new RegExp("^(" + mixedPieces.join("|") + ")", "i");
      this._erasNameRegex = new RegExp("^(" + namePieces.join("|") + ")", "i");
      this._erasAbbrRegex = new RegExp("^(" + abbrPieces.join("|") + ")", "i");
      this._erasNarrowRegex = new RegExp("^(" + narrowPieces.join("|") + ")", "i");
    }
    addFormatToken(0, ["gg", 2], 0, function() {
      return this.weekYear() % 100;
    });
    addFormatToken(0, ["GG", 2], 0, function() {
      return this.isoWeekYear() % 100;
    });
    function addWeekYearFormatToken(token2, getter) {
      addFormatToken(0, [token2, token2.length], 0, getter);
    }
    addWeekYearFormatToken("gggg", "weekYear");
    addWeekYearFormatToken("ggggg", "weekYear");
    addWeekYearFormatToken("GGGG", "isoWeekYear");
    addWeekYearFormatToken("GGGGG", "isoWeekYear");
    addRegexToken("G", matchSigned);
    addRegexToken("g", matchSigned);
    addRegexToken("GG", match1to2, match2);
    addRegexToken("gg", match1to2, match2);
    addRegexToken("GGGG", match1to4, match4);
    addRegexToken("gggg", match1to4, match4);
    addRegexToken("GGGGG", match1to6, match6);
    addRegexToken("ggggg", match1to6, match6);
    addWeekParseToken(["gggg", "ggggg", "GGGG", "GGGGG"], function(input, week, config, token2) {
      week[token2.substr(0, 2)] = toInt(input);
    });
    addWeekParseToken(["gg", "GG"], function(input, week, config, token2) {
      week[token2] = hooks.parseTwoDigitYear(input);
    });
    function getSetWeekYear(input) {
      return getSetWeekYearHelper.call(this, input, this.week(), this.weekday() + this.localeData()._week.dow, this.localeData()._week.dow, this.localeData()._week.doy);
    }
    function getSetISOWeekYear(input) {
      return getSetWeekYearHelper.call(this, input, this.isoWeek(), this.isoWeekday(), 1, 4);
    }
    function getISOWeeksInYear() {
      return weeksInYear(this.year(), 1, 4);
    }
    function getISOWeeksInISOWeekYear() {
      return weeksInYear(this.isoWeekYear(), 1, 4);
    }
    function getWeeksInYear() {
      var weekInfo = this.localeData()._week;
      return weeksInYear(this.year(), weekInfo.dow, weekInfo.doy);
    }
    function getWeeksInWeekYear() {
      var weekInfo = this.localeData()._week;
      return weeksInYear(this.weekYear(), weekInfo.dow, weekInfo.doy);
    }
    function getSetWeekYearHelper(input, week, weekday, dow, doy) {
      var weeksTarget;
      if (input == null) {
        return weekOfYear(this, dow, doy).year;
      } else {
        weeksTarget = weeksInYear(input, dow, doy);
        if (week > weeksTarget) {
          week = weeksTarget;
        }
        return setWeekAll.call(this, input, week, weekday, dow, doy);
      }
    }
    function setWeekAll(weekYear, week, weekday, dow, doy) {
      var dayOfYearData = dayOfYearFromWeeks(weekYear, week, weekday, dow, doy), date = createUTCDate(dayOfYearData.year, 0, dayOfYearData.dayOfYear);
      this.year(date.getUTCFullYear());
      this.month(date.getUTCMonth());
      this.date(date.getUTCDate());
      return this;
    }
    addFormatToken("Q", 0, "Qo", "quarter");
    addRegexToken("Q", match1);
    addParseToken("Q", function(input, array) {
      array[MONTH] = (toInt(input) - 1) * 3;
    });
    function getSetQuarter(input) {
      return input == null ? Math.ceil((this.month() + 1) / 3) : this.month((input - 1) * 3 + this.month() % 3);
    }
    addFormatToken("D", ["DD", 2], "Do", "date");
    addRegexToken("D", match1to2, match1to2NoLeadingZero);
    addRegexToken("DD", match1to2, match2);
    addRegexToken("Do", function(isStrict, locale2) {
      return isStrict ? locale2._dayOfMonthOrdinalParse || locale2._ordinalParse : locale2._dayOfMonthOrdinalParseLenient;
    });
    addParseToken(["D", "DD"], DATE);
    addParseToken("Do", function(input, array) {
      array[DATE] = toInt(input.match(match1to2)[0]);
    });
    var getSetDayOfMonth = makeGetSet("Date", true);
    addFormatToken("DDD", ["DDDD", 3], "DDDo", "dayOfYear");
    addRegexToken("DDD", match1to3);
    addRegexToken("DDDD", match3);
    addParseToken(["DDD", "DDDD"], function(input, array, config) {
      config._dayOfYear = toInt(input);
    });
    function getSetDayOfYear(input) {
      var dayOfYear = Math.round((this.clone().startOf("day") - this.clone().startOf("year")) / 86400000) + 1;
      return input == null ? dayOfYear : this.add(input - dayOfYear, "d");
    }
    addFormatToken("m", ["mm", 2], 0, "minute");
    addRegexToken("m", match1to2, match1to2HasZero);
    addRegexToken("mm", match1to2, match2);
    addParseToken(["m", "mm"], MINUTE);
    var getSetMinute = makeGetSet("Minutes", false);
    addFormatToken("s", ["ss", 2], 0, "second");
    addRegexToken("s", match1to2, match1to2HasZero);
    addRegexToken("ss", match1to2, match2);
    addParseToken(["s", "ss"], SECOND);
    var getSetSecond = makeGetSet("Seconds", false);
    addFormatToken("S", 0, 0, function() {
      return ~~(this.millisecond() / 100);
    });
    addFormatToken(0, ["SS", 2], 0, function() {
      return ~~(this.millisecond() / 10);
    });
    addFormatToken(0, ["SSS", 3], 0, "millisecond");
    addFormatToken(0, ["SSSS", 4], 0, function() {
      return this.millisecond() * 10;
    });
    addFormatToken(0, ["SSSSS", 5], 0, function() {
      return this.millisecond() * 100;
    });
    addFormatToken(0, ["SSSSSS", 6], 0, function() {
      return this.millisecond() * 1000;
    });
    addFormatToken(0, ["SSSSSSS", 7], 0, function() {
      return this.millisecond() * 1e4;
    });
    addFormatToken(0, ["SSSSSSSS", 8], 0, function() {
      return this.millisecond() * 1e5;
    });
    addFormatToken(0, ["SSSSSSSSS", 9], 0, function() {
      return this.millisecond() * 1e6;
    });
    addRegexToken("S", match1to3, match1);
    addRegexToken("SS", match1to3, match2);
    addRegexToken("SSS", match1to3, match3);
    var token, getSetMillisecond;
    for (token = "SSSS";token.length <= 9; token += "S") {
      addRegexToken(token, matchUnsigned);
    }
    function parseMs(input, array) {
      array[MILLISECOND] = toInt(("0." + input) * 1000);
    }
    for (token = "S";token.length <= 9; token += "S") {
      addParseToken(token, parseMs);
    }
    getSetMillisecond = makeGetSet("Milliseconds", false);
    addFormatToken("z", 0, 0, "zoneAbbr");
    addFormatToken("zz", 0, 0, "zoneName");
    function getZoneAbbr() {
      return this._isUTC ? "UTC" : "";
    }
    function getZoneName() {
      return this._isUTC ? "Coordinated Universal Time" : "";
    }
    var proto$2 = Moment.prototype;
    proto$2.add = add$1;
    proto$2.calendar = calendar;
    proto$2.clone = clone$1;
    proto$2.diff = diff;
    proto$2.endOf = endOf;
    proto$2.format = format;
    proto$2.from = from;
    proto$2.fromNow = fromNow;
    proto$2.to = to;
    proto$2.toNow = toNow;
    proto$2.get = stringGet;
    proto$2.invalidAt = invalidAt;
    proto$2.isAfter = isAfter;
    proto$2.isBefore = isBefore;
    proto$2.isBetween = isBetween;
    proto$2.isSame = isSame;
    proto$2.isSameOrAfter = isSameOrAfter;
    proto$2.isSameOrBefore = isSameOrBefore;
    proto$2.isValid = isValid;
    proto$2.lang = lang;
    proto$2.locale = locale;
    proto$2.localeData = localeData;
    proto$2.max = prototypeMax;
    proto$2.min = prototypeMin;
    proto$2.parsingFlags = parsingFlags;
    proto$2.set = stringSet;
    proto$2.startOf = startOf;
    proto$2.subtract = subtract$1;
    proto$2.toArray = toArray;
    proto$2.toObject = toObject;
    proto$2.toDate = toDate;
    proto$2.toISOString = toISOString$1;
    proto$2.inspect = inspect;
    if (typeof Symbol !== "undefined" && Symbol.for != null) {
      proto$2[Symbol.for("nodejs.util.inspect.custom")] = function() {
        return "Moment<" + this.format() + ">";
      };
    }
    proto$2.toJSON = toJSON;
    proto$2.toString = toString;
    proto$2.unix = unix;
    proto$2.valueOf = valueOf$1;
    proto$2.creationData = creationData;
    proto$2.eraName = getEraName;
    proto$2.eraNarrow = getEraNarrow;
    proto$2.eraAbbr = getEraAbbr;
    proto$2.eraYear = getEraYear;
    proto$2.year = getSetYear;
    proto$2.isLeapYear = getIsLeapYear;
    proto$2.weekYear = getSetWeekYear;
    proto$2.isoWeekYear = getSetISOWeekYear;
    proto$2.quarter = proto$2.quarters = getSetQuarter;
    proto$2.month = getSetMonth;
    proto$2.daysInMonth = getDaysInMonth;
    proto$2.week = proto$2.weeks = getSetWeek;
    proto$2.isoWeek = proto$2.isoWeeks = getSetISOWeek;
    proto$2.weeksInYear = getWeeksInYear;
    proto$2.weeksInWeekYear = getWeeksInWeekYear;
    proto$2.isoWeeksInYear = getISOWeeksInYear;
    proto$2.isoWeeksInISOWeekYear = getISOWeeksInISOWeekYear;
    proto$2.date = getSetDayOfMonth;
    proto$2.day = proto$2.days = getSetDayOfWeek;
    proto$2.weekday = getSetLocaleDayOfWeek;
    proto$2.isoWeekday = getSetISODayOfWeek;
    proto$2.dayOfYear = getSetDayOfYear;
    proto$2.hour = proto$2.hours = getSetHour;
    proto$2.minute = proto$2.minutes = getSetMinute;
    proto$2.second = proto$2.seconds = getSetSecond;
    proto$2.millisecond = proto$2.milliseconds = getSetMillisecond;
    proto$2.utcOffset = getSetOffset;
    proto$2.utc = setOffsetToUTC;
    proto$2.local = setOffsetToLocal;
    proto$2.parseZone = setOffsetToParsedOffset;
    proto$2.hasAlignedHourOffset = hasAlignedHourOffset;
    proto$2.isDST = isDaylightSavingTime;
    proto$2.isLocal = isLocal;
    proto$2.isUtcOffset = isUtcOffset;
    proto$2.isUtc = isUtc;
    proto$2.isUTC = isUtc;
    proto$2.zoneAbbr = getZoneAbbr;
    proto$2.zoneName = getZoneName;
    proto$2.dates = deprecate("dates accessor is deprecated. Use date instead.", getSetDayOfMonth);
    proto$2.months = deprecate("months accessor is deprecated. Use month instead", getSetMonth);
    proto$2.years = deprecate("years accessor is deprecated. Use year instead", getSetYear);
    proto$2.zone = deprecate("moment().zone is deprecated, use moment().utcOffset instead. http://momentjs.com/guides/#/warnings/zone/", getSetZone);
    proto$2.isDSTShifted = deprecate("isDSTShifted is deprecated. See http://momentjs.com/guides/#/warnings/dst-shifted/ for more information", isDaylightSavingTimeShifted);
    function createUnix(input) {
      return createLocal(input * 1000);
    }
    function createInZone() {
      return createLocal.apply(null, arguments).parseZone();
    }
    function preParsePostFormat(string) {
      return string;
    }
    var proto$1 = Locale.prototype;
    proto$1.calendar = calendar$1;
    proto$1.longDateFormat = longDateFormat;
    proto$1.invalidDate = invalidDate;
    proto$1.ordinal = ordinal;
    proto$1.preparse = preParsePostFormat;
    proto$1.postformat = preParsePostFormat;
    proto$1.relativeTime = relativeTime$1;
    proto$1.pastFuture = pastFuture;
    proto$1.set = set;
    proto$1.eras = localeEras;
    proto$1.erasParse = localeErasParse;
    proto$1.erasConvertYear = localeErasConvertYear;
    proto$1.erasAbbrRegex = erasAbbrRegex;
    proto$1.erasNameRegex = erasNameRegex;
    proto$1.erasNarrowRegex = erasNarrowRegex;
    proto$1.months = localeMonths;
    proto$1.monthsShort = localeMonthsShort;
    proto$1.monthsParse = localeMonthsParse;
    proto$1.monthsRegex = monthsRegex;
    proto$1.monthsShortRegex = monthsShortRegex;
    proto$1.week = localeWeek;
    proto$1.firstDayOfYear = localeFirstDayOfYear;
    proto$1.firstDayOfWeek = localeFirstDayOfWeek;
    proto$1.weekdays = localeWeekdays;
    proto$1.weekdaysMin = localeWeekdaysMin;
    proto$1.weekdaysShort = localeWeekdaysShort;
    proto$1.weekdaysParse = localeWeekdaysParse;
    proto$1.weekdaysRegex = weekdaysRegex;
    proto$1.weekdaysShortRegex = weekdaysShortRegex;
    proto$1.weekdaysMinRegex = weekdaysMinRegex;
    proto$1.isPM = localeIsPM;
    proto$1.meridiem = localeMeridiem;
    function get$1(format2, index, field, setter) {
      var locale2 = getLocale(), utc = createUTC().set(setter, index);
      return locale2[field](utc, format2);
    }
    function listMonthsImpl(format2, index, field) {
      if (isNumber(format2)) {
        index = format2;
        format2 = undefined;
      }
      format2 = format2 || "";
      if (index != null) {
        return get$1(format2, index, field, "month");
      }
      var i, out = [];
      for (i = 0;i < 12; i++) {
        out[i] = get$1(format2, i, field, "month");
      }
      return out;
    }
    function listWeekdaysImpl(localeSorted, format2, index, field) {
      if (typeof localeSorted === "boolean") {
        if (isNumber(format2)) {
          index = format2;
          format2 = undefined;
        }
        format2 = format2 || "";
      } else {
        format2 = localeSorted;
        index = format2;
        localeSorted = false;
        if (isNumber(format2)) {
          index = format2;
          format2 = undefined;
        }
        format2 = format2 || "";
      }
      var locale2 = getLocale(), shift = localeSorted ? locale2._week.dow : 0, i, out = [];
      if (index != null) {
        return get$1(format2, (index + shift) % 7, field, "day");
      }
      for (i = 0;i < 7; i++) {
        out[i] = get$1(format2, (i + shift) % 7, field, "day");
      }
      return out;
    }
    function listMonths(format2, index) {
      return listMonthsImpl(format2, index, "months");
    }
    function listMonthsShort(format2, index) {
      return listMonthsImpl(format2, index, "monthsShort");
    }
    function listWeekdays(localeSorted, format2, index) {
      return listWeekdaysImpl(localeSorted, format2, index, "weekdays");
    }
    function listWeekdaysShort(localeSorted, format2, index) {
      return listWeekdaysImpl(localeSorted, format2, index, "weekdaysShort");
    }
    function listWeekdaysMin(localeSorted, format2, index) {
      return listWeekdaysImpl(localeSorted, format2, index, "weekdaysMin");
    }
    getSetGlobalLocale("en", {
      eras: [
        {
          since: "0001-01-01",
          until: Infinity,
          offset: 1,
          name: "Anno Domini",
          narrow: "AD",
          abbr: "AD"
        },
        {
          since: "0000-12-31",
          until: -Infinity,
          offset: 1,
          name: "Before Christ",
          narrow: "BC",
          abbr: "BC"
        }
      ],
      dayOfMonthOrdinalParse: /\d{1,2}(th|st|nd|rd)/,
      ordinal: function(number) {
        var b = number % 10, output = toInt(number % 100 / 10) === 1 ? "th" : b === 1 ? "st" : b === 2 ? "nd" : b === 3 ? "rd" : "th";
        return number + output;
      }
    });
    hooks.lang = deprecate("moment.lang is deprecated. Use moment.locale instead.", getSetGlobalLocale);
    hooks.langData = deprecate("moment.langData is deprecated. Use moment.localeData instead.", getLocale);
    var mathAbs = Math.abs;
    function abs$1() {
      var data = this._data;
      this._milliseconds = mathAbs(this._milliseconds);
      this._days = mathAbs(this._days);
      this._months = mathAbs(this._months);
      data.milliseconds = mathAbs(data.milliseconds);
      data.seconds = mathAbs(data.seconds);
      data.minutes = mathAbs(data.minutes);
      data.hours = mathAbs(data.hours);
      data.months = mathAbs(data.months);
      data.years = mathAbs(data.years);
      return this;
    }
    function addSubtract(duration, input, value, direction) {
      var other = createDuration(input, value);
      duration._milliseconds += direction * other._milliseconds;
      duration._days += direction * other._days;
      duration._months += direction * other._months;
      return duration._bubble();
    }
    function add(input, value) {
      return addSubtract(this, input, value, 1);
    }
    function subtract(input, value) {
      return addSubtract(this, input, value, -1);
    }
    function absCeil(number) {
      if (number < 0) {
        return Math.floor(number);
      } else {
        return Math.ceil(number);
      }
    }
    function bubble() {
      var milliseconds2 = this._milliseconds, days2 = this._days, months2 = this._months, data = this._data, seconds2, minutes2, hours2, years2, monthsFromDays;
      if (!(milliseconds2 >= 0 && days2 >= 0 && months2 >= 0 || milliseconds2 <= 0 && days2 <= 0 && months2 <= 0)) {
        milliseconds2 += absCeil(monthsToDays(months2) + days2) * 86400000;
        days2 = 0;
        months2 = 0;
      }
      data.milliseconds = milliseconds2 % 1000;
      seconds2 = absFloor(milliseconds2 / 1000);
      data.seconds = seconds2 % 60;
      minutes2 = absFloor(seconds2 / 60);
      data.minutes = minutes2 % 60;
      hours2 = absFloor(minutes2 / 60);
      data.hours = hours2 % 24;
      days2 += absFloor(hours2 / 24);
      monthsFromDays = absFloor(daysToMonths(days2));
      months2 += monthsFromDays;
      days2 -= absCeil(monthsToDays(monthsFromDays));
      years2 = absFloor(months2 / 12);
      months2 %= 12;
      data.days = days2;
      data.months = months2;
      data.years = years2;
      return this;
    }
    function daysToMonths(days2) {
      return days2 * 4800 / 146097;
    }
    function monthsToDays(months2) {
      return months2 * 146097 / 4800;
    }
    function as(units) {
      if (!this.isValid()) {
        return NaN;
      }
      var days2, months2, milliseconds2 = this._milliseconds;
      units = normalizeUnits(units);
      if (units === "month" || units === "quarter" || units === "year") {
        days2 = this._days + milliseconds2 / 86400000;
        months2 = this._months + daysToMonths(days2);
        switch (units) {
          case "month":
            return months2;
          case "quarter":
            return months2 / 3;
          case "year":
            return months2 / 12;
        }
      } else {
        days2 = this._days + Math.round(monthsToDays(this._months));
        switch (units) {
          case "week":
            return days2 / 7 + milliseconds2 / 604800000;
          case "day":
            return days2 + milliseconds2 / 86400000;
          case "hour":
            return days2 * 24 + milliseconds2 / 3600000;
          case "minute":
            return days2 * 1440 + milliseconds2 / 60000;
          case "second":
            return days2 * 86400 + milliseconds2 / 1000;
          case "millisecond":
            return Math.floor(days2 * 86400000) + milliseconds2;
          default:
            throw new Error("Unknown unit " + units);
        }
      }
    }
    function makeAs(alias) {
      return function() {
        return this.as(alias);
      };
    }
    var asMilliseconds = makeAs("ms"), asSeconds = makeAs("s"), asMinutes = makeAs("m"), asHours = makeAs("h"), asDays = makeAs("d"), asWeeks = makeAs("w"), asMonths = makeAs("M"), asQuarters = makeAs("Q"), asYears = makeAs("y"), valueOf = asMilliseconds;
    function clone() {
      return createDuration(this);
    }
    function get(units) {
      units = normalizeUnits(units);
      return this.isValid() ? this[units + "s"]() : NaN;
    }
    function makeGetter(name) {
      return function() {
        return this.isValid() ? this._data[name] : NaN;
      };
    }
    var milliseconds = makeGetter("milliseconds"), seconds = makeGetter("seconds"), minutes = makeGetter("minutes"), hours = makeGetter("hours"), days = makeGetter("days"), months = makeGetter("months"), years = makeGetter("years");
    function weeks() {
      return absFloor(this.days() / 7);
    }
    var round = Math.round, thresholds = {
      ss: 44,
      s: 45,
      m: 45,
      h: 22,
      d: 26,
      w: null,
      M: 11
    };
    function substituteTimeAgo(string, number, withoutSuffix, isFuture, locale2) {
      return relativeTimeWithoutPostformat.call(locale2, number || 1, !!withoutSuffix, string, isFuture);
    }
    function relativeTime(posNegDuration, withoutSuffix, thresholds2, locale2) {
      var duration = createDuration(posNegDuration).abs(), seconds2 = round(duration.as("s")), minutes2 = round(duration.as("m")), hours2 = round(duration.as("h")), days2 = round(duration.as("d")), months2 = round(duration.as("M")), weeks2 = round(duration.as("w")), years2 = round(duration.as("y")), a = seconds2 <= thresholds2.ss && ["s", seconds2] || seconds2 < thresholds2.s && ["ss", seconds2] || minutes2 <= 1 && ["m"] || minutes2 < thresholds2.m && ["mm", minutes2] || hours2 <= 1 && ["h"] || hours2 < thresholds2.h && ["hh", hours2] || days2 <= 1 && ["d"] || days2 < thresholds2.d && ["dd", days2];
      if (thresholds2.w != null) {
        a = a || weeks2 <= 1 && ["w"] || weeks2 < thresholds2.w && ["ww", weeks2];
      }
      a = a || months2 <= 1 && ["M"] || months2 < thresholds2.M && ["MM", months2] || years2 <= 1 && ["y"] || ["yy", years2];
      a[2] = withoutSuffix;
      a[3] = +posNegDuration > 0;
      a[4] = locale2;
      return substituteTimeAgo.apply(null, a);
    }
    function getSetRelativeTimeRounding(roundingFunction) {
      if (roundingFunction === undefined) {
        return round;
      }
      if (typeof roundingFunction === "function") {
        round = roundingFunction;
        return true;
      }
      return false;
    }
    function getSetRelativeTimeThreshold(threshold, limit) {
      if (thresholds[threshold] === undefined) {
        return false;
      }
      if (limit === undefined) {
        return thresholds[threshold];
      }
      thresholds[threshold] = limit;
      if (threshold === "s") {
        thresholds.ss = limit - 1;
      }
      return true;
    }
    function humanize(argWithSuffix, argThresholds) {
      if (!this.isValid()) {
        return this.localeData().invalidDate();
      }
      var withSuffix = false, th = thresholds, locale2, output;
      if (typeof argWithSuffix === "object") {
        argThresholds = argWithSuffix;
        argWithSuffix = false;
      }
      if (typeof argWithSuffix === "boolean") {
        withSuffix = argWithSuffix;
      }
      if (typeof argThresholds === "object") {
        th = extend(extend({}, thresholds), argThresholds || {});
        if (argThresholds.s != null && argThresholds.ss == null) {
          th.ss = argThresholds.s - 1;
        }
      }
      locale2 = this.localeData();
      output = relativeTime(this, !withSuffix, th, locale2);
      if (withSuffix) {
        output = pastFutureWithoutPostformat.call(locale2, +this, output);
      }
      return locale2.postformat(output);
    }
    var abs = Math.abs;
    function sign(x) {
      return (x > 0) - (x < 0) || +x;
    }
    function toISOString() {
      if (!this.isValid()) {
        return this.localeData().invalidDate();
      }
      var seconds2 = abs(this._milliseconds) / 1000, days2 = abs(this._days), months2 = abs(this._months), minutes2, hours2, years2, s, total = this.asSeconds(), totalSign, ymSign, daysSign, hmsSign;
      if (!total) {
        return "P0D";
      }
      minutes2 = absFloor(seconds2 / 60);
      hours2 = absFloor(minutes2 / 60);
      seconds2 %= 60;
      minutes2 %= 60;
      years2 = absFloor(months2 / 12);
      months2 %= 12;
      s = seconds2 ? seconds2.toFixed(3).replace(/\.?0+$/, "") : "";
      totalSign = total < 0 ? "-" : "";
      ymSign = sign(this._months) !== sign(total) ? "-" : "";
      daysSign = sign(this._days) !== sign(total) ? "-" : "";
      hmsSign = sign(this._milliseconds) !== sign(total) ? "-" : "";
      return totalSign + "P" + (years2 ? ymSign + years2 + "Y" : "") + (months2 ? ymSign + months2 + "M" : "") + (days2 ? daysSign + days2 + "D" : "") + (hours2 || minutes2 || seconds2 ? "T" : "") + (hours2 ? hmsSign + hours2 + "H" : "") + (minutes2 ? hmsSign + minutes2 + "M" : "") + (seconds2 ? hmsSign + s + "S" : "");
    }
    var proto = Duration.prototype;
    proto.isValid = isValid$1;
    proto.abs = abs$1;
    proto.add = add;
    proto.subtract = subtract;
    proto.as = as;
    proto.asMilliseconds = asMilliseconds;
    proto.asSeconds = asSeconds;
    proto.asMinutes = asMinutes;
    proto.asHours = asHours;
    proto.asDays = asDays;
    proto.asWeeks = asWeeks;
    proto.asMonths = asMonths;
    proto.asQuarters = asQuarters;
    proto.asYears = asYears;
    proto.valueOf = valueOf;
    proto._bubble = bubble;
    proto.clone = clone;
    proto.get = get;
    proto.milliseconds = milliseconds;
    proto.seconds = seconds;
    proto.minutes = minutes;
    proto.hours = hours;
    proto.days = days;
    proto.weeks = weeks;
    proto.months = months;
    proto.years = years;
    proto.humanize = humanize;
    proto.toISOString = toISOString;
    proto.toString = toISOString;
    proto.toJSON = toISOString;
    proto.locale = locale;
    proto.localeData = localeData;
    proto.toIsoString = deprecate("toIsoString() is deprecated. Please use toISOString() instead (notice the capitals)", toISOString);
    proto.lang = lang;
    addFormatToken("X", 0, 0, "unix");
    addFormatToken("x", 0, 0, "valueOf");
    addRegexToken("x", matchSigned);
    addRegexToken("X", matchTimestamp);
    addParseToken("X", function(input, array, config) {
      config._d = new Date(parseFloat(input) * 1000);
    });
    addParseToken("x", function(input, array, config) {
      config._d = new Date(toInt(input));
    });
    //! moment.js
    hooks.version = "2.31.0";
    setHookCallback(createLocal);
    hooks.fn = proto$2;
    hooks.min = min;
    hooks.max = max;
    hooks.now = now;
    hooks.utc = createUTC;
    hooks.unix = createUnix;
    hooks.months = listMonths;
    hooks.isDate = isDate;
    hooks.locale = getSetGlobalLocale;
    hooks.invalid = createInvalid$1;
    hooks.duration = createDuration;
    hooks.isMoment = isMoment;
    hooks.weekdays = listWeekdays;
    hooks.parseZone = createInZone;
    hooks.localeData = getLocale;
    hooks.isDuration = isDuration;
    hooks.monthsShort = listMonthsShort;
    hooks.weekdaysMin = listWeekdaysMin;
    hooks.defineLocale = defineLocale;
    hooks.updateLocale = updateLocale;
    hooks.locales = listLocales;
    hooks.weekdaysShort = listWeekdaysShort;
    hooks.normalizeUnits = normalizeUnits;
    hooks.relativeTimeRounding = getSetRelativeTimeRounding;
    hooks.relativeTimeThreshold = getSetRelativeTimeThreshold;
    hooks.calendarFormat = getCalendarFormat;
    hooks.prototype = proto$2;
    hooks.HTML5_FMT = {
      DATETIME_LOCAL: "YYYY-MM-DDTHH:mm",
      DATETIME_LOCAL_SECONDS: "YYYY-MM-DDTHH:mm:ss",
      DATETIME_LOCAL_MS: "YYYY-MM-DDTHH:mm:ss.SSS",
      DATE: "YYYY-MM-DD",
      TIME: "HH:mm",
      TIME_SECONDS: "HH:mm:ss",
      TIME_MS: "HH:mm:ss.SSS",
      WEEK: "GGGG-[W]WW",
      MONTH: "YYYY-MM"
    };
    return hooks;
  });
});

// node_modules/file-stream-rotator/FileStreamRotator.js
var require_FileStreamRotator = __commonJS((exports, module) => {
  /*!
   * FileStreamRotator
   * Copyright(c) 2012-2017 Holiday Extras.
   * Copyright(c) 2017 Roger C.
   * MIT Licensed
   */
  var fs6 = __require("fs");
  var path7 = __require("path");
  var moment = require_moment();
  var crypto2 = __require("crypto");
  var EventEmitter = __require("events");
  var FileStreamRotator = {};
  module.exports = FileStreamRotator;
  var staticFrequency = ["daily", "test", "m", "h", "custom"];
  var DATE_FORMAT = "YYYYMMDDHHmm";
  var _checkNumAndType = function(type, num) {
    if (typeof num == "number") {
      switch (type) {
        case "m":
          if (num < 0 || num > 60) {
            return false;
          }
          break;
        case "h":
          if (num < 0 || num > 24) {
            return false;
          }
          break;
      }
      return { type, digit: num };
    }
  };
  var _checkDailyAndTest = function(freqType) {
    switch (freqType) {
      case "custom":
      case "daily":
        return { type: freqType, digit: undefined };
        break;
      case "test":
        return { type: freqType, digit: 0 };
    }
    return false;
  };
  FileStreamRotator.getFrequency = function(frequency) {
    var _f = frequency.toLowerCase().match(/^(\d+)([mh])$/);
    if (_f) {
      return _checkNumAndType(_f[2], parseInt(_f[1]));
    }
    var dailyOrTest = _checkDailyAndTest(frequency);
    if (dailyOrTest) {
      return dailyOrTest;
    }
    return false;
  };
  FileStreamRotator.parseFileSize = function(size) {
    if (size && typeof size == "string") {
      var _s = size.toLowerCase().match(/^((?:0\.)?\d+)([kmg])$/);
      if (_s) {
        switch (_s[2]) {
          case "k":
            return _s[1] * 1024;
          case "m":
            return _s[1] * 1024 * 1024;
          case "g":
            return _s[1] * 1024 * 1024 * 1024;
        }
      }
    }
    return null;
  };
  FileStreamRotator.getDate = function(format, date_format, utc) {
    date_format = date_format || DATE_FORMAT;
    let currentMoment = utc ? moment.utc() : moment().local();
    if (format && staticFrequency.indexOf(format.type) !== -1) {
      switch (format.type) {
        case "m":
          var minute = Math.floor(currentMoment.minutes() / format.digit) * format.digit;
          return currentMoment.minutes(minute).format(date_format);
          break;
        case "h":
          var hour = Math.floor(currentMoment.hour() / format.digit) * format.digit;
          return currentMoment.hour(hour).format(date_format);
          break;
        case "daily":
        case "custom":
        case "test":
          return currentMoment.format(date_format);
      }
    }
    return currentMoment.format(date_format);
  };
  FileStreamRotator.setAuditLog = function(max_logs, audit_file, log_file) {
    var _rtn = null;
    if (max_logs) {
      var use_days = max_logs.toString().substr(-1);
      var _num = max_logs.toString().match(/^(\d+)/);
      if (Number(_num[1]) > 0) {
        var baseLog = path7.dirname(log_file.replace(/%DATE%.+/, "_filename"));
        try {
          if (audit_file) {
            var full_path = path7.resolve(audit_file);
            _rtn = JSON.parse(fs6.readFileSync(full_path, { encoding: "utf-8" }));
          } else {
            var full_path = path7.resolve(baseLog + "/" + ".audit.json");
            _rtn = JSON.parse(fs6.readFileSync(full_path, { encoding: "utf-8" }));
          }
        } catch (e) {
          if (e.code !== "ENOENT") {
            return null;
          }
          _rtn = {
            keep: {
              days: false,
              amount: Number(_num[1])
            },
            auditLog: audit_file || baseLog + "/" + ".audit.json",
            files: []
          };
        }
        _rtn.keep = {
          days: use_days === "d",
          amount: Number(_num[1])
        };
      }
    }
    return _rtn;
  };
  FileStreamRotator.writeAuditLog = function(audit, verbose) {
    try {
      mkDirForFile(audit.auditLog);
      fs6.writeFileSync(audit.auditLog, JSON.stringify(audit, null, 4));
    } catch (e) {
      if (verbose) {
        console.error(new Date, "[FileStreamRotator] Failed to store log audit at:", audit.auditLog, "Error:", e);
      }
    }
  };
  function removeFile(file, verbose) {
    if (file.hash === crypto2.createHash(file.hashType).update(file.name + "LOG_FILE" + file.date).digest("hex")) {
      try {
        if (fs6.existsSync(file.name)) {
          fs6.unlinkSync(file.name);
        }
      } catch (e) {
        if (verbose) {
          console.error(new Date, "[FileStreamRotator] Could not remove old log file: ", file.name);
        }
      }
    }
  }
  function createCurrentSymLink(logfile, name, verbose) {
    let symLinkName = name || "current.log";
    let logPath = path7.dirname(logfile);
    let logfileName = path7.basename(logfile);
    let current = logPath + "/" + symLinkName;
    try {
      let stats = fs6.lstatSync(current);
      if (stats.isSymbolicLink()) {
        fs6.unlinkSync(current);
        fs6.symlinkSync(logfileName, current);
      }
    } catch (err) {
      if (err && err.code == "ENOENT") {
        try {
          fs6.symlinkSync(logfileName, current);
        } catch (e) {
          if (verbose) {
            console.error(new Date, "[FileStreamRotator] Could not create symlink file: ", current, " -> ", logfileName);
          }
        }
      }
    }
  }
  function createLogWatcher(logfile, verbose, cb) {
    if (!logfile)
      return null;
    try {
      let stats = fs6.lstatSync(logfile);
      return fs6.watch(logfile, function(event, filename) {
        if (event == "rename") {
          try {
            let stats2 = fs6.lstatSync(logfile);
          } catch (err) {
            cb(err, logfile);
          }
        }
      });
    } catch (err) {
      if (verbose) {
        console.log(new Date, "[FileStreamRotator] Could not add watcher for " + logfile);
      }
    }
  }
  FileStreamRotator.addLogToAudit = function(logfile, audit, stream, verbose) {
    if (audit && audit.files) {
      var index = audit.files.findIndex(function(file) {
        return file.name === logfile;
      });
      if (index !== -1) {
        return audit;
      }
      var time = Date.now();
      audit.files.push({
        date: time,
        name: logfile,
        hash: crypto2.createHash(audit.hashType).update(logfile + "LOG_FILE" + time).digest("hex")
      });
      if (audit.keep.days) {
        var oldestDate = moment().subtract(audit.keep.amount, "days").valueOf();
        var recentFiles = audit.files.filter(function(file) {
          if (file.date > oldestDate) {
            return true;
          }
          file.hashType = audit.hashType;
          removeFile(file, verbose);
          stream.emit("logRemoved", file);
          return false;
        });
        audit.files = recentFiles;
      } else {
        var filesToKeep = audit.files.splice(-audit.keep.amount);
        if (audit.files.length > 0) {
          audit.files.filter(function(file) {
            file.hashType = audit.hashType;
            removeFile(file, verbose);
            stream.emit("logRemoved", file);
            return false;
          });
        }
        audit.files = filesToKeep;
      }
      FileStreamRotator.writeAuditLog(audit, verbose);
    }
    return audit;
  };
  FileStreamRotator.getStream = function(options) {
    var frequencyMetaData = null;
    var curDate = null;
    var self2 = this;
    if (!options.filename) {
      console.error(new Date, "[FileStreamRotator] No filename supplied. Defaulting to STDOUT");
      return process.stdout;
    }
    if (options.frequency) {
      frequencyMetaData = self2.getFrequency(options.frequency);
    }
    let auditLog = self2.setAuditLog(options.max_logs, options.audit_file, options.filename);
    if (auditLog != null) {
      auditLog.hashType = options.audit_hash_type !== undefined ? options.audit_hash_type : "md5";
    }
    self2.verbose = options.verbose !== undefined ? options.verbose : true;
    var fileSize = null;
    var fileCount = 0;
    var curSize = 0;
    if (options.size) {
      fileSize = FileStreamRotator.parseFileSize(options.size);
    }
    var dateFormat = options.date_format || DATE_FORMAT;
    if (frequencyMetaData && frequencyMetaData.type == "daily") {
      if (!options.date_format) {
        dateFormat = "YYYY-MM-DD";
      }
      if (moment().format(dateFormat) != moment().endOf("day").format(dateFormat) || moment().format(dateFormat) == moment().add(1, "day").format(dateFormat)) {
        if (self2.verbose) {
          console.log(new Date, "[FileStreamRotator] Changing type to custom as date format changes more often than once a day or not every day");
        }
        frequencyMetaData.type = "custom";
      }
    }
    if (frequencyMetaData) {
      curDate = options.frequency ? self2.getDate(frequencyMetaData, dateFormat, options.utc) : "";
    }
    options.create_symlink = options.create_symlink || false;
    options.extension = options.extension || "";
    var filename = options.filename;
    var oldFile = null;
    var logfile = filename + (curDate ? "." + curDate : "");
    if (filename.match(/%DATE%/)) {
      logfile = filename.replace(/%DATE%/g, curDate ? curDate : self2.getDate(null, dateFormat, options.utc));
    }
    if (fileSize) {
      var lastLogFile = null;
      var t_log = logfile;
      var f = null;
      if (auditLog && auditLog.files && auditLog.files instanceof Array && auditLog.files.length > 0) {
        var lastEntry = auditLog.files[auditLog.files.length - 1].name;
        if (lastEntry.match(t_log)) {
          var lastCount = lastEntry.match(t_log + "\\.(\\d+)");
          if (lastCount) {
            t_log = lastEntry;
            fileCount = lastCount[1];
          }
        }
      }
      if (fileCount == 0 && t_log == logfile) {
        t_log += options.extension;
      }
      while (f = fs6.existsSync(t_log)) {
        lastLogFile = t_log;
        fileCount++;
        t_log = logfile + "." + fileCount + options.extension;
      }
      if (lastLogFile) {
        var lastLogFileStats = fs6.statSync(lastLogFile);
        if (lastLogFileStats.size < fileSize) {
          t_log = lastLogFile;
          fileCount--;
          curSize = lastLogFileStats.size;
        }
      }
      logfile = t_log;
    } else {
      logfile += options.extension;
    }
    if (self2.verbose) {
      console.log(new Date, "[FileStreamRotator] Logging to: ", logfile);
    }
    mkDirForFile(logfile);
    var file_options = options.file_options || { flags: "a" };
    var rotateStream = fs6.createWriteStream(logfile, file_options);
    if (curDate && frequencyMetaData && staticFrequency.indexOf(frequencyMetaData.type) > -1 || fileSize > 0) {
      if (self2.verbose) {
        console.log(new Date, "[FileStreamRotator] Rotating file: ", frequencyMetaData ? frequencyMetaData.type : "", fileSize ? "size: " + fileSize : "");
      }
      var stream = new EventEmitter;
      stream.auditLog = auditLog;
      stream.end = function() {
        rotateStream.end.apply(rotateStream, arguments);
      };
      BubbleEvents(rotateStream, stream);
      stream.on("close", function() {
        if (logWatcher) {
          logWatcher.close();
        }
      });
      stream.on("new", function(newLog) {
        stream.auditLog = self2.addLogToAudit(newLog, stream.auditLog, stream, self2.verbose);
        if (options.create_symlink) {
          createCurrentSymLink(newLog, options.symlink_name, self2.verbose);
        }
        if (options.watch_log) {
          stream.emit("addWatcher", newLog);
        }
      });
      var logWatcher;
      stream.on("addWatcher", function(newLog) {
        if (logWatcher) {
          logWatcher.close();
        }
        if (!options.watch_log) {
          return;
        }
        logWatcher = createLogWatcher(newLog, self2.verbose, function(err, newLog2) {
          stream.emit("createLog", newLog2);
        });
      });
      stream.on("createLog", function(file) {
        try {
          let stats = fs6.lstatSync(file);
        } catch (err) {
          if (rotateStream && rotateStream.end == "function") {
            rotateStream.end();
          }
          rotateStream = fs6.createWriteStream(file, file_options);
          stream.emit("new", file);
          BubbleEvents(rotateStream, stream);
        }
      });
      stream.write = function(str, encoding) {
        var newDate = frequencyMetaData ? this.getDate(frequencyMetaData, dateFormat, options.utc) : curDate;
        if (newDate != curDate || fileSize && curSize > fileSize) {
          var newLogfile = filename + (curDate && frequencyMetaData ? "." + newDate : "");
          if (filename.match(/%DATE%/) && curDate) {
            newLogfile = filename.replace(/%DATE%/g, newDate);
          }
          if (fileSize && curSize > fileSize) {
            fileCount++;
            newLogfile += "." + fileCount + options.extension;
          } else {
            fileCount = 0;
            newLogfile += options.extension;
          }
          curSize = 0;
          if (self2.verbose) {
            console.log(new Date, __require("util").format("[FileStreamRotator] Changing logs from %s to %s", logfile, newLogfile));
          }
          curDate = newDate;
          oldFile = logfile;
          logfile = newLogfile;
          if (options.end_stream === true) {
            rotateStream.end();
          } else {
            rotateStream.destroy();
          }
          mkDirForFile(logfile);
          rotateStream = fs6.createWriteStream(newLogfile, file_options);
          stream.emit("new", newLogfile);
          stream.emit("rotate", oldFile, newLogfile);
          BubbleEvents(rotateStream, stream);
        }
        rotateStream.write(str, encoding);
        curSize += Buffer.byteLength(str, encoding);
      }.bind(this);
      process.nextTick(function() {
        stream.emit("new", logfile);
      });
      stream.emit("new", logfile);
      return stream;
    } else {
      if (self2.verbose) {
        console.log(new Date, "[FileStreamRotator] File won't be rotated: ", options.frequency, options.size);
      }
      process.nextTick(function() {
        rotateStream.emit("new", logfile);
      });
      return rotateStream;
    }
  };
  var mkDirForFile = function(pathWithFile) {
    var _path = path7.dirname(pathWithFile);
    _path.split(path7.sep).reduce(function(fullPath, folder) {
      fullPath += folder + path7.sep;
      if (!fs6.existsSync(fullPath)) {
        try {
          fs6.mkdirSync(fullPath);
        } catch (e) {
          if (e.code !== "EEXIST") {
            throw e;
          }
        }
      }
      return fullPath;
    }, "");
  };
  var BubbleEvents = function BubbleEvents2(emitter, proxy) {
    emitter.on("close", function() {
      proxy.emit("close");
    });
    emitter.on("finish", function() {
      proxy.emit("finish");
    });
    emitter.on("error", function(err) {
      proxy.emit("error", err);
    });
    emitter.on("open", function(fd) {
      proxy.emit("open", fd);
    });
  };
});

// node_modules/winston-daily-rotate-file/daily-rotate-file.js
var require_daily_rotate_file = __commonJS((exports, module) => {
  var fs6 = __require("fs");
  var os4 = __require("os");
  var path7 = __require("path");
  var util = __require("util");
  var zlib = __require("zlib");
  var hash = require_object_hash();
  var MESSAGE = require_triple_beam().MESSAGE;
  var PassThrough = __require("stream").PassThrough;
  var Transport = require_winston_transport();
  var loggerDefaults = {
    json: false,
    colorize: false,
    eol: os4.EOL,
    logstash: null,
    prettyPrint: false,
    label: null,
    stringify: false,
    depth: null,
    showLevel: true,
    timestamp: () => {
      return new Date().toISOString();
    }
  };
  var DailyRotateFile = function(options) {
    options = options || {};
    Transport.call(this, options);
    function throwIf(target) {
      Array.prototype.slice.call(arguments, 1).forEach((name) => {
        if (options[name]) {
          throw new Error("Cannot set " + name + " and " + target + " together");
        }
      });
    }
    function getMaxSize(size) {
      if (size && typeof size === "string") {
        if (size.toLowerCase().match(/^((?:0\.)?\d+)([kmg])$/)) {
          return size;
        }
      } else if (size && Number.isInteger(size)) {
        const sizeK = Math.round(size / 1024);
        return sizeK === 0 ? "1k" : sizeK + "k";
      }
      return null;
    }
    function isValidFileName(filename) {
      return !/["<>|:*?\\/\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f]/g.test(filename);
    }
    function isValidDirName(dirname2) {
      return !/["<>|\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f]/g.test(dirname2);
    }
    this.options = Object.assign({}, loggerDefaults, options);
    if (options.stream) {
      throwIf("stream", "filename", "maxsize");
      this.logStream = new PassThrough;
      this.logStream.pipe(options.stream);
    } else {
      this.filename = options.filename ? path7.basename(options.filename) : "winston.log";
      this.dirname = options.dirname || path7.dirname(options.filename);
      if (!isValidFileName(this.filename) || !isValidDirName(this.dirname)) {
        throw new Error("Your path or filename contain an invalid character.");
      }
      this.logStream = require_FileStreamRotator().getStream({
        filename: path7.join(this.dirname, this.filename),
        frequency: options.frequency ? options.frequency : "custom",
        date_format: options.datePattern ? options.datePattern : "YYYY-MM-DD",
        verbose: false,
        size: getMaxSize(options.maxSize),
        max_logs: options.maxFiles,
        end_stream: true,
        audit_file: options.auditFile ? options.auditFile : path7.join(this.dirname, "." + hash(options) + "-audit.json"),
        file_options: options.options ? options.options : { flags: "a" },
        utc: options.utc ? options.utc : false,
        extension: options.extension ? options.extension : "",
        create_symlink: options.createSymlink ? options.createSymlink : false,
        symlink_name: options.symlinkName ? options.symlinkName : "current.log",
        watch_log: options.watchLog ? options.watchLog : false,
        audit_hash_type: options.auditHashType ? options.auditHashType : "sha256"
      });
      this.logStream.on("new", (newFile) => {
        this.emit("new", newFile);
      });
      this.logStream.on("rotate", (oldFile, newFile) => {
        this.emit("rotate", oldFile, newFile);
      });
      this.logStream.on("logRemoved", (params) => {
        if (options.zippedArchive) {
          const gzName = params.name + ".gz";
          try {
            fs6.unlinkSync(gzName);
          } catch (err) {
            if (err.code !== "ENOENT") {
              err.message = `Error occurred while removing ${gzName}: ${err.message}`;
              this.emit("error", err);
              return;
            }
          }
          this.emit("logRemoved", gzName);
          return;
        }
        this.emit("logRemoved", params.name);
      });
      if (options.zippedArchive) {
        this.logStream.on("rotate", (oldFile) => {
          try {
            if (!fs6.existsSync(oldFile)) {
              return;
            }
          } catch (err) {
            err.message = `Error occurred while checking existence of ${oldFile}: ${err.message}`;
            this.emit("error", err);
            return;
          }
          try {
            if (fs6.existsSync(`${oldFile}.gz`)) {
              return;
            }
          } catch (err) {
            err.message = `Error occurred while checking existence of ${oldFile}.gz: ${err.message}`;
            this.emit("error", err);
            return;
          }
          const gzip = zlib.createGzip();
          const inp = fs6.createReadStream(oldFile);
          inp.on("error", (err) => {
            err.message = `Error occurred while reading ${oldFile}: ${err.message}`;
            this.emit("error", err);
          });
          const out = fs6.createWriteStream(oldFile + ".gz");
          out.on("error", (err) => {
            err.message = `Error occurred while writing ${oldFile}.gz: ${err.message}`;
            this.emit("error", err);
          });
          inp.pipe(gzip).pipe(out).on("finish", () => {
            try {
              fs6.unlinkSync(oldFile);
            } catch (err) {
              if (err.code !== "ENOENT") {
                err.message = `Error occurred while removing ${oldFile}: ${err.message}`;
                this.emit("error", err);
                return;
              }
            }
            this.emit("archive", oldFile + ".gz");
          });
        });
      }
      if (options.watchLog) {
        this.logStream.on("addWatcher", (newFile) => {
          this.emit("addWatcher", newFile);
        });
      }
    }
  };
  module.exports = DailyRotateFile;
  util.inherits(DailyRotateFile, Transport);
  DailyRotateFile.prototype.name = "dailyRotateFile";
  var noop = function() {};
  DailyRotateFile.prototype.log = function(info, callback) {
    callback = callback || noop;
    this.logStream.write(info[MESSAGE] + this.options.eol);
    this.emit("logged", info);
    callback(null, true);
  };
  DailyRotateFile.prototype.close = function() {
    if (this.logStream) {
      this.logStream.end(() => {
        this.emit("finish");
      });
    }
  };
  DailyRotateFile.prototype.query = function(options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (!this.options.json) {
      throw new Error("query() may not be used without the json option being set to true");
    }
    if (!this.filename) {
      throw new Error("query() may not be used when initializing with a stream");
    }
    let results = [];
    options = options || {};
    options.rows = options.rows || options.limit || 10;
    options.start = options.start || 0;
    options.until = options.until || new Date;
    if (typeof options.until !== "object") {
      options.until = new Date(options.until);
    }
    options.from = options.from || options.until - 24 * 60 * 60 * 1000;
    if (typeof options.from !== "object") {
      options.from = new Date(options.from);
    }
    options.order = options.order || "desc";
    const logFiles = (() => {
      const fileRegex = new RegExp(this.filename.replace("%DATE%", ".*"), "i");
      return fs6.readdirSync(this.dirname).filter((file) => path7.basename(file).match(fileRegex));
    })();
    if (logFiles.length === 0 && callback) {
      callback(null, results);
    }
    const processLogFile = (file) => {
      if (!file) {
        return;
      }
      const logFile = path7.join(this.dirname, file);
      let buff = "";
      let stream;
      if (file.endsWith(".gz")) {
        stream = new PassThrough;
        const inp = fs6.createReadStream(logFile);
        inp.on("error", (err) => {
          err.message = `Error occurred while reading ${logFile}: ${err.message}`;
          stream.emit("error", err);
        });
        inp.pipe(zlib.createGunzip()).pipe(stream);
      } else {
        stream = fs6.createReadStream(logFile, {
          encoding: "utf8"
        });
      }
      stream.on("error", (err) => {
        if (stream.readable) {
          stream.destroy();
        }
        if (!callback) {
          return;
        }
        return err.code === "ENOENT" ? callback(null, results) : callback(err);
      });
      stream.on("data", (data) => {
        data = (buff + data).split(/\n+/);
        const l = data.length - 1;
        for (let i = 0;i < l; i++) {
          add(data[i]);
        }
        buff = data[l];
      });
      stream.on("end", () => {
        if (buff) {
          add(buff, true);
        }
        if (logFiles.length) {
          processLogFile(logFiles.shift());
        } else if (callback) {
          results.sort((a, b) => {
            const d1 = new Date(a.timestamp).getTime();
            const d2 = new Date(b.timestamp).getTime();
            return d1 > d2 ? 1 : d1 < d2 ? -1 : 0;
          });
          if (options.order === "desc") {
            results = results.reverse();
          }
          const start = options.start || 0;
          const limit = options.limit || results.length;
          results = results.slice(start, start + limit);
          if (options.fields) {
            results = results.map((log) => {
              const obj = {};
              options.fields.forEach((key) => {
                obj[key] = log[key];
              });
              return obj;
            });
          }
          callback(null, results);
        }
      });
      function add(buff2, attempt) {
        try {
          const log = JSON.parse(buff2);
          if (!log || typeof log !== "object") {
            return;
          }
          const time = new Date(log.timestamp);
          if (options.from && time < options.from || options.until && time > options.until || options.level && options.level !== log.level) {
            return;
          }
          results.push(log);
        } catch (e) {
          if (!attempt) {
            stream.emit("error", e);
          }
        }
      }
    };
    processLogFile(logFiles.shift());
  };
});

// node_modules/winston-daily-rotate-file/index.js
var require_winston_daily_rotate_file = __commonJS((exports, module) => {
  var winston = require_winston();
  var DailyRotateFile = require_daily_rotate_file();
  winston.transports.DailyRotateFile = DailyRotateFile;
  module.exports = DailyRotateFile;
});

// node_modules/@gajae-code/coding-agent/src/utils/herdr-pane.ts
import * as crypto2 from "crypto";
import * as fs11 from "fs";
import * as os6 from "os";
import * as path10 from "path";
// node_modules/@gajae-code/utils/src/broken-pipe.ts
import * as fs from "fs";
var KNOWN_SINK_PEER_CLOSED_CODES = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);
var PROCESS_STDOUT_PEER_CLOSED_CODES = new Set(["EIO", "EPIPE", "EBADF"]);
function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}
function readErrorProperty(error, property) {
  try {
    return { available: true, value: Reflect.get(error, property) };
  } catch {
    return { available: false, value: undefined };
  }
}
function isUsableFileDescriptor(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function fileIdentity(fd) {
  try {
    const stat = fs.fstatSync(fd);
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return;
  }
}
function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function createProcessStdoutEpipeClassifier() {
  const directProcessStdoutWriteErrors = new WeakSet;
  const initialStdoutIdentity = isUsableFileDescriptor(process.stdout.fd) ? fileIdentity(process.stdout.fd) : undefined;
  const hasCurrentStdoutIdentity = (fd) => {
    if (!initialStdoutIdentity)
      return false;
    let stdoutFd;
    try {
      stdoutFd = process.stdout.fd;
    } catch {
      return false;
    }
    if (!isUsableFileDescriptor(stdoutFd))
      return false;
    const currentStdoutIdentity = fileIdentity(stdoutFd);
    const errorFdIdentity = fileIdentity(fd);
    if (!currentStdoutIdentity || !errorFdIdentity)
      return false;
    if (!sameFileIdentity(currentStdoutIdentity, initialStdoutIdentity))
      return false;
    return fd === stdoutFd || sameFileIdentity(errorFdIdentity, currentStdoutIdentity);
  };
  return {
    markDirectProcessStdoutWriteError(error) {
      if (isObjectLike(error))
        directProcessStdoutWriteErrors.add(error);
    },
    isAttributableProcessStdoutEpipe(error) {
      if (!isObjectLike(error))
        return false;
      const code = readErrorProperty(error, "code");
      if (!code.available || typeof code.value !== "string" || !PROCESS_STDOUT_PEER_CLOSED_CODES.has(code.value))
        return false;
      if (directProcessStdoutWriteErrors.has(error))
        return true;
      const syscall = readErrorProperty(error, "syscall");
      if (!syscall.available || syscall.value !== "write")
        return false;
      const fd = readErrorProperty(error, "fd");
      if (!fd.available || !isUsableFileDescriptor(fd.value))
        return false;
      return hasCurrentStdoutIdentity(fd.value);
    }
  };
}
var BROKEN_PIPE_EXIT_CODE = 141;
// node_modules/@gajae-code/utils/src/crash-fingerprint.ts
import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";

// node_modules/@gajae-code/utils/src/crash-redaction.ts
function redactCrashSecrets(text) {
  let redacted = text;
  redacted = redacted.replace(/\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "\xABredacted-auth\xBB");
  redacted = redacted.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "\xABredacted-jwt\xBB");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "\xABredacted-api-key\xBB");
  redacted = redacted.replace(/\bgh[opsur]_[A-Za-z0-9]{16,}\b/g, "\xABredacted-github-token\xBB");
  redacted = redacted.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "\xABredacted-github-token\xBB");
  redacted = redacted.replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, "\xABredacted-slack-token\xBB");
  redacted = redacted.replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, "\xABredacted-npm-token\xBB");
  redacted = redacted.replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/g, "\xABredacted-gitlab-token\xBB");
  redacted = redacted.replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "\xABredacted-api-key\xBB");
  redacted = redacted.replace(/\bhf_[A-Za-z0-9]{20,}\b/g, "\xABredacted-api-key\xBB");
  redacted = redacted.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "\xABredacted-private-key\xBB");
  redacted = redacted.replace(/(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g, "\xABredacted-google-api-key\xBB");
  redacted = redacted.replace(/(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]{0,15}:\/\/)[^/\s:@]{1,256}:[^/\s@]{1,256}@/gi, "$1\xABredacted-url-credential\xBB@");
  redacted = redacted.replace(/\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, "\xABredacted-aws-key\xBB");
  redacted = redacted.replace(/(?<![A-Za-z0-9_])(["']?(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|client[_-]?secret|secret[_-]?key|secret[_-]?access[_-]?key|password|passwd|authorization)["']?\s*[=:]\s*["']?)[^\s"',;}\]]{8,}/gi, "$1\xABredacted\xBB");
  return redacted;
}

// node_modules/@gajae-code/utils/src/crash-fingerprint.ts
var CRASH_FINGERPRINT_VERSION = 1;
var CRASH_FINGERPRINT_HEX_LENGTH = 32;
var CRASH_RECORD_MARKER = "gjc-crash-record.v1";
var NO_APP_FRAME = "<no-app-frame>";
var MESSAGE_CLASS_MAX_BYTES = 512;
var FRAME_MAX_BYTES = 256;
var MAX_FRAMES = 3;
function defaultInstallRoot() {
  return path.resolve(import.meta.dir, "..", "..", "..");
}
function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes)
    return text;
  const bytes = Buffer.from(text, "utf8");
  let end = maxBytes;
  while (end > 0 && (bytes[end - 1] & 192) === 128)
    end--;
  if (end > 0 && bytes[end - 1] >= 192)
    end--;
  return bytes.subarray(0, end).toString("utf8");
}
var UUID_PATTERN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
var HEX_RUN_PATTERN = /\b[0-9a-fA-F]{8,}\b/g;
var DIGIT_RUN_PATTERN = /\d{4,}/g;
var PATH_PATTERN = /\\\\[^\s"'`,;)\]]+|\b[A-Za-z]:\\[^\s"'`,;)\]]*|\/\$bunfs\/[^\s"'`,;)\]]*|(?<![\w.~])\/[^\s"'`,;)\]]*/g;
function normalizeSeparators(value) {
  return value.replace(/\\/g, "/");
}
function replaceAbsolutePaths(text, homeDir = os.homedir()) {
  const normalizedHome = normalizeSeparators(homeDir).replace(/\/+$/, "");
  return text.replace(PATH_PATTERN, (match) => {
    if (match === "/")
      return match;
    const normalized = normalizeSeparators(match);
    if (normalizedHome.length > 0 && (normalized === normalizedHome || normalized.startsWith(`${normalizedHome}/`)))
      return "<home>";
    return "<path>";
  });
}
function normalizeCrashMessage(message, options = {}) {
  const homeDir = options.homeDir ?? os.homedir();
  let normalized = redactCrashSecrets(message);
  normalized = replaceAbsolutePaths(normalized, homeDir);
  normalized = normalized.replace(UUID_PATTERN, "<uuid>");
  normalized = normalized.replace(HEX_RUN_PATTERN, (match) => /[a-fA-F]/.test(match) ? "<hex>" : "<num>");
  normalized = normalized.replace(DIGIT_RUN_PATTERN, "<num>");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return truncateUtf8(normalized, MESSAGE_CLASS_MAX_BYTES);
}
function parseStackFrame(line) {
  const trimmed = line.trim();
  const atMatch = /^at\s+(.*)$/.exec(trimmed);
  if (!atMatch)
    return;
  const rest = atMatch[1] ?? "";
  const parenIndex = rest.lastIndexOf(" (");
  let functionName = "<anonymous>";
  let location = rest;
  if (parenIndex >= 0 && rest.endsWith(")")) {
    functionName = rest.slice(0, parenIndex).trim();
    location = rest.slice(parenIndex + 2, -1).trim();
  }
  if (!location)
    return;
  return { functionName, location };
}
function stripLocation(location) {
  let value = location;
  if (value.startsWith("file://"))
    value = Bun.fileURLToPath(value);
  value = value.replace(/:\d+(?::\d+)?$/, "");
  return value;
}
function normalizeFunctionName(name) {
  let value = name.replace(/^(?:async|new)\s+/, "").trim();
  value = value.replace(/\s+\[as\s+[^\]]+\]$/, "");
  if (!value || value === "<anonymous>")
    return "<anonymous>";
  return value;
}
function relativizeInApp(location, installRoot) {
  const normalized = normalizeSeparators(location);
  if (!normalized || normalized === "native" || normalized === "<anonymous>")
    return;
  if (/^(?:node|bun):/.test(normalized))
    return;
  if (/(?:^|\/)node_modules\//.test(normalized))
    return;
  const bunfs = /^(?:[A-Za-z]:\/~BUN|\/\$bunfs)\/root\/(.*)$/.exec(normalized);
  if (bunfs)
    return bunfs[1] ?? undefined;
  const root = normalizeSeparators(installRoot).replace(/\/+$/, "");
  if (root.length > 0 && normalized.startsWith(`${root}/`))
    return normalized.slice(root.length + 1);
  return;
}
function normalizeCrashFrames(stack, options = {}) {
  const installRoot = options.installRoot ?? defaultInstallRoot();
  const frames = [];
  for (const line of stack.split(`
`)) {
    if (frames.length >= MAX_FRAMES)
      break;
    const parsed = parseStackFrame(line);
    if (!parsed)
      continue;
    const relative = relativizeInApp(stripLocation(parsed.location), installRoot);
    if (relative === undefined)
      continue;
    frames.push(truncateUtf8(`${relative}#${normalizeFunctionName(parsed.functionName)}`, FRAME_MAX_BYTES));
  }
  return frames.length > 0 ? frames : [NO_APP_FRAME];
}
function canonicalSerialization(fields) {
  const parts = [];
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    parts.push(Buffer.from(`${bytes.byteLength}:`, "utf8"), bytes);
  }
  return Buffer.concat(parts);
}
function computeFingerprint(input, options, includeMessage) {
  const errorName = truncateUtf8(normalizeCrashMessage(input.name, options) || "Error", 128);
  const messageClass = normalizeCrashMessage(input.message, options);
  const frames = normalizeCrashFrames(input.stack, options);
  const identity = includeMessage ? ["gjc-crash-fp.v1", errorName, messageClass, ...frames] : ["gjc-crash-fp.v1", "handled", errorName, frames[0] ?? NO_APP_FRAME];
  const digest = createHash("sha256").update(canonicalSerialization(identity)).digest();
  return {
    fingerprint: digest.subarray(0, CRASH_FINGERPRINT_HEX_LENGTH / 2).toString("hex"),
    version: CRASH_FINGERPRINT_VERSION,
    errorName,
    messageClass,
    frames
  };
}
function computeCrashFingerprint(input, options = {}) {
  return computeFingerprint(input, options, true);
}
function formatCrashRecordMarker(fingerprint, version, recordId) {
  return `${CRASH_RECORD_MARKER} fp:${fingerprint} fpv:${version} id:${recordId}`;
}
// node_modules/@gajae-code/utils/src/crash-journal.ts
import * as fs2 from "fs";
import * as path2 from "path";
var CRASH_EVENT_MAX_BYTES = 512;
var CRASH_EVENT_KIND = "gjc-crash-event.v1";
var CRASH_EVENT_MESSAGE_MAX_BYTES = 256;
function detectCrashProvenance(argv = process.argv, env = process.env, execArgv = process.execArgv) {
  if (env.BUN_TEST !== undefined)
    return "bun_test";
  if (execArgv[0] === "-e" || execArgv[0] === "--eval" || argv[0] === "-e" || argv[0] === "--eval")
    return "eval";
  return "product";
}
function truncateUtf82(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes)
    return text;
  const bytes = Buffer.from(text, "utf8");
  let end = maxBytes;
  while (end > 0 && (bytes[end - 1] & 192) === 128)
    end--;
  if (end > 0 && bytes[end - 1] >= 192)
    end--;
  return bytes.subarray(0, end).toString("utf8");
}
function sanitizeEventText(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}
function formatCrashEventLine(event) {
  const build = (messageClass) => {
    const body = event.kind === "occurrence" ? {
      k: "occurrence",
      fp: event.fingerprint,
      fpv: event.fpv,
      id: event.recordId,
      at: event.at,
      n: sanitizeEventText(truncateUtf82(event.errorName, 64)),
      ...event.provenance && event.provenance !== "product" ? { p: event.provenance } : {},
      ...messageClass === undefined ? {} : { m: messageClass }
    } : event.kind === "reported" ? {
      k: "reported",
      fp: event.fingerprint,
      at: event.at,
      u: sanitizeEventText(truncateUtf82(event.issueUrl, 256)),
      ...event.commented ? { c: 1 } : {}
    } : event.kind === "refused" ? {
      k: "refused",
      fp: event.fingerprint,
      v: event.fpv,
      r: event.recordId,
      c: sanitizeEventText(truncateUtf82(event.contractVersion, 64)),
      at: event.at
    } : event.kind === "relayed" ? { k: "relayed", fp: event.fingerprint, at: event.at, e: event.eventId, r: event.recordId } : event.kind === "acknowledged" ? { k: "acknowledged", fp: event.fingerprint, at: event.at } : { k: "nudged", at: event.at };
    return `${CRASH_EVENT_KIND} ${JSON.stringify(body)}
`;
  };
  if (event.kind !== "occurrence")
    return truncateLine(build());
  let preview = sanitizeEventText(truncateUtf82(event.messageClass, CRASH_EVENT_MESSAGE_MAX_BYTES));
  let line = build(preview);
  while (Buffer.byteLength(line, "utf8") > CRASH_EVENT_MAX_BYTES && preview.length > 0) {
    preview = preview.slice(0, Math.floor(preview.length / 2));
    line = build(preview);
  }
  if (Buffer.byteLength(line, "utf8") > CRASH_EVENT_MAX_BYTES)
    line = build();
  return truncateLine(line);
}
function truncateLine(line) {
  if (Buffer.byteLength(line, "utf8") <= CRASH_EVENT_MAX_BYTES)
    return line;
  return `${truncateUtf82(line.trimEnd(), CRASH_EVENT_MAX_BYTES - 1)}
`;
}
function appendCrashEvent(event, journalPath) {
  try {
    const line = formatCrashEventLine(event);
    fs2.mkdirSync(path2.dirname(journalPath), { recursive: true });
    const fd = fs2.openSync(journalPath, fs2.constants.O_WRONLY | fs2.constants.O_CREAT | fs2.constants.O_APPEND, 384);
    try {
      fs2.writeSync(fd, line);
    } finally {
      fs2.closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}
var fatalJournalLatched = false;
function appendFatalCrashEvent(event, journalPath) {
  if (fatalJournalLatched)
    return false;
  fatalJournalLatched = true;
  return appendCrashEvent(event, journalPath);
}
// node_modules/@gajae-code/utils/src/dirs.ts
import * as fs4 from "fs";
import * as os2 from "os";
import * as path5 from "path";

// node_modules/@gajae-code/utils/src/canonical-log-dir.ts
import * as path3 from "path";
var APP_NAME = "gjc";
var DEFAULT_CONFIG_DIR_NAME = ".gjc";
function canonicalEnvKey(name) {
  return process.platform === "win32" ? name.toUpperCase() : name;
}
function sanitizeConfigDirName(value) {
  const trimmed = value?.trim();
  if (!trimmed || path3.normalize(trimmed).split(/[\\/]/).includes(".."))
    return;
  return trimmed;
}
function trustedValue(name, input) {
  const value = input.env[name];
  if (!value)
    return;
  const key = canonicalEnvKey(name);
  if (input.projectEnv.dynamic.has(key) || input.projectEnv.values[key] === value)
    return;
  return value;
}
function resolveCanonicalLogsDir(input) {
  const configDirName = sanitizeConfigDirName(trustedValue("GJC_CONFIG_DIR", input)) ?? sanitizeConfigDirName(trustedValue("PI_CONFIG_DIR", input)) ?? DEFAULT_CONFIG_DIR_NAME;
  const xdgStateHome = input.xdgEligible && (process.platform === "linux" || process.platform === "darwin") ? trustedValue("XDG_STATE_HOME", input)?.trim() : undefined;
  if (xdgStateHome) {
    const xdgRoot = path3.join(xdgStateHome, APP_NAME);
    if (input.pathExists?.(xdgRoot) === true)
      return path3.join(xdgRoot, "logs");
  }
  return path3.join(input.home, configDirName, "logs");
}
// node_modules/@gajae-code/utils/package.json
var engines = {
  bun: ">=1.4.0"
};

// node_modules/@gajae-code/utils/src/cli-metadata.ts
var APP_NAME2 = "gjc";
var MIN_BUN_VERSION = engines.bun.replace(/[^0-9.]/g, "");

// node_modules/@gajae-code/utils/src/env-file.ts
import * as fs3 from "fs";
import * as path4 from "path";

// node_modules/@gajae-code/utils/src/spawn-env.ts
var MACOS_MALLOC_STACK_LOGGING_ENV = new Set(["MallocStackLogging", "MallocStackLoggingNoCompact"]);
function isSafeEnvName(name) {
  return name.length > 0 && !name.includes("=") && !name.includes("\x00");
}
function isSafeEnvValue(value) {
  return !value.includes("\x00");
}

// node_modules/@gajae-code/utils/src/env-file.ts
var ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isValidEnvName(name) {
  return ENV_NAME_RE.test(name);
}
function stripInlineShellComment(value) {
  let quote;
  for (let i = 0;i < value.length; i++) {
    const char = value[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }
    if (char === "#" && !quote && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}
function stripInlineDotenvComment(value) {
  let quote;
  for (let i = 0;i < value.length; i++) {
    const char = value[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }
    if (char === "#" && !quote)
      return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}
function parseShellEnvFile(filePath) {
  const result = {};
  try {
    const content = fs3.readFileSync(filePath, "utf-8");
    for (const line of content.split(`
`)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#"))
        continue;
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match)
        continue;
      const key = match[1];
      if (!isValidEnvName(key))
        continue;
      let value = stripInlineShellComment(match[2] ?? "").trim();
      if (value.endsWith(";"))
        value = value.slice(0, -1).trimEnd();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (!isSafeEnvValue(value))
        continue;
      if (/[$`]/.test(value))
        continue;
      result[key] = value;
    }
  } catch {}
  return result;
}
function parseEnvFile(filePath) {
  try {
    return parseEnvFileContent(fs3.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}
function parseEnvFileContent(content) {
  const result = {};
  for (const line of content.split(`
`)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
      continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:)\s*(.*)$/.exec(trimmed);
    if (!match)
      continue;
    const key = match[1];
    if (!isValidEnvName(key))
      continue;
    let value = stripInlineDotenvComment(match[2] ?? "").trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (!isSafeEnvValue(value))
      continue;
    result[key] = value;
  }
  return result;
}
function canonicalEnvKey2(name) {
  return process.platform === "win32" ? name.toUpperCase() : name;
}
function projectEnvSnapshot(cwd = process.cwd()) {
  const nodeEnv = "development";
  const validNodeEnv = nodeEnv && /^[A-Za-z0-9_-]+$/.test(nodeEnv) ? nodeEnv : undefined;
  const files = [
    ".env",
    ...validNodeEnv ? [`.env.${validNodeEnv}`] : [],
    ...validNodeEnv !== "test" ? [".env.local"] : [],
    ...validNodeEnv ? [`.env.${validNodeEnv}.local`] : []
  ];
  const values = {};
  const dynamic = new Set;
  for (const file of files) {
    for (const [rawKey, value] of Object.entries(parseEnvFile(path4.join(cwd, file)))) {
      const key = canonicalEnvKey2(rawKey);
      values[key] = value;
      if (/[$`]/.test(value))
        dynamic.add(key);
      else
        dynamic.delete(key);
    }
  }
  return { values, dynamic };
}
// node_modules/@gajae-code/utils/src/dirs.ts
var CONFIG_DIR_NAME = ".gjc";
function standardizeMacOSPath(p) {
  if (process.platform !== "darwin" || !p.startsWith("/private/"))
    return p;
  const stripped = p.slice("/private".length);
  try {
    if (fs4.realpathSync(p) === fs4.realpathSync(stripped)) {
      return stripped;
    }
  } catch {}
  return p;
}
function resolveEquivalentPath(inputPath) {
  const resolvedPath = path5.resolve(inputPath);
  try {
    return fs4.realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}
function normalizePathForComparison(inputPath, platform = process.platform) {
  const pathApi = platform === "win32" ? path5.win32 : path5;
  const resolvedPath = platform === process.platform ? resolveEquivalentPath(inputPath) : pathApi.resolve(inputPath);
  return platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}
var projectDir = standardizeMacOSPath(process.cwd());
function sanitizeConfigDirName2(value) {
  const trimmed = value?.trim();
  if (!trimmed)
    return;
  if (path5.normalize(trimmed).split(/[\\/]/).includes(".."))
    return;
  return trimmed;
}
function trustedValue2(name, project) {
  const value = process.env[name];
  if (!value)
    return;
  const key = canonicalEnvKey2(name);
  const projectValue = project.values[key];
  if (projectValue !== undefined && (project.dynamic.has(key) || projectValue === value))
    return;
  return value;
}
function resolveConfigDirName(project) {
  return sanitizeConfigDirName2(trustedValue2("GJC_CONFIG_DIR", project)) ?? sanitizeConfigDirName2(trustedValue2("PI_CONFIG_DIR", project)) ?? CONFIG_DIR_NAME;
}
function usableHome(home) {
  if (!home || !path5.isAbsolute(home))
    return;
  const normalized = path5.resolve(home);
  return normalized === path5.parse(normalized).root ? undefined : home;
}
var accountHomeCache = new Map;
function accountIdentity(info) {
  const uid = process.platform === "win32" ? info.uid : process.geteuid?.() ?? info.uid;
  return {
    key: `${process.platform}:uid=${uid}:user=${info.username}`,
    uid
  };
}
function nssAccountHome(uid) {
  try {
    const result = Bun.spawnSync({
      cmd: ["getent", "passwd", String(uid)],
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" },
      stdout: "pipe",
      stderr: "ignore"
    });
    if (result.exitCode !== 0)
      return;
    const line = new TextDecoder().decode(result.stdout).split(`
`)[0];
    return usableHome(line?.split(":")[5]);
  } catch {
    return;
  }
}
function accountHomeFromSystem() {
  try {
    const info = os2.userInfo();
    const identity = accountIdentity(info);
    const cached = accountHomeCache.get(identity.key);
    if (cached !== undefined)
      return cached;
    if (process.platform === "linux") {
      const nss = nssAccountHome(identity.uid);
      if (nss !== undefined) {
        const result = { home: nss, envDerived: false };
        accountHomeCache.set(identity.key, result);
        return result;
      }
    }
    const fallback = usableHome(info.homedir);
    if (fallback !== undefined)
      return { home: fallback, envDerived: true };
  } catch {
    return;
  }
  return;
}
function resolveTrustedHome(project) {
  const authoritativeHomeKey = process.platform === "win32" ? "USERPROFILE" : "HOME";
  const declaredHomeKey = canonicalEnvKey2(authoritativeHomeKey);
  const declaredHome = project.values[declaredHomeKey];
  const runtimeHome = usableHome(os2.homedir());
  const ambiguousHome = declaredHome !== undefined && (project.dynamic.has(declaredHomeKey) || declaredHome === runtimeHome);
  if (!ambiguousHome && runtimeHome !== undefined)
    return runtimeHome;
  const accountHome = accountHomeFromSystem();
  if (ambiguousHome) {
    if (accountHome === undefined || accountHome.envDerived)
      return path5.parse(process.cwd()).root;
    return accountHome.home;
  }
  if (accountHome !== undefined)
    return accountHome.home;
  throw new Error("Unable to determine a trustworthy account home directory");
}
class DirResolver {
  configRoot;
  agentDir;
  #projectEnv;
  #configDirName;
  #agentDirOverride;
  #trustedHome;
  #xdgEligible;
  #rootDirs;
  #defaultRootDirs;
  #agentDirs;
  #rootCache = new Map;
  #defaultRootCache = new Map;
  #agentCache = new Map;
  constructor(agentDirOverride, snapshot = projectEnvSnapshot()) {
    this.#projectEnv = snapshot;
    this.#configDirName = resolveConfigDirName(snapshot);
    this.#trustedHome = resolveTrustedHome(snapshot);
    this.configRoot = path5.join(this.#trustedHome, this.#configDirName);
    const defaultAgent = path5.join(this.configRoot, "agent");
    this.#agentDirOverride = Boolean(agentDirOverride);
    this.agentDir = agentDirOverride ? path5.resolve(agentDirOverride) : defaultAgent;
    const isDefault = normalizePathForComparison(this.agentDir) === normalizePathForComparison(defaultAgent);
    this.#xdgEligible = isDefault;
    this.#rootDirs = { data: this.configRoot, state: this.configRoot, cache: this.configRoot };
    this.#defaultRootDirs = { data: this.configRoot, state: this.configRoot, cache: this.configRoot };
    this.#agentDirs = { data: this.agentDir, state: this.agentDir, cache: this.agentDir };
    this.refreshCategoryDirs(snapshot, isDefault);
  }
  get profileAuthority() {
    return this.#xdgEligible ? "default" : "custom";
  }
  refreshCategoryDirs(snapshot, isDefault) {
    let xdgData;
    let xdgState;
    let xdgCache;
    if (process.platform === "linux" || process.platform === "darwin") {
      const resolveIf = (envVar) => {
        const value = trustedValue2(envVar, snapshot);
        if (!value)
          return;
        try {
          const joined = path5.join(value, APP_NAME2);
          return fs4.existsSync(joined) ? joined : undefined;
        } catch {
          return;
        }
      };
      xdgData = resolveIf("XDG_DATA_HOME");
      xdgState = resolveIf("XDG_STATE_HOME");
      xdgCache = resolveIf("XDG_CACHE_HOME");
    }
    this.#defaultRootDirs = {
      data: xdgData ?? this.configRoot,
      state: xdgState ?? this.configRoot,
      cache: xdgCache ?? this.configRoot
    };
    this.#rootDirs = {
      data: isDefault ? xdgData ?? this.configRoot : this.configRoot,
      state: isDefault ? xdgState ?? this.configRoot : this.configRoot,
      cache: isDefault ? xdgCache ?? this.configRoot : this.configRoot
    };
    this.#agentDirs = {
      data: isDefault ? xdgData ?? this.agentDir : this.agentDir,
      state: isDefault ? xdgState ?? this.agentDir : this.agentDir,
      cache: isDefault ? xdgCache ?? this.agentDir : this.agentDir
    };
  }
  refreshConfigDirOverride() {
    const nextConfigDirName = resolveConfigDirName(this.#projectEnv);
    const nextHome = resolveTrustedHome(this.#projectEnv);
    if (nextConfigDirName === this.#configDirName && nextHome === this.#trustedHome)
      return;
    const nextConfigRoot = path5.join(nextHome, nextConfigDirName);
    const nextAgentDir = this.#agentDirOverride ? this.agentDir : path5.join(nextConfigRoot, "agent");
    this.#trustedHome = nextHome;
    this.#configDirName = nextConfigDirName;
    this.configRoot = nextConfigRoot;
    this.agentDir = nextAgentDir;
    this.refreshCategoryDirs(this.#projectEnv, this.#xdgEligible);
    this.#rootCache.clear();
    this.#defaultRootCache.clear();
    this.#agentCache.clear();
  }
  get #homeAvailable() {
    return this.#trustedHome !== path5.parse(this.#trustedHome).root;
  }
  isProjectEnvDeclaration(name) {
    return Object.hasOwn(this.#projectEnv.values, canonicalEnvKey2(name));
  }
  rootSubdir(subdir, xdg) {
    this.refreshConfigDirOverride();
    if (!this.#homeAvailable)
      throw new Error("User state is unavailable: no trustworthy home directory");
    const cached = this.#rootCache.get(subdir);
    if (cached)
      return cached;
    const base = xdg ? this.#rootDirs[xdg] : this.configRoot;
    const result = path5.join(base, subdir);
    this.#rootCache.set(subdir, result);
    return result;
  }
  agentSubdir(userAgentDir, subdir, xdg) {
    this.refreshConfigDirOverride();
    if (!this.#homeAvailable)
      throw new Error("User state is unavailable: no trustworthy home directory");
    if (!userAgentDir || normalizePathForComparison(userAgentDir) === normalizePathForComparison(this.agentDir)) {
      const cached = this.#agentCache.get(subdir);
      if (cached)
        return cached;
      const base = xdg ? this.#agentDirs[xdg] : this.agentDir;
      const result = path5.join(base, subdir);
      this.#agentCache.set(subdir, result);
      return result;
    }
    return path5.join(userAgentDir, subdir);
  }
  rootSubdirForDefaultProfile(subdir, xdg) {
    this.refreshConfigDirOverride();
    if (!this.#homeAvailable)
      throw new Error("User state is unavailable: no trustworthy home directory");
    const cacheKey = `${xdg ?? "config"}:${subdir}`;
    const cached = this.#defaultRootCache.get(cacheKey);
    if (cached)
      return cached;
    const base = xdg ? this.#defaultRootDirs[xdg] : this.configRoot;
    const result = path5.join(base, subdir);
    this.#defaultRootCache.set(cacheKey, result);
    return result;
  }
  get configDirName() {
    return this.#configDirName;
  }
  get trustedHome() {
    this.refreshConfigDirOverride();
    return this.#trustedHome;
  }
  assertHomeAvailable() {
    this.refreshConfigDirOverride();
    if (!this.#homeAvailable)
      throw new Error("User state is unavailable: no trustworthy home directory");
  }
  get trustSnapshot() {
    return this.#projectEnv;
  }
}
var INITIAL_PROJECT_SNAPSHOT = projectEnvSnapshot();
var trustedAgentOverride = trustedValue2("GJC_CODING_AGENT_DIR", INITIAL_PROJECT_SNAPSHOT) ?? trustedValue2("PI_CODING_AGENT_DIR", INITIAL_PROJECT_SNAPSHOT);
var dirs = new DirResolver(trustedAgentOverride, INITIAL_PROJECT_SNAPSHOT);
function getConfigRootDir() {
  dirs.refreshConfigDirOverride();
  dirs.assertHomeAvailable();
  return dirs.configRoot;
}
function getTrustedHomeDir() {
  dirs.assertHomeAvailable();
  return dirs.trustedHome;
}
function getAgentDir() {
  dirs.refreshConfigDirOverride();
  dirs.assertHomeAvailable();
  return dirs.agentDir;
}
function getLogsDir() {
  const home = getTrustedHomeDir();
  return resolveCanonicalLogsDir({
    home,
    env: {
      GJC_CONFIG_DIR: process.env.GJC_CONFIG_DIR,
      PI_CONFIG_DIR: process.env.PI_CONFIG_DIR,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME
    },
    projectEnv: dirs.trustSnapshot,
    xdgEligible: dirs.profileAuthority === "default",
    pathExists: fs4.existsSync
  });
}
function getEffectiveLogsDir() {
  const override = trustedValue2("GJC_LOG_DIR", dirs.trustSnapshot)?.trim();
  return override || getLogsDir();
}
function getCrashLogPath(agentDir) {
  return dirs.agentSubdir(agentDir, "gjc-crash.log", "state");
}
function getCrashEventsPath(agentDir) {
  return dirs.agentSubdir(agentDir, "gjc-crash-events.jsonl", "state");
}
// node_modules/@gajae-code/utils/src/env.ts
import * as fs5 from "fs";
import * as os3 from "os";
import * as path6 from "path";
function loadProjectEnv() {
  const cwd = process.cwd();
  const nodeEnv = "development";
  const validNodeEnv = nodeEnv && /^[A-Za-z0-9_-]+$/.test(nodeEnv) ? nodeEnv : undefined;
  const files = [
    ".env",
    ...validNodeEnv ? [`.env.${validNodeEnv}`] : [],
    ...validNodeEnv !== "test" ? [".env.local"] : [],
    ...validNodeEnv ? [`.env.${validNodeEnv}.local`] : []
  ];
  const values = {};
  const dynamic = new Set;
  for (const file of files) {
    const parsed = parseEnvFile(path6.join(cwd, file));
    for (const [rawKey, value] of Object.entries(parsed)) {
      const key = canonicalEnvKey2(rawKey);
      values[key] = value;
      if (/[$`]/.test(value))
        dynamic.add(key);
      else
        dynamic.delete(key);
    }
  }
  return { values, dynamic };
}
function resolveFileEnvValue(file, name) {
  if (!isSafeEnvName(name))
    return;
  const value = file[canonicalEnvKey2(name)];
  if (value === undefined || !isSafeEnvValue(value))
    return;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
function readTrustedAgentEnv() {
  let filePath;
  try {
    filePath = path6.join(getAgentDir(), ".env");
  } catch {
    return { status: "unavailable", values: {} };
  }
  let fileDescriptor;
  try {
    const linkStats = fs5.lstatSync(filePath);
    if (!linkStats.isFile())
      return { status: "unavailable", values: {} };
    const noFollow = fs5.constants.O_NOFOLLOW ?? 0;
    fileDescriptor = fs5.openSync(filePath, fs5.constants.O_RDONLY | noFollow);
    const fileStats = fs5.fstatSync(fileDescriptor);
    if (!fileStats.isFile())
      return { status: "unavailable", values: {} };
    const content = fs5.readFileSync(fileDescriptor, "utf-8");
    return { status: "ok", values: parseEnvFileContent(content) };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return code === "ENOENT" ? { status: "missing", values: {} } : { status: "unavailable", values: {} };
  } finally {
    if (fileDescriptor !== undefined)
      fs5.closeSync(fileDescriptor);
  }
}
function filterCredentialInheritedEnv(env) {
  const result = {};
  for (const key in env) {
    const value = env[key];
    if (!isSafeEnvName(key) || value === undefined || !isSafeEnvValue(value))
      continue;
    const projectValue = resolveFileEnvValue(projectEnv, key);
    if (projectValue !== undefined && (projectSnapshot.dynamic.has(canonicalEnvKey2(key)) || projectValue === value))
      continue;
    result[key] = value;
  }
  return result;
}
var projectSnapshot = loadProjectEnv();
var projectEnv = projectSnapshot.values;
var authoritativeHomeKey = process.platform === "win32" ? "USERPROFILE" : "HOME";
var declaredHomeKey = canonicalEnvKey2(authoritativeHomeKey);
var declaredHome = projectEnv[declaredHomeKey];
var runtimeHome = process.env[authoritativeHomeKey];
var rejectProjectHome = declaredHome !== undefined && runtimeHome !== undefined && (projectSnapshot.dynamic.has(declaredHomeKey) || declaredHome === runtimeHome);
var trustedEnvHome;
try {
  trustedEnvHome = rejectProjectHome ? getTrustedHomeDir() : os3.homedir();
} catch {
  trustedEnvHome = undefined;
}
var homeShellEnv = trustedEnvHome ? {
  ...parseShellEnvFile(path6.join(trustedEnvHome, ".zshenv")),
  ...parseShellEnvFile(path6.join(trustedEnvHome, ".zprofile")),
  ...parseShellEnvFile(path6.join(trustedEnvHome, ".zshrc")),
  ...parseShellEnvFile(path6.join(trustedEnvHome, ".bash_profile")),
  ...parseShellEnvFile(path6.join(trustedEnvHome, ".bashrc"))
} : {};
var homeEnv = trustedEnvHome && path6.resolve(trustedEnvHome) !== path6.resolve(process.cwd()) ? parseEnvFile(path6.join(trustedEnvHome, ".env")) : {};
var piEnv = {};
var agentEnv = {};
try {
  piEnv = parseEnvFile(path6.join(getConfigRootDir(), ".env"));
  agentEnv = parseEnvFile(path6.join(getAgentDir(), ".env"));
} catch {}
var initialTrustedAgentEnv = readTrustedAgentEnv();
var projectLoadedEnv = Object.fromEntries(Object.keys(projectEnv).map((key) => [key, Bun.env[key]]));
var inheritedEnv = filterCredentialInheritedEnv(Bun.env);
var rotatingAgentEnvNames = new Set(Object.keys(agentEnv));
for (const file of [projectEnv, agentEnv, piEnv, homeEnv, homeShellEnv]) {
  for (const key in file) {
    if (!Bun.env[key]) {
      Bun.env[key] = file[key];
    }
  }
}
var $env = Bun.env;
// node_modules/@gajae-code/utils/src/error-classification.ts
var DESIGNED_ERROR = Symbol.for("gajae-code.designed-error");
// node_modules/@gajae-code/utils/src/format.ts
var SEC = 1000;
var MIN = 60 * SEC;
var HOUR = 60 * MIN;
var DAY = 24 * HOUR;
// node_modules/@gajae-code/utils/src/logger.ts
var exports_logger = {};
__export(exports_logger, {
  warn: () => warn,
  time: () => time,
  startTiming: () => startTiming,
  setTransports: () => setTransports,
  printTimings: () => printTimings,
  info: () => info,
  error: () => error,
  endTiming: () => endTiming,
  debug: () => debug
});
import { AsyncLocalStorage } from "async_hooks";
import * as fs6 from "fs";
function ensureDir(dir) {
  if (!fs6.existsSync(dir)) {
    fs6.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
var winstonModule;
var dailyRotateFileCtor;
var winstonLogger;
var loggerInit;
var flushingBufferedLogs = false;
var bufferedLogs = [];
var MAX_BUFFERED_LOGS = 1e4;
var transportOptions = { file: true };
async function loadLoggingModules() {
  if (!winstonModule || !dailyRotateFileCtor) {
    const [winstonImport, dailyRotateFileImport] = await Promise.all([
      Promise.resolve().then(() => __toESM(require_winston(), 1)),
      Promise.resolve().then(() => __toESM(require_winston_daily_rotate_file(), 1))
    ]);
    winstonModule = winstonImport.default ?? winstonImport;
    dailyRotateFileCtor = dailyRotateFileImport.default;
  }
  return { winston: winstonModule, DailyRotateFile: dailyRotateFileCtor };
}
function makeLogFormat(winston) {
  return winston.format.combine(winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }), winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const entry = {
      timestamp,
      level,
      pid: process.pid,
      message
    };
    for (const [key, value] of Object.entries(meta)) {
      if (key !== "level" && key !== "timestamp" && key !== "message") {
        entry[key] = value;
      }
    }
    return JSON.stringify(entry);
  }));
}
function makeFileTransport(DailyRotateFile, dir) {
  const transport = new DailyRotateFile({
    dirname: ensureDir(dir ?? getEffectiveLogsDir()),
    filename: "gjc.%DATE%.log",
    datePattern: "YYYY-MM-DD",
    maxSize: "10m",
    maxFiles: 5,
    zippedArchive: true
  });
  transport.logStream.on("error", ignoreSinkError);
  return transport;
}
function ignoreSinkError() {}
function makeConsoleTransport(winston) {
  return new winston.transports.Console({ format: makeLogFormat(winston) });
}
function applyTransports(logger, modules) {
  logger.clear();
  logger.silent = !transportOptions.console && !transportOptions.file;
  if (transportOptions.file) {
    logger.add(makeFileTransport(modules.DailyRotateFile, typeof transportOptions.file === "string" ? transportOptions.file : undefined));
  }
  if (transportOptions.console)
    logger.add(makeConsoleTransport(modules.winston));
}
async function getWinstonLogger() {
  if (winstonLogger)
    return winstonLogger;
  loggerInit ??= (async () => {
    const modules = await loadLoggingModules();
    const logger = modules.winston.createLogger({
      level: "debug",
      format: makeLogFormat(modules.winston),
      transports: [],
      exitOnError: false
    });
    logger.on("error", ignoreSinkError);
    applyTransports(logger, modules);
    winstonLogger = logger;
    flushBufferedLogs();
    return logger;
  })();
  return loggerInit;
}
function flushBufferedLogs() {
  if (!winstonLogger || flushingBufferedLogs)
    return;
  flushingBufferedLogs = true;
  try {
    while (bufferedLogs.length > 0) {
      for (const record of bufferedLogs.splice(0)) {
        winstonLogger[record.level](record.message, record.context);
      }
    }
  } finally {
    flushingBufferedLogs = false;
  }
}
function writeLog(level, message, context) {
  try {
    if (winstonLogger && !flushingBufferedLogs) {
      winstonLogger[level](message, context);
      return;
    }
    bufferedLogs.push({ level, message, context });
    if (bufferedLogs.length > MAX_BUFFERED_LOGS) {
      bufferedLogs.splice(0, bufferedLogs.length - MAX_BUFFERED_LOGS);
    }
    getWinstonLogger().catch(() => {
      bufferedLogs.length = 0;
      loggerInit = undefined;
    });
  } catch {}
}
function setTransports(opts) {
  transportOptions = opts;
  if (winstonLogger && winstonModule && dailyRotateFileCtor) {
    applyTransports(winstonLogger, { winston: winstonModule, DailyRotateFile: dailyRotateFileCtor });
  } else if (loggerInit) {
    loggerInit.then((logger) => {
      if (winstonModule && dailyRotateFileCtor) {
        applyTransports(logger, { winston: winstonModule, DailyRotateFile: dailyRotateFileCtor });
      }
    }).catch(() => {});
  }
}
function error(message, context) {
  writeLog("error", message, context);
}
function warn(message, context) {
  writeLog("warn", message, context);
}
function info(message, context) {
  writeLog("info", message, context);
}
function debug(message, context) {
  writeLog("debug", message, context);
}
var LOGGED_TIMING_THRESHOLD_MS = 0.5;
var spanStorage = new AsyncLocalStorage;
var gRootSpan;
var gRecordTimings = false;
function printTimings() {
  if (!gRecordTimings || !gRootSpan) {
    console.error(`
--- Startup Timings ---
(no markers)
`);
    return;
  }
  gRootSpan.end = performance.now();
  const root = gRootSpan;
  const printNow = root.end;
  const closeOpenSpans = (span) => {
    for (const child of span.children)
      closeOpenSpans(child);
    if (span.end === undefined && !span.point)
      span.end = printNow;
  };
  closeOpenSpans(root);
  const lines = [];
  lines.push("");
  lines.push("--- Startup timings (hierarchical) ---");
  for (const child of [...gRootSpan.children].sort((a, b) => a.start - b.start)) {
    printSpan(child, 0, lines);
  }
  const totalMs = (gRootSpan.end - gRootSpan.start).toFixed(1);
  lines.push(`Total: ${totalMs}ms`);
  lines.push("--------------------------------------");
  lines.push("");
  console.error(lines.join(`
`));
  gRootSpan.end = undefined;
}
function startTiming() {
  if (gRecordTimings)
    return;
  gRootSpan = {
    op: "(root)",
    start: 0,
    parent: undefined,
    children: []
  };
  gRecordTimings = true;
}
function endTiming() {
  gRootSpan = undefined;
  gRecordTimings = false;
}
function durationOf(span) {
  if (span.point || span.end === undefined)
    return 0;
  return span.end - span.start;
}
function selfTimeOf(span) {
  const dur = durationOf(span);
  if (span.children.length === 0 || span.point)
    return dur;
  const intervals = span.children.filter((c) => !c.point && c.end !== undefined).map((c) => [c.start, c.end]).sort((a, b) => a[0] - b[0]);
  if (intervals.length === 0)
    return dur;
  let union = 0;
  let curStart = intervals[0][0];
  let curEnd = intervals[0][1];
  for (let i = 1;i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s > curEnd) {
      union += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  union += curEnd - curStart;
  return Math.max(0, dur - union);
}
function fmtMs(ms) {
  if (ms < 1)
    return `${ms.toFixed(2)}ms`;
  if (ms < 100)
    return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(0)}ms`;
}
function printSpan(span, depth, lines) {
  const indent = "  ".repeat(depth);
  if (span.point) {
    lines.push(`${indent}\u2022 ${span.op}`);
    return;
  }
  const dur = durationOf(span);
  if (dur < LOGGED_TIMING_THRESHOLD_MS && span.children.length === 0)
    return;
  const parallel = isParallel(span);
  const tag = parallel ? " [parallel]" : "";
  const self2 = selfTimeOf(span);
  const selfStr = span.children.length > 0 && self2 > LOGGED_TIMING_THRESHOLD_MS ? ` (self ${fmtMs(self2)})` : "";
  lines.push(`${indent}${span.op}: ${fmtMs(dur)}${selfStr}${tag}`);
  for (const child of [...span.children].sort((a, b) => a.start - b.start)) {
    printSpan(child, depth + 1, lines);
  }
}
function isParallel(span) {
  const parent = span.parent;
  if (!parent || span.end === undefined)
    return false;
  for (const sibling of parent.children) {
    if (sibling === span || sibling.end === undefined || sibling.point)
      continue;
    if (sibling.start < span.end && span.start < sibling.end)
      return true;
  }
  return false;
}
function time(op, fn, ...args) {
  if (!gRecordTimings || !gRootSpan) {
    if (fn === undefined)
      return;
    return fn(...args);
  }
  const parent = spanStorage.getStore() ?? gRootSpan;
  const span = { op, start: performance.now(), parent, children: [] };
  parent.children.push(span);
  if (fn === undefined) {
    span.end = span.start;
    span.point = true;
    return;
  }
  const finish = () => {
    span.end = performance.now();
  };
  try {
    const result = spanStorage.run(span, () => fn(...args));
    if (result instanceof Promise) {
      return result.finally(finish);
    }
    finish();
    return result;
  } catch (error2) {
    finish();
    throw error2;
  }
}
// node_modules/@gajae-code/utils/src/peek-file.ts
var POOLED_BUFFER_SIZE = 512;
var ASYNC_POOL_SIZE = 10;
var INITIAL_SYNC_BUFFER_SIZE = 1024;
var EMPTY_BUFFER = Buffer.alloc(0);
var asyncPool = Array.from({ length: ASYNC_POOL_SIZE }, () => Buffer.allocUnsafe(POOLED_BUFFER_SIZE));
var availableAsyncPoolIndexes = Array.from({ length: ASYNC_POOL_SIZE }, (_, index) => index);
var syncPool = new Uint8Array(INITIAL_SYNC_BUFFER_SIZE);

// node_modules/@gajae-code/utils/src/mime.ts
var DEFAULT_IMAGE_METADATA_HEADER_BYTES = 256 * 1024;
var PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
var JPEG_MAGIC = Buffer.from([255, 216, 255]);
var WEBP_RIFF_MAGIC = Buffer.from([82, 73, 70, 70]);
var WEBP_MAGIC = Buffer.from([87, 69, 66, 80]);
var PNG_IHDR = Buffer.from("IHDR");
var GIF87A = Buffer.from("GIF87a");
var GIF89A = Buffer.from("GIF89a");
var WEBP_VP8X = Buffer.from("VP8X");
var WEBP_VP8L = Buffer.from("VP8L");
var WEBP_VP8 = Buffer.from("VP8 ");
var SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// node_modules/@gajae-code/utils/src/postmortem.ts
import { randomBytes } from "crypto";
import * as fs8 from "fs";
import inspector from "inspector";
import * as path7 from "path";
import { isMainThread } from "worker_threads";

// node_modules/@gajae-code/utils/src/safe-stderr.ts
import * as fs7 from "fs";
var CLOSED_STDERR_ERROR_CODES = new Set(["EIO", "EPIPE", "EBADF"]);
function isClosedStderrWriteError(error2) {
  if (!(error2 instanceof Error) || !("code" in error2) || typeof error2.code !== "string")
    return false;
  return CLOSED_STDERR_ERROR_CODES.has(error2.code);
}
function safeStderrWrite(message) {
  if (!process.stderr.writable)
    return;
  try {
    fs7.writeSync(process.stderr.fd, message);
  } catch (error2) {
    if (isClosedStderrWriteError(error2))
      return;
    throw error2;
  }
}

// node_modules/@gajae-code/utils/src/postmortem.ts
var callbackList = [];
var cleanupStage = "idle";
var cleanupPromise;
var quietShutdownStarted = false;
var ordinaryFatalStarted = false;
var stdoutEpipeClassifier = createProcessStdoutEpipeClassifier();
function shouldSuppressCleanupLogging(quiet) {
  return quiet || quietShutdownStarted;
}
function runCleanup(reason, options = {}) {
  const quiet = options.quiet === true;
  switch (cleanupStage) {
    case "idle":
      cleanupStage = "running";
      break;
    case "running":
      if (reason === "manual" /* MANUAL */ && !shouldSuppressCleanupLogging(quiet)) {
        error("Cleanup invoked recursively", { stack: new Error().stack });
      }
      return Promise.resolve();
    case "complete":
      return Promise.resolve();
  }
  const { promise, resolve: resolve4 } = Promise.withResolvers();
  cleanupPromise = promise;
  const promises = callbackList.toReversed().map((callback) => {
    return Promise.try(() => callback(reason));
  });
  Promise.allSettled(promises).then((results) => {
    try {
      if (!shouldSuppressCleanupLogging(quiet)) {
        for (const result of results) {
          if (result.status === "rejected") {
            const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
            error("Cleanup callback failed", { err, stack: err.stack });
          }
        }
      }
    } finally {
      cleanupStage = "complete";
      resolve4();
    }
  });
  return promise;
}
var DEFAULT_CLEANUP_DEADLINE_MS = 5000;
var MAX_CLEANUP_DEADLINE_MS = 2 ** 31 - 1;
function resolveCleanupDeadlineMs() {
  const raw = process.env.GJC_CLEANUP_DEADLINE_MS;
  if (raw === undefined || raw.trim() === "")
    return DEFAULT_CLEANUP_DEADLINE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0)
    return DEFAULT_CLEANUP_DEADLINE_MS;
  return Math.min(parsed, MAX_CLEANUP_DEADLINE_MS);
}
async function awaitCleanupWithDeadline(reason, options = {}) {
  const pending = cleanupPromise;
  if (!pending || cleanupStage === "complete")
    return;
  const deadlineMs = resolveCleanupDeadlineMs();
  let timer;
  const timedOut = await Promise.race([
    pending.then(() => false),
    new Promise((resolve4) => {
      timer = setTimeout(() => resolve4(true), deadlineMs);
    })
  ]);
  if (timer)
    clearTimeout(timer);
  if (!timedOut)
    return;
  cleanupStage = "complete";
  if (!shouldSuppressCleanupLogging(options.quiet === true)) {
    const diagnostic = `[postmortem] cleanup deadline (${deadlineMs}ms) expired for ${reason}; exiting without waiting for remaining callbacks.
`;
    safeStderrWrite(diagnostic);
    error("Cleanup deadline expired", { reason, deadlineMs });
  }
}
async function runCleanupBounded(reason, options = {}) {
  runCleanup(reason, options);
  await awaitCleanupWithDeadline(reason, options);
}
function installProcessStdoutWriteClassifier() {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const markCallback = (callback) => {
    return (error2) => {
      stdoutEpipeClassifier.markDirectProcessStdoutWriteError(error2);
      callback(error2);
    };
  };
  const markedWrite = (chunk, encoding, callback) => {
    try {
      if (typeof encoding === "function")
        return originalWrite(chunk, markCallback(encoding));
      if (callback) {
        return typeof chunk === "string" ? originalWrite(chunk, encoding, markCallback(callback)) : originalWrite(chunk, markCallback(callback));
      }
      return typeof chunk === "string" ? originalWrite(chunk, encoding, markCallback(() => {})) : originalWrite(chunk, markCallback(() => {}));
    } catch (error2) {
      stdoutEpipeClassifier.markDirectProcessStdoutWriteError(error2);
      throw error2;
    }
  };
  process.stdout.write = markedWrite;
}
var UNREADABLE_FIELD = "[unreadable]";
var UNREADABLE_THROWABLE = "[unreadable throwable]";
var ERROR_FIELDS = ["name", "message", "stack"];
var CRASH_CONTEXT_FIELDS = new Set([
  "code",
  "errno",
  "syscall",
  "path",
  "dest",
  "address",
  "port",
  "fd",
  "status",
  "statusCode",
  "url",
  "method",
  "phase",
  "reason",
  "exitCode",
  "stderr"
]);
var CRASH_CONTEXT_FIELD_MAX_BYTES = 4 * 1024;
var CRASH_CONTEXT_FIELD_TRUNCATION_MARKER = "\u2026 [field truncated]";
var UNDEFINED_FIELD = "[undefined]";
function readField(reason, key, preserveUndefined = false) {
  try {
    const value = reason[key];
    return value === undefined && !preserveUndefined ? { kind: "missing" } : { kind: "value", value };
  } catch {
    return { kind: "unreadable" };
  }
}
function capturedValue(field) {
  if (field.kind === "value")
    return field.value;
  if (field.kind === "unreadable")
    return UNREADABLE_FIELD;
  return;
}
function boundedJsonString(value) {
  const redacted = redactCrashSecrets(value);
  if (Buffer.byteLength(JSON.stringify(redacted), "utf8") <= CRASH_CONTEXT_FIELD_MAX_BYTES)
    return JSON.stringify(redacted);
  let low = 0;
  let high = redacted.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const candidate = JSON.stringify(`${redacted.slice(0, midpoint)}${CRASH_CONTEXT_FIELD_TRUNCATION_MARKER}`);
    if (Buffer.byteLength(candidate, "utf8") <= CRASH_CONTEXT_FIELD_MAX_BYTES)
      low = midpoint;
    else
      high = midpoint - 1;
  }
  let end = low;
  if (end > 0 && /[\uD800-\uDBFF]/.test(redacted[end - 1] ?? ""))
    end--;
  return JSON.stringify(`${redacted.slice(0, end)}${CRASH_CONTEXT_FIELD_TRUNCATION_MARKER}`);
}
function serializeCapturedValue(value) {
  if (value === undefined)
    return JSON.stringify(UNDEFINED_FIELD);
  if (typeof value === "string")
    return boundedJsonString(value);
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string")
      return boundedJsonString(String(value));
    const redacted = redactCrashSecrets(serialized);
    if (Buffer.byteLength(redacted, "utf8") <= CRASH_CONTEXT_FIELD_MAX_BYTES)
      return redacted;
    return boundedJsonString(redacted);
  } catch {
    try {
      return boundedJsonString(String(value));
    } catch {
      return JSON.stringify(UNREADABLE_FIELD);
    }
  }
}
function capturePayload(reason) {
  let keys;
  try {
    keys = Object.keys(reason);
  } catch {
    return;
  }
  const properties = [];
  for (const key of keys) {
    if (!CRASH_CONTEXT_FIELDS.has(key))
      continue;
    const serialized = serializeCapturedValue(capturedValue(readField(reason, key, true)));
    properties.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return properties.length > 0 ? { serialized: `{${properties.join(",")}}` } : undefined;
}
function fieldText(field, fallback) {
  if (field.kind === "unreadable")
    return UNREADABLE_FIELD;
  if (field.kind !== "value")
    return fallback;
  try {
    const text = typeof field.value === "string" ? field.value : String(field.value);
    return text || fallback;
  } catch {
    return UNREADABLE_FIELD;
  }
}
function describeFatal(reason) {
  try {
    if (typeof reason !== "object" || reason === null) {
      let message2;
      try {
        message2 = String(reason);
      } catch {
        message2 = UNREADABLE_THROWABLE;
      }
      return { name: "Error", message: message2 || "(no message)", stack: "" };
    }
    const fields = {
      name: readField(reason, "name"),
      message: readField(reason, "message"),
      stack: readField(reason, "stack")
    };
    const payload = capturePayload(reason);
    const payloadIsMessage = payload !== undefined && ERROR_FIELDS.every((key) => fields[key].kind === "missing");
    const name = fieldText(fields.name, "Error");
    const message = fieldText(fields.message, "(no message)");
    let stack = "";
    if (fields.stack.kind === "unreadable") {
      stack = `${name}: ${message}
${UNREADABLE_FIELD}`;
    } else if (fields.stack.kind === "value" && typeof fields.stack.value === "string" && fields.stack.value.length > 0) {
      stack = fields.stack.value.includes(`
`) ? fields.stack.value : `${name}: ${message}
${fields.stack.value}`;
    }
    return {
      name,
      message: payloadIsMessage ? payload.serialized : message,
      stack,
      payload: payloadIsMessage ? undefined : payload?.serialized
    };
  } catch {
    return { name: "Error", message: UNREADABLE_THROWABLE, stack: "" };
  }
}
function fatalErrorForLog(fatal) {
  const error2 = new Error(fatal.message);
  error2.name = fatal.name;
  if (fatal.stack)
    error2.stack = fatal.stack;
  return error2;
}
var inspectorOpened = false;
function formatFatalError(label, fatal) {
  const stackLines = fatal.stack.split(`
`).slice(1);
  const formattedStack = stackLines.length > 0 ? `
${stackLines.join(`
`)}` : "";
  const formattedPayload = fatal.payload ? `
${fatal.payload}` : "";
  return boundCrashRecord(redactCrashSecrets(`
[${label}] ${fatal.name}: ${fatal.message}${formattedStack}${formattedPayload}
`));
}
var CRASH_LOG_MAX_BYTES = 512 * 1024;
var CRASH_RECORD_MAX_BYTES = 64 * 1024;
var CRASH_RECORD_TRUNCATION_MARKER = `
\u2026 [crash record truncated]

`;
function boundCrashRecord(report, maxBytes = CRASH_RECORD_MAX_BYTES) {
  if (Buffer.byteLength(report, "utf8") <= maxBytes)
    return report;
  const bytes = Buffer.from(report, "utf8");
  const budget = maxBytes - Buffer.byteLength(CRASH_RECORD_TRUNCATION_MARKER, "utf8");
  let end = budget;
  while (end > 0 && (bytes[end - 1] & 192) === 128)
    end--;
  if (end > 0 && bytes[end - 1] >= 192)
    end--;
  return bytes.subarray(0, end).toString("utf8") + CRASH_RECORD_TRUNCATION_MARKER;
}
function recordFatalCrash(label, reason, options = {}) {
  const provenance = detectCrashProvenance();
  const written = writeCrashRecord(label, describeFatal(reason), { ...options, provenance });
  if (!written)
    return;
  appendFatalCrashEvent({
    kind: "occurrence",
    fingerprint: written.fingerprint.fingerprint,
    fpv: written.fingerprint.version,
    recordId: written.recordId,
    at: written.now.getTime(),
    errorName: written.fingerprint.errorName,
    messageClass: written.fingerprint.messageClass,
    provenance
  }, getCrashEventsTarget(written.target, options.path));
  return written.target;
}
var handledErrorFingerprints = new Set;
function getCrashEventsTarget(target, configuredPath) {
  return configuredPath === undefined ? getCrashEventsPath() : path7.join(path7.dirname(target), path7.basename(getCrashEventsPath()));
}
function writeCrashRecord(label, fatal, options = {}) {
  try {
    const target = options.path ?? getCrashLogPath();
    const now = options.now ?? new Date;
    const stack = fatal.stack ? `${redactCrashSecrets(fatal.stack)}
` : "";
    const payload = fatal.payload ? `${redactCrashSecrets(fatal.payload)}
` : "";
    const fingerprint = options.fingerprint ?? computeCrashFingerprint(fatal);
    const recordId = randomBytes(8).toString("hex");
    const markerLine = `${formatCrashRecordMarker(fingerprint.fingerprint, fingerprint.version, recordId)}
`;
    const body = boundCrashRecord(`${now.toISOString()} pid=${process.pid} [${label}${options.provenance && options.provenance !== "product" ? `;provenance=${options.provenance}` : ""}] ` + `${redactCrashSecrets(fatal.name)}: ${redactCrashSecrets(fatal.message)}
` + `${stack}${payload}`, CRASH_RECORD_MAX_BYTES - Buffer.byteLength(markerLine, "utf8") - 1);
    const report = `${body}${markerLine}
`;
    fs8.mkdirSync(path7.dirname(target), { recursive: true });
    let existingSize = 0;
    try {
      existingSize = fs8.statSync(target).size;
    } catch {}
    if (existingSize + Buffer.byteLength(report, "utf8") > CRASH_LOG_MAX_BYTES) {
      fs8.writeFileSync(target, report, { mode: 384 });
    } else {
      fs8.appendFileSync(target, report, { mode: 384 });
    }
    try {
      fs8.chmodSync(target, 384);
    } catch {}
    return { target, now, fingerprint, recordId };
  } catch {
    return;
  }
}
async function exitQuietlyForAttributableStdoutEpipe(reason) {
  if (ordinaryFatalStarted || quietShutdownStarted)
    return;
  quietShutdownStarted = true;
  process.exitCode = BROKEN_PIPE_EXIT_CODE;
  await runCleanupBounded(reason, { quiet: true });
  if (process.exitCode === BROKEN_PIPE_EXIT_CODE)
    process.exit(BROKEN_PIPE_EXIT_CODE);
}
async function handleFatalError(label, reason, cleanupReason) {
  if (stdoutEpipeClassifier.isAttributableProcessStdoutEpipe(reason)) {
    await exitQuietlyForAttributableStdoutEpipe(cleanupReason);
    return;
  }
  ordinaryFatalStarted = true;
  process.exitCode = 1;
  const fatal = describeFatal(reason);
  const crashLogPath = recordFatalCrash(label, reason);
  safeStderrWrite(formatFatalError(label, fatal));
  if (crashLogPath)
    safeStderrWrite(`[${label}] crash recorded at ${crashLogPath}
`);
  if (!quietShutdownStarted) {
    const err = fatalErrorForLog(fatal);
    error(label === "Uncaught Exception" ? "Uncaught exception" : "Unhandled rejection", {
      err,
      stack: err.stack
    });
  }
  await runCleanupBounded(cleanupReason);
  process.exit(1);
}
if (isMainThread) {
  installProcessStdoutWriteClassifier();
  process.on("SIGINT", async () => {
    await runCleanupBounded("sigint" /* SIGINT */);
    process.exit(130);
  }).on("SIGUSR1", () => {
    if (inspectorOpened)
      return;
    inspectorOpened = true;
    inspector.open(undefined, undefined, false);
    const url = inspector.url();
    safeStderrWrite(`Inspector opened: ${url}
`);
  }).on("uncaughtException", async (error2) => {
    await handleFatalError("Uncaught Exception", error2, "uncaught_exception" /* UNCAUGHT_EXCEPTION */);
  }).on("unhandledRejection", async (reason) => {
    await handleFatalError("Unhandled Rejection", reason, "unhandled_rejection" /* UNHANDLED_REJECTION */);
  }).on("exit", async () => {
    runCleanup("exit" /* EXIT */);
  }).on("SIGTERM", async () => {
    await runCleanupBounded("sigterm" /* SIGTERM */);
    process.exit(143);
  }).on("SIGHUP", async () => {
    await runCleanupBounded("sighup" /* SIGHUP */);
    process.exit(129);
  });
} else {
  process.on("exit", () => {
    runCleanup("exit" /* EXIT */);
  });
}
// node_modules/@gajae-code/utils/src/native-process.ts
var bindings;
function nativeProcessBindings() {
  if (!bindings) {
    bindings = __require("@gajae-code/natives");
  }
  return bindings;
}

// node_modules/@gajae-code/utils/src/which.ts
import * as fs9 from "fs";
import * as os4 from "os";
import * as path8 from "path";
var XCODE_BINS = new Set([
  "clang",
  "clang++",
  "gcc",
  "g++",
  "cc",
  "c++",
  "cpp",
  "c89",
  "c99",
  "swift",
  "swiftc",
  "swift-frontend",
  "clangd",
  "sourcekit-lsp",
  "ld",
  "ld-classic",
  "ar",
  "ranlib",
  "libtool",
  "as",
  "lipo",
  "install_name_tool",
  "codesign_allocate",
  "make",
  "gnumake",
  "m4",
  "flex",
  "bison",
  "yacc",
  "lex",
  "git",
  "git-receive-pack",
  "git-upload-pack",
  "git-upload-archive",
  "git-shell",
  "scalar",
  "lldb",
  "lldb-dap",
  "nm",
  "otool",
  "objdump",
  "strings",
  "strip",
  "size",
  "dsymutil",
  "dwarfdump",
  "lipo",
  "vtool",
  "clang-format",
  "swift-format"
]);
var XCODE_BIN_PREFIXES = ["python", "pip", "pydoc", "2to3"];
function isXcodeBin(command) {
  if (XCODE_BINS.has(command))
    return true;
  for (const prefix of XCODE_BIN_PREFIXES) {
    if (command.startsWith(prefix))
      return true;
  }
  return false;
}
function getDeveloperDirs() {
  const envDir = process.env.DEVELOPER_DIR;
  if (envDir && fs9.existsSync(envDir)) {
    return envDir;
  }
  try {
    return fs9.readlinkSync("/var/db/xcode_select_link");
  } catch {}
  for (const candidate of ["/Applications/Xcode.app/Contents/Developer", "/Library/Developer/CommandLineTools"]) {
    if (fs9.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
var macosToolPaths;
function getMacosToolPaths() {
  if (macosToolPaths)
    return macosToolPaths;
  const paths = [
    "/Library/Developer/CommandLineTools/usr/bin"
  ];
  const devDir = getDeveloperDirs();
  if (devDir) {
    paths.push(path8.join(devDir, "usr/bin"), path8.join(devDir, "Toolchains/XcodeDefault.xctoolchain/usr/bin"));
  }
  macosToolPaths = new Map;
  for (const dir of Array.from(new Set(paths))) {
    try {
      for (const entry of fs9.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() || entry.isSymbolicLink()) {
          if (macosToolPaths.has(entry.name)) {
            continue;
          }
          macosToolPaths.set(entry.name, path8.join(dir, entry.name));
        }
      }
    } catch {}
  }
  return macosToolPaths;
}
var toolCache = new Map;
function darwinWhich(command, options) {
  const regular = Bun.which(command, options);
  if (regular)
    return regular;
  if (options?.PATH !== undefined)
    return null;
  if (isXcodeBin(command)) {
    return getMacosToolPaths().get(command) ?? null;
  }
  return null;
}
var whichFresh = os4.platform() === "darwin" ? darwinWhich : Bun.which;
// node_modules/@gajae-code/utils/src/prompt.ts
var compiledTemplateCache = new Map;
// node_modules/@gajae-code/utils/src/ptree.ts
class Exception extends Error {
  exitCode;
  stderr;
  constructor(message, exitCode, stderr) {
    super(message);
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.name = this.constructor.name;
  }
}

class NonZeroExitError extends Exception {
  static MAX_TRACE = 32 * 1024;
  constructor(exitCode, stderr) {
    super(`Process exited with code ${exitCode}:
${stderr}`, exitCode, stderr);
  }
  get aborted() {
    return false;
  }
}

class AbortError extends Exception {
  reason;
  constructor(reason, stderr) {
    const msg = reason instanceof Error ? reason.message : String(reason ?? "aborted");
    super(`Operation cancelled: ${msg}`, -1, stderr);
    this.reason = reason;
  }
  get aborted() {
    return true;
  }
}

class TimeoutError extends AbortError {
  constructor(timeout, stderr) {
    super(new Error(`Timed out after ${Math.round(timeout / 1000)}s`), stderr);
  }
}

class ChildProcess {
  proc;
  exposeStderr;
  #nothrow = false;
  #stderrTail = "";
  #stderrChunks = [];
  #exitReason;
  #exitReasonPending;
  #stderrDone;
  #exited;
  #stderrStream;
  constructor(proc, exposeStderr) {
    this.proc = proc;
    this.exposeStderr = exposeStderr;
    const dec = new TextDecoder;
    const trim = () => {
      if (this.#stderrTail.length > NonZeroExitError.MAX_TRACE)
        this.#stderrTail = this.#stderrTail.slice(-NonZeroExitError.MAX_TRACE);
    };
    let stderrStream = proc.stderr;
    if (exposeStderr) {
      const [teeStream, drainStream] = stderrStream.tee();
      this.#stderrStream = teeStream;
      stderrStream = drainStream;
    }
    this.#stderrDone = (async () => {
      try {
        for await (const chunk of stderrStream) {
          this.#stderrChunks.push(chunk);
          this.#stderrTail += dec.decode(chunk, { stream: true });
          trim();
        }
      } catch {}
      this.#stderrTail += dec.decode();
      trim();
    })();
    const { promise, resolve: resolve4, reject } = Promise.withResolvers();
    this.#exited = promise;
    proc.exited.catch(() => null).then(async (exitCode) => {
      if (this.#exitReasonPending) {
        this.#exitReason = this.#exitReasonPending;
        reject(this.#exitReasonPending);
        return;
      }
      if (exitCode === 0) {
        resolve4(0);
        return;
      }
      await this.#stderrDone;
      if (exitCode !== null) {
        this.#exitReason = new NonZeroExitError(exitCode, this.#stderrTail);
        resolve4(exitCode);
        return;
      }
      const ex = this.proc.killed ? new AbortError(new Error("process killed"), this.#stderrTail) : new NonZeroExitError(-1, this.#stderrTail);
      this.#exitReason = ex;
      reject(ex);
    });
  }
  get pid() {
    return this.proc.pid;
  }
  get exited() {
    return this.#exited;
  }
  get exitCode() {
    return this.proc.exitCode;
  }
  get exitReason() {
    return this.#exitReason;
  }
  get killed() {
    return this.proc.killed;
  }
  get stdin() {
    return this.proc.stdin;
  }
  get stdout() {
    return this.proc.stdout;
  }
  get stderr() {
    return this.#stderrStream;
  }
  get exitedCleanly() {
    if (this.#nothrow)
      return this.#exited;
    return this.#exited.then((code) => {
      if (code !== 0)
        throw new NonZeroExitError(code, this.#stderrTail);
      return code;
    });
  }
  peekStderr() {
    return this.#stderrTail;
  }
  nothrow() {
    this.#nothrow = true;
    return this;
  }
  kill(reason) {
    if (reason && !this.#exitReasonPending)
      this.#exitReasonPending = reason;
    if (!this.proc.killed)
      nativeProcessBindings().Process.fromPid(this.proc.pid)?.terminate()?.catch((e) => {
        return;
      });
  }
  async text() {
    const p = new Response(this.stdout).text();
    if (this.#nothrow)
      return p;
    const [text] = await Promise.all([p, this.exitedCleanly]);
    return text;
  }
  async blob() {
    const p = new Response(this.stdout).blob();
    if (this.#nothrow)
      return p;
    const [blob] = await Promise.all([p, this.exitedCleanly]);
    return blob;
  }
  async json() {
    return new Response(this.stdout).json();
  }
  async arrayBuffer() {
    return new Response(this.stdout).arrayBuffer();
  }
  async bytes() {
    return new Response(this.stdout).bytes();
  }
  async wait(opts) {
    const { allowNonZero = false, allowAbort = false, stderr: stderrMode = "buffer" } = opts ?? {};
    const stdoutP = new Response(this.stdout).text();
    const stderrP = stderrMode === "full" ? this.#stderrDone.then(() => new TextDecoder().decode(Buffer.concat(this.#stderrChunks))) : this.#stderrDone.then(() => this.#stderrTail);
    const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);
    let exitError;
    try {
      await this.#exited;
    } catch (err) {
      if (err instanceof Exception)
        exitError = err;
      else
        throw err;
    }
    if (!exitError)
      exitError = this.exitReason;
    if (!exitError && this.exitCode !== null && this.exitCode !== 0) {
      exitError = new NonZeroExitError(this.exitCode, this.#stderrTail);
    }
    const exitCode = this.exitCode ?? (exitError && !exitError.aborted ? exitError.exitCode : null);
    const ok = exitCode === 0;
    if (exitError) {
      if (exitError.aborted && !allowAbort || !exitError.aborted && !allowNonZero)
        throw exitError;
    }
    return { stdout, stderr, exitCode, ok, exitError };
  }
  attachSignal(signal) {
    const onAbort = () => this.kill(new AbortError(signal.reason, "<cancelled>"));
    if (signal.aborted)
      return void onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    this.#exited.catch(() => {}).finally(() => signal.removeEventListener("abort", onAbort));
  }
  attachTimeout(ms) {
    if (ms <= 0 || this.proc.killed)
      return;
    Promise.race([
      Bun.sleep(ms).then(() => true),
      this.proc.exited.then(() => false, () => false)
    ]).then((timedOut) => {
      if (timedOut)
        this.kill(new TimeoutError(ms, this.#stderrTail));
    });
  }
  [Symbol.dispose]() {
    if (this.proc.exitCode !== null)
      return;
    this.kill(new AbortError("process disposed", this.#stderrTail));
  }
}
// node_modules/@gajae-code/utils/src/snowflake.ts
var HEX4 = Array.from({ length: 65536 }, (_, i) => i.toString(16).padStart(4, "0"));
function randu32() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
var EPOCH = 1420070400000;
var MAX_SEQ = 4194303;
var Snowflake;
((Snowflake) => {
  Snowflake.PATTERN = /^[0-9a-f]{16}$/;
  Snowflake.EPOCH_TIMESTAMP = EPOCH;
  Snowflake.MAX_SEQUENCE = MAX_SEQ;
  function toBigInt(value) {
    const hi = Number.parseInt(value.substring(0, 8), 16);
    const lo = Number.parseInt(value.substring(8, 16), 16);
    return BigInt(hi) << 32n | BigInt(lo);
  }
  function formatParts(dt, seq) {
    const dtLo = dt % 1024;
    const hi = (dt - dtLo) / 1024;
    const lo = (dtLo << 22 | seq) >>> 0;
    const hi1 = hi >>> 16 & 65535;
    const hi2 = hi & 65535;
    const lo1 = lo >>> 16 & 65535;
    const lo2 = lo & 65535;
    return `${HEX4[hi1]}${HEX4[hi2]}${HEX4[lo1]}${HEX4[lo2]}`;
  }
  Snowflake.formatParts = formatParts;

  class Source {
    #seq = 0;
    constructor(sequence = randu32() & MAX_SEQ) {
      this.#seq = sequence & MAX_SEQ;
    }
    get sequence() {
      return this.#seq & MAX_SEQ;
    }
    set sequence(v) {
      this.#seq = v & MAX_SEQ;
    }
    reset() {
      this.#seq = 0;
    }
    generate(timestamp) {
      const seq = this.#seq + 1 & MAX_SEQ;
      const dt = timestamp - EPOCH;
      this.#seq = seq;
      return formatParts(dt, seq);
    }
  }
  Snowflake.Source = Source;
  const defaultSource = new Source;
  function next(timestamp = Date.now()) {
    return defaultSource.generate(timestamp);
  }
  Snowflake.next = next;
  function valid(value) {
    return value.length === 16 && Snowflake.PATTERN.test(value);
  }
  Snowflake.valid = valid;
  function lowerbound(timelike) {
    switch (typeof timelike) {
      case "object":
        return formatParts(timelike.getTime() - EPOCH, 0);
      case "number":
        return formatParts(timelike - EPOCH, 0);
      case "string":
        return timelike;
    }
  }
  Snowflake.lowerbound = lowerbound;
  function upperbound(timelike) {
    switch (typeof timelike) {
      case "object":
        return formatParts(timelike.getTime() - EPOCH, MAX_SEQ);
      case "number":
        return formatParts(timelike - EPOCH, MAX_SEQ);
      case "string":
        return timelike;
    }
  }
  Snowflake.upperbound = upperbound;
  function getSequence(value) {
    return Number.parseInt(value.substring(8, 16), 16) & MAX_SEQ;
  }
  Snowflake.getSequence = getSequence;
  function getTimestamp(value) {
    const n = toBigInt(value) >> 22n;
    return Number(n + BigInt(EPOCH));
  }
  Snowflake.getTimestamp = getTimestamp;
  function getDate(value) {
    return new Date(getTimestamp(value));
  }
  Snowflake.getDate = getDate;
})(Snowflake ||= {});
// node_modules/@gajae-code/utils/src/stream.ts
var LF = 10;
function parseJsonlChunkCompat(input, beg, end) {
  if (typeof input === "string") {
    const { values: values2, error: error3, read: read2, done: done2 } = Bun.JSONL.parseChunk(input);
    return { values: values2, error: error3, read: read2, done: done2 };
  }
  const start = beg ?? 0;
  const stop = end ?? input.length;
  const { values, error: error2, read, done } = Bun.JSONL.parseChunk(input, start, stop);
  return { values, error: error2, read, done };
}
class ConcatSink {
  #space;
  #length = 0;
  #ensureCapacity(size) {
    const space = this.#space;
    if (space && space.length >= size)
      return space;
    const nextSize = space ? Math.max(size, space.length * 2) : size;
    const next = Buffer.allocUnsafe(nextSize);
    if (space && this.#length > 0) {
      space.copy(next, 0, 0, this.#length);
    }
    this.#space = next;
    return next;
  }
  append(chunk) {
    const n = chunk.length;
    if (!n)
      return;
    const offset = this.#length;
    const space = this.#ensureCapacity(offset + n);
    space.set(chunk, offset);
    this.#length += n;
  }
  reset(chunk) {
    const n = chunk.length;
    if (!n) {
      this.#length = 0;
      return;
    }
    const space = this.#ensureCapacity(n);
    space.set(chunk, 0);
    this.#length = n;
  }
  get isEmpty() {
    return this.#length === 0;
  }
  flush() {
    if (!this.#length)
      return;
    return this.#space.subarray(0, this.#length);
  }
  clear() {
    this.#length = 0;
  }
  *appendAndFlushLines(chunk, maxLineBytes) {
    let pos = 0;
    while (pos < chunk.length) {
      const nl = chunk.indexOf(LF, pos);
      if (nl === -1) {
        if (maxLineBytes && this.#length + chunk.length - pos > maxLineBytes()) {
          throw new Error("SSE event exceeds size limit");
        }
        this.append(chunk.subarray(pos));
        return;
      }
      const suffix = chunk.subarray(pos, nl);
      pos = nl + 1;
      if (maxLineBytes && this.#length + suffix.length + 1 > maxLineBytes()) {
        throw new Error("SSE event exceeds size limit");
      }
      if (this.isEmpty) {
        yield suffix;
      } else {
        this.append(suffix);
        const payload = this.flush();
        if (payload) {
          yield payload;
          this.clear();
        }
      }
    }
  }
  *pullJSONL(chunk, beg, end) {
    if (this.isEmpty) {
      const { values: values2, error: error3, read: read2, done: done2 } = parseJsonlChunkCompat(chunk, beg, end);
      if (values2.length > 0) {
        yield* values2;
      }
      if (error3)
        throw error3;
      if (done2)
        return;
      this.reset(chunk.subarray(read2, end));
      return;
    }
    const offset = this.#length;
    const n = end - beg;
    const total = offset + n;
    const space = this.#ensureCapacity(total);
    space.set(chunk.subarray(beg, end), offset);
    this.#length = total;
    const { values, error: error2, read, done } = parseJsonlChunkCompat(space.subarray(0, total), 0, total);
    if (values.length > 0) {
      yield* values;
    }
    if (error2)
      throw error2;
    if (done) {
      this.#length = 0;
      return;
    }
    const rem = total - read;
    if (rem < total) {
      space.copyWithin(0, read, total);
    }
    this.#length = rem;
  }
}
var SSE_LINE_DECODER = new TextDecoder("utf-8");
// node_modules/@gajae-code/utils/src/tab-spacing.ts
var tabWidthChangeListeners = new Set;
var editorConfigCache = new Map;
var editorConfigChainCache = new Map;
var indentationCache = new Map;
// node_modules/@gajae-code/utils/src/temp.ts
import * as fs10 from "fs";
import * as os5 from "os";
import * as path9 from "path";

class TempDir {
  #path;
  constructor(path10) {
    this.#path = path10;
  }
  static createSync(prefix) {
    return new TempDir(fs10.mkdtempSync(normalizePrefix(prefix)));
  }
  static async create(prefix) {
    return new TempDir(await fs10.promises.mkdtemp(normalizePrefix(prefix)));
  }
  #removePromise = null;
  path() {
    return this.#path;
  }
  absolute() {
    return path9.resolve(this.#path);
  }
  remove() {
    if (this.#removePromise) {
      return this.#removePromise;
    }
    const removePromise = fs10.promises.rm(this.#path, { recursive: true, force: true });
    this.#removePromise = removePromise;
    return removePromise;
  }
  removeSync() {
    fs10.rmSync(this.#path, { recursive: true, force: true });
    this.#removePromise = Promise.resolve();
  }
  toString() {
    return this.#path;
  }
  join(...paths) {
    return path9.join(this.#path, ...paths);
  }
  async[Symbol.asyncDispose]() {
    try {
      await this.remove();
    } catch {}
  }
  [Symbol.dispose]() {
    try {
      this.removeSync();
    } catch {}
  }
}
var kTempDir = os5.tmpdir();
function normalizePrefix(prefix) {
  if (!prefix) {
    return `${kTempDir}${path9.sep}pi-temp-`;
  } else if (prefix.startsWith("@")) {
    return path9.join(kTempDir, prefix.slice(1));
  }
  return prefix;
}
// node_modules/@gajae-code/coding-agent/src/gjc-runtime/linux-proc.ts
import * as nodeFsSync from "fs";
function parseLinuxProcIdentity(stat) {
  if (!stat || stat.includes("\x00") || stat.includes("\r"))
    return null;
  const record = stat.endsWith(`
`) ? stat.slice(0, -1) : stat;
  if (!record || record.includes(`
`))
    return null;
  const open = record.indexOf(" (");
  const close = record.lastIndexOf(")");
  if (open < 1 || close <= open + 1 || !/^[1-9]\d*$/.test(record.slice(0, open)))
    return null;
  const suffix = record.slice(close + 1);
  if (!/^[ \t]+/.test(suffix))
    return null;
  const fields = suffix.trim().split(/[ \t]+/);
  if (fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]))
    return null;
  const ttyDevice = fields[4];
  const startTime = fields[19];
  if (!ttyDevice || !/^-?\d+$/.test(ttyDevice) || !/^\d+$/.test(startTime))
    return null;
  return { state: fields[0], startTime, ttyDevice };
}
function classifyProcReadError(error2) {
  const code = error2?.code;
  if (code === "ENOENT" || code === "ESRCH")
    return { kind: "absent" };
  if (code === "EACCES" || code === "EPERM")
    return { kind: "unverifiable", reason: "permission_denied" };
  return { kind: "unverifiable", reason: "read_error" };
}
function probeLinuxProcPidSync(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    return { kind: "unverifiable", reason: "invalid_pid" };
  if (process.platform !== "linux")
    return { kind: "unverifiable", reason: "unsupported_platform" };
  let stat;
  try {
    stat = nodeFsSync.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error2) {
    return classifyProcReadError(error2);
  }
  const identity = parseLinuxProcIdentity(stat);
  return identity ? { kind: "live", ...identity } : { kind: "unverifiable", reason: "malformed_stat" };
}
function readLinuxProcStartTimeSync(pid) {
  const probe = probeLinuxProcPidSync(pid);
  return probe.kind === "live" ? probe.startTime : null;
}

// node_modules/@gajae-code/coding-agent/src/sdk/broker/process-incarnation.ts
import { dlopen, ptr } from "bun:ffi";
var DARWIN_PROC_PIDTBSDINFO = 3;
var DARWIN_PROC_BSDINFO_SIZE = 136;
var DARWIN_PROC_BSDINFO_START_SECONDS_OFFSET = 120;
var DARWIN_PROC_BSDINFO_START_MICROSECONDS_OFFSET = 128;
var POWERSHELL_PROCESS_INCARNATION_COMMAND = "powershell.exe";
var WIN32_PROCESS_INCARNATION_OUTPUT = /^(\d+)\t(0|[1-9]\d*)(?:\r?\n)?$/;
var MAX_WINDOWS_FILETIME_TICKS = 18446744073709551615n;
var darwinProcLibrary = process.platform === "darwin" ? (() => {
  try {
    return dlopen("/usr/lib/libproc.dylib", {
      proc_pidinfo: {
        args: ["i32", "i32", "u64", "ptr", "i32"],
        returns: "i32"
      }
    });
  } catch {
    return;
  }
})() : undefined;
var WIN32_INCARNATION_TIMEOUT_MS = 5000;
function runProcessIncarnationCommand(command, args) {
  try {
    const result = Bun.spawnSync([command, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
      timeout: WIN32_INCARNATION_TIMEOUT_MS,
      killSignal: "SIGKILL"
    });
    return { exitCode: result.exitCode, stdout: Buffer.from(result.stdout).toString("utf8") };
  } catch {
    return;
  }
}
function windowsProcessIncarnationCommand(pid) {
  return {
    command: POWERSHELL_PROCESS_INCARNATION_COMMAND,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop'",
        "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
        "$filetime = [UInt64]($process.StartTime.ToUniversalTime().ToFileTimeUtc())",
        '[Console]::Out.WriteLine(("{0}`t{1}" -f $process.Id, $filetime))'
      ].join("; ")
    ]
  };
}
function isWindowsFiletimeTicks(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(value))
    return false;
  try {
    return BigInt(value) <= MAX_WINDOWS_FILETIME_TICKS;
  } catch {
    return false;
  }
}
function parseWin32ProcessIncarnation(pid, output) {
  const match = WIN32_PROCESS_INCARNATION_OUTPUT.exec(output);
  if (!match || match[1] !== String(pid) || !isWindowsFiletimeTicks(match[2]))
    return;
  return `windows:${match[2]}`;
}
function parseDarwinProcessIncarnation(info2) {
  if (info2.byteLength < DARWIN_PROC_BSDINFO_SIZE)
    return;
  try {
    const view = new DataView(info2.buffer, info2.byteOffset, info2.byteLength);
    const seconds = view.getBigUint64(DARWIN_PROC_BSDINFO_START_SECONDS_OFFSET, true);
    const microseconds = view.getBigUint64(DARWIN_PROC_BSDINFO_START_MICROSECONDS_OFFSET, true);
    if (seconds === 0n || microseconds >= 1000000n)
      return;
    return `darwin:${seconds}:${microseconds}`;
  } catch {
    return;
  }
}
function isProcessIncarnation(value) {
  return typeof value === "string" && (/^(?:linux:\d+|darwin:[1-9]\d*:\d+)$/.test(value) || value.startsWith("windows:") && isWindowsFiletimeTicks(value.slice("windows:".length)));
}
function processIncarnation(pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    return;
  const platform2 = options.platform ?? process.platform;
  if (platform2 === process.platform && options.runCommand === undefined) {
    try {
      const nativeProcess = nativeProcessBindings().Process.fromPid(pid);
      if (nativeProcess === null)
        return;
      if (isProcessIncarnation(nativeProcess?.incarnation))
        return nativeProcess.incarnation;
    } catch {}
  }
  if (platform2 === "linux") {
    const startTicks = readLinuxProcStartTimeSync(pid);
    return startTicks ? `linux:${startTicks}` : undefined;
  }
  if (platform2 === "darwin") {
    const info2 = new Uint8Array(DARWIN_PROC_BSDINFO_SIZE);
    try {
      const bytesRead = darwinProcLibrary?.symbols.proc_pidinfo(pid, DARWIN_PROC_PIDTBSDINFO, 0, ptr(info2), info2.byteLength);
      return bytesRead === DARWIN_PROC_BSDINFO_SIZE ? parseDarwinProcessIncarnation(info2) : undefined;
    } catch {
      return;
    }
  }
  if (platform2 === "win32") {
    const command = windowsProcessIncarnationCommand(pid);
    let result;
    try {
      result = (options.runCommand ?? runProcessIncarnationCommand)(command.command, command.args);
    } catch {
      return;
    }
    return result?.exitCode === 0 && typeof result.stdout === "string" ? parseWin32ProcessIncarnation(pid, result.stdout) : undefined;
  }
  return;
}

// node_modules/@gajae-code/coding-agent/src/utils/herdr-pane.ts
var HERDR_ENV = "HERDR_ENV";
var HERDR_PANE_ID_ENV = "HERDR_PANE_ID";
var HERDR_BIN_PATH_ENV = "HERDR_BIN_PATH";
var HERDR_PANE_OWNER_ENV = "GJC_HERDR_PANE_OWNER";
var HERDR_PANE_OWNER_VERSION = 1;
var HERDR_SOCKET_PATH_ENV = "HERDR_SOCKET_PATH";
var HERDR_COMMAND = "herdr";
var HERDR_SEQUENCE_STATE_PATH = path10.join(os6.tmpdir(), "gjc-herdr-sequence-v1");
var PROCESS_OWNER_TOKEN = crypto2.randomUUID();
var sequenceFloor = 0;
function readSequenceFloor() {
  try {
    const value = Number.parseInt(fs11.readFileSync(HERDR_SEQUENCE_STATE_PATH, "utf8"), 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}
function persistSequenceFloor(value) {
  try {
    const directory = path10.dirname(HERDR_SEQUENCE_STATE_PATH);
    fs11.mkdirSync(directory, { recursive: true, mode: 448 });
    const temporary = `${HERDR_SEQUENCE_STATE_PATH}.${process.pid}.${crypto2.randomUUID()}.tmp`;
    fs11.writeFileSync(temporary, String(value), { encoding: "utf8", mode: 384 });
    fs11.renameSync(temporary, HERDR_SEQUENCE_STATE_PATH);
  } catch (error2) {
    exports_logger.debug("herdr sequence watermark persistence failed", { error: String(error2) });
  }
}
function initialSeq() {
  sequenceFloor = Math.max(sequenceFloor + 1001, readSequenceFloor() + 1001, Date.now() * 1000);
  persistSequenceFloor(sequenceFloor);
  return sequenceFloor;
}
var metadataSeq = initialSeq();
var lastReportedTitles = new WeakMap;

class HerdrTitleScope {
}
var standaloneTitleScope = new HerdrTitleScope;
function resolveHerdrPaneEnvironment(options = {}) {
  const env2 = options.env ?? process.env;
  if (env2[HERDR_ENV]?.trim() !== "1")
    return null;
  const paneId = env2[HERDR_PANE_ID_ENV]?.trim();
  if (!paneId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(paneId))
    return null;
  if (!mayClaimPane(env2, paneId, options))
    return null;
  const socketPath = env2[HERDR_SOCKET_PATH_ENV]?.trim() || undefined;
  const configured = env2[HERDR_BIN_PATH_ENV]?.trim();
  if (configured)
    return { paneId, binPath: configured, socketPath };
  const which2 = options.which ?? Bun.which;
  try {
    const resolved = which2(HERDR_COMMAND);
    return resolved ? { paneId, binPath: resolved, socketPath } : null;
  } catch (error2) {
    exports_logger.debug("herdr binary lookup failed", { error: String(error2) });
    return null;
  }
}
function readOwnerMarker(value) {
  if (!value)
    return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const marker = parsed;
    if (marker.version !== HERDR_PANE_OWNER_VERSION || typeof marker.paneId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(marker.paneId) || typeof marker.pid !== "number" || !Number.isSafeInteger(marker.pid) || marker.pid <= 0 || marker.incarnation !== undefined && typeof marker.incarnation !== "string" || typeof marker.token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(marker.token))
      return null;
    return {
      version: HERDR_PANE_OWNER_VERSION,
      paneId: marker.paneId,
      pid: marker.pid,
      ...marker.incarnation === undefined ? {} : { incarnation: marker.incarnation },
      token: marker.token
    };
  } catch {
    return null;
  }
}
function ownerIncarnation(pid, options) {
  try {
    return (options.processIncarnation ?? processIncarnation)(pid);
  } catch (error2) {
    exports_logger.debug("herdr owner identity lookup failed", { error: String(error2) });
    return;
  }
}
function defaultProcessProbe(pid, expectedIncarnation) {
  if (process.platform === "linux") {
    const probe = probeLinuxProcPidSync(pid);
    if (probe.kind === "absent")
      return { state: "absent" };
    if (probe.kind !== "live")
      return { state: "unverifiable" };
    return `linux:${probe.startTime}` === expectedIncarnation ? { state: "live", incarnation: expectedIncarnation } : { state: "live", incarnation: `linux:${probe.startTime}` };
  }
  try {
    const processHandle = nativeProcessBindings().Process.fromPid(pid);
    if (processHandle === null)
      return { state: "absent" };
    if (typeof processHandle.incarnation !== "string")
      return { state: "unverifiable" };
    return { state: "live", incarnation: processHandle.incarnation };
  } catch (error2) {
    exports_logger.debug("herdr owner process probe failed", { error: String(error2) });
    return { state: "unverifiable" };
  }
}
function inspectOwnerProcess(marker, options) {
  if (options.processProbe) {
    const probe2 = options.processProbe(marker.pid);
    if (probe2.state === "absent")
      return "absent";
    if (probe2.state === "unverifiable")
      return "unverifiable";
    return probe2.incarnation === marker.incarnation ? "live" : "reused";
  }
  if (options.processIncarnation) {
    const incarnation = ownerIncarnation(marker.pid, options);
    if (incarnation === undefined)
      return "absent";
    return incarnation === marker.incarnation ? "live" : "reused";
  }
  const probe = defaultProcessProbe(marker.pid, marker.incarnation ?? "");
  if (probe.state === "absent")
    return "absent";
  if (probe.state === "unverifiable")
    return "unverifiable";
  return probe.incarnation === marker.incarnation ? "live" : "reused";
}
function mayClaimPane(env2, paneId, options) {
  const raw = env2[HERDR_PANE_OWNER_ENV]?.trim();
  if (!raw)
    return true;
  const marker = readOwnerMarker(raw);
  if (!marker || marker.paneId !== paneId)
    return true;
  const pid = options.pid ?? process.pid;
  if (marker.pid === pid) {
    if (marker.token === PROCESS_OWNER_TOKEN)
      return true;
    delete env2[HERDR_PANE_OWNER_ENV];
    return true;
  }
  if (!marker.incarnation)
    return false;
  const ownerState = inspectOwnerProcess(marker, options);
  if (ownerState === "live" || ownerState === "unverifiable")
    return false;
  delete env2[HERDR_PANE_OWNER_ENV];
  return true;
}

// src/metadata.ts
import { randomUUID as randomUUID2 } from "crypto";
var MODEL_KEY = "gjc_herdr_model";
var SESSION_KEY = "gjc_herdr_session";
var TTL_MS = 60000;
var REFRESH_MS = 20000;
function isMainSession(ctx) {
  return ctx.sessionMetadata?.kind === "main" && ctx.sessionMetadata.taskDepth === 0;
}
function displayValue(value) {
  if (value === undefined)
    return;
  const text = Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()).slice(0, 80).join("");
  return text || undefined;
}
function reportArgs(pane, source, seq, values) {
  const args = [
    "pane",
    "report-metadata",
    pane,
    "--source",
    source,
    "--agent",
    "gjc",
    "--applies-to-source",
    "custom:gjc",
    "--seq",
    String(seq),
    "--ttl-ms",
    String(TTL_MS)
  ];
  for (const [key, value] of [
    [MODEL_KEY, values.model],
    [SESSION_KEY, values.session]
  ]) {
    const text = displayValue(value);
    args.push(...text === undefined ? ["--clear-token", key] : ["--token", `${key}=${text}`]);
  }
  return args;
}
function createReporter(exec, pane, binPath) {
  const source = `gjc-herdr:${randomUUID2()}`;
  let seq = 0;
  return async (values) => {
    const result = await exec(binPath, reportArgs(pane, source, ++seq, values), { timeout: 3000 });
    if (result.code !== 0 || result.killed) {
      throw new Error(`Herdr metadata report failed (exit ${result.code}, killed ${result.killed})`);
    }
  };
}

// src/extension.ts
function herdrMetadata(api) {
  api.logger.info("gjc-herdr extension loaded");
  const pane = resolveHerdrPaneEnvironment({ env: { ...process.env } });
  if (!pane)
    return;
  const report = createReporter(api.exec.bind(api), pane.paneId, pane.binPath);
  let context;
  let timer;
  let stopping = false;
  let tail = Promise.resolve();
  function enqueue(action) {
    tail = tail.then(action).catch((error2) => {
      api.logger.warn("gjc-herdr metadata update failed", {
        reason: error2 instanceof Error ? error2.message : "Unknown metadata error"
      });
    });
    return tail;
  }
  function refresh() {
    return enqueue(async () => {
      if (stopping || !context || !isMainSession(context))
        return;
      const model = context.model;
      await report({
        model: model ? `${model.provider}/${model.id}` : undefined,
        session: api.getSessionName()
      });
    });
  }
  async function update(_event, ctx) {
    if (stopping || !isMainSession(ctx))
      return;
    context = ctx;
    if (!timer) {
      timer = setInterval(() => {
        refresh();
      }, REFRESH_MS);
      timer.unref();
    }
    await refresh();
  }
  api.on("session_start", update);
  api.on("session_switch", update);
  api.on("agent_start", update);
  api.on("agent_end", update);
  api.on("session_shutdown", async () => {
    stopping = true;
    if (timer)
      clearInterval(timer);
    if (context)
      await enqueue(() => report({}));
  });
}
export {
  herdrMetadata as default
};
