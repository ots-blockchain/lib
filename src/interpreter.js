import Decimal from 'decimal.js';
import { consts, costs } from './config.js';

const BLACKLIST = ['__proto__', 'constructor', 'prototype'];

const isNumeric = (val) => {
    if (typeof val === 'number') return !Number.isNaN(val);
    if (typeof val === 'bigint') return true;
    if (val instanceof Decimal) return !val.isNaN();
    if (typeof val === 'object' && val !== null && val['__bigint'] === true) return true;
    return false;
};

const tryParseDecimal = (val) => {
    if (val instanceof Decimal) return val.isNaN() ? null : val;
    if (typeof val === 'number') return Number.isNaN(val) ? null : new Decimal(val);
    if (typeof val === 'bigint') return new Decimal(val.toString());
    if (typeof val === 'object' && val !== null && val['__bigint'] === true) return new Decimal(val.value);
    if (typeof val === 'boolean') return new Decimal(val ? 1 : 0);
    if (typeof val === 'string' && val.trim() !== '') {
        try {
            const d = new Decimal(val);
            return d.isNaN() ? null : d;
        } catch {
            return null;
        }
    }
    return null;
};

const toDec = (val) => {
    const d = tryParseDecimal(val);
    return d !== null ? d : new Decimal(0);
};

const toNum = (val) => {
    if (val instanceof Decimal) return val.toNumber();
    if (typeof val === 'bigint') return Number(val);
    if (typeof val === 'object' && val !== null && val['__bigint'] === true) return Number(val.value);
    const n = Number(val);
    return Number.isNaN(n) ? 0 : n;
};

const isTruthy = (val) => {
    if (!val) return false;
    if (val instanceof Decimal) return !val.isZero() && !val.isNaN();
    if (typeof val === 'object' && val['__bigint'] === true) return val.value !== '0' && val.value !== '';
    return true;
};

export class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.vars = new Map();
    }
    get(name) {
        if (this.vars.has(name)) return this.vars.get(name);
        if (this.parent) return this.parent.get(name);
        return undefined;
    }
    define(name, value) {
        this.vars.set(name, value);
    }
    set(name, value) {
        if (this.vars.has(name)) {
            this.vars.set(name, value);
            return;
        }
        if (this.parent && this.parent.has(name)) {
            this.parent.set(name, value);
            return;
        }
        this.vars.set(name, value);
    }
    has(name) {
        if (this.vars.has(name)) return true;
        if (this.parent) return this.parent.has(name);
        return false;
    }
    delete(name) {
        if (this.vars.has(name)) return this.vars.delete(name);
        if (this.parent) return this.parent.delete(name);
        return false;
    }
}

export class VM {
    constructor(gasTracker, extraFuncs = {}) {
        this.gasTracker = gasTracker;
        this.globalScope = new Scope();
        this.currentScope = this.globalScope;
        this.callDepth = 0;
        this.extraFuncs = extraFuncs;
        const stack = [];
        stack.all = stack;
        stack.user = [];
        stack.host = [];
        this.callStackTrace = stack;
        this.initBuiltins();
    }

    useGas(amount) {
        const cost = BigInt(amount);
        if (this.gasTracker.amount < cost) {
            this.gasTracker.amount = 0n;
            throw new Error('Out of Gas!');
        }
        this.gasTracker.amount -= cost;
    }

    chargeMemory(size) {
        this.useGas(BigInt(size) * costs.MEMORY_BYTE);
    }

    initBuiltins() {
        const funcs = {
            writeVar: (name, value) => {
                this.useGas(costs.WRITE_VAR);
                if (!name || name.length > consts.VARNAME_LENGTH_LIMIT) throw new Error('Incorrect variable name');
                if (funcs[name] || this.extraFuncs[name]) throw new Error('Cannot write a read-only variable');
                this.currentScope.set(name, value);
            },
            deleteVar: (name) => {
                this.useGas(costs.DEFAULT);
                if (!name || name.length > consts.VARNAME_LENGTH_LIMIT) throw new Error('Incorrect variable name');
                if (funcs[name] || this.extraFuncs[name]) throw new Error('Cannot delete a read-only variable');
                return this.currentScope.delete(name);
            },
            readVar: (name) => {
                this.useGas(costs.DEFAULT);
                if (!name || name.length > consts.VARNAME_LENGTH_LIMIT) throw new Error('Incorrect variable name');
                return this.currentScope.get(name);
            },
            readGas: () => {
                this.useGas(costs.DEFAULT);
                return BigInt(this.gasTracker.amount);
            },

            execFunc: async (funcBody) => {
                const stmts = (funcBody && funcBody.raw) ? funcBody.raw : (Array.isArray(funcBody) ? funcBody : [funcBody]);

                for (let i = 0; i < stmts.length; i++) {
                    const inst = stmts[i];
                    if (Array.isArray(inst) && inst[0] === 'writeFunc') {
                        await this.resolveArg(inst);
                    }
                }

                let result;
                for (let i = 0; i < stmts.length; i++) {
                    this.useGas(costs.INSTRUCTION);
                    const inst = stmts[i];

                    result = Array.isArray(inst)
                        ? await this.resolveArg(inst)
                        : inst;

                    if (result && typeof result === 'object' && result.type) {
                        return result;
                    }
                }
                return result;
            },

            break: () => ({ type: 'break' }),
            continue: () => ({ type: 'continue' }),

            while: async (condition, funcBody) => {
                while (true) {
                    this.useGas(costs.DEFAULT);
                    const condVal = await this.resolveArg(condition);
                    if (!isTruthy(condVal)) break;
                    const result = await funcs.execFunc(funcBody);
                    if (result) {
                        if (result.type === 'return') return result;
                        if (result.type === 'break') break;
                        if (result.type === 'continue') continue;
                    }
                }
            },

            return: (value) => ({ type: 'return', value }),

            writeFunc: (name, paramNames, body) => {
                let params = paramNames;
                if (paramNames && paramNames.raw) {
                    params = paramNames.raw;
                } else if (!Array.isArray(paramNames)) {
                    if (body === undefined) {
                        body = paramNames;
                        params = [];
                    } else {
                        params = [];
                    }
                }
                const funcBody = (body && body.raw) ? body.raw : (Array.isArray(body) ? body : [body]);

                this.currentScope.define(name, funcs.createFunc(params, funcBody));
            },

            makeFunc: (paramNames, body) => {
                let params = paramNames;
                if (paramNames && paramNames.raw) {
                    params = paramNames.raw;
                } else if (!Array.isArray(paramNames)) {
                    if (body === undefined) {
                        body = paramNames;
                        params = [];
                    } else {
                        params = [];
                    }
                }
                const funcBody = (body && body.raw) ? body.raw : (Array.isArray(body) ? body : [body]);

                return funcs.createFunc(params, funcBody);
            },

            add: (a, b) => {
                this.useGas(costs.DEFAULT);
                if (typeof a === 'string' || typeof b === 'string') {
                    const res = String(a ?? '') + String(b ?? '');
                    if (res.length > consts.MAX_STRING_LENGTH) throw new Error("String length limit exceeded");
                    this.chargeMemory(res.length);
                    return res;
                }
                return toDec(a).add(toDec(b));
            },
            sub: (a, b) => {
                this.useGas(costs.DEFAULT);
                return toDec(a).sub(toDec(b));
            },
            mul: (a, b) => {
                this.useGas(costs.DEFAULT);
                return toDec(a).mul(toDec(b));
            },
            div: (a, b) => {
                this.useGas(costs.DEFAULT);
                const divisor = toDec(b);
                if (divisor.isZero()) throw new Error("Division by zero");
                return toDec(a).div(divisor);
            },
            mod: (a, b) => {
                this.useGas(costs.DEFAULT);
                const divisor = toDec(b);
                if (divisor.isZero()) throw new Error("Division by zero");
                return toDec(a).mod(divisor);
            },

            pow: (a, b) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).pow(toDec(b));
            },
            sqrt: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).sqrt();
            },
            cbrt: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).cbrt();
            },

            sin: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).sin();
            },
            cos: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).cos();
            },
            tan: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).tan();
            },
            asin: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).asin();
            },
            acos: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).acos();
            },
            atan: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).atan();
            },

            log: (a, b) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).log(toDec(b));
            },
            ln: (a) => {
                this.useGas(costs.COMPLEX_MATH);
                return toDec(a).ln();
            },

            abs: (a) => {
                this.useGas(costs.DEFAULT);
                return toDec(a).abs();
            },
            ceil: (a) => {
                this.useGas(costs.DEFAULT);
                return toDec(a).ceil();
            },
            floor: (a) => {
                this.useGas(costs.DEFAULT);
                return toDec(a).floor();
            },
            round: (a) => {
                this.useGas(costs.DEFAULT);
                return toDec(a).round();
            },

            isEqual: (a, b) => {
                this.useGas(costs.DEFAULT);
                if (a == null && b == null) return true;
                if (a == null || b == null) return false;

                if (typeof a === 'string' && typeof b === 'string') {
                    return a === b;
                }
                if (typeof a === 'boolean' && typeof b === 'boolean') {
                    return a === b;
                }

                if (isNumeric(a) && isNumeric(b)) {
                    const da = tryParseDecimal(a);
                    const db = tryParseDecimal(b);
                    if (da !== null && db !== null) return da.eq(db);
                }

                if ((typeof a === 'string' && isNumeric(b)) || (isNumeric(a) && typeof b === 'string')) {
                    const da = tryParseDecimal(a);
                    const db = tryParseDecimal(b);
                    if (da !== null && db !== null) return da.eq(db);
                    return false;
                }

                if (typeof a === 'boolean' || typeof b === 'boolean') {
                    const da = tryParseDecimal(a);
                    const db = tryParseDecimal(b);
                    if (da !== null && db !== null) return da.eq(db);
                    return false;
                }

                return a === b;
            },

            isEqualType: (a, b) => {
                this.useGas(costs.DEFAULT);
                if (a === b) return true;
                if (a === null || b === null || a === undefined || b === undefined) return a === b;

                if (typeof a === 'string' && typeof b === 'string') {
                    return a === b;
                }
                if (typeof a === 'boolean' && typeof b === 'boolean') {
                    return a === b;
                }
                if (isNumeric(a) && isNumeric(b)) {
                    const da = tryParseDecimal(a);
                    const db = tryParseDecimal(b);
                    if (da !== null && db !== null) return da.eq(db);
                }
                return false;
            },

            isNotEqual: (a, b) => {
                return !funcs.isEqual(a, b);
            },

            isNotEqualType: (a, b) => {
                return !funcs.isEqualType(a, b);
            },

            isGreater: (a, b) => {
                this.useGas(costs.DEFAULT);
                if (a == null || b == null) return false;
                if (typeof a === 'string' && typeof b === 'string') return a > b;
                const da = tryParseDecimal(a);
                const db = tryParseDecimal(b);
                if (da !== null && db !== null) return da.gt(db);
                return false;
            },

            isLower: (a, b) => {
                this.useGas(costs.DEFAULT);
                if (a == null || b == null) return false;
                if (typeof a === 'string' && typeof b === 'string') return a < b;
                const da = tryParseDecimal(a);
                const db = tryParseDecimal(b);
                if (da !== null && db !== null) return da.lt(db);
                return false;
            },

            isEqualGreater: (a, b) => {
                this.useGas(costs.DEFAULT);
                if (a == null || b == null) return false;
                if (typeof a === 'string' && typeof b === 'string') return a >= b;
                const da = tryParseDecimal(a);
                const db = tryParseDecimal(b);
                if (da !== null && db !== null) return da.gte(db);
                return false;
            },

            isEqualLower: (a, b) => {
                this.useGas(costs.DEFAULT);
                if (a == null || b == null) return false;
                if (typeof a === 'string' && typeof b === 'string') return a <= b;
                const da = tryParseDecimal(a);
                const db = tryParseDecimal(b);
                if (da !== null && db !== null) return da.lte(db);
                return false;
            },

            not: (a) => {
                this.useGas(costs.DEFAULT);
                return !isTruthy(a);
            },
            and: (a, b) => {
                this.useGas(costs.DEFAULT);
                return isTruthy(a) ? b : a;
            },
            or: (a, b) => {
                this.useGas(costs.DEFAULT);
                return isTruthy(a) ? a : b;
            },
            bitAnd: (a, b) => {
                this.useGas(costs.DEFAULT);
                return (toNum(a) & toNum(b)) >>> 0;
            },
            bitOr: (a, b) => {
                this.useGas(costs.DEFAULT);
                return (toNum(a) | toNum(b)) >>> 0;
            },
            bitXor: (a, b) => {
                this.useGas(costs.DEFAULT);
                return (toNum(a) ^ toNum(b)) >>> 0;
            },
            bitNot: (a) => {
                this.useGas(costs.DEFAULT);
                return (~toNum(a)) >>> 0;
            },
            bitShl: (a, b) => {
                this.useGas(costs.DEFAULT);
                return (toNum(a) << toNum(b)) >>> 0;
            },
            bitShr: (a, b) => {
                this.useGas(costs.DEFAULT);
                return toNum(a) >>> toNum(b);
            },

            parseInt: (a, radix) => {
                this.useGas(costs.DEFAULT);
                const str = a instanceof Decimal ? a.toString() : String(a ?? 0);
                const res = parseInt(str, radix ? toNum(radix) : 10);
                return Number.isNaN(res) ? 0 : res;
            },
            parseFloat: (a) => {
                this.useGas(costs.DEFAULT);
                const str = a instanceof Decimal ? a.toString() : String(a ?? 0);
                const res = parseFloat(str);
                return Number.isNaN(res) ? 0 : res;
            },
            toBigInt: (a) => {
                this.useGas(costs.DEFAULT);
                if (a === null || a === undefined) return 0n;
                if (typeof a === 'bigint') return a;
                if (a instanceof Decimal) {
                    return BigInt(a.floor().toFixed(0));
                }
                if (typeof a === 'object' && a['__bigint'] === true) return BigInt(a.value);
                try {
                    return BigInt(typeof a === 'number' ? Math.floor(a) : a);
                } catch {
                    const n = parseInt(a);
                    return Number.isNaN(n) ? 0n : BigInt(n);
                }
            },
            toString: (a) => {
                this.useGas(costs.DEFAULT);
                if (a === null) return 'null';
                if (a === undefined) return 'undefined';
                if (a instanceof Decimal) return a.toString();
                if (typeof a === 'bigint') return a.toString();
                if (typeof a === 'object' && a['__bigint'] === true) return a.value;
                return String(a);
            },
            charCodeAt: (str, idx = 0) => {
                this.useGas(costs.DEFAULT);
                const s = String(str ?? '');
                const i = toNum(idx);
                if (i < 0 || i >= s.length) return null;
                return s.charCodeAt(i);
            },
            fromCharCode: (...codes) => {
                this.useGas(costs.DEFAULT);
                const chars = codes.map(c => String.fromCharCode(toNum(c))).join('');
                if (chars.length > consts.MAX_STRING_LENGTH) throw new Error("String length limit exceeded");
                this.chargeMemory(chars.length);
                return chars;
            },

            if: async (cond, t, f) => {
                const conditionMet = isTruthy(await this.resolveArg(cond));
                const target = conditionMet ? t : f;
                if (target) return await funcs.execFunc(target);
            },

            typeof: (a) => {
                this.useGas(costs.DEFAULT);
                if (a === null) return 'object';
                if (a instanceof Decimal) return 'number';
                if (typeof a === 'object' && a['__bigint'] === true) return 'bigint';
                return typeof a;
            },

            objectKeys: (o) => {
                this.useGas(costs.DEFAULT);
                if (!o || typeof o !== 'object') return [];
                return Object.keys(o);
            },
            objectValues: (o) => {
                this.useGas(costs.DEFAULT);
                if (!o || typeof o !== 'object') return [];
                return Object.values(o);
            },
            parseJSON: (js) => {
                try {
                    this.useGas(costs.CREATE_OBJECT);
                    const parsed = JSON.parse(js);
                    return parsed;
                } catch (e) {
                    return null;
                }
            },

            stringifyJSON: (obj) => {
                try {
                    this.useGas(costs.CREATE_OBJECT);
                    const js = JSON.stringify(obj);
                    return js;
                } catch (e) {
                    return null;
                }
            },

            readObjectKey: (obj, key) => {
                this.useGas(costs.DEFAULT);
                if (obj === null || obj === undefined) return undefined;
                const actualKey = key instanceof Decimal ? (key.isInteger() ? key.toNumber() : key.toString()) : key;
                if (BLACKLIST.includes(actualKey)) return undefined;
                return obj[actualKey];
            },

            writeObjectKey: (obj, key, val) => {
                this.useGas(costs.WRITE_VAR);
                if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
                const actualKey = key instanceof Decimal ? (key.isInteger() ? key.toNumber() : key.toString()) : key;
                if (BLACKLIST.includes(actualKey)) return undefined;
                this.chargeMemory(2);
                obj[actualKey] = val;
                return val;
            },

            createObject: async (elements) => {
                this.useGas(costs.CREATE_OBJECT);
                const newObj = Object.create(null);
                const elList = (elements && elements.raw) ? elements.raw : (Array.isArray(elements) ? elements : [elements]);

                for (const el of elList) {
                    if (el.type === 'spread') {
                        const sourceObj = await this.resolveArg(el.argument);
                        if (sourceObj && typeof sourceObj === 'object') {
                            const keys = Object.keys(sourceObj);
                            this.chargeMemory(keys.length * 2);

                            keys.forEach(key => {
                                if (!BLACKLIST.includes(key)) newObj[key] = sourceObj[key];
                            });
                        }
                    } else if (el.type === 'property') {
                        if (!BLACKLIST.includes(el.key)) {
                            this.chargeMemory(2);
                            newObj[el.key] = await this.resolveArg(el.value);
                        }
                    }
                }
                return newObj;
            },

            createArray: (...elements) => {
                this.useGas(costs.CREATE_OBJECT);
                this.chargeMemory(elements.length * 2);
                return elements;
            },
        };

        funcs.if.rawArgs = true;
        funcs.while.rawArgs = true;
        funcs.writeFunc.rawArgs = true;
        funcs.makeFunc.rawArgs = true;

        for (const [key, val] of Object.entries(funcs)) {
            if (typeof val === 'function') val.isHost = true;
            this.globalScope.define(key, val);
        }
        for (const [key, val] of Object.entries(this.extraFuncs)) {
            if (typeof val === 'function') val.isHost = true;
            this.globalScope.define(key, val);
        }

        funcs.createFunc = (paramNames, funcBody) => {
            return async (...args) => {
                this.callDepth++;
                if (this.callDepth > consts.MAX_CALL_DEPTH) throw new Error("Call stack overflow");
                const previousScope = this.currentScope;
                this.currentScope = new Scope(previousScope);

                try {
                    for (let i = 0; i < paramNames.length; i++) {
                        this.currentScope.define(paramNames[i], args[i]);
                    }
                    const returnVal = await funcs.execFunc(funcBody);
                    if (returnVal && returnVal.type === 'return') return returnVal.value;
                    return returnVal;
                } finally {
                    this.currentScope = previousScope;
                    this.callDepth--;
                }
            };
        };
    }

    async resolveArg(arg) {
        if (typeof arg !== 'object' || arg === null) return arg;

        if (Array.isArray(arg)) {
            if (arg.length === 0) return arg;

            const funcName = arg[0];
            if (typeof funcName === 'string') {
                const func = this.currentScope.get(funcName);
                if (typeof func === 'function') {
                    this.useGas(costs.FUNC_CALL);

                    if (func.rawArgs) {
                        return await func(...arg.slice(1));
                    }

                    const resolvedArgs = [];
                    for (let i = 1; i < arg.length; i++) {
                        resolvedArgs.push(await this.resolveArg(arg[i]));
                    }

                    const isHost = Boolean(func.isHost);
                    const callEntry = {
                        name: funcName,
                        args: resolvedArgs,
                        depth: this.callDepth,
                        timestamp: Date.now(),
                        type: isHost ? 'host' : 'user'
                    };

                    if (this.callStackTrace.all.length < 2000) {
                        this.callStackTrace.all.push(callEntry);
                    }

                    if (isHost) {
                        if (this.callStackTrace.host.length < 2000) {
                            this.callStackTrace.host.push(callEntry);
                        }
                    } else {
                        if (this.callStackTrace.user.length < 2000) {
                            this.callStackTrace.user.push(callEntry);
                        }
                    }

                    return await func(...resolvedArgs);
                } else {
                    throw new Error(`Unknown function: ${funcName}`);
                }
            }

            return arg;
        }

        if (arg.raw !== undefined) {
            return await this.resolveArg(arg.raw);
        }
        return arg;
    }

    async run(code) {
        try {
            if (Array.isArray(code)) {
                for (const inst of code) {
                    if (Array.isArray(inst) && inst[0] === 'writeFunc') {
                        await this.resolveArg(inst);
                    }
                }
            }

            let status = null;
            for (const inst of code) {
                status = await this.resolveArg(inst);
            }
            return {
                success: true,
                remainingGas: this.gasTracker.amount,
                status,
                callStack: this.callStackTrace
            };
        } catch (e) {
            return {
                success: false,
                error: e.message || e,
                remainingGas: this.gasTracker.amount,
                callStack: this.callStackTrace
            };
        }
    }
}

export async function start(code, extraFuncsArg = {}, gasTracker = { amount: 100000000000n }) {
    const vm = new VM(gasTracker || { amount: 100000000000n }, extraFuncsArg);
    return await vm.run(code);
}
