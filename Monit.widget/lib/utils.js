// Custom Error
export class WidgetError extends Error {
    constructor(msg, status = 2) {
        super(msg);
        this.status = status;
    }
};

// Format string with "Hello {0}".format('World')
String.prototype.format = function() {
    var formatted = this;
    for (var arg in arguments) {
        formatted = formatted.replace("{" + arg + "}", arguments[arg]);
    }
    return formatted;
};

// String TitleCase
String.prototype.toTitleCase = function () {
    return this.replace(/(^|\s)([a-z])/g, function (m, p1, p2) { return p1 + p2.toUpperCase(); });
};


export const formatPing = (seconds) => {
    let ms = seconds * 1000;
    let rt = 0;

    if (ms > 1000) {
        rt = Math.round(ms) / 1000 + ' s';
    } else if (ms < 1) {
        rt = Math.round(ms * 100) / 100 + ' ms';
    } else {
        rt = Math.round(ms * 10) / 10 + ' ms';
    }
    return rt;
}

export const formatBytes = (kbytes, decimals = 2) => {
    if (kbytes === 0) return '0 KB';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(kbytes) / Math.log(k));

    return parseFloat((kbytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}