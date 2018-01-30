var tcp_wrap = process.binding('tcp_wrap')
var TCP = tcp_wrap.TCP;
var errno = require('util')._errnoException;

module.exports = function (addr, port) {
    if (typeof addr === 'number' || /^\d+$/.test(addr)) {
        var p = port;
        port = addr;
        addr = p;
    }
    if (!port) port = 0;
    if (!addr) addr = '0.0.0.0';
    var h = new TCP(tcp_wrap.constants && tcp_wrap.constants.SERVER);
    var r = /:/.test(addr)
        ? h.bind6(addr, port)
        : h.bind(addr, port)
    ;
    if (r) {
        error(r, 'bind');
    }
    
    var sock = {};
    if (/^v0\.10\./.test(process.version)) {
        sock = h.getsockname && h.getsockname();
        if (!sock || (port && port !== sock.port)) {
            error('EADDRINUSE', 'bind');
        }
        else return h.fd;
    }
    else {
        var s = h.getsockname && h.getsockname(sock);
        if (s || (port && port !== sock.port)) {
            error('EADDRINUSE', 'bind');
        }
        else {
            return h.fd;
        }
    }
};

function error (code, syscall) {
    if (process._errno) {
        var ex = new Error(syscall + ' ' + process._errno);
        ex.errno = ex.code = code;
        ex.syscall = syscall;
        throw ex;
    }
    else if (errno && code !== 'EADDRINUSE') {
        throw errno(code, syscall);
    }
    else {
        var ex = new Error(syscall + ' ' + code);
        ex.errno = code;
        ex.syscall = syscall;
        throw ex;
    }
}