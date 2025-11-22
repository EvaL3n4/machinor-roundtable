export class Logger {
    constructor(debugMode = false, prefix = "[Machinor Roundtable]") {
        this.debugMode = debugMode;
        this.prefix = prefix;
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    log(message, ...args) {
        if (this.debugMode) {
            console.log(`${this.prefix} ${message}`, ...args);
        }
    }

    warn(message, ...args) {
        console.warn(`${this.prefix} ${message}`, ...args);
    }

    error(message, ...args) {
        console.error(`${this.prefix} ${message}`, ...args);
    }

    debug(message, ...args) {
        if (this.debugMode) {
            console.log(`${this.prefix} [DEBUG] ${message}`, ...args);
        }
    }
}

export const logger = new Logger();