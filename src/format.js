export function toOts(val) {
    if (val === undefined || val === null) return '0';
    try {
        const isNegative = val < 0n;
        let s = (isNegative ? -val : val).toString();

        s = s.padStart(10, '0');

        const intPart = s.slice(0, -9);
        let decPart = s.slice(-9).replace(/0+$/, '');

        let result = decPart ? `${intPart}.${decPart}` : intPart;

        result = result.replace(/^0+(?=\d)/, '');
        if (result.startsWith('.')) result = '0' + result;

        return isNegative ? `-${result}` : result;
    } catch (e) {
        console.error("Format Error in toOts:", e);
        return '0';
    }
}

export function toNanoOts(valStr) {
    if (!valStr) return 0n;
    try {
        let s = valStr.toString().trim();
        const isNegative = s.startsWith('-');
        if (isNegative) s = s.slice(1);

        let [intPart, decPart] = s.split('.');
        if (!intPart) intPart = '0';
        if (!decPart) decPart = '0';

        decPart = decPart.padEnd(9, '0');
        decPart = decPart.slice(0, 9);

        let nanoString = `${intPart}${decPart}`;
        const result = BigInt(nanoString);
        return isNegative ? -result : result;
    } catch (e) {
        console.error("Format Error in toNanoOts:", e);
        return 0n;
    }
}
