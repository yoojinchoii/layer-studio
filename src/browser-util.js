// ag-psd references util.inspect only in optional debug logging paths.
export function inspect(value) { try { return JSON.stringify(value); } catch { return String(value); } }
